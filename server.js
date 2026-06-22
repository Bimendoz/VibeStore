'use strict';
// VibeStore server — sirve la tienda + envía Web Push reales
// Escucha Firebase vía REST streaming (EventSource), sin credenciales admin.

const express = require('express');
const path    = require('path');
const webpush = require('web-push');
const https   = require('https');

const DB_BASE = 'https://data-base-store-3bbf8-default-rtdb.firebaseio.com';

// ── Claves VAPID ───────────────────────────────────────────────────────────────────────
const VAPID_PUBLIC  = 'BBddPNkEupysXpfhkNyhaNrYGqTAbigGlxyQAwckztPX_dJUWjBx3JHM4BRhagRu2lo2jFFmJNFI-nS7IhYugcE';
const VAPID_PRIVATE = 's-Zjoqw8alKFo5h1I8Xchq_rXUqWAKGJdJNNIn6tgIU';
webpush.setVapidDetails('mailto:admin@vibestore.app', VAPID_PUBLIC, VAPID_PRIVATE);
console.log('[WebPush] VAPID configurado ✓');

// ── Express: servir la tienda ───────────────────────────────────────────────────────────
const app  = express();
const PORT = process.env.PORT || 3000;
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => res.json({ status: 'ok', ts: Date.now() }));

app.use(express.static(__dirname, {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('sw.js')) {
            res.setHeader('Service-Worker-Allowed', '/');
            res.setHeader('Cache-Control', 'no-cache');
        }
    }
}));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.listen(PORT, () => console.log(`[Server] Puerto ${PORT}`));

// ── Helpers REST de Firebase ────────────────────────────────────────────────────────────
function fbGet(pathName) {
    return new Promise((resolve) => {
        https.get(`${DB_BASE}/${pathName}.json`, (res) => {
            let body = '';
            res.on('data', c => body += c);
            res.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve(null); } });
        }).on('error', () => resolve(null));
    });
}
function fbDelete(pathName) {
    const req = https.request(`${DB_BASE}/${pathName}.json`, { method: 'DELETE' }, () => {});
    req.on('error', () => {});
    req.end();
}

// ── Cache de suscripciones push ─────────────────────────────────────────────────────────
let subscriptions = {};
async function refreshSubs() {
    const data = await fbGet('chat/push');
    subscriptions = {};
    if (data) {
        for (const [id, val] of Object.entries(data)) {
            try { subscriptions[id] = JSON.parse(val); } catch {}
        }
    }
    console.log(`[WebPush] ${Object.keys(subscriptions).length} suscripciones`);
}
refreshSubs();
setInterval(refreshSubs, 20000); // refrescar cada 20s

// ── Enviar push a todos menos al remitente ──────────────────────────────────────────────
async function notifyOthers(senderId) {
    const targets = Object.entries(subscriptions).filter(([id]) => id !== senderId);
    if (!targets.length) {
        console.log('[WebPush] No hay destinatarios (solo el remitente esta suscrito)');
        return;
    }
    const payload = JSON.stringify({
        title: '🛍️ VibeStore — Oferta especial',
        body:  'Tienes una promoción disponible. ¡Entra ahora!',
        tag:   'vibestore-msg'
    });
    console.log(`[WebPush] Enviando a ${targets.length} destinatario(s)...`);
    for (const [userId, sub] of targets) {
        try {
            await webpush.sendNotification(sub, payload);
            console.log(`[WebPush] ✓ enviado a ${userId}`);
        } catch (err) {
            const code = err.statusCode || '?';
            console.warn(`[WebPush] ✗ error ${code} en ${userId}: ${err.body || err.message}`);
            if (err.statusCode === 410 || err.statusCode === 404) {
                fbDelete(`chat/push/${userId}`);
                delete subscriptions[userId];
                console.log(`[WebPush] suscripción ${userId} expirada/invalida, eliminada`);
            }
        }
    }
}

// ── Streaming REST: escuchar mensajes nuevos en tiempo real ──────────────────────────────
// Firebase Realtime DB soporta Server-Sent Events vía header Accept: text/event-stream
const SERVER_START = Date.now();
const seenKeys = new Set();   // claves de mensajes ya procesados, para no duplicar

function handleMessage(key, msg) {
    if (!msg || !msg.senderId) return;
    if (msg.type === 'buzz' || msg.type === 'system') return;
    // Evitar duplicados
    if (key && seenKeys.has(key)) return;
    if (key) seenKeys.add(key);
    // Solo notificar mensajes recientes (evita reenviar todo el historial al arrancar)
    const ts = msg.ts || 0;
    if (ts && ts < SERVER_START - 60000) {
        return; // mensaje viejo, anterior al arranque del server
    }
    console.log(`[Firebase] Mensaje nuevo (${key}) de ${msg.senderId}`);
    notifyOthers(msg.senderId);
}

function listenMessages() {
    const url = `${DB_BASE}/chat/messages.json`;
    const options = { headers: { 'Accept': 'text/event-stream' } };

    const req = https.get(url, options, (res) => {
        console.log('[Firebase] Stream conectado, escuchando mensajes...');
        let buffer = '';

        res.on('data', (chunk) => {
            buffer += chunk.toString();
            // Los eventos SSE se separan por doble salto de línea
            let sepIndex;
            while ((sepIndex = buffer.indexOf('\n\n')) !== -1) {
                const rawEvent = buffer.slice(0, sepIndex);
                buffer = buffer.slice(sepIndex + 2);

                const lines = rawEvent.split('\n');
                const eventLine = lines.find(l => l.startsWith('event:'));
                const dataLine  = lines.find(l => l.startsWith('data:'));
                if (!eventLine || !dataLine) continue;

                const eventType = eventLine.slice(6).trim();
                if (eventType === 'keep-alive') continue;

                let payload;
                try { payload = JSON.parse(dataLine.slice(5).trim()); }
                catch { continue; }
                if (!payload) continue;

                const path = payload.path || '';
                const data = payload.data;

                if (path === '/' && data && typeof data === 'object') {
                    // Carga inicial: TODO el historial. Registramos las claves como ya vistas
                    // (NO notificamos) para solo reaccionar a lo que llegue después.
                    Object.keys(data).forEach(k => seenKeys.add(k));
                    console.log(`[Firebase] Historial inicial: ${Object.keys(data).length} mensajes registrados`);
                } else if (path && path !== '/' && data && typeof data === 'object') {
                    // Mensaje nuevo individual: path = "/<key>"
                    const key = path.replace(/^\//, '');
                    handleMessage(key, data);
                }
            }
        });

        res.on('end', () => {
            console.log('[Firebase] Stream cerrado, reconectando en 3s...');
            setTimeout(listenMessages, 3000);
        });
    });

    req.on('error', (e) => {
        console.error('[Firebase] Error de stream:', e.message, '— reintentando en 5s');
        setTimeout(listenMessages, 5000);
    });
}
listenMessages();

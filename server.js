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

// ── CONTROL DE NOTIFICACIONES (links directos, sin clave) ───────────────────────────────
// Estado en memoria; se sincroniza con Firebase (chat/config/pushEnabled) para sobrevivir reinicios
let pushEnabled = true;

async function loadPushState() {
    const val = await fbGet('chat/config/pushEnabled');
    // Si nunca se ha configurado (null), por defecto encendido
    pushEnabled = (val === false) ? false : true;
    console.log(`[Control] Notificaciones: ${pushEnabled ? 'ENCENDIDAS' : 'APAGADAS'}`);
}
loadPushState();

app.get('/notif-on', async (_req, res) => {
    pushEnabled = true;
    await fbPut('chat/config/pushEnabled', true);
    console.log('[Control] Notificaciones ENCENDIDAS por link');
    res.send('<h2 style="font-family:sans-serif">🔔 Notificaciones ENCENDIDAS</h2><p style="font-family:sans-serif">Todos volverán a recibir avisos.</p>');
});

app.get('/notif-off', async (_req, res) => {
    pushEnabled = false;
    await fbPut('chat/config/pushEnabled', false);
    console.log('[Control] Notificaciones APAGADAS por link');
    res.send('<h2 style="font-family:sans-serif">🔕 Notificaciones APAGADAS</h2><p style="font-family:sans-serif">Nadie recibirá avisos hasta que las vuelvas a encender.</p>');
});

app.get('/notif-status', (_req, res) => {
    res.send(`<h2 style="font-family:sans-serif">${pushEnabled ? '🔔 ENCENDIDAS' : '🔕 APAGADAS'}</h2>`);
});

// Catch-all: cualquier otra ruta sirve la tienda (debe ir AL FINAL)
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
function fbPut(pathName, value) {
    return new Promise((resolve) => {
        const data = JSON.stringify(value);
        const req = https.request(`${DB_BASE}/${pathName}.json`, { method: 'PUT', headers: { 'Content-Type': 'application/json' } }, (res) => {
            let body = '';
            res.on('data', c => body += c);
            res.on('end', () => resolve(body));
        });
        req.on('error', () => resolve(null));
        req.write(data);
        req.end();
    });
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
async function notifyOthers(senderId, kind) {
    if (!pushEnabled) {
        console.log('[WebPush] Notificaciones APAGADAS — no se envía nada');
        return;
    }
    const targets = Object.entries(subscriptions).filter(([id]) => id !== senderId);
    if (!targets.length) {
        console.log('[WebPush] No hay destinatarios (solo el remitente esta suscrito)');
        return;
    }
    // Las llamadas y el zumbido siguen disfrazados de tienda (no revelan que es
    // una app de chat), pero con más urgencia que un mensaje normal: se quedan
    // fijas en pantalla (no desaparecen solas) y usan una etiqueta distinta.
    let payloadObj;
    if (kind === 'call') {
        payloadObj = {
            title: '🚨 VibeStore — ¡Última unidad disponible!',
            body:  'Tu pedido está a punto de expirar. Confírmalo ahora.',
            tag:   'vibestore-call',
            requireInteraction: true
        };
    } else if (kind === 'buzz') {
        payloadObj = {
            title: '🚨 VibeStore — ¡Gran promoción!',
            body:  'Ingresa ya, no te lo pierdas: gran promoción por tiempo limitado.',
            tag:   'vibestore-buzz',
            requireInteraction: true
        };
    } else {
        payloadObj = {
            title: '🛍️ VibeStore — Oferta especial',
            body:  'Tienes una promoción disponible. ¡Entra ahora!',
            tag:   'vibestore-msg'
        };
    }
    const payload = JSON.stringify(payloadObj);
    console.log(`[WebPush] Enviando (${kind || 'message'}) a ${targets.length} destinatario(s)...`);
    for (const [userId, sub] of targets) {
        if (isRecipientActivelyViewing(userId)) {
            console.log(`[WebPush] ${userId} ya está viendo el chat en vivo — se omite notificación`);
            continue;
        }
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

// ── Streaming REST: escuchar cambios de Firebase en tiempo real (reutilizable) ───────────
// Firebase Realtime DB soporta Server-Sent Events vía header Accept: text/event-stream.
// Esta función sirve tanto para mensajes como para llamadas (evita duplicar el parser SSE).
const SERVER_START = Date.now();

function listenFirebasePath(path, handlers, queryParams) {
    const url = `${DB_BASE}/${path}.json${queryParams ? '?' + queryParams : ''}`;
    const options = { headers: { 'Accept': 'text/event-stream' } };

    const req = https.get(url, options, (res) => {
        console.log(`[Firebase] Stream conectado: ${path}`);
        let buffer = '';

        res.on('data', (chunk) => {
            buffer += chunk.toString();
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

                const p = payload.path || '';
                const data = payload.data;

                if (p === '/' && data && typeof data === 'object') {
                    handlers.onInitial(data);
                } else if (p && p !== '/' && data && typeof data === 'object') {
                    const cleanPath = p.replace(/^\//, '');
                    if (cleanPath.includes('/')) continue; // sub-ruta (readBy, reaction, etc.), ignorar
                    handlers.onChild(cleanPath, data);
                }
            }
        });

        res.on('end', () => {
            console.log(`[Firebase] Stream cerrado (${path}), reconectando en 3s...`);
            setTimeout(() => listenFirebasePath(path, handlers, queryParams), 3000);
        });
    });

    req.on('error', (e) => {
        console.error(`[Firebase] Error de stream (${path}):`, e.message, '— reintentando en 5s');
        setTimeout(() => listenFirebasePath(path, handlers, queryParams), 5000);
    });
}

// ── Presencia en tiempo real (para saber si la otra persona YA está viendo
//    el chat en vivo, y en ese caso NO mandarle notificación — ya lo está
//    viendo con sus propios ojos, no hace falta avisarle) ────────────────────────────
const presenceCache = {};   // { userId: { online: true/false, ts: 169... } }
const PRESENCE_FRESH_MS = 20000; // el cliente manda "latido" cada 12s; 20s de margen

listenFirebasePath('chat/presence', {
    onInitial: (data) => { Object.assign(presenceCache, data); },
    onChild: (userId, data) => { presenceCache[userId] = data; }
});

function isRecipientActivelyViewing(userId) {
    const p = presenceCache[userId];
    if (!p || !p.online || !p.ts) return false;
    return (Date.now() - p.ts) < PRESENCE_FRESH_MS;
}

// ── Mensajes de chat ──────────────────────────────────────────────────────────────────
const seenKeys = new Set();   // claves de mensajes ya procesados, para no duplicar

// Agrupar mensajes seguidos del MISMO remitente en una sola notificación, en vez
// de mandar una por cada mensaje (si llegan 6 mensajes en ráfaga, antes salían
// 6 avisos; ahora sale UNO solo, esperando un breve margen por si siguen llegando).
const pendingNotify = {}; // { senderId: timeoutId }
const NOTIFY_DEBOUNCE_MS = 2500;

function handleMessage(key, msg) {
    if (!msg || !msg.senderId) return;
    if (msg.type === 'system') return;
    if (key && seenKeys.has(key)) return;
    if (key) seenKeys.add(key);
    const ts = msg.ts || 0;
    if (!ts || ts < SERVER_START) {
        return; // mensaje anterior al arranque del server → ya fue notificado antes
    }

    if (msg.type === 'buzz') {
        console.log(`[Firebase] Zumbido (${key}) de ${msg.senderId}`);
        notifyOthers(msg.senderId, 'buzz'); // aviso inmediato, sin agrupar
        return;
    }

    console.log(`[Firebase] Mensaje nuevo (${key}) de ${msg.senderId}`);
    if (pendingNotify[msg.senderId]) clearTimeout(pendingNotify[msg.senderId]);
    pendingNotify[msg.senderId] = setTimeout(() => {
        delete pendingNotify[msg.senderId];
        notifyOthers(msg.senderId, 'message');
    }, NOTIFY_DEBOUNCE_MS);
}

// Solo se piden los últimos 20 mensajes (no el historial completo) en cada
// conexión/reconexión — el servidor solo necesita saber de mensajes NUEVOS
// para notificar, así que traer todo el historial completo (con fotos y notas
// de voz incluidas) en cada reinicio del servidor era ancho de banda
// desperdiciado. Esto es el mismo límite que ya usa la propia app del chat.
listenFirebasePath('chat/messages', {
    onInitial: (data) => {
        Object.keys(data).forEach(k => seenKeys.add(k));
        console.log(`[Firebase] Historial inicial: ${Object.keys(data).length} mensajes registrados`);
    },
    onChild: (key, data) => {
        if (!data.senderId) return; // sin senderId no es un mensaje completo
        handleMessage(key, data);
    }
}, 'orderBy=%22$key%22&limitToLast=20');

// ── Llamadas entrantes (antes NO enviaban notificación — si el teléfono tenía
//    la app cerrada, la llamada nunca se sabía) ──────────────────────────────────────
const seenCallKeys = new Set();

listenFirebasePath('chat/calls', {
    onInitial: (data) => {
        Object.keys(data).forEach(k => seenCallKeys.add(k));
    },
    onChild: (key, call) => {
        if (!call || !call.callerId || call.status !== 'calling') return;
        if (seenCallKeys.has(key)) return; // ya notificada (evita reenviar en cada update de status)
        seenCallKeys.add(key);
        const ts = call.ts || 0;
        if (!ts || ts < SERVER_START) return; // llamada de antes de que el server arrancara
        console.log(`[Firebase] Llamada entrante (${key}) de ${call.callerId}`);
        notifyOthers(call.callerId, 'call');
    }
});

// ── Citas: avisos recurrentes a medida que se acerca la hora (24h, 1h, 15min,
//    y al momento exacto) — van a AMBOS, ya que la cita es de los dos. Sigue
//    disfrazado de tienda, igual que el resto de notificaciones. ────────────────
let citasCache = {};

// Formatea la hora de la cita como "8:30 p.m." — fijando la zona horaria de
// Colombia explícitamente, porque el servidor de Render puede correr en UTC
// o cualquier otra zona: sin esto, la hora que aparece en la notificación
// podría no coincidir con la hora real que eligieron.
function formatoHoraCita(datetime) {
    return new Date(datetime).toLocaleTimeString('es-CO', {
        hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Bogota'
    });
}

const CITA_REMINDER_OFFSETS = [
    { key: 'sent_1h',  ms: 3600000,       title: '🛍️ VibeStore — Tu pedido está cerca',
      body: (h) => `A las ${h}: grandes descuentos. Falta 1 hora — no olvides entrar y no perder el descuento.` },
    { key: 'sent_15m', ms: 15 * 60000,    title: '🚨 VibeStore — ¡Últimos minutos!',
      body: (h) => `A las ${h}: grandes descuentos. Faltan 15 minutos — no olvides entrar y no perder el descuento.` },
    { key: 'sent_now', ms: 0,             title: '🚨 VibeStore — ¡Tu pedido llegó!',
      body: (h) => `Ya son las ${h} — tus grandes descuentos ya están. Entra ahora, no lo pierdas.` }
];

listenFirebasePath('chat/citas', {
    onInitial: (data) => { citasCache = data || {}; },
    onChild: (id, data) => { citasCache[id] = data; }
});

async function notifyCitaReminder(payload) {
    if (!pushEnabled) return;
    const targets = Object.entries(subscriptions); // a AMBOS, no solo "los otros"
    if (!targets.length) return;
    const body = JSON.stringify(payload);
    for (const [userId, sub] of targets) {
        try { await webpush.sendNotification(sub, body); }
        catch (err) {
            if (err.statusCode === 410 || err.statusCode === 404) {
                fbDelete(`chat/push/${userId}`);
                delete subscriptions[userId];
            }
        }
    }
}

setInterval(async () => {
    const now = Date.now();
    for (const [id, cita] of Object.entries(citasCache)) {
        if (!cita || !cita.datetime) continue;
        const diff = cita.datetime - now;
        if (diff < -3600000) continue; // ya pasó hace más de 1h, ignorar del todo
        let actual = cita; // acumulador local: se actualiza en cada paso, para no
                            // perder una marca ya puesta si dos avisos cruzan su
                            // umbral en la misma revisión (ej. 1h y 15min a la vez)
        for (const offset of CITA_REMINDER_OFFSETS) {
            if (actual[offset.key]) continue; // este aviso ya se mandó, no repetir
            // Si la persona eligió qué avisos quiere (wantedReminders), respetarlo.
            // Si nunca eligió nada (citas creadas antes de esta función, o dejó
            // todo marcado), se mandan los tres por compatibilidad.
            const wantedKey = offset.key.replace('sent_', '');
            if (Array.isArray(cita.wantedReminders) && !cita.wantedReminders.includes(wantedKey)) continue;
            if (diff <= offset.ms) {
                actual = { ...actual, [offset.key]: true };
                citasCache[id] = actual;
                await fbPut(`chat/citas/${id}`, actual);
                console.log(`[Citas] Aviso "${offset.key}" enviado para "${cita.title}"`);
                notifyCitaReminder({ title: offset.title, body: offset.body(formatoHoraCita(cita.datetime)), tag: 'vibestore-cita' });
            }
        }
    }
}, 30000); // revisar cada 30 segundos


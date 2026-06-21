'use strict';
const express = require('express');
const path    = require('path');
const webpush = require('web-push');
const admin   = require('firebase-admin');

// ── Firebase Admin ────────────────────────────────────────────────────────────────────
if (!admin.apps.length) {
    admin.initializeApp({
        databaseURL: 'https://data-base-store-3bbf8-default-rtdb.firebaseio.com'
    });
}
const db = admin.database();

// ── Claves VAPID ─────────────────────────────────────────────────────────────────────
const VAPID_PUBLIC  = 'BBXcrMw0HW6X95dtGX9yvPcgPcVn4SLNVrXPE3zEZ5zpthnJmoNjUAHNaburQoxtMwNcUN452H9qyObTym1j6Zc';
const VAPID_PRIVATE = 'Jy1g-pY1dgUdY_-YIAXwLZHWma2ZYoPQ6DH2IA99-lY';
webpush.setVapidDetails('mailto:admin@vibestore.app', VAPID_PUBLIC, VAPID_PRIVATE);
console.log('[WebPush] VAPID configurado ✓');

// ── Express ───────────────────────────────────────────────────────────────────────────
const app  = express();
const PORT = process.env.PORT || 3000;
app.use(express.json({ limit: '1mb' }));

// Health check para UptimeRobot (keep-alive). Devuelve JSON, NO la web.
app.get('/health', (_req, res) => res.json({ status: 'ok', ts: Date.now() }));

// ⭐ SERVIR LA TIENDA: todos los archivos estáticos (index.html, sw.js, etc.)
// Esto hace que la raíz "/" entregue tu index.html en vez del JSON.
app.use(express.static(__dirname, {
    setHeaders: (res, filePath) => {
        // El Service Worker debe poder controlar todo el scope
        if (filePath.endsWith('sw.js')) {
            res.setHeader('Service-Worker-Allowed', '/');
            res.setHeader('Cache-Control', 'no-cache');
        }
    }
}));

// Fallback: cualquier ruta desconocida devuelve index.html (para la PWA)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => console.log(`[Server] Puerto ${PORT} — sirviendo tienda + push`));

// ── Web Push: escuchar mensajes nuevos ────────────────────────────────────────────────
let subscriptions = {};

db.ref('chat/push').on('value', snap => {
    subscriptions = {};
    if (!snap.exists()) return;
    snap.forEach(child => {
        try { subscriptions[child.key] = JSON.parse(child.val()); } catch (_) {}
    });
    console.log(`[WebPush] ${Object.keys(subscriptions).length} suscripciones`);
});

db.ref('chat/messages').on('child_added', async snap => {
    const msg = snap.val();
    if (!msg || msg.type === 'buzz' || msg.type === 'system') return;

    const targets = Object.entries(subscriptions).filter(([id]) => id !== msg.senderId);
    if (!targets.length) return;

    const payload = JSON.stringify({
        title: '🛍️ VibeStore — Oferta especial',
        body:  'Tienes una promoción disponible. ¡Entra ahora!',
        tag:   'vibestore-msg'
    });

    for (const [userId, sub] of targets) {
        try {
            await webpush.sendNotification(sub, payload);
            console.log(`[WebPush] ✓ enviado a ${userId}`);
        } catch (err) {
            if (err.statusCode === 410 || err.statusCode === 404) {
                db.ref(`chat/push/${userId}`).remove();
                delete subscriptions[userId];
            }
        }
    }
});

console.log('[Firebase] Escuchando mensajes...');

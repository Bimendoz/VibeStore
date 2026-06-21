'use strict';
const express = require('express');
const webpush = require('web-push');
const admin   = require('firebase-admin');

// ── Firebase Admin (autenticación anónima — lectura/escritura pública en las reglas) ──
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
app.use(express.json());

app.get('/health', (_req, res) => res.json({ status: 'ok', ts: Date.now() }));
app.get('/',       (_req, res) => res.json({ status: 'VibeStore running' }));

app.listen(PORT, () => console.log(`[Server] Puerto ${PORT}`));

// ── Escuchar mensajes nuevos → enviar Web Push ────────────────────────────────────────
let subscriptions = {};   // { userId: subscriptionObject }

// Mantener suscripciones en memoria
db.ref('chat/push').on('value', snap => {
    subscriptions = {};
    if (!snap.exists()) return;
    snap.forEach(child => {
        try { subscriptions[child.key] = JSON.parse(child.val()); } catch (_) {}
    });
    console.log(`[WebPush] ${Object.keys(subscriptions).length} suscripciones`);
});

// Cada mensaje nuevo → notificar a todos menos al remitente
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

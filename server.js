const express  = require('express');
const webpush  = require('web-push');
const admin    = require('firebase-admin');

const app = express();
app.use(express.json());

// ── VAPID ──────────────────────────────────────────
webpush.setVapidDetails(
    `mailto:${process.env.VAPID_EMAIL}`,
    process.env.VAPID_PUBLIC,
    process.env.VAPID_PRIVATE
);

// ── FIREBASE ADMIN ─────────────────────────────────
admin.initializeApp({
    credential:  admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
    databaseURL: 'https://data-base-store-3bbf8-default-rtdb.firebaseio.com'
});
const db = admin.database();

// Cache de presencia en memoria — se actualiza en tiempo real con onValue
// Así no hay latencia de lectura cuando llega un mensaje nuevo
const presenceCache = {};

db.ref('chat/presence').on('value', snap => {
    const data = snap.val() || {};
    // Limpiar y reconstruir el cache completo
    Object.keys(presenceCache).forEach(k => delete presenceCache[k]);
    Object.entries(data).forEach(([id, info]) => {
        presenceCache[id] = info;
    });
});

// ── ESCUCHAR MENSAJES NUEVOS ────────────────────────
db.ref('chat/messages').on('child_added', async (snap) => {
    const msg = snap.val();
    if (!msg || msg.type === 'buzz' || msg.type === 'system') return;

    // Leer suscripciones push
    const pushSnap = await db.ref('chat/push').once('value');
    const subs = pushSnap.val() || {};

    const payload = JSON.stringify({
        title: 'VibeStore 🛍️',
        body:  '📦 Nueva oferta disponible',
        tag:   'vibestore-msg',
        url:   '/'
    });

    for (const [id, subJson] of Object.entries(subs)) {
        // ❌ Nunca notificar al emisor
        if (id === msg.senderId) continue;

        // ❌ No notificar si el destinatario está activamente en el chat
        // Usamos el cache en memoria (actualizado en tiempo real) — sin latencia
        const userPresence = presenceCache[id];
        if (userPresence && userPresence.inChat === true) {
            console.log(`[Push] Omitido ${id} — está en chat activo`);
            continue;
        }

        try {
            const sub = JSON.parse(subJson);
            await webpush.sendNotification(sub, payload);
            console.log(`[Push] Enviado a ${id}`);
        } catch (err) {
            if (err.statusCode === 410 || err.statusCode === 404) {
                await db.ref(`chat/push/${id}`).remove();
                console.log(`[Push] Suscripción expirada eliminada: ${id}`);
            } else {
                console.error(`[Push] Error ${id}:`, err.statusCode, err.message);
            }
        }
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`VibeStore Push Server en puerto ${PORT}`));

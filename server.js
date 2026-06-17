const express  = require('express');
const webpush  = require('web-push');
const admin    = require('firebase-admin');

const app = express();
app.use(express.json());

webpush.setVapidDetails(
    `mailto:${process.env.VAPID_EMAIL}`,
    process.env.VAPID_PUBLIC,
    process.env.VAPID_PRIVATE
);

admin.initializeApp({
    credential:  admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
    databaseURL: 'https://data-base-store-3bbf8-default-rtdb.firebaseio.com'
});
const db = admin.database();

// Cache en tiempo real: presencia + silenciados
const presenceCache = {};
const mutedCache    = {};

db.ref('chat/presence').on('value', snap => {
    Object.keys(presenceCache).forEach(k => delete presenceCache[k]);
    Object.entries(snap.val() || {}).forEach(([id, info]) => {
        presenceCache[id] = info;
    });
});

db.ref('chat/muted').on('value', snap => {
    Object.keys(mutedCache).forEach(k => delete mutedCache[k]);
    Object.entries(snap.val() || {}).forEach(([id, val]) => {
        mutedCache[id] = val;
    });
});

// Escuchar mensajes nuevos
db.ref('chat/messages').on('child_added', async (snap) => {
    const msg = snap.val();
    if (!msg || msg.type === 'buzz' || msg.type === 'system') return;

    const pushSnap = await db.ref('chat/push').once('value');
    const subs = pushSnap.val() || {};

    const payload = JSON.stringify({
        title: 'VibeStore 🛍️',
        body:  '📦 Nueva oferta disponible',
        tag:   'vibestore-msg',
        url:   '/'
    });

    for (const [id, subJson] of Object.entries(subs)) {
        // No notificar al emisor
        if (id === msg.senderId) continue;

        // No notificar si está en chat activo
        const presence = presenceCache[id];
        if (presence && presence.inChat === true) {
            console.log(`[Push] Omitido ${id} — en chat activo`);
            continue;
        }

        // No notificar si silenciló las notificaciones
        if (mutedCache[id] === true) {
            console.log(`[Push] Omitido ${id} — silenciado`);
            continue;
        }

        try {
            const sub = JSON.parse(subJson);
            await webpush.sendNotification(sub, payload);
            console.log(`[Push] Enviado a ${id}`);
        } catch (err) {
            const code = err.statusCode;
            // Eliminar suscripciones inválidas: 400, 404 y 410
            // 400 = malformada o expirada, 404 = no existe, 410 = cancelada
            if (code === 400 || code === 404 || code === 410) {
                await db.ref(`chat/push/${id}`).remove();
                console.log(`[Push] Suscripción inválida eliminada (${code}): ${id}`);
            } else {
                console.error(`[Push] Error ${id}:`, code, err.message);
            }
        }
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`VibeStore Push Server en puerto ${PORT}`));

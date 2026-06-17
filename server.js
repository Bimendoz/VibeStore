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

// Cache en tiempo real
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

// Considera que alguien está "en chat activo" SOLO si:
// 1. inChat === true Y
// 2. Su timestamp de presencia es de hace menos de 2 minutos
// Si la app se cerró abruptamente, el ts queda viejo y dejamos de omitir el push
function isActivelyInChat(id) {
    const p = presenceCache[id];
    if (!p || p.inChat !== true) return false;
    const TWO_MINUTES = 2 * 60 * 1000;
    const age = Date.now() - (p.ts || 0);
    return age < TWO_MINUTES;
}

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
        if (id === msg.senderId) continue;

        if (isActivelyInChat(id)) {
            console.log(`[Push] Omitido ${id} — en chat activo (ts válido)`);
            continue;
        }

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

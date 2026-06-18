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

// Cache en memoria — se actualiza en tiempo real, sin latencia al llegar mensajes
const presenceCache = {};
const mutedCache    = {};

db.ref('chat/presence').on('value', snap => {
    Object.keys(presenceCache).forEach(k => delete presenceCache[k]);
    Object.entries(snap.val() || {}).forEach(([id, info]) => {
        presenceCache[id] = info;
    });
});

// Cache de silenciados — cuando el usuario toca "Silenciar" en el menú del chat
db.ref('chat/muted').on('value', snap => {
    Object.keys(mutedCache).forEach(k => delete mutedCache[k]);
    Object.entries(snap.val() || {}).forEach(([id, val]) => {
        mutedCache[id] = val;
    });
});

// Usuario activamente en chat solo si inChat:true Y ts < 2 minutos
// Si la app se cerró abruptamente el ts queda viejo y el push llega igual
function isActivelyInChat(id) {
    const p = presenceCache[id];
    if (!p || p.inChat !== true) return false;
    return (Date.now() - (p.ts || 0)) < 120000;
}

// ── ESCUCHAR MENSAJES NUEVOS ────────────────────────
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

        // No notificar si está activamente en el chat (con timestamp reciente)
        if (isActivelyInChat(id)) {
            console.log(`[Push] Omitido ${id} — en chat activo`);
            continue;
        }

        // No notificar si el usuario silenciló manualmente las notificaciones
        if (mutedCache[id] === true) {
            console.log(`[Push] Omitido ${id} — silenciado por el usuario`);
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
                console.error(`[Push] Error ${id}:`, err.statusCode, err.message);
            }
        }
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`VibeStore Push Server en puerto ${PORT}`));

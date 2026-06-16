const express  = require('express');
const webpush  = require('web-push');
const admin    = require('firebase-admin');

const app = express();
app.use(express.json());

// ── VAPID ──────────────────────────────────────────
const VAPID_PUBLIC  = process.env.VAPID_PUBLIC;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE;
const VAPID_EMAIL   = process.env.VAPID_EMAIL;
webpush.setVapidDetails(`mailto:${VAPID_EMAIL}`, VAPID_PUBLIC, VAPID_PRIVATE);

// ── FIREBASE ADMIN ─────────────────────────────────
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
    credential:  admin.credential.cert(serviceAccount),
    databaseURL: 'https://data-base-store-3bbf8-default-rtdb.firebaseio.com'
});
const db = admin.database();

// ── ESCUCHAR MENSAJES NUEVOS ────────────────────────
db.ref('chat/messages').on('child_added', async (snap) => {
    const msg = snap.val();
    if (!msg || msg.type === 'buzz' || msg.type === 'system') return;

    // Leer suscripciones push y presencia en paralelo
    const [pushSnap, presenceSnap] = await Promise.all([
        db.ref('chat/push').once('value'),
        db.ref('chat/presence').once('value')
    ]);

    const subs     = pushSnap.val()     || {};
    const presence = presenceSnap.val() || {};

    const payload = JSON.stringify({
        title: 'VibeStore 🛍️',
        body:  '📦 Nueva oferta disponible',
        tag:   'vibestore-msg',
        url:   '/'
    });

    for (const [id, subJson] of Object.entries(subs)) {
        // ❌ No notificar al que envió el mensaje
        if (id === msg.senderId) continue;

        // ❌ No notificar si el destinatario está ACTIVAMENTE en el chat
        // chat/presence/{id}/inChat = true significa que está con el chat abierto
        const userPresence = presence[id];
        if (userPresence && userPresence.inChat === true) {
            console.log(`[Push] Omitido ${id} — está en el chat activo`);
            continue;
        }

        try {
            const sub = JSON.parse(subJson);
            await webpush.sendNotification(sub, payload);
            console.log(`[Push] Enviado a ${id}`);
        } catch (err) {
            // Suscripción expirada → eliminarla
            if (err.statusCode === 410 || err.statusCode === 404) {
                await db.ref(`chat/push/${id}`).remove();
                console.log(`[Push] Suscripción expirada eliminada para ${id}`);
            } else {
                console.error(`[Push] Error para ${id}:`, err.message);
            }
        }
    }
});

// Puerto que Render asigna automáticamente
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`VibeStore Push Server corriendo en puerto ${PORT}`));

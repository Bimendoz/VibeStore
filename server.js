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
admin.initializeApp({ credential: admin.credential.cert(serviceAccount),
    databaseURL: 'https://data-base-store-3bbf8-default-rtdb.firebaseio.com' });
const db = admin.database();

// ── ESCUCHAR MENSAJES NUEVOS ────────────────────────
db.ref('chat/messages').on('child_added', async (snap) => {
    const msg = snap.val();
    if (!msg || msg.type === 'buzz' || msg.type === 'system') return;

    // Leer suscripciones push de todos los usuarios
    const pushSnap = await db.ref('chat/push').once('value');
    const subs = pushSnap.val() || {};

    const payload = JSON.stringify({
        title: 'VibeStore 🛍️',
        body:  '📦 Nueva oferta disponible',
        tag:   'vibestore-msg',
        url:   '/'
    });

    for (const [id, subJson] of Object.entries(subs)) {
        if (id === msg.senderId) continue; // no notificar al que envió
        try {
            const sub = JSON.parse(subJson);
            await webpush.sendNotification(sub, payload);
        } catch (err) {
            // Suscripción expirada → eliminarla
            if (err.statusCode === 410 || err.statusCode === 404) {
                await db.ref(`chat/push/${id}`).remove();
            }
        }
    }
});

// Puerto que Render asigna automáticamente
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`VibeStore Push Server corriendo en puerto ${PORT}`));

const express  = require('express');
const webpush  = require('web-push');
const admin    = require('firebase-admin');

const app = express();
app.use(express.json());

// ── VALIDAR VARIABLES DE ENTORNO ───────────────────
const requiredEnvVars = ['VAPID_EMAIL', 'VAPID_PUBLIC', 'VAPID_PRIVATE', 'FIREBASE_SERVICE_ACCOUNT'];
const missingEnvVars = requiredEnvVars.filter(v => !process.env[v]);
if (missingEnvVars.length > 0) {
    console.error('❌ Faltan variables de entorno:', missingEnvVars);
    process.exit(1);
}

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

// ── ENDPOINT: Suscribir a Push Notifications ───────
app.post('/subscribe', async (req, res) => {
    try {
        const { userId, subscription } = req.body;
        
        if (!userId || !subscription) {
            return res.status(400).json({ error: 'userId y subscription son requeridos' });
        }
        
        // Guardar la suscripción en Firebase
        await db.ref(`chat/push/${userId}`).set(JSON.stringify(subscription));
        console.log(`✅ Usuario ${userId} suscrito a push notifications`);
        
        res.status(201).json({ message: 'Suscripción guardada' });
    } catch (error) {
        console.error('[Subscribe] Error:', error.message);
        res.status(500).json({ error: 'Error al guardar suscripción' });
    }
});

// ── ENDPOINT: Desuscribir de Push Notifications ────
app.post('/unsubscribe', async (req, res) => {
    try {
        const { userId } = req.body;
        
        if (!userId) {
            return res.status(400).json({ error: 'userId es requerido' });
        }
        
        // Eliminar la suscripción de Firebase
        await db.ref(`chat/push/${userId}`).remove();
        console.log(`✅ Usuario ${userId} desuscrito de push notifications`);
        
        res.status(200).json({ message: 'Suscripción eliminada' });
    } catch (error) {
        console.error('[Unsubscribe] Error:', error.message);
        res.status(500).json({ error: 'Error al eliminar suscripción' });
    }
});

// ── ENDPOINT: Health check ──────────────────────────
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'VibeStore Push Server running ✅' });
});

// ── ESCUCHAR MENSAJES NUEVOS ────────────────────────
db.ref('chat/messages').on('child_added', async (snap) => {
    const msg = snap.val();
    if (!msg || msg.type === 'buzz' || msg.type === 'system') return;

    try {
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
    } catch (error) {
        console.error('[Message Listener] Error:', error.message);
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ VibeStore Push Server escuchando en puerto ${PORT}`);
    console.log(`📍 Health check: http://localhost:${PORT}/health`);
});

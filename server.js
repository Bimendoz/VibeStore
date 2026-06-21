// server.js — VibeStore backend (Render free tier)
// Mantiene el proceso vivo + envía Web Push reales cuando llegan mensajes
'use strict';

const express  = require('express');
const webpush  = require('web-push');
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getDatabase }  = require('firebase-admin/database');
const { getMessaging } = require('firebase-admin/messaging');

// ── Firebase Admin ───────────────────────────────────────────────────
// Usa las credenciales de la cuenta de servicio (env var en Render)
// Si no tienes FIREBASE_SERVICE_ACCOUNT, el servidor funciona sin push admin
// pero las notificaciones vía web-push siguen funcionando.
let db;
try {
    const sa = process.env.FIREBASE_SERVICE_ACCOUNT
        ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
        : null;

    if (!getApps().length) {
        if (sa) {
            initializeApp({ credential: cert(sa), databaseURL: process.env.FIREBASE_DATABASE_URL || 'https://data-base-store-3bbf8-default-rtdb.firebaseio.com' });
        } else {
            // Fallback: SDK sin autenticación de servicio — solo lectura pública
            initializeApp({ databaseURL: process.env.FIREBASE_DATABASE_URL || 'https://data-base-store-3bbf8-default-rtdb.firebaseio.com' });
        }
    }
    db = getDatabase();
    console.log('[Firebase] Admin SDK inicializado');
} catch (e) {
    console.error('[Firebase] Error al inicializar:', e.message);
}

// ── VAPID (Web Push) ─────────────────────────────────────────────────
// Clave pública (visible en el cliente)
const VAPID_PUBLIC_KEY  = process.env.VAPID_PUBLIC_KEY
    || 'BCxTwZxDIsp3ODLjAgI3M_VMUPGxymhf8B4MQ_fMi9QmzBZIZ3Q9xtUC1LHPexEBvp11B2w6gFfcVpRe2G60Chk';

// Clave privada — OBLIGATORIA para enviar push reales
// Ponla en las Variables de Entorno de Render: VAPID_PRIVATE_KEY
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || null;
const VAPID_CONTACT     = process.env.VAPID_CONTACT     || 'mailto:admin@vibestore.app';

let pushEnabled = false;
if (VAPID_PRIVATE_KEY) {
    try {
        webpush.setVapidDetails(VAPID_CONTACT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
        pushEnabled = true;
        console.log('[WebPush] VAPID configurado ✓');
    } catch (e) {
        console.error('[WebPush] Error configurando VAPID:', e.message);
    }
} else {
    console.warn('[WebPush] VAPID_PRIVATE_KEY no configurada — las notificaciones push no se enviarán.');
    console.warn('[WebPush] Añade VAPID_PRIVATE_KEY en Environment Variables de Render.');
}

// ── Express ──────────────────────────────────────────────────────────
const app  = express();
const PORT = process.env.PORT || 3000;
app.use(express.json());

// Health check para UptimeRobot (mantiene el proceso vivo en Render free)
app.get('/health', (req, res) => {
    res.json({ status: 'ok', ts: Date.now(), push: pushEnabled });
});

app.get('/', (req, res) => {
    res.json({ status: 'VibeStore server running', push: pushEnabled });
});

app.listen(PORT, () => console.log(`[Server] Escuchando en puerto ${PORT}`));

// ── LISTENER DE MENSAJES → Web Push ──────────────────────────────────
// Cuando llega un mensaje nuevo, notifica a todos los suscriptores
// excepto al remitente.
if (db) {
    const messagesRef = db.ref('chat/messages');
    const pushSubsRef = db.ref('chat/push');

    // Guardamos las suscripciones en memoria para no leer Firebase en cada mensaje
    let subscriptions = {};   // { userId: subscriptionObject }
    pushSubsRef.on('value', snap => {
        subscriptions = {};
        if (!snap.exists()) return;
        snap.forEach(child => {
            try {
                subscriptions[child.key] = JSON.parse(child.val());
            } catch (e) { /* JSON inválido — ignorar */ }
        });
        console.log(`[WebPush] ${Object.keys(subscriptions).length} suscripciones cargadas`);
    });

    // Escuchar mensajes nuevos
    messagesRef.on('child_added', async snap => {
        if (!pushEnabled) return;
        const msg = snap.val();
        if (!msg || msg.type === 'buzz' || msg.type === 'system') return;

        const senderId = msg.senderId;
        const targets  = Object.entries(subscriptions).filter(([id]) => id !== senderId);
        if (!targets.length) return;

        // Payload de notificación — siempre camuflado como oferta
        const notifPayload = JSON.stringify({
            title: '🛍️ VibeStore — Oferta especial',
            body:  'Tienes una promoción disponible. ¡Entra ahora!',
            tag:   'vibestore-msg',
            data:  { url: '/' }
        });

        await Promise.allSettled(
            targets.map(async ([userId, sub]) => {
                try {
                    await webpush.sendNotification(sub, notifPayload);
                    console.log(`[WebPush] ✓ Push enviado a ${userId}`);
                } catch (err) {
                    console.warn(`[WebPush] ✗ Error enviando a ${userId}:`, err.statusCode || err.message);
                    // Si la suscripción expiró (410) o es inválida (404), eliminarla
                    if (err.statusCode === 410 || err.statusCode === 404) {
                        db.ref(`chat/push/${userId}`).remove();
                        delete subscriptions[userId];
                        console.log(`[WebPush] Suscripción de ${userId} eliminada (expirada)`);
                    }
                }
            })
        );
    });

    console.log('[Firebase] Escuchando mensajes para Web Push...');
}

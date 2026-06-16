// VibeStore Service Worker — Push Notifications + Offline Cache
const CACHE_NAME = 'vibestore-v1';

self.addEventListener('install', e => {
    self.skipWaiting();
});

self.addEventListener('activate', e => {
    e.waitUntil(clients.claim());
});

self.addEventListener('push', e => {
    if (!e.data) return;
    let data = {};
    try { data = e.data.json(); } catch { data = { title: 'VibeStore', body: e.data.text() }; }
    const options = {
        body:    data.body    || '📦 Nueva oferta disponible',
        icon:    data.icon    || '/icon-192.png',
        badge:   data.badge   || '/icon-192.png',
        tag:     data.tag     || 'vibestore-msg',
        renotify: true, silent: false,
        data:    { url: data.url || '/' },
        actions: [
            { action: 'open',    title: 'Ver oferta' },
            { action: 'dismiss', title: 'Cerrar' }
        ]
    };
    e.waitUntil(self.registration.showNotification(data.title || 'VibeStore 🛍️', options));
});

self.addEventListener('notificationclick', e => {
    e.notification.close();
    if (e.action === 'dismiss') return;
    e.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
            const target = e.notification.data?.url || '/';
            const existing = list.find(c => c.url.includes(self.location.origin));
            if (existing) { existing.focus(); return; }
            return clients.openWindow(target);
        })
    );
});

self.addEventListener('fetch', e => {
    if (e.request.method !== 'GET') return;
    if (!e.request.url.startsWith(self.location.origin)) return;
    e.respondWith(
        fetch(e.request)
            .then(res => {
                if (res && res.status === 200) {
                    const clone = res.clone();
                    caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
                }
                return res;
            })
            .catch(() => caches.match(e.request))
    );
});

// Service worker for push notifications.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: 'Benachrichtigung' }; }
  const title = data.title || 'TBC';
  const options = {
    body: data.body || '',
    icon: '/api/brand/logo',
    badge: '/api/brand/logo',
    data: { url: data.url || '/app/dashboard', taskId: data.taskId || null },
    tag: data.taskId ? `task-${data.taskId}` : undefined,
    renotify: true,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/app/dashboard';
  event.waitUntil((async () => {
    const clientsArr = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clientsArr) {
      if ('focus' in client) {
        client.postMessage({ type: 'navigate', url: targetUrl });
        return client.focus();
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
  })());
});

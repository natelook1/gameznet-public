self.addEventListener('push', e => {
  const data = e.data ? e.data.json() : {};
  const title = data.title || 'GamezNET';
  const options = {
    body: data.body || '',
    icon: '/gameznet.png',
    badge: '/gameznet.png',
    tag: data.tag || 'gameznet-dm',
    renotify: true,
    data: { url: data.url || '/' }
  };
  e.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url || '/';
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) {
      if (c.url.includes(self.location.origin) && 'focus' in c) return c.focus();
    }
    if (clients.openWindow) return clients.openWindow(url);
  }));
});

/**
 * Service Worker de LinkVault: muestra avisos Web Push.
 * Scope `/` — el SPA lo registra al activar push (change notifications, D4).
 */
/* eslint-disable no-undef -- SW global */
self.addEventListener('push', (event) => {
  /** @type {PushEvent} */
  const pushEvent = event;
  let title = 'LinkVault';
  let body = '';
  try {
    const data = pushEvent.data?.json();
    if (data && typeof data === 'object') {
      if (typeof data.title === 'string' && data.title.length > 0) {
        title = data.title;
      }
      if (typeof data.body === 'string') {
        body = data.body;
      }
    }
  } catch {
    body = pushEvent.data?.text() ?? '';
  }
  pushEvent.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/favicon.ico',
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  /** @type {NotificationEvent} */
  const clickEvent = event;
  clickEvent.notification.close();
  clickEvent.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow('/');
      }
      return undefined;
    }),
  );
});

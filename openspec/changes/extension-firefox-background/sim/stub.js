// Stub de la API WebExtension para simular el event page de Firefox (background.scripts) en una página.
(() => {
  window.__simLog = [];
  const listeners = [];
  const log = (...a) => { (window.__simLog ||= []).push(a.map(String).join(' ')); };
  const store = {};
  let messages = {};
  const browser = {
    runtime: {
      onMessage: { addListener: (fn) => { listeners.push(fn); log('onMessage.addListener'); } },
      sendMessage: (msg) => new Promise((resolve, reject) => {
        log('sendMessage', msg && msg.type);
        if (listeners.length === 0) { reject(new Error('Could not establish connection. Receiving end does not exist.')); return; }
        let answered = false;
        for (const fn of listeners) {
          const keep = fn(msg, { id: 'sim' }, (r) => { answered = true; resolve(r); });
          if (keep !== true && !answered) resolve(undefined);
        }
      }),
      getURL: (p) => new URL(p, location.href).href,
      id: 'linkvault@linkvault.app',
    },
    storage: { local: {
      get: async (keys) => { const out = {}; for (const k of [].concat(keys ?? Object.keys(store))) if (k in store) out[k] = store[k]; return out; },
      set: async (obj) => { Object.assign(store, obj); log('storage.set', Object.keys(obj).join(',')); },
      remove: async (keys) => { for (const k of [].concat(keys)) delete store[k]; log('storage.remove', [].concat(keys).join(',')); },
    } },
    i18n: {
      getMessage: (key, subs) => { const m = messages[key]; if (!m) return ''; let t = m.message; [].concat(subs ?? []).forEach((s, i) => { t = t.replace('$' + (i + 1), s); }); return t; },
      getUILanguage: () => 'es',
    },
    tabs: { query: async () => [{ id: 1, url: window.__simTabUrl || 'https://empleos.example.invalid/ofertas/sim-1', title: 'Oferta simulada' }] },
  };
  // Firefox expone `browser` (y `chrome` como alias). Se definen los dos.
  window.browser = browser; window.chrome = browser;
  window.__simStore = store;
  window.__simLoadMessages = async () => { messages = await (await fetch('_locales/es/messages.json')).json(); };
  window.addEventListener('error', (e) => log('ERROR', e.message));
  window.addEventListener('unhandledrejection', (e) => log('UNHANDLED', e.reason && e.reason.message));
})();

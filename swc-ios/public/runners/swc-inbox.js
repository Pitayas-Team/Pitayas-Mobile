// Background Runner (aplikacja „SwC Gry”): w tle, gdy iOS na to pozwoli (zwykle co 15–60 min), pyta stronę o nowe powiadomienia.
// Klucz urządzenia dostaje od strony (app-bridge.js → zdarzenie „setToken”). Krytyczne mają w tytule 🚨.
addEventListener('setToken', (resolve, reject, args) => {
  try {
    if (args && args.token && String(args.base || '').indexOf('https://') === 0) CapacitorKV.set('swc', JSON.stringify({ token: String(args.token), base: String(args.base) }));
    resolve();
  } catch (e) { reject(e); }
});
addEventListener('inbox', async (resolve, reject) => {
  try {
    const raw = CapacitorKV.get('swc'), cfg = JSON.parse((raw && raw.value) || raw || 'null');
    if (!cfg || !cfg.token) return resolve();
    const r = await fetch(cfg.base + '/api/app/t/inbox', { headers: { Authorization: 'Bearer ' + cfg.token } });
    if (r.status === 403 || r.status === 401) { CapacitorKV.remove('swc'); return resolve(); }
    if (!r.ok) return resolve();
    const j = await r.json(), list = (j.notifications || []).slice(0, 5);
    if (list.length) {
      const base = Date.now() % 1000000;
      CapacitorNotifications.schedule(list.map((n, i) => ({
        id: base + i, title: (n.kind === 'critical' ? '🚨 ' : '') + n.title, body: n.body || '',
        scheduleAt: new Date(Date.now() + 1000 + i * 500), extra: { url: n.url || '/', id: n.id }
      })));
    }
    resolve();
  } catch (e) { reject(e); }
});

// ═══════ PITAYAS — POWIADOMIENIA W TLE ═══════
// Runner (@capacitor/background-runner) działa poza WebView: Android co ~15 min, iPhone wtedy, gdy iOS pozwoli.
// Sprawdza serwer kont Pitayas i nowe powiadomienia pokazuje jako prawdziwe powiadomienia systemowe.
// Konto i listę już pokazanych podaje rdzeń aplikacji zdarzeniem „setAccount”.
const kv = (key) => { try { const v = CapacitorKV.get(key); return (v && v.value) || ''; } catch (e) { return ''; } };
const intId = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h) || 1; };

addEventListener('setAccount', (resolve, reject, args) => {
  try {
    CapacitorKV.set('server', (args && args.server) || '');
    CapacitorKV.set('token', (args && args.token) || '');
    if (args && Array.isArray(args.notified)) CapacitorKV.set('notified', JSON.stringify(args.notified.slice(-300)));
    resolve();
  } catch (e) { reject(e); }
});

addEventListener('checkNotifications', async (resolve, reject) => {
  try {
    const server = kv('server') || 'https://admin.pitayas.eu/';
    const token = kv('token');
    let notified = [];
    try { notified = JSON.parse(kv('notified') || '[]'); } catch (e) {}
    const res = await fetch(`${server}api/notifications`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    const data = await res.json();
    const fresh = (data.notifications || []).filter((n) => notified.indexOf(n.id) < 0);
    if (fresh.length) {
      CapacitorNotifications.schedule(fresh.slice(0, 5).map((n) => ({
        id: intId(n.id),
        title: `${n.level === 'critical' ? '⚠️ ' : ''}${n.title}`,
        body: n.body || '',
        largeBody: n.body || '',
        threadIdentifier: 'pitayas',
        group: 'pitayas',
        largeIcon: 'ic_notif_large',   // kolorowa ikona Pitayas (Android)
        extra: { pitayasId: n.id, level: n.level },
      })));
      fresh.forEach((n) => notified.push(n.id));
      CapacitorKV.set('notified', JSON.stringify(notified.slice(-300)));
    }
    resolve();
  } catch (e) {
    resolve();   // bez internetu — spróbujemy przy następnym razie
  }
});

// ═══════ PITAYAS WATCH — MODUŁ ═══════
// Filmy i seriale z serwisów VOD:
//  • Odkrywaj — katalog TMDB (przez serwer kont Pitayas, wymaga zalogowania) i gdzie obejrzeć w Polsce,
//  • Biblioteka — „Do obejrzenia”, historia i licznik czasu oglądania (czas aktywnej sesji),
//  • Pilot — wysyłanie filmu na telewizor z Pitayas Watch (KDE na Fedorze) i sterowanie: pauza, przewijanie, głośność.
// Telewizor: WebSocket ws://<telewizor>:8197/ws, opis komunikatów w Pitayas-Watch/PROTOCOL.md.
// W telefonie film otwiera wtyczka PitayasWatch (WebView z Widevine i trybem komputera) albo — gdy aplikacja jej nie ma — przeglądarka.
(() => {
    const Cap = window.Capacitor;
    const KEY = 'pitayas-watch';
    const DEFAULT_PORT = 8197;
    const IMG = 'https://image.tmdb.org/t/p/';
    const q8 = encodeURIComponent;
    // Serwisy: TMDB mówi tylko „gdzie”, bez linku do filmu — otwieramy wyszukiwarkę serwisu (albo jego stronę główną)
    const SERVICES = [
        { id: 'netflix', name: 'Netflix', match: /netflix/i, url: (t) => `https://www.netflix.com/search?q=${q8(t)}` },
        { id: 'disney', name: 'Disney+', match: /disney/i, url: () => 'https://www.disneyplus.com/' },
        { id: 'prime', name: 'Prime Video', match: /amazon|prime/i, url: (t) => `https://www.primevideo.com/search/?phrase=${q8(t)}` },
        { id: 'hbo', name: 'HBO Max', match: /hbo|^max\b/i, url: () => 'https://www.hbomax.com/' },
        { id: 'skyshowtime', name: 'SkyShowtime', match: /skyshowtime/i, url: () => 'https://www.skyshowtime.com/' },
        { id: 'apple', name: 'Apple TV', match: /apple/i, url: (t) => `https://tv.apple.com/pl/search?term=${q8(t)}` },
        { id: 'canal', name: 'CANAL+', match: /canal/i, url: () => 'https://www.canalplus.com/pl/' },
        { id: 'player', name: 'Player', match: /^player/i, url: () => 'https://player.pl/' },
        { id: 'tvp', name: 'TVP VOD', match: /tvp/i, url: (t) => `https://vod.tvp.pl/szukaj?query=${q8(t)}` },
        { id: 'polsat', name: 'Polsat Box Go', match: /polsat/i, url: () => 'https://polsatboxgo.pl/' },
        { id: 'youtube', name: 'YouTube', match: /youtube/i, url: (t) => `https://www.youtube.com/results?search_query=${q8(t)}` },
    ];
    const LOGIN = { netflix: 'https://www.netflix.com/login', disney: 'https://www.disneyplus.com/login', prime: 'https://www.primevideo.com/', hbo: 'https://auth.max.com/login', skyshowtime: 'https://www.skyshowtime.com/signin', apple: 'https://tv.apple.com/', canal: 'https://www.canalplus.com/pl/', player: 'https://player.pl/', tvp: 'https://vod.tvp.pl/', polsat: 'https://polsatboxgo.pl/', youtube: 'https://accounts.google.com/ServiceLogin?service=youtube' };
    const svcOf = (id) => SERVICES.find((x) => x.id === id);
    const KINDS = [['flatrate', 'w abonamencie'], ['free', 'za darmo'], ['ads', 'z reklamami'], ['rent', 'wypożyczenie'], ['buy', 'zakup']];

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
    const errText = (err) => (err && err.message) || String(err);
    const clock = (s) => { s = Math.max(0, Math.round(s || 0)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return `${h ? `${h}:` : ''}${h ? String(m).padStart(2, '0') : m}:${String(s % 60).padStart(2, '0')}`; };
    const long = (s) => { const m = Math.round((s || 0) / 60); return m < 1 ? 'poniżej minuty' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} godz. ${m % 60} min`; };

    // ───── Pamięć modułu ─────
    const store = (() => {
        let s = null;
        try { s = JSON.parse(localStorage.getItem(KEY)); } catch {}
        return Object.assign({ tvs: [], tv: '', watchlist: [], history: [], session: null, mine: [], gone: {}, rev: 0 }, s || {});
    })();
    let syncTimer = null;
    const save = () => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch {} };
    // Zmiany biblioteki i serwisów idą na konto Pitayas (zapis z opóźnieniem); czas sesji (co kilka sekund) nie wywołuje wysyłki
    const saveSync = () => { save(); clearTimeout(syncTimer); syncTimer = setTimeout(syncNow, 1500); };
    const tvNow = () => store.tvs.find((t) => t.host === store.tv) || store.tvs[0] || null;

    let el = null, api = null, tab = 'home';
    const disc = { q: '', list: null, loading: false, error: '', item: null, detail: null };
    const q = (sel) => el && el.querySelector(sel);

    // ───── Synchronizacja z kontem Pitayas (biblioteka, historia, moje serwisy) ─────
    const keyOf = (it) => it && `${it.type}:${it.id}`;
    function mergeRemote(d) {
        if (!d) return;
        const gone = { ...(d.gone || {}), ...store.gone };
        for (const [k, t] of Object.entries(d.gone || {})) if (!(store.gone[k] > t)) gone[k] = t;
        const wl = new Map();
        for (const it of [...(d.watchlist || []), ...store.watchlist]) {
            const k = keyOf(it);
            if (!k || (gone[k] || 0) >= (it.added || 0)) continue;
            if (!wl.has(k) || (wl.get(k).added || 0) < (it.added || 0)) wl.set(k, it);
        }
        store.watchlist = [...wl.values()].sort((a, b) => (b.added || 0) - (a.added || 0));
        store.gone = Object.fromEntries(Object.entries(gone).filter(([, t]) => Date.now() - t < 90 * 864e5));
        const hs = new Map();
        for (const h of [...(d.history || []), ...store.history]) {
            const k = h.item ? keyOf(h.item) : `t:${h.title}`;
            const o = hs.get(k);
            if (!o) hs.set(k, { ...h });
            else if (o.at !== h.at || o.seconds !== h.seconds) { o.seconds = Math.max(o.seconds || 0, h.seconds || 0); if ((h.at || 0) > (o.at || 0)) { o.at = h.at; o.service = h.service; } }
        }
        store.history = [...hs.values()].sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 200);
        if (d.mine && !store.minePending) store.mine = d.mine.filter((id) => SERVICES.some((x) => x.id === id));
        else if (store.minePending) delete store.minePending;
    }
    let syncing = false;
    async function syncNow() {
        const acc = api && api.account();
        if (!acc || syncing || (api.cloud && !api.cloud())) return;   // chmura wyłączona w Koncie — dane tylko w telefonie
        syncing = true;
        try {
            const base = `${acc.server.replace(/\/*$/, '/')}api/sync/watch`;
            const h = { Authorization: `Bearer ${acc.token}` };
            const r = await fetch(base, { headers: h });
            if (r.ok) mergeRemote((await r.json()).data);
            const body = { watchlist: store.watchlist, history: store.history, mine: store.mine, gone: store.gone };
            await fetch(base, { method: 'PUT', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify({ data: body }) });
            save();
            if (el) renderPage();
        } catch {}   // bez sieci albo serwer bez synchronizacji — dane zostają w telefonie
        syncing = false;
    }

    // ───── Katalog (TMDB przez serwer kont) ─────
    async function tmdb(path, params = {}) {
        const acc = api.account();
        if (!acc) throw new Error('Zaloguj się na konto Pitayas');
        const qs = new URLSearchParams({ language: 'pl-PL', ...params }).toString();
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 12000);
        try {
            const r = await fetch(`${acc.server.replace(/\/*$/, '/')}api/tmdb/${path}?${qs}`, { headers: { Authorization: `Bearer ${acc.token}` }, signal: ctrl.signal });
            const data = await r.json().catch(() => ({}));
            if (r.status === 503) throw new Error('Katalog nie jest jeszcze włączony na serwerze Pitayas');
            if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
            return data;
        } catch (err) {
            throw err.name === 'AbortError' ? new Error('Serwer nie odpowiada') : err;
        } finally { clearTimeout(timer); }
    }
    const slim = (r) => ({ id: r.id, type: r.media_type || (r.first_air_date !== undefined || r.name ? 'tv' : 'movie'), title: r.title || r.name || '', poster: r.poster_path || '', year: String(r.release_date || r.first_air_date || '').slice(0, 4) });

    async function loadList() {
        Object.assign(disc, { loading: true, error: '', item: null, detail: null });
        renderPage();
        try {
            const d = disc.q.trim() ? await tmdb('search/multi', { query: disc.q.trim(), include_adult: 'false' }) : await tmdb('trending/all/week');
            disc.list = (d.results || []).filter((r) => (r.media_type || 'movie') !== 'person').map(slim).filter((r) => r.title);
        } catch (err) { disc.error = errText(err); disc.list = null; }
        disc.loading = false;
        renderPage();
    }

    async function openItem(item) {
        Object.assign(disc, { item, detail: null, error: '' });
        renderPage();
        try {
            const d = await tmdb(`${item.type}/${item.id}`, { append_to_response: 'watch/providers' });
            const pl = ((d['watch/providers'] || {}).results || {}).PL || {};
            const seen = new Set(), providers = [];
            for (const [kind, label] of KINDS) for (const p of pl[kind] || []) {
                const svc = SERVICES.find((s) => s.match.test(p.provider_name));
                const key = svc ? svc.id : p.provider_name;
                if (seen.has(key)) continue;
                seen.add(key);
                providers.push({ name: svc ? svc.name : p.provider_name, kind: label, svc: svc ? svc.id : '' });
            }
            if (disc.item === item) disc.detail = { overview: d.overview || '', runtime: d.runtime || (d.episode_run_time || [])[0] || 0, seasons: d.number_of_seasons || 0, genres: (d.genres || []).map((g) => g.name).slice(0, 3), providers };
        } catch (err) { if (disc.item === item) disc.error = errText(err); }
        if (disc.item === item) renderPage();
    }

    // ───── Biblioteka i licznik sesji ─────
    const same = (a, b) => a && b && a.id === b.id && a.type === b.type;
    const inList = (item) => store.watchlist.some((w) => same(w, item));
    function toggleList(item) {
        if (inList(item)) store.watchlist = store.watchlist.filter((w) => !same(w, item));
        else { store.watchlist.unshift({ ...item, added: Date.now() }); delete store.gone[keyOf(item)]; }
        if (!inList(item)) store.gone[keyOf(item)] = Date.now();
        saveSync(); renderPage();
    }
    // Sesja = oglądanie jednego tytułu; czas liczymy tylko wtedy, gdy film naprawdę gra (telewizor) albo jest otwarty (telefon)
    function startSession(item, svc, url, where) {
        endSession();
        store.session = { item: item || null, title: item ? item.title : svc.name, service: svc.name, svc: svc.id, url, where, start: Date.now(), seconds: 0, tick: Date.now() };
        save();
    }
    function tickSession(playing) {
        const s = store.session;
        if (!s) return;
        const now = Date.now();
        if (playing) s.seconds += Math.min(5, (now - s.tick) / 1000);
        s.tick = now;
        save();
    }
    function endSession() {
        const s = store.session;
        if (!s) return;
        if (s.where === 'phone' && !s.counted) s.seconds = (Date.now() - s.start) / 1000;
        store.session = null;
        if (s.seconds >= 30) {
            const prev = s.item && store.history.find((h) => same(h.item, s.item));
            if (prev) { prev.seconds += Math.round(s.seconds); prev.at = Date.now(); prev.service = s.service; prev.url = s.url; prev.svc = s.svc; store.history = [prev, ...store.history.filter((h) => h !== prev)]; }
            else store.history.unshift({ item: s.item, title: s.title, service: s.service, url: s.url, svc: s.svc, at: Date.now(), seconds: Math.round(s.seconds) });
            store.history = store.history.slice(0, 200);
            saveSync();
        } else save();
    }

    // ───── Odtwarzanie w telefonie ─────
    const nativePlayer = () => (Cap && Cap.isPluginAvailable && Cap.isPluginAvailable('PitayasWatch') ? Cap.Plugins.PitayasWatch : null);
    let playerHooked = false;
    let pendingConnect = null;
    function hookPlayer(P) {
        if (playerHooked) return;
        playerHooked = true;
        // Wtyczka sama mierzy czas z otwartym odtwarzaczem (bez czasu w tle)
        P.addListener('closed', (e) => {
            if (pendingConnect) return askConnected();
            if (store.session && store.session.where === 'phone') { store.session.seconds = e.seconds || 0; store.session.counted = true; endSession(); if (el) renderPage(); }
        });
    }
    function openInApp(url, title) {
        const P = nativePlayer();
        if (P) { hookPlayer(P); return P.open({ url, title, desktop: true }).catch((err) => api.toast(errText(err), 'err')); }
        // Starsza aplikacja bez wtyczki (iPhone): przeglądarka telefonu (ma Widevine)
        // iPhone: okno w aplikacji (nie wyrzuca do Safari ani aplikacji serwisu)
        const iab = api.Plugins.InAppBrowser;
        if (iab) (iab.openInWebView || iab.openInExternalBrowser).call(iab, { url }).catch(() => window.open(url, '_blank'));
        else window.open(url, '_blank');
    }
    function playOnPhone(item, svc, url) {
        url = url || svc.url(item ? item.title : '');
        startSession(item, svc, url, 'phone');
        return openInApp(url, item ? item.title : svc.name);
    }
    // „Połącz konto”: logowanie w oknie aplikacji (ciasteczka zostają, więc nie logujesz się drugi raz); po zamknięciu pytamy, czy się udało
    function connectSvc(svc) {
        pendingConnect = svc.id;
        openInApp(LOGIN[svc.id] || svc.url(''), `Logowanie: ${svc.name}`);
        if (!nativePlayer()) setTimeout(() => { if (el) renderPage(); }, 400);   // bez natywnego odtwarzacza (iPhone) pytanie „zalogowano?” pokazujemy na liście
    }
    function askConnected() {
        const svc = svcOf(pendingConnect);
        pendingConnect = null;
        if (svc && window.confirm(`Czy zalogowano się do ${svc.name}?`)) { if (!store.mine.includes(svc.id)) store.mine.push(svc.id); store.minePending = true; saveSync(); }
        if (el) renderPage();
    }

    // ───── Telewizor ─────
    const tv = { ws: null, online: false, connecting: false, state: null, error: '', needPin: false, retry: 0, seq: 0, waiting: new Map() };
    function tvClose() {
        clearTimeout(tv.retry);
        const ws = tv.ws;
        tv.ws = null; tv.online = false; tv.connecting = false;
        if (ws) { ws.onclose = ws.onmessage = ws.onerror = null; try { ws.close(); } catch {} }
        tv.waiting.forEach((done) => done({ ok: false, error: 'Brak połączenia z telewizorem' }));
        tv.waiting.clear();
    }
    function tvConnect(pin) {
        const t = tvNow();
        tvClose();
        if (!t || !el) return;
        if (!t.token && !pin) { tv.needPin = true; return renderPilot(); }
        tv.connecting = true; tv.error = '';
        renderPilot();
        let ws;
        try { ws = new WebSocket(`ws://${t.host}:${t.port || DEFAULT_PORT}/ws`); } catch { tv.connecting = false; tv.error = 'Zły adres telewizora'; return renderPilot(); }
        tv.ws = ws;
        ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', name: (Cap && Cap.getPlatform && Cap.getPlatform() === 'ios' ? 'iPhone' : 'Telefon'), ...(pin ? { pin } : { token: t.token }) }));
        ws.onmessage = (e) => {
            let m; try { m = JSON.parse(e.data); } catch { return; }
            if (m.t === 'welcome') {
                if (m.token) t.token = m.token;
                t.name = m.tv || t.name; save();
                Object.assign(tv, { online: true, connecting: false, needPin: false, error: '', state: m.state });
                renderPilot();
            } else if (m.t === 'state') {
                tv.state = m.state;
                if (store.session && store.session.where === 'tv') {
                    if (m.state && m.state.open) tickSession(Boolean(m.state.video && !m.state.video.paused));
                    else endSession();
                }
                renderPilot(true);
            } else if (m.t === 'ack') {
                const done = tv.waiting.get(m.id);
                if (done) { tv.waiting.delete(m.id); done(m); }
            } else if (m.t === 'error') {
                tv.error = m.text || 'Telewizor odrzucił połączenie';
                if (m.code === 'auth') delete t.token;
                tv.needPin = m.code !== 'locked';
                save();
            }
        };
        ws.onclose = (e) => {
            if (tv.ws !== ws) return;
            tvClose();
            if (e.code === 4003) { delete t.token; save(); tv.needPin = true; tv.error = 'Telewizor zapomniał ten telefon — sparuj ponownie'; }
            else if (e.code !== 4001 && !tv.needPin) { tv.error = tv.error || 'Telewizor nie odpowiada'; tv.retry = setTimeout(() => el && tvConnect(), 4000); }
            renderPilot();
        };
    }
    function tvSend(msg) {
        return new Promise((resolve) => {
            if (!tv.online || !tv.ws) return resolve({ ok: false, error: 'Brak połączenia z telewizorem' });
            const id = ++tv.seq;
            tv.waiting.set(id, resolve);
            setTimeout(() => { if (tv.waiting.delete(id)) resolve({ ok: false, error: 'Telewizor nie odpowiedział' }); }, 20000);
            tv.ws.send(JSON.stringify({ ...msg, id }));
        });
    }
    async function cmd(action, value, quiet) {
        if (navigator.vibrate && !quiet) navigator.vibrate(6);
        const r = await tvSend({ t: 'cmd', action, value });
        if (!r.ok && !quiet) api.toast(r.error || 'Nie udało się', 'err');
        return r;
    }
    // Handoff: ten sam adres otwiera się na telewizorze, a telefon zostaje pilotem
    async function playOnTv(item, svc, rawUrl) {
        if (!tvNow()) { tab = 'remote'; render(); return api.toast('Najpierw dodaj telewizor'); }
        if (!tv.online) { tab = 'remote'; render(); return api.toast('Telewizor nie jest połączony', 'err'); }
        const url = rawUrl || svc.url(item ? item.title : '');
        const r = await tvSend({ t: 'open', url, title: item ? item.title : '' });
        if (!r.ok) return api.toast(r.error || 'Telewizor nie otworzył strony', 'err');
        startSession(item, svc || { name: 'Strona' }, url, 'tv');
        tab = 'remote'; render();
        api.toast(item && svc && svc.url('x') === svc.url('y') ? `${svc.name} otwarty — znajdź tytuł pilotem` : 'Otwarte na telewizorze');
    }
    async function addTv(address, pin) {
        const m = String(address).trim().replace(/^\w+:\/\//, '').replace(/\/.*$/, '').match(/^([a-z0-9.\-]+)(?::(\d{2,5}))?$/i);
        if (!m) return api.toast('Wpisz adres z ekranu telewizora, np. 192.168.1.40', 'err');
        const host = m[1], port = Number(m[2]) || DEFAULT_PORT;
        const info = await api.probe(`http://${host}:${port}/info`, true);
        if (!info || info.app !== 'pitayas-watch') return api.toast('Pod tym adresem nie ma Pitayas Watch — sprawdź adres i sieć Wi-Fi', 'err');
        store.tvs = [{ host, port, name: info.name || host }, ...store.tvs.filter((t) => t.host !== host)];
        store.tv = host; save();
        tv.needPin = false;
        tvConnect(String(pin || '').replace(/\D/g, ''));
    }

    // ───── Wygląd ─────
    const poster = (p, w = 'w342') => (p ? `<img src="${IMG}${w}${esc(p)}" alt="" loading="lazy">` : '<i class="wt-noimg"></i>');
    const card = (it, i, attr) => `<button class="wt-card" ${attr}="${i}"><span class="wt-poster">${poster(it.poster)}</span><b>${esc(it.title)}</b><small>${it.type === 'tv' ? 'Serial' : 'Film'}${it.year ? ` · ${esc(it.year)}` : ''}</small></button>`;

    function discoverHtml() {
        if (!api.account()) return `<div class="wt-panel wt-c"><b class="wt-h">Katalog filmów i seriali</b><p class="hint">Zaloguj się na konto Pitayas w Ustawieniach aplikacji, żeby przeglądać katalog i sprawdzać, gdzie obejrzeć film. Pilot telewizora działa bez logowania.</p></div>${servicesHtml(null)}`;
        if (disc.item) return detailHtml();
        return `<form class="wt-search" data-search><input name="q" type="search" placeholder="Szukaj filmu albo serialu" value="${esc(disc.q)}" enterkeyhint="search"><button class="chip">Szukaj</button></form>
            ${disc.loading ? '<div class="spinner"></div>' : disc.error ? `<p class="hint warn">${esc(disc.error)}</p>${servicesHtml(null)}`
                : !disc.list ? '' : !disc.list.length ? '<p class="hint">Nic nie znaleziono.</p>'
                    : `<div class="wt-label">${disc.q.trim() ? 'Wyniki' : 'Popularne w tym tygodniu'}</div><div class="wt-grid">${disc.list.map((it, i) => card(it, i, 'data-res')).join('')}</div>`}`;
    }
    // Przyciski „Na telewizorze / W telefonie” dla serwisu
    const svcRow = (svc, kind) => `<div class="wt-svc"><span><b>${esc(svc.name)}</b>${kind ? `<small>${esc(kind)}</small>` : ''}</span>
        ${tvNow() ? `<button class="chip" data-tv="${svc.id}">Na telewizorze</button>` : ''}<button class="chip ${tvNow() ? 'ghost' : ''}" data-phone="${svc.id}">W telefonie</button></div>`;
    // „Moje serwisy”: zaznaczone u góry list, zapisane na koncie (te same na każdym telefonie)
    const mineFirst = (list, idOf) => [...list].sort((a, b) => (store.mine.includes(idOf(b)) ? 1 : 0) - (store.mine.includes(idOf(a)) ? 1 : 0));
    const mineHtml = () => `<div class="wt-panel"><b class="wt-h">Moje serwisy</b><p class="hint">Zaznacz serwisy, z których korzystasz — pojawią się pierwsze przy filmach, na każdym Twoim telefonie. Telewizor nie jest potrzebny: film otworzy się w telefonie.</p>
        <div class="wt-chips">${SERVICES.map((x) => `<button class="chip ${store.mine.includes(x.id) ? '' : 'ghost'}" data-mine="${x.id}">${store.mine.includes(x.id) ? '✓ ' : ''}${esc(x.name)}</button>`).join('')}</div></div>`;
    function servicesHtml(item) {
        return `<div class="wt-panel"><b class="wt-h">${item ? 'Otwórz w innym serwisie' : 'Otwórz serwis'}</b>${mineFirst(SERVICES, (s) => s.id).map((s) => svcRow(s, '')).join('')}</div>`;
    }
    function detailHtml() {
        const it = disc.item, d = disc.detail;
        const known = d ? d.providers.filter((p) => p.svc) : [];
        const other = d ? d.providers.filter((p) => !p.svc) : [];
        return `<button class="wt-back" data-back>‹ Wróć</button>
            <div class="wt-title"><span class="wt-poster">${poster(it.poster)}</span><div><b>${esc(it.title)}</b>
              <small>${it.type === 'tv' ? 'Serial' : 'Film'}${it.year ? ` · ${esc(it.year)}` : ''}${d && d.runtime ? ` · ${d.runtime} min` : ''}${d && d.seasons ? ` · sezonów: ${d.seasons}` : ''}</small>
              ${d && d.genres.length ? `<small>${esc(d.genres.join(', '))}</small>` : ''}
              <button class="chip ${inList(it) ? '' : 'ghost'}" data-list>${inList(it) ? '✓ Do obejrzenia' : '+ Do obejrzenia'}</button></div></div>
            ${disc.error ? `<p class="hint warn">${esc(disc.error)}</p>` : !d ? '<div class="spinner"></div>' : `
              ${d.overview ? `<p class="wt-over">${esc(d.overview)}</p>` : ''}
              <div class="wt-panel"><b class="wt-h">Gdzie obejrzeć w Polsce</b>
                ${known.length ? mineFirst(known, (p) => p.svc).map((p) => svcRow(SERVICES.find((s) => s.id === p.svc), p.kind)).join('') : '<p class="hint">Brak informacji o tym tytule w polskich serwisach.</p>'}
                ${other.length ? `<p class="hint">Także: ${esc(other.map((p) => `${p.name} (${p.kind})`).join(', '))}</p>` : ''}
                <p class="hint">Dane o dostępności: JustWatch przez TMDB. Serwis otwiera się na wyszukiwarce albo stronie głównej — zaloguj się w nim raz.</p></div>`}
            ${d && !known.length ? servicesHtml(it) : ''}`;
    }

    // ───── Ten komputer jako telewizor (aplikacja na Fedorze) ─────
    let pcState = null, pcHooked = false;
    const pcRefresh = () => window.PitayasDesktop.state().then((s) => { pcState = s; if (el && tab === 'thispc') renderPage(); }).catch(() => {});
    function pcHtml() {
        if (!pcState) { pcRefresh(); return '<div class="spinner"></div>'; }
        const s = pcState, pin = s.pin ? `${s.pin.slice(0, 3)} ${s.pin.slice(3)}` : '······', now = s.player && s.player.open;
        return `<div class="wt-panel"><b class="wt-h">Ten komputer jako telewizor</b>
            <p class="hint">Uruchom na telefonie moduł Watch → Pilot → „Dodaj telewizor” i wpisz adres oraz kod poniżej. Telefon wyśle film tutaj i będzie pilotem. Telefon i komputer muszą być w tej samej sieci.</p>
            <div class="wt-svc"><span><b>Adres</b><small>${esc((s.addresses || []).join(', ') || 'brak sieci')} · port ${s.port}${s.error ? ` · ${esc(s.error)}` : ''}</small></span></div>
            <div class="wt-svc"><span><b style="font-size:22px;letter-spacing:4px">${pin}</b><small>kod parowania</small></span><button class="chip ghost" data-pcpin>Nowy kod</button></div></div>
          <div class="wt-panel"><b class="wt-h">Odtwarzanie</b><p class="hint">${esc((s.drm && s.drm.text) || '')}</p>
            ${now ? `<div class="wt-svc"><span><b>${esc(s.player.title || 'Film')}</b><small>trwa odtwarzanie</small></span><button class="chip" data-pcstop>Zamknij</button></div>` : '<p class="hint">Wybierz tytuł w „Odkrywaj” i „W telefonie” — na komputerze otworzy się w przeglądarce z Widevine.</p>'}
            <div class="wt-svc"><span><b>Pełny ekran okna</b><small>tryb telewizora</small></span><button class="chip ${s.fullscreen ? '' : 'ghost'}" data-pcfull>${s.fullscreen ? 'Włączony' : 'Włącz'}</button></div></div>
          <div class="wt-panel"><b class="wt-h">Sparowane telefony</b>
            ${(s.devices || []).length ? s.devices.map((d) => `<div class="wt-svc"><span><b>${esc(d.name || 'Telefon')}</b><small>${d.online ? 'połączony' : 'rozłączony'}</small></span><button class="chip ghost" data-pcforget="${esc(d.id)}">Zapomnij</button></div>`).join('') : '<p class="hint">Żaden telefon nie jest jeszcze sparowany.</p>'}</div>`;
    }
    function pcBind(on) {
        if (!window.PitayasDesktop) return;
        const D = window.PitayasDesktop, set = (p) => p.then((s) => { pcState = s; renderPage(); }).catch((e) => api.toast(errText(e), 'err'));
        on('[data-pcpin]', () => set(D.newPin()));
        on('[data-pcstop]', () => set(D.stop()));
        on('[data-pcfull]', () => set(D.fullscreen(!pcState.fullscreen)));
        on('[data-pcforget]', (b) => set(D.forget(b.dataset.pcforget)));
        if (!pcHooked) { pcHooked = true; D.onState((s) => { pcState = s; if (el && tab === 'thispc') renderPage(); }); }
    }

    // ───── Start: kontynuuj oglądanie, połączone konta, do obejrzenia ─────
    let view = '';
    function accountsHtml() {
        const pend = pendingConnect && svcOf(pendingConnect);
        return `<button class="wt-back" data-back2>‹ Wróć</button>
            ${pend ? `<div class="wt-panel wt-now"><b class="wt-h">Zalogowano do ${esc(pend.name)}?</b><p class="hint">Zamknij okno logowania („Gotowe”), a potem potwierdź tutaj.</p><div class="wt-chips"><button class="chip" data-confirmconn>Tak, połącz</button><button class="chip ghost" data-cancelconn>Anuluj</button></div></div>` : ''}
            <div class="wt-panel"><b class="wt-h">Połącz konta</b><p class="hint">Zaloguj się do serwisów, z których korzystasz — logowanie odbywa się w oknie aplikacji i zostaje zapamiętane. Lista połączonych kont synchronizuje się z kontem Pitayas. Nie widzimy ani nie przechowujemy Twoich haseł do serwisów.</p>
            ${SERVICES.map((x) => `<div class="wt-svc"><span><b>${esc(x.name)}</b><small>${store.mine.includes(x.id) ? '✓ połączono' : 'niepołączone'}</small></span>
                <button class="chip ${store.mine.includes(x.id) ? 'ghost' : ''}" data-connect="${x.id}">${store.mine.includes(x.id) ? 'Zaloguj ponownie' : 'Połącz'}</button>
                ${store.mine.includes(x.id) ? `<button class="chip ghost" data-disconnect="${x.id}">Odłącz</button>` : ''}</div>`).join('')}</div>`;
    }
    function homeHtml() {
        if (view === 'accounts') return accountsHtml();
        const cont = store.history.filter((h) => h.url).slice(0, 12);
        const linked = SERVICES.filter((x) => store.mine.includes(x.id));
        return `<div class="wt-label">Kontynuuj oglądanie</div>
            ${cont.length ? `<div class="wt-row">${cont.map((h, i) => `<button class="wt-cont" data-cont="${i}"><span class="wt-poster">${poster(h.item && h.item.poster, 'w342')}</span><b>${esc(h.title)}</b><small>${esc(h.service)} · ${long(h.seconds)}</small></button>`).join('')}</div>`
                : `<div class="wt-panel wt-c"><b class="wt-h">Jeszcze nic nie oglądałeś</b><p class="hint">Połącz konta serwisów, wybierz tytuł w „Odkrywaj” i włącz go — tutaj pojawi się „Kontynuuj oglądanie”.</p></div>`}
            <div class="wt-label">Twoje konta</div>
            <div class="wt-panel"><div class="wt-chips">${linked.map((x) => `<button class="chip" data-open-svc="${x.id}">${esc(x.name)}</button>`).join('')}<button class="chip ghost" data-accounts>${linked.length ? 'Zarządzaj kontami' : '+ Połącz konta'}</button></div>
              ${linked.length ? '<p class="hint">Dotknij serwisu, żeby go otworzyć w aplikacji.</p>' : '<p class="hint">Zaloguj się do Netflixa, Disney+, HBO Max i innych — wszystko w jednym miejscu.</p>'}</div>
            ${store.watchlist.length ? `<div class="wt-label">Do obejrzenia · ${store.watchlist.length}</div><div class="wt-grid">${store.watchlist.slice(0, 6).map((it, i) => card(it, i, 'data-wl')).join('')}</div>` : ''}`;
    }

    function libraryHtml() {
        const total = store.history.reduce((n, h) => n + (h.seconds || 0), 0);
        const s = store.session;
        return `${s ? `<div class="wt-panel wt-now"><small>Trwa oglądanie · ${s.where === 'tv' ? 'telewizor' : 'telefon'}</small><b>${esc(s.title)}</b><span>${esc(s.service)} · ${long(s.where === 'tv' ? s.seconds : (Date.now() - s.start) / 1000)}</span>
                <button class="chip ghost" data-endsession>Zakończ sesję</button></div>` : ''}
            <div class="wt-label">Do obejrzenia · ${store.watchlist.length}</div>
            ${store.watchlist.length ? `<div class="wt-grid">${store.watchlist.map((it, i) => card(it, i, 'data-wl')).join('')}</div>` : '<p class="hint">Dodawaj tytuły przyciskiem „+ Do obejrzenia” w katalogu.</p>'}
            <div class="wt-label">Historia${total ? ` · razem ${long(total)}` : ''}</div>
            ${store.history.length ? `<div class="wt-hist">${store.history.map((h, i) => `<button class="wt-hrow" data-hist="${i}"><span class="wt-poster">${poster(h.item && h.item.poster, 'w154')}</span>
                <span><b>${esc(h.title)}</b><small>${esc(h.service)} · ${new Date(h.at).toLocaleDateString('pl-PL', { day: 'numeric', month: 'long' })}</small><small>Oglądane: ${long(h.seconds)}</small></span></button>`).join('')}</div>
                <button class="chip ghost wt-clear" data-clearhist>Wyczyść historię</button>` : '<p class="hint">Tu pojawią się tytuły, które oglądasz, z czasem oglądania.</p>'}`;
    }

    const ICON = {
        play: '<path d="M8 5v14l11-7z"/>', pause: '<path d="M7 5h4v14H7zM13 5h4v14h-4z"/>',
        up: '<path d="M6 15l6-6 6 6"/>', down: '<path d="M6 9l6 6 6-6"/>', left: '<path d="M15 6l-6 6 6 6"/>', right: '<path d="M9 6l6 6-6 6"/>',
    };
    const svg = (k) => `<svg viewBox="0 0 24 24">${ICON[k]}</svg>`;
    function pairHtml(t) {
        return `<form class="wt-panel" data-pair><b class="wt-h">${t ? `Sparuj z „${esc(t.name || t.host)}”` : 'Dodaj telewizor'}</b>
            <p class="hint">Uruchom Pitayas Watch na telewizorze — na ekranie zobaczysz adres i kod parowania. Telefon i telewizor muszą być w tej samej sieci.</p>
            <input name="host" placeholder="Adres telewizora, np. 192.168.1.40" value="${esc(t ? `${t.host}${t.port && t.port !== DEFAULT_PORT ? `:${t.port}` : ''}` : '')}" autocapitalize="off" autocomplete="off" inputmode="url">
            <input name="pin" placeholder="Kod z telewizora (6 cyfr)" inputmode="numeric" maxlength="7" autocomplete="off">
            ${tv.error ? `<p class="hint warn">${esc(tv.error)}</p>` : ''}
            <button class="btn">Połącz</button></form>`;
    }
    function remoteHtml() {
        const t = tvNow();
        if (!t || tv.needPin) return pairHtml(t);
        const s = tv.state || {}, v = s.video, keys = s.service && s.service.seek === 'keys';
        const head = `<div class="wt-tv"><span class="wt-dot ${tv.online ? 'on' : ''}"></span><b>${esc(t.name || t.host)}</b><small>${tv.online ? 'połączony' : tv.connecting ? 'łączę…' : esc(tv.error || 'rozłączony')}</small>
            <button class="chip ghost" data-tvmenu>Zmień</button></div>`;
        if (!tv.online) return `${head}<div class="wt-panel wt-c"><p class="hint">${tv.connecting ? 'Łączę z telewizorem…' : 'Sprawdź, czy Pitayas Watch działa na telewizorze i czy telefon jest w tej samej sieci.'}</p><button class="btn ghost" data-reconnect>Połącz ponownie</button></div>`;
        if (!s.open) return `${head}<div class="wt-panel wt-c"><b class="wt-h">Telewizor czeka na film</b><p class="hint">Wybierz tytuł w „Odkrywaj” albo otwórz serwis od razu.</p></div>
            <div class="wt-panel"><b class="wt-h">Otwórz serwis na telewizorze</b><div class="wt-chips">${SERVICES.map((x) => `<button class="chip ghost" data-tv="${x.id}">${esc(x.name)}</button>`).join('')}</div>
              <form class="wt-search" data-openurl><input name="url" type="url" placeholder="albo wklej adres https://…" autocapitalize="off"><button class="chip">Wyślij</button></form></div>`;
        return `${head}
            <div class="wt-panel wt-playing"><b>${esc(s.title || '')}</b><small>${esc(s.service ? s.service.name : s.host || '')}</small>
              <div class="wt-prog" data-progwrap>${progHtml(v, keys)}</div>
              <div class="wt-main"><button data-cmd="seek" data-v="-30">−30</button><button data-cmd="seek" data-v="-10">−10</button>
                <button class="big" data-cmd="playpause" data-pp>${svg(v && !v.paused ? 'pause' : 'play')}</button>
                <button data-cmd="seek" data-v="10">+10</button><button data-cmd="seek" data-v="30">+30</button></div>
              <div class="wt-row"><button data-cmd="volume" data-v="-0.05">Ciszej</button><button data-cmd="mute" data-mute>${muted(s) ? 'Włącz dźwięk' : 'Wycisz'}</button><button data-cmd="volume" data-v="0.05">Głośniej</button></div>
              <div class="wt-row"><button data-cmd="fullscreen">Pełny ekran</button><button data-cmd="reload">Odśwież</button><button class="stop" data-cmd="stop">Zakończ</button></div></div>
            <div class="wt-panel"><b class="wt-h">Nawigacja po stronie</b>
              <div class="wt-pad" data-pad><span>Gładzik — przesuń palcem, dotknij = kliknięcie, dwa palce = przewijanie</span></div>
              <div class="wt-dpad"><i></i><button data-key="up">${svg('up')}</button><i></i>
                <button data-key="left">${svg('left')}</button><button data-key="enter" class="ok">OK</button><button data-key="right">${svg('right')}</button>
                <button data-key="back">Wstecz</button><button data-key="down">${svg('down')}</button><button data-key="tab">Tab</button></div>
              <form class="wt-search" data-text><input name="text" placeholder="Wpisz tekst na telewizorze" autocapitalize="off" autocomplete="off"><button class="chip">Wyślij</button></form>
              <div class="wt-row"><button data-key="backspace">Usuń znak</button><button data-key="space">Spacja</button></div></div>`;
    }
    const muted = (s) => (s.system ? s.system.muted : Boolean(s.video && s.video.muted));
    function progHtml(v, keys) {
        if (!v) return '<small class="wt-wait">Czekam na odtwarzacz serwisu — wybierz film na telewizorze (gładzik niżej).</small>';
        const live = !v.duration;
        return `<span>${clock(v.time)}</span>${live ? '<i class="wt-live"></i>' : `<input type="range" min="0" max="${v.duration}" value="${Math.min(v.time, v.duration)}" ${keys ? 'disabled' : ''} data-seekto>`}<span>${live ? '' : clock(v.duration)}</span>`;
    }

    function render() {
        if (!el) return;
        el.innerHTML = `<div class="wt-tabs">${[['home', 'Start'], ['discover', 'Odkrywaj'], ['library', 'Biblioteka'], ['remote', 'Pilot'], ...(window.PitayasDesktop ? [['thispc', 'Ten komputer']] : [])].map(([id, n]) => `<button data-tab="${id}" class="${tab === id ? 'on' : ''}">${n}</button>`).join('')}</div><div class="wt-page"></div>`;
        el.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => { tab = b.dataset.tab; render(); }));
        renderPage();
        if (tab === 'discover' && api.account() && !disc.list && !disc.loading && !disc.error) loadList();
    }
    function renderPage() {
        const page = q('.wt-page');
        if (!page) return;
        page.innerHTML = tab === 'thispc' ? pcHtml() : tab === 'home' ? homeHtml() : tab === 'discover' ? discoverHtml() : tab === 'library' ? libraryHtml() : remoteHtml();
        bind();
    }
    // Stan z telewizora przychodzi co sekundę — podmieniamy tylko pasek postępu i ikony, żeby nie zrywać dotyku
    let dragging = false, shape = '';
    function renderPilot(light) {
        if (!el || tab !== 'remote') return;
        const s = tv.state || {};
        const now = `${tv.online}|${tv.needPin}|${Boolean(s.open)}|${s.title}|${s.service && s.service.id}|${Boolean(s.video)}|${Boolean(s.video && s.video.duration)}`;
        if (!light || now !== shape || !q('[data-progwrap]')) { shape = now; return renderPage(); }
        if (!dragging) {
            const r = q('[data-seekto]');
            if (r && s.video) { r.value = s.video.time; r.previousElementSibling.textContent = clock(s.video.time); }
            else if (s.video) { const c = q('[data-progwrap] span'); if (c) c.textContent = clock(s.video.time); }
        }
        const pp = q('[data-pp]'); if (pp) pp.innerHTML = svg(s.video && !s.video.paused ? 'pause' : 'play');
        const mu = q('[data-mute]'); if (mu) mu.textContent = muted(s) ? 'Włącz dźwięk' : 'Wycisz';
    }

    function bindPad(pad) {
        let last = null, moved = 0, fingers = 0, dx = 0, dy = 0, sc = 0, timer = 0;
        const flush = () => {
            timer = 0;
            if (dx || dy) { tv.ws && tv.online && tv.ws.send(JSON.stringify({ t: 'cmd', action: 'move', value: { dx: Math.round(dx), dy: Math.round(dy) } })); dx = dy = 0; }
            if (sc) { tv.ws && tv.online && tv.ws.send(JSON.stringify({ t: 'cmd', action: 'scroll', value: Math.round(sc) })); sc = 0; }
        };
        pad.addEventListener('touchstart', (e) => { const t = e.touches[0]; last = { x: t.clientX, y: t.clientY }; moved = 0; fingers = e.touches.length; }, { passive: true });
        pad.addEventListener('touchmove', (e) => {
            if (!last) return;
            e.preventDefault();
            const t = e.touches[0], mx = t.clientX - last.x, my = t.clientY - last.y;
            last = { x: t.clientX, y: t.clientY };
            moved += Math.abs(mx) + Math.abs(my);
            fingers = Math.max(fingers, e.touches.length);
            if (e.touches.length > 1) sc += my * 3; else { dx += mx * 2.2; dy += my * 2.2; }
            if (!timer) timer = setTimeout(flush, 40);
        }, { passive: false });
        pad.addEventListener('touchend', (e) => { if (e.touches.length) return; if (last && moved < 8 && fingers === 1) cmd('click'); last = null; });
    }

    function bind() {
        const on = (sel, fn) => el.querySelectorAll(sel).forEach((b) => (b.onclick = () => fn(b)));
        const svcOf = (id) => SERVICES.find((s) => s.id === id);
        const sf = q('[data-search]');
        if (sf) sf.onsubmit = (e) => { e.preventDefault(); disc.q = sf.elements.q.value; sf.elements.q.blur(); loadList(); };
        on('[data-res]', (b) => openItem(disc.list[Number(b.dataset.res)]));
        on('[data-wl]', (b) => { tab = 'discover'; render(); openItem(store.watchlist[Number(b.dataset.wl)]); });
        on('[data-hist]', (b) => { const h = store.history[Number(b.dataset.hist)]; if (h.item) { tab = 'discover'; render(); openItem(h.item); } });
        on('[data-back]', () => { Object.assign(disc, { item: null, detail: null, error: '' }); renderPage(); });
        on('[data-list]', () => toggleList(disc.item));
        on('[data-tv]', (b) => playOnTv(tab === 'discover' ? disc.item : null, svcOf(b.dataset.tv)));
        on('[data-phone]', (b) => playOnPhone(disc.item, svcOf(b.dataset.phone)));
        pcBind(on);
        on('[data-accounts]', () => { view = 'accounts'; renderPage(); });
        on('[data-back2]', () => { view = ''; renderPage(); });
        on('[data-confirmconn]', () => { const id = pendingConnect; pendingConnect = null; if (id && !store.mine.includes(id)) store.mine.push(id); store.minePending = true; saveSync(); renderPage(); });
        on('[data-cancelconn]', () => { pendingConnect = null; renderPage(); });
        on('[data-connect]', (b) => connectSvc(svcOf(b.dataset.connect)));
        on('[data-disconnect]', (b) => { store.mine = store.mine.filter((x) => x !== b.dataset.disconnect); store.minePending = true; saveSync(); renderPage(); });
        on('[data-cont]', (b) => { const h = store.history.filter((x) => x.url)[Number(b.dataset.cont)]; if (h) playOnPhone(h.item, svcOf(h.svc) || { id: h.svc, name: h.service, url: () => h.url }, h.url); });
        on('[data-open-svc]', (b) => playOnPhone(null, svcOf(b.dataset.openSvc)));
        on('[data-endsession]', () => { endSession(); renderPage(); });
        on('[data-clearhist]', () => { store.history = []; saveSync(); renderPage(); });
        on('[data-mine]', (b) => { const id = b.dataset.mine; store.mine = store.mine.includes(id) ? store.mine.filter((x) => x !== id) : [...store.mine, id]; store.minePending = true; saveSync(); renderPage(); });

        const pf = q('[data-pair]');
        if (pf) pf.onsubmit = (e) => { e.preventDefault(); const b = pf.querySelector('.btn'); b.disabled = true; addTv(pf.elements.host.value, pf.elements.pin.value).finally(() => { b.disabled = false; }); };
        on('[data-reconnect]', () => tvConnect());
        on('[data-tvmenu]', () => {
            // Kolejny telewizor albo ponowne parowanie: formularz z adresem bieżącego
            const t = tvNow();
            if (t) delete t.token;
            save(); tvClose(); tv.needPin = true; tv.error = ''; renderPage();
        });
        on('[data-cmd]', (b) => cmd(b.dataset.cmd, b.dataset.v !== undefined ? Number(b.dataset.v) : undefined).then((r) => {
            if (b.dataset.cmd === 'stop' && r.ok) { endSession(); }
        }));
        on('[data-key]', (b) => cmd('key', b.dataset.key));
        const range = q('[data-seekto]');
        if (range) {
            range.oninput = () => { dragging = true; range.previousElementSibling.textContent = clock(range.value); };
            range.onchange = () => { cmd('seekto', Number(range.value)).finally(() => { dragging = false; }); };
        }
        const tf = q('[data-text]');
        if (tf) tf.onsubmit = (e) => { e.preventDefault(); const v = tf.elements.text.value; if (v) cmd('text', v).then((r) => { if (r.ok) tf.elements.text.value = ''; }); };
        const uf = q('[data-openurl]');
        if (uf) uf.onsubmit = (e) => { e.preventDefault(); const u = uf.elements.url.value.trim(); if (u) playOnTv(null, null, u); };
        const pad = q('[data-pad]');
        if (pad) bindPad(pad);
    }

    Pitayas.register({
        id: 'watch',

        // Kafelek: zielona kropka, gdy wybrany telewizor odpowiada (moduł działa też bez niego)
        probe: (a) => { const t = tvNow(); return t ? a.probe(`http://${t.host}:${t.port || DEFAULT_PORT}/info`, true) : Promise.resolve(null); },

        mount(body, moduleApi) {
            api = moduleApi;
            el = body;
            el.classList.add('wt-mod');
            if (store.session && store.session.where === 'phone') endSession();   // wróciliśmy z odtwarzacza w telefonie
            render();
            if (tvNow()) tvConnect();
            syncNow();
        },

        pause() { tvClose(); },
        resume() {
            if (!el) return;
            if (store.session && store.session.where === 'phone' && !nativePlayer()) { endSession(); renderPage(); }
            if (tvNow() && !tv.needPin) tvConnect();
        },

        unmount() {
            tvClose();
            el = null;
        },
    });
})();

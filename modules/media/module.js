// ═══════ PITAYAS MEDIA — MODUŁ ═══════
// Pobieranie filmów na telefon:
//  • Filmy i seriale — wyszukiwarka (Cinemeta) + linki z dodatku Pitaya Streams (logowanie jak w /configure),
//  • Link — YouTube i inne strony przez yt-dlp w Pitayas Media na komputerze, zwykłe linki prosto na telefon,
//  • Pobrane — pliki w telefonie i zadania komputera.
// Linki ⚡ (debrid) i zwykłe pliki telefon pobiera sam (Filesystem.downloadFile, bez CORS). Torrenty i YouTube
// pobiera komputer (Pitayas Media, port 8193), a gotowy plik przechodzi na telefon przez sieć lokalną.
(() => {
    const Cap = window.Capacitor;
    const NATIVE = Boolean(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
    const FS = NATIVE ? Cap.Plugins.Filesystem : null;
    const PLATFORM = Cap && Cap.getPlatform ? Cap.getPlatform() : 'web';
    const CINEMETA = 'https://v3-cinemeta.strem.io';
    const DEFAULT_STREAMS = 'https://streams.rakunek.com';
    const KEY = 'pitayas-media';
    const FORMATS = [['mp4', 'MP4'], ['mkv', 'MKV'], ['mp3', 'MP3'], ['flac', 'FLAC'], ['wav', 'WAV']];

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
    const size = (n) => (!n ? '' : n >= 1073741824 ? `${(n / 1073741824).toFixed(2)} GB` : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
    const errText = (err) => (err && err.message) || String(err);
    const safeName = (s) => String(s || 'plik').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 150) || 'plik';

    // ───── Pamięć modułu ─────
    const store = (() => {
        let s = null;
        try { s = JSON.parse(localStorage.getItem(KEY)); } catch {}
        s = Object.assign({ streams: { server: '', token: '', login: '', logged: false, torrentio: '' }, phone: [], sent: [] }, s || {});
        // Pobieranie przerwane zamknięciem aplikacji nie wznowi się samo
        s.phone.forEach((d) => { if (d.state === 'run') { d.state = 'err'; d.error = 'Przerwane — aplikacja została zamknięta'; } });
        return s;
    })();
    const save = () => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch {} };
    const streamsServer = () => (store.streams.server || DEFAULT_STREAMS).replace(/\/+$/, '');

    let el = null, api = null, tab = 'link';
    let pcOnline = false, pcInfo = null, jobs = [], pollTimer = null, probeTimer = null;
    // Wyszukiwarka: lista → tytuł (sezony/odcinki) → linki
    const search = { q: '', results: null, loading: false, meta: null, season: null, target: null, streams: null, error: '' };
    // Link: wynik analizy na komputerze
    const link = { url: '', info: null, loading: false, format: 'mp4', height: 0, dest: 'phone', error: '' };

    const q = (sel) => el && el.querySelector(sel);
    const qa = (sel) => (el ? [...el.querySelectorAll(sel)] : []);

    // ───── Komputer (Pitayas Media) ─────
    async function pc(path, body, timeout = 10000) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeout);
        try {
            const r = await fetch(api.url(path), {
                method: body === undefined ? 'GET' : (body === null ? 'DELETE' : 'POST'),
                headers: body ? { 'Content-Type': 'application/json' } : {},
                body: body ? JSON.stringify(body) : undefined, cache: 'no-store', signal: ctrl.signal,
            });
            const data = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
            return data;
        } catch (err) {
            if (err.name === 'AbortError') throw new Error('Komputer nie odpowiada');
            throw err;
        } finally { clearTimeout(timer); }
    }

    async function probePc() {
        const was = pcOnline;
        pcInfo = api.pc() && api.port() ? await api.probe(api.url('/info'), true) : null;
        pcOnline = Boolean(pcInfo && pcInfo.app === 'media');
        renderBar();
        if (was !== pcOnline && (tab === 'link' || (tab === 'search' && search.streams))) renderPage();
        if (pcOnline) pollJobs();
    }

    async function pollJobs() {
        if (!pcOnline || !el) return;
        try { jobs = (await pc('/api/jobs')).jobs || []; } catch { return; }
        // Zadania „na telefon” po skończeniu same przechodzą do telefonu
        for (const j of jobs) {
            if (j.forPhone && j.state === 'done' && !store.sent.includes(j.id)) {
                store.sent.push(j.id);
                store.sent = store.sent.slice(-200);
                save();
                phoneDownload({ url: api.url(`/files/${encodeURIComponent(j.id)}`), name: j.file || j.title, from: 'Komputer' });
            }
        }
        if (tab === 'files') renderJobs();
        clearTimeout(pollTimer);
        const active = jobs.some((j) => j.state === 'queued' || j.state === 'run');
        pollTimer = setTimeout(pollJobs, active ? 1500 : 5000);
    }

    async function pcJob(job) {
        if (!pcOnline) return api.toast('Uruchom Pitayas Media na komputerze', 'err');
        try {
            await pc('/api/jobs', job, 20000);
            api.toast(job.forPhone ? 'Komputer pobiera — plik sam przejdzie na telefon' : 'Pobieranie na komputerze ruszyło');
            pollJobs();
        } catch (err) { api.toast(`Komputer: ${errText(err)}`, 'err'); }
    }

    // ───── Pobieranie na telefon ─────
    const byUrl = new Map();
    let progressHooked = false;
    function hookProgress() {
        if (progressHooked || !FS || !FS.addListener) return;
        progressHooked = true;
        FS.addListener('progress', (p) => {
            const d = byUrl.get(p.url);
            if (!d) return;
            d.bytes = p.bytes; d.total = p.contentLength > 0 ? p.contentLength : d.total;
            const row = el && el.querySelector(`[data-dl="${d.id}"]`);
            if (row) paintRow(row, d);
        });
    }

    function awake() {
        const k = api && api.Plugins.KeepAwake;
        if (!k) return;
        (store.phone.some((d) => d.state === 'run') ? k.keepAwake() : k.allowSleep()).catch(() => {});
    }

    // Android: Dokumenty/Pitayas/Media (widać w Plikach). iPhone: folder aplikacji — zapis do Plików przez „Udostępnij”.
    const target = () => (PLATFORM === 'android' ? { directory: 'DOCUMENTS', dir: 'Pitayas/Media' } : { directory: 'DOCUMENTS', dir: 'Media' });

    async function freePath(directory, dir, name) {
        const dot = name.lastIndexOf('.');
        const stem = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : '';
        for (let i = 1; i < 100; i++) {
            const path = `${dir}/${i === 1 ? name : `${stem} (${i})${ext}`}`;
            try { await FS.stat({ directory, path }); } catch { return path; }
        }
        return `${dir}/${Date.now()}-${name}`;
    }

    async function phoneDownload({ url, name, from }) {
        name = safeName(name);
        if (!/\.[a-z0-9]{2,4}$/i.test(name)) name += '.mp4';
        if (!FS) {   // podgląd w przeglądarce: zwykłe pobranie
            window.open(url, '_blank');
            return;
        }
        hookProgress();
        const { directory, dir } = target();
        if (PLATFORM === 'android') { try { await FS.requestPermissions(); } catch {} }
        const d = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, url, from: from || '', directory, path: '', state: 'run', bytes: 0, total: 0, at: Date.now() };
        store.phone.unshift(d);
        store.phone = store.phone.slice(0, 100);
        save();
        api.toast(`Pobieram na telefon: ${name}`);
        if (tab === 'files') renderPage();
        awake();
        try {
            d.path = await freePath(directory, dir, name);
            byUrl.set(url, d);
            await FS.downloadFile({ url, directory, path: d.path, progress: true, recursive: true });
            const st = await FS.stat({ directory, path: d.path }).catch(() => null);
            d.state = 'done';
            d.total = d.bytes = (st && st.size) || d.total;
            api.toast(`Pobrano: ${d.name}`);
        } catch (err) {
            d.state = 'err';
            d.error = errText(err);
            api.toast(`Nie udało się pobrać: ${d.error}`, 'err');
        } finally {
            byUrl.delete(url);
            save();
            awake();
            if (tab === 'files') renderPage();
        }
    }

    async function fileUri(d) {
        return (await FS.getUri({ directory: d.directory, path: d.path })).uri;
    }

    async function shareFile(d) {
        try {
            const uri = await fileUri(d);
            if (Cap.isPluginAvailable('Share')) await Cap.Plugins.Share.share({ title: d.name, files: [uri] });
            else api.toast(PLATFORM === 'android' ? `Plik jest w Dokumenty/${d.path}` : 'Ten telefon nie pozwala udostępnić pliku', 'err');
        } catch (err) {
            if (!/cancel|abort/i.test(errText(err))) api.toast(errText(err), 'err');
        }
    }

    async function playFile(d) {
        try {
            const src = Cap.convertFileSrc(await fileUri(d));
            const ov = document.createElement('div');
            ov.className = 'md-player';
            ov.innerHTML = `<video controls autoplay playsinline src="${esc(src)}"></video><button class="bar-btn" title="Zamknij"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`;
            ov.querySelector('button').onclick = () => { ov.querySelector('video').pause(); ov.remove(); };
            ov.querySelector('video').onerror = () => api.toast('Telefon nie odtworzy tego formatu — użyj „Udostępnij” i np. VLC', 'err');
            document.body.appendChild(ov);
        } catch (err) { api.toast(errText(err), 'err'); }
    }

    async function removeFile(d) {
        if (!confirm(`Usunąć „${d.name}”${d.state === 'done' ? ' z telefonu' : ''}?`)) return;
        if (d.state === 'done' && d.path) { try { await FS.deleteFile({ directory: d.directory, path: d.path }); } catch {} }
        store.phone = store.phone.filter((x) => x !== d);
        save();
        renderPage();
    }

    // ───── Pitaya Streams ─────
    function cfgSegment() {
        const c = {};
        if (store.streams.token) c.t = store.streams.token;
        if (store.streams.torrentio) c.torrentioOptions = store.streams.torrentio;
        if (!Object.keys(c).length) return '';
        return `${btoa(unescape(encodeURIComponent(JSON.stringify(c)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}/`;
    }

    async function getJson(url, timeout = 25000) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeout);
        try {
            const r = await fetch(url, { signal: ctrl.signal });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return await r.json();
        } catch (err) {
            throw err.name === 'AbortError' ? new Error('Serwer nie odpowiada') : err;
        } finally { clearTimeout(timer); }
    }

    async function streamsLogin(server, login, password) {
        const r = await fetch(`${server}/api/login`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login, password }),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
        Object.assign(store.streams, { server: server === DEFAULT_STREAMS ? '' : server, token: d.token || '', login: d.login || login, logged: true, viaAccount: false });
        save();
    }

    async function doSearch() {
        const text = search.q.trim();
        if (!text) return;
        Object.assign(search, { loading: true, results: null, meta: null, streams: null, error: '' });
        renderPage();
        try {
            const enc = encodeURIComponent(text);
            const [movies, series] = await Promise.all(['movie', 'series'].map((t) =>
                getJson(`${CINEMETA}/catalog/${t}/top/search=${enc}.json`).then((d) => d.metas || []).catch(() => [])));
            // Na przemian filmy i seriale, żeby trafne wyniki obu rodzajów były u góry
            const out = [];
            for (let i = 0; i < Math.max(movies.length, series.length); i++) {
                if (movies[i]) out.push({ ...movies[i], type: 'movie' });
                if (series[i]) out.push({ ...series[i], type: 'series' });
            }
            search.results = out.filter((m) => /^tt\d+/.test(m.id)).slice(0, 40);
        } catch (err) { search.error = errText(err); }
        search.loading = false;
        renderPage();
    }

    async function openTitle(m) {
        Object.assign(search, { meta: { ...m, videos: null }, season: null, streams: null, error: '' });
        if (m.type === 'movie') return loadStreams({ type: 'movie', id: m.id, label: m.name });
        renderPage();
        try {
            const d = await getJson(`${CINEMETA}/meta/series/${m.id}.json`);
            const videos = ((d.meta && d.meta.videos) || []).filter((v) => v.season > 0 && v.episode > 0)
                .sort((a, b) => a.season - b.season || a.episode - b.episode);
            search.meta.videos = videos;
            search.season = videos.length ? videos[videos.length - 1].season : null;
        } catch (err) { search.error = errText(err); }
        renderPage();
    }

    async function loadStreams(t) {
        Object.assign(search, { target: t, streams: null, loading: true, error: '' });
        renderPage();
        try {
            const d = await getJson(`${streamsServer()}/${cfgSegment()}stream/${t.type}/${encodeURIComponent(t.id)}.json`, 60000);
            search.streams = d.streams || [];
            if (d.error) search.error = d.error;
        } catch (err) { search.error = errText(err); search.streams = []; }
        search.loading = false;
        renderPage();
    }

    function streamName(s) {
        const hint = s.behaviorHints && s.behaviorHints.filename;
        if (hint) return hint;
        if (s.url) {
            try {
                const last = decodeURIComponent(new URL(s.url).pathname.split('/').pop() || '');
                if (/\.(mkv|mp4|avi|m4v|webm|mov|ts)$/i.test(last)) return last;
            } catch {}
        }
        const quality = (s.name || '').split('\n')[1] || '';
        return `${search.target.label}${quality ? ` ${quality}` : ''}.mkv`;
    }

    function streamAction(s, dest) {
        const name = streamName(s);
        if (s.url && dest === 'phone') return phoneDownload({ url: s.url, name, from: 'Pitaya Streams ⚡' });
        if (s.url) return pcJob({ type: 'http', url: s.url, name, forPhone: false });
        const trackers = (s.sources || []).filter((x) => x.startsWith('tracker:')).map((x) => x.slice(8));
        pcJob({
            type: 'torrent', infoHash: s.infoHash, fileIdx: s.fileIdx, fileMustInclude: s.fileMustInclude,
            trackers, name, title: search.target.label, forPhone: dest === 'phone',
        });
    }

    // ───── Link ─────
    async function analyzeLink() {
        const url = link.url.trim();
        if (!/^(https?:\/\/|magnet:)/i.test(url)) return api.toast('Wklej link zaczynający się od https:// albo magnet:', 'err');
        if (/^magnet:/i.test(url)) {
            return pcJob({ type: 'torrent', magnet: url, forPhone: link.dest === 'phone' });
        }
        Object.assign(link, { loading: true, info: null, error: '' });
        renderPage();
        try {
            link.info = await pc('/api/analyze', { url }, 90000);
            link.height = (link.info.heights || [])[0] || 0;
        } catch (err) { link.error = errText(err); }
        link.loading = false;
        renderPage();
    }

    function startLink() {
        const i = link.info;
        if (!i) return;
        pcJob({ type: 'ytdlp', url: link.url.trim(), title: i.title, format: link.format, height: link.height, forPhone: link.dest === 'phone' });
        Object.assign(link, { info: null, url: '' });
        renderPage();
    }

    function directLink() {
        const url = link.url.trim();
        if (!/^https?:\/\//i.test(url)) return api.toast('Wklej link https://', 'err');
        let name = 'plik';
        try { name = decodeURIComponent(new URL(url).pathname.split('/').pop()) || name; } catch {}
        phoneDownload({ url, name, from: 'Link' });
    }

    // ───── Wygląd ─────
    function renderBar() {
        const b = q('.md-pcstate');
        if (!b) return;
        b.className = `md-pcstate ${pcOnline ? 'on' : ''}`;
        b.textContent = pcOnline ? 'Komputer połączony' : api.pc() ? 'Komputer: nie widzę Pitayas Media' : 'Bez komputera';
    }

    // Kapsuła pod wybraną zakładką: przesuwa się sprężyście i na chwilę „rozciąga” jak płyn (styl iOS 26)
    function placePill(animate) {
        const bar = q('.md-tabs'), on = q('.md-tabs button.on'), pill = q('.md-pill');
        if (!bar || !on || !pill) return;
        if (!animate) pill.style.transition = 'none';
        pill.style.setProperty('--x', `${on.offsetLeft}px`);
        pill.style.setProperty('--w', `${on.offsetWidth}px`);
        if (!animate) { void pill.offsetWidth; pill.style.transition = ''; return; }
        pill.classList.remove('stretch'); void pill.offsetWidth; pill.classList.add('stretch');
    }

    function selectTab(id) {
        if (id === tab) return;
        tab = id;
        qa('.md-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === id));
        placePill(true);
        if (navigator.vibrate) navigator.vibrate(8);
        renderPage();
    }

    function render() {
        if (!el) return;
        // „Filmy i seriale” (Pitaya Streams): na końcu i tylko po zalogowaniu, gdy w panelu kont masz dostęp do aplikacji „stremio”
        const acc = api.account && api.account();
        const st = api.access ? api.access('stremio') : null;
        const streamsOk = Boolean(acc && st && st.access);
        const tabs = [['link', 'Link'], ['files', 'Pobrane'], ...(streamsOk ? [['search', 'Filmy i seriale']] : [])];
        if (!tabs.some(([id]) => id === tab)) tab = 'link';
        el.innerHTML = `
            <div class="md-tabs" id="mdTabs" data-glass-seg style="--n:${tabs.length}">
              <i class="md-pill"></i>
              ${tabs.map(([id, label]) => `<button data-tab="${id}" class="${tab === id ? 'on' : ''}">${label}</button>`).join('')}
            </div>
            <div class="md-pcstate"></div>
            <div class="md-page"></div>`;
        qa('[data-tab]').forEach((b) => (b.onclick = () => selectTab(b.dataset.tab)));
        placePill(false);
        renderBar();
        renderPage();
    }

    // Konto Pitayas z Ustawień działa też w Pitaya Streams — bez osobnego logowania
    function syncAccount() {
        const acc = api.account ? api.account() : null;
        const st = store.streams;
        if (acc && (!st.logged || (st.viaAccount && st.token !== acc.token))) {
            Object.assign(st, { server: '', token: acc.token, login: acc.user.name || acc.user.login, logged: true, viaAccount: true });
            save();
        } else if (!acc && st.viaAccount) {
            Object.assign(st, { token: '', logged: false, viaAccount: false });
            save();
        }
    }

    function renderPage() {
        const page = q('.md-page');
        if (!page) return;
        syncAccount();
        if (tab === 'search') page.innerHTML = store.streams.logged ? searchHtml() : loginHtml();
        else if (tab === 'link') page.innerHTML = linkHtml();
        else page.innerHTML = filesHtml();
        bindPage();
        if (tab === 'files') { qa('[data-dl]').forEach((row) => paintRow(row, store.phone.find((d) => d.id === row.dataset.dl))); renderJobs(); }
    }

    function loginHtml() {
        return `
            <form class="md-panel" data-login>
              <b class="md-h">Zaloguj się do Pitaya Streams</b>
              <p class="hint">Najprościej: zaloguj się na konto Pitayas w Ustawieniach aplikacji — Pitaya Streams użyje go samo. Albo podaj login tutaj.</p>
              <div><label>Serwer</label><input name="server" inputmode="url" autocapitalize="off" placeholder="${esc(DEFAULT_STREAMS)}" value="${esc(store.streams.server)}"></div>
              <div><label>Login</label><input name="login" autocapitalize="off" autocomplete="username" value="${esc(store.streams.login)}"></div>
              <div><label>Hasło</label><input name="password" type="password" autocomplete="current-password"></div>
              <div><label>Opcje Torrentio (debrid, opcjonalnie)</label><input name="torrentio" autocapitalize="off" placeholder="np. realdebrid=KLUCZ" value="${esc(store.streams.torrentio)}"></div>
              <p class="hint">Z kluczem debrid linki ⚡ pobierają się prosto na telefon. Torrenty pobiera komputer.</p>
              <button class="btn" type="submit">Zaloguj</button>
            </form>`;
    }

    function searchHtml() {
        const s = search;
        let body = '';
        if (s.target && (s.streams || s.loading)) {
            body = `
              <button class="md-back" data-back="title">‹ ${esc(s.meta ? s.meta.name : '')}</button>
              <b class="md-h">${esc(s.target.label)}</b>
              ${s.loading ? '<div class="spinner"></div><p class="hint md-c">Pitaya Streams zbiera linki ze wszystkich źródeł…</p>' : ''}
              ${s.error ? `<p class="hint warn">${esc(s.error)}</p>` : ''}
              ${s.streams && !s.streams.length && !s.loading ? `<p class="hint">Brak linków. ${store.streams.token ? 'Jeśli to się powtarza, zaloguj się ponownie.' : ''}</p>` : ''}
              ${!pcOnline && s.streams && s.streams.some((x) => !x.url) ? '<p class="hint">Torrenty pobiera komputer — uruchom na nim Pitayas Media i dodaj go na ekranie głównym.</p>' : ''}
              <div class="md-streams">${(s.streams || []).map((st, i) => `
                <div class="md-stream ${st.url ? 'fast' : ''}">
                  <div class="md-sname">${esc((st.name || '').replace(/\n/g, ' '))}</div>
                  <div class="md-stitle">${esc(st.title || st.description || '')}</div>
                  <div class="md-sbtns">
                    <button class="chip" data-st="${i}" data-dest="phone" ${st.url || pcOnline ? '' : 'disabled'}>📱 Na telefon</button>
                    <button class="chip ghost" data-st="${i}" data-dest="pc" ${pcOnline ? '' : 'disabled'}>💻 Na komputer</button>
                  </div>
                </div>`).join('')}</div>`;
        } else if (s.meta) {
            const m = s.meta;
            const seasons = m.videos ? [...new Set(m.videos.map((v) => v.season))] : [];
            body = `
              <button class="md-back" data-back="results">‹ Wyniki</button>
              <div class="md-title">
                ${m.poster ? `<img src="${esc(m.poster)}" alt="">` : ''}
                <div><b>${esc(m.name)}</b><small>${esc(m.releaseInfo || '')} · ${m.type === 'series' ? 'Serial' : 'Film'}</small></div>
              </div>
              ${s.error ? `<p class="hint warn">${esc(s.error)}</p>` : ''}
              ${m.type === 'series' && !m.videos && !s.error ? '<div class="spinner"></div>' : ''}
              ${seasons.length ? `<div class="md-chips">${seasons.map((n) => `<button class="md-chip ${n === s.season ? 'on' : ''}" data-season="${n}">Sezon ${n}</button>`).join('')}</div>
                <div class="md-eps">${m.videos.filter((v) => v.season === s.season).map((v) => `
                  <button class="md-ep" data-ep="${esc(v.id || `${m.id}:${v.season}:${v.episode}`)}" data-eplabel="${esc(`${m.name} S${String(v.season).padStart(2, '0')}E${String(v.episode).padStart(2, '0')}`)}">
                    <span>${v.episode}</span><div><b>${esc(v.name || v.title || `Odcinek ${v.episode}`)}</b><small>${v.released ? esc(new Date(v.released).toLocaleDateString('pl-PL')) : ''}</small></div>
                  </button>`).join('')}</div>` : ''}`;
        } else {
            body = `
              ${s.loading ? '<div class="spinner"></div>' : ''}
              ${s.error ? `<p class="hint warn">${esc(s.error)}</p>` : ''}
              ${s.results && !s.results.length ? '<p class="hint">Nic nie znaleziono.</p>' : ''}
              ${s.results ? `<div class="md-grid">${s.results.map((m, i) => `
                <button class="md-card" data-res="${i}">
                  <div class="md-poster">${m.poster ? `<img src="${esc(m.poster)}" alt="" loading="lazy">` : ''}<i>${m.type === 'series' ? 'Serial' : 'Film'}</i></div>
                  <b>${esc(m.name)}</b><small>${esc(m.releaseInfo || '')}</small>
                </button>`).join('')}</div>` : '<p class="hint md-c">Wpisz tytuł filmu albo serialu.</p>'}`;
        }
        return `
            <form class="md-search" data-search>
              <input name="q" type="search" placeholder="Szukaj filmu lub serialu" autocomplete="off" value="${esc(s.q)}">
              <button class="chip" type="submit">Szukaj</button>
            </form>
            ${body}
            <p class="hint md-c md-acc">Pitaya Streams: ${esc(store.streams.login || 'bez logowania')} · <a href="#" data-logout>Wyloguj</a></p>`;
    }

    function linkHtml() {
        const l = link, i = l.info;
        const audio = ['mp3', 'flac', 'wav'].includes(l.format);
        return `
            <div class="md-panel">
              <div><label>Link</label><input name="url" inputmode="url" autocapitalize="off" placeholder="YouTube, TikTok, Instagram, plik .mp4, magnet:…" value="${esc(l.url)}"></div>
              <div class="md-chips">
                <button class="md-chip ${l.dest === 'phone' ? 'on' : ''}" data-ldest="phone">📱 Na telefon</button>
                <button class="md-chip ${l.dest === 'pc' ? 'on' : ''}" data-ldest="pc">💻 Zostaw na komputerze</button>
              </div>
              <div class="row">
                <button class="btn" data-analyze ${pcOnline ? '' : 'disabled'}>${l.loading ? 'Sprawdzam…' : 'Sprawdź'}</button>
                <button class="btn ghost" data-direct>Plik prosto na telefon</button>
              </div>
              <p class="hint">${pcOnline ? '„Sprawdź” — komputer odczyta film (yt-dlp) i pokaże jakości. „Plik prosto na telefon” — dla zwykłych linków do pliku.'
                : 'YouTube i inne strony obsługuje Pitayas Media na komputerze — uruchom go i dodaj komputer na ekranie głównym. Zwykłe linki do pliku telefon pobierze sam.'}</p>
              ${l.error ? `<p class="hint warn">${esc(l.error)}</p>` : ''}
            </div>
            ${i ? `
            <div class="md-panel">
              <div class="md-title">
                ${i.thumbnail ? `<img class="wide" src="${esc(i.thumbnail)}" alt="">` : ''}
                <div><b>${esc(i.title)}</b><small>${esc([i.uploader, i.duration ? `${Math.floor(i.duration / 60)}:${String(Math.round(i.duration % 60)).padStart(2, '0')}` : ''].filter(Boolean).join(' · '))}</small></div>
              </div>
              <label>Format</label>
              <div class="md-chips">${FORMATS.map(([id, label]) => `<button class="md-chip ${l.format === id ? 'on' : ''}" data-fmt="${id}">${label}</button>`).join('')}</div>
              ${!audio && (i.heights || []).length ? `<label>Rozdzielczość</label>
                <div class="md-chips">${i.heights.map((h) => `<button class="md-chip ${l.height === h ? 'on' : ''}" data-h="${h}">${h}p</button>`).join('')}</div>` : ''}
              <button class="btn" data-start>Pobierz</button>
            </div>` : ''}`;
    }

    function filesHtml() {
        return `
            <b class="md-h">Na telefonie</b>
            ${store.phone.length ? `<div class="md-files">${store.phone.map((d) => `
              <div class="md-file" data-dl="${d.id}">
                <div class="md-fname"><b>${esc(d.name)}</b><small class="md-fstat"></small></div>
                <div class="md-bar"><i></i></div>
                <div class="md-sbtns">
                  ${d.state === 'done' ? `<button class="chip" data-play="${d.id}">▶ Odtwórz</button><button class="chip ghost" data-share="${d.id}">Udostępnij / zapisz</button>` : ''}
                  ${d.state === 'err' && d.url ? `<button class="chip ghost" data-retry="${d.id}">Ponów</button>` : ''}
                  ${d.state !== 'run' ? `<button class="chip ghost danger" data-del="${d.id}">Usuń</button>` : ''}
                </div>
              </div>`).join('')}</div>` : '<p class="hint">Jeszcze nic nie pobrano.</p>'}
            ${PLATFORM === 'android' ? '<p class="hint">Pliki leżą w Dokumenty/Pitayas/Media.</p>' : PLATFORM === 'ios' ? '<p class="hint">Do Plików albo Zdjęć zapiszesz przez „Udostępnij / zapisz”.</p>' : ''}
            <b class="md-h">Na komputerze</b>
            <div class="md-jobs"></div>`;
    }

    function paintRow(row, d) {
        if (!row || !d) return;
        const pct = d.total ? Math.min(100, Math.round(d.bytes * 100 / d.total)) : 0;
        row.querySelector('.md-bar i').style.width = `${d.state === 'done' ? 100 : pct}%`;
        row.querySelector('.md-bar').hidden = d.state !== 'run';
        row.querySelector('.md-fstat').textContent = d.state === 'run'
            ? `${d.total ? `${pct}% · ${size(d.bytes)} z ${size(d.total)}` : size(d.bytes) || 'Łączenie…'} — nie zamykaj aplikacji`
            : d.state === 'done' ? [size(d.total), d.from].filter(Boolean).join(' · ') : `Błąd: ${d.error || ''}`;
        row.classList.toggle('err', d.state === 'err');
    }

    const JOB_STATE = { queued: 'W kolejce', run: 'Pobieranie', post: 'Przetwarzanie', done: 'Gotowe', err: 'Błąd', canceled: 'Przerwane' };
    function renderJobs() {
        const box = q('.md-jobs');
        if (!box) return;
        if (!pcOnline) { box.innerHTML = '<p class="hint">Komputer niepołączony.</p>'; return; }
        if (!jobs.length) { box.innerHTML = '<p class="hint">Brak zadań.</p>'; return; }
        box.innerHTML = jobs.map((j) => `
            <div class="md-file ${j.state === 'err' ? 'err' : ''}">
              <div class="md-fname"><b>${esc(j.file || j.title || j.id)}</b>
                <small>${esc(JOB_STATE[j.state] || j.state)}${j.state === 'run' ? ` · ${Math.round(j.percent || 0)}%${j.speed ? ` · ${esc(j.speed)}` : ''}${j.eta ? ` · zostało ${esc(j.eta)}` : ''}` : ''}${j.size ? ` · ${esc(j.size)}` : ''}${j.error ? ` · ${esc(j.error)}` : ''}${j.forPhone ? ' · 📱' : ''}</small></div>
              ${j.state === 'run' || j.state === 'queued' || j.state === 'post' ? `<div class="md-bar"><i style="width:${Math.round(j.percent || 0)}%"></i></div>` : ''}
              <div class="md-sbtns">
                ${j.state === 'done' ? `<button class="chip" data-tophone="${esc(j.id)}">📱 Na telefon</button>` : ''}
                ${['run', 'queued', 'post'].includes(j.state) ? `<button class="chip ghost danger" data-jcancel="${esc(j.id)}">Przerwij</button>`
                    : `<button class="chip ghost" data-jdel="${esc(j.id)}">Usuń z listy</button>`}
              </div>
            </div>`).join('');
        box.querySelectorAll('[data-tophone]').forEach((b) => (b.onclick = () => {
            const j = jobs.find((x) => x.id === b.dataset.tophone);
            phoneDownload({ url: api.url(`/files/${encodeURIComponent(j.id)}`), name: j.file || j.title, from: 'Komputer' });
        }));
        box.querySelectorAll('[data-jcancel]').forEach((b) => (b.onclick = () => pc(`/api/jobs/${encodeURIComponent(b.dataset.jcancel)}/cancel`, {}).then(pollJobs).catch((e) => api.toast(errText(e), 'err'))));
        box.querySelectorAll('[data-jdel]').forEach((b) => (b.onclick = () => pc(`/api/jobs/${encodeURIComponent(b.dataset.jdel)}`, null).then(pollJobs).catch((e) => api.toast(errText(e), 'err'))));
    }

    function bindPage() {
        const on = (sel, fn) => qa(sel).forEach((b) => (b.onclick = (e) => { e.preventDefault(); fn(b); }));
        const login = q('[data-login]');
        if (login) login.onsubmit = async (e) => {
            e.preventDefault();
            const f = login.elements;
            const btn = login.querySelector('.btn');
            btn.disabled = true; btn.textContent = 'Logowanie…';
            store.streams.torrentio = f.torrentio.value.trim();
            try {
                await streamsLogin((f.server.value.trim() || DEFAULT_STREAMS).replace(/\/+$/, ''), f.login.value.trim(), f.password.value);
                renderPage();
            } catch (err) {
                api.toast(`Logowanie: ${errText(err)}`, 'err');
                btn.disabled = false; btn.textContent = 'Zaloguj';
            }
        };
        const sf = q('[data-search]');
        if (sf) sf.onsubmit = (e) => { e.preventDefault(); search.q = sf.elements.q.value; sf.elements.q.blur(); doSearch(); };
        on('[data-logout]', () => {
            if (store.streams.viaAccount) return api.toast('Używasz konta Pitayas — wyloguj się w Ustawieniach aplikacji');
            Object.assign(store.streams, { token: '', logged: false }); save(); renderPage();
        });
        on('[data-res]', (b) => openTitle(search.results[Number(b.dataset.res)]));
        on('[data-back]', (b) => {
            if (b.dataset.back === 'title' && search.meta && search.meta.type === 'series') Object.assign(search, { target: null, streams: null, error: '' });
            else Object.assign(search, { meta: null, target: null, streams: null, error: '' });
            renderPage();
        });
        on('[data-season]', (b) => { search.season = Number(b.dataset.season); renderPage(); });
        on('[data-ep]', (b) => loadStreams({ type: 'series', id: b.dataset.ep, label: b.dataset.eplabel }));
        on('[data-st]', (b) => streamAction(search.streams[Number(b.dataset.st)], b.dataset.dest));

        const url = q('[name=url]');
        if (url) url.oninput = () => { link.url = url.value; };
        on('[data-ldest]', (b) => { link.dest = b.dataset.ldest; renderPage(); });
        on('[data-analyze]', analyzeLink);
        on('[data-direct]', directLink);
        on('[data-fmt]', (b) => { link.format = b.dataset.fmt; renderPage(); });
        on('[data-h]', (b) => { link.height = Number(b.dataset.h); renderPage(); });
        on('[data-start]', startLink);

        const find = (id) => store.phone.find((d) => d.id === id);
        on('[data-play]', (b) => playFile(find(b.dataset.play)));
        on('[data-share]', (b) => shareFile(find(b.dataset.share)));
        on('[data-del]', (b) => removeFile(find(b.dataset.del)));
        on('[data-retry]', (b) => {
            const d = find(b.dataset.retry);
            store.phone = store.phone.filter((x) => x !== d);
            phoneDownload({ url: d.url, name: d.name, from: d.from });
        });
    }

    Pitayas.register({
        id: 'media',

        probe: (api) => api.probe(api.url('/info'), true),

        mount(body, moduleApi, barSlot) {
            api = moduleApi;
            el = body;
            el.classList.add('md-mod');
            barSlot.innerHTML = '<button class="bar-btn" id="mdRefresh" data-glass="arrow.clockwise" title="Odśwież"><svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg></button>';
            barSlot.firstElementChild.onclick = () => { probePc(); if (tab === 'search' && search.target) loadStreams(search.target); else renderPage(); };
            render();
            probePc();
            probeTimer = setInterval(probePc, 6000);
        },

        resume() { if (el) probePc(); },

        unmount() {
            clearInterval(probeTimer);
            clearTimeout(pollTimer);
            el = null;
            // Pobieranie na telefon trwa dalej (natywnie) — po powrocie widać postęp w „Pobrane”
        },
    });
})();

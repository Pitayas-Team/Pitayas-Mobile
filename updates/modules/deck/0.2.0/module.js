// ═══════ PITAYA DECK — MODUŁ ═══════
// Deck rysowany w aplikacji (bez osobnego okna przeglądarki): WebSocket ws://komputer:8191/ws,
// ten sam protokół i to samo rysowanie widżetów (render.js z Pitaya Deck) co strona decka na telefonie.
(() => {
    const BASE = document.currentScript.src.replace(/[^/]*$/, '');   // folder modułu (render.js, render.css, icon.png)
    const LONG_MS = 500;
    const DOUBLE_MS = 280;

    // render.js / render.css z Pitaya Deck wczytujemy raz, przy pierwszym otwarciu
    let renderReady = null;
    function loadRender() {
        if (window.PitayaDeckRender) return Promise.resolve();
        if (renderReady) return renderReady;
        const css = document.createElement('link');
        css.rel = 'stylesheet'; css.href = `${BASE}render.css`; css.dataset.module = 'deck';
        document.head.appendChild(css);
        renderReady = new Promise((resolve, reject) => {
            const js = document.createElement('script');
            js.src = `${BASE}render.js`; js.dataset.module = 'deck';
            js.onload = resolve;
            js.onerror = () => { renderReady = null; reject(new Error('Brak pliku render.js — zaktualizuj moduł')); };
            document.body.appendChild(js);
        });
        return renderReady;
    }

    function deviceId() {
        try {
            let id = localStorage.getItem('pitaya-deck-id');
            if (!id) {
                id = 'd' + Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
                localStorage.setItem('pitaya-deck-id', id);
            }
            return id;
        } catch {
            return 'd' + Math.random().toString(16).slice(2) + Date.now().toString(16);
        }
    }
    function deviceName() {
        const ua = navigator.userAgent;
        const os = /iPad/.test(ua) ? 'iPad' : /iPhone/.test(ua) ? 'iPhone' : /Android/.test(ua) ? ((ua.match(/Android[^;]*;\s*([^;)]+?)(?:\sBuild|\))/) || [])[1] || 'Android') : 'Telefon';
        return `${os.trim()} · Pitayas`;
    }
    // Ustawienia ekranu (zapisane w telefonie): nie wygaszaj ekranu + wygaszacz z zegarem po bezczynności
    const PREFS_KEY = 'pitayas-deck-prefs';
    const SAVER_OPTIONS = [[0, 'Wyłączony'], [30, '30 s'], [60, '1 min'], [120, '2 min'], [300, '5 min'], [600, '10 min']];
    const prefs = (() => {
        try { return Object.assign({ keepAwake: true, saver: 120 }, JSON.parse(localStorage.getItem(PREFS_KEY))); }
        catch { return { keepAwake: true, saver: 120 }; }
    })();
    const savePrefs = () => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch {} };

    const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    let api = null, el = null, view = null;
    let ws = null, state = null, retry = 0, retryTimer = null, toastTimer = null, ticks = [];
    let server = '';   // http://komputer:port — obrazy z decka mają ścieżki względne (/img/…, /art?…)
    const $ = (sel) => el.querySelector(sel);

    function screen(title, text, spinner = true) {
        $('.screen').classList.toggle('hidden', !title);
        if (!title) return;
        $('.screen-title').textContent = title;
        $('.screen-text').innerHTML = text;
        $('.spinner').classList.toggle('hidden', !spinner);
    }
    function toast(text, kind) {
        const t = $('.toast');
        t.textContent = text;
        t.className = `toast show ${kind || ''}`;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { if (el) t.className = 'toast'; }, 2600);
    }

    // ───── Połączenie ─────
    function connect() {
        if (!el) return;
        const url = api.url('/ws', 'ws');
        let opened = false;
        try { ws = new WebSocket(url); } catch (err) {
            return screen('Nie mogę się połączyć', `Błąd: ${escapeHtml(err.message)}<br>Adres: <b>${escapeHtml(url)}</b>`, false);
        }
        ws.onopen = () => {
            opened = true;
            retry = 0;
            ws.send(JSON.stringify({ t: 'hello', deviceId: deviceId(), name: deviceName() }));
        };
        ws.onmessage = (e) => {
            let msg;
            try { msg = JSON.parse(e.data); } catch { return; }
            if (msg.t === 'state') {
                const sliding = state && state.sliding;
                state = absolutize(msg);
                screen(null);
                if (sliding) { state.sliding = sliding; return; }
                render();
            }
            else if (msg.t === 'pending') screen('Zatwierdź na komputerze', `To urządzenie (<b>${escapeHtml(msg.name)}</b>) czeka na zgodę w aplikacji Pitaya Deck na komputerze.`);
            else if (msg.t === 'denied') screen('Brak dostępu', 'Komputer odrzucił to urządzenie. Możesz je odblokować w Pitaya Deck → Urządzenia.', false);
            else if (msg.t === 'toast') toast(msg.text, msg.kind);
        };
        ws.onclose = () => {
            ws = null;
            if (!el) return;
            const delay = Math.min(8000, 500 * 2 ** retry++);
            if (!state || retry > 1) {
                const ios = /iPhone|iPad/.test(navigator.userAgent);
                screen('Łączenie…', `Nie ma połączenia z <b>${escapeHtml(url.replace(/^ws:\/\/|\/ws$/g, ''))}</b>.<br><br>
                    • Pitaya Deck musi działać na komputerze.<br>
                    • Telefon w tej samej sieci Wi‑Fi co komputer.<br>
                    ${ios ? '• iPhone: <b>Ustawienia → Prywatność i ochrona → Sieć lokalna → Pitayas</b> musi być włączone.<br>' : ''}
                    • Zapora na komputerze musi przepuszczać port ${escapeHtml(api.port())}.
                    ${opened ? '' : `<br><br><small>Próba ${retry}</small>`}`);
            }
            retryTimer = setTimeout(connect, delay);
        };
        ws.onerror = () => {};
    }
    function send(msg) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); }

    function absolutize(msg) {
        const fix = (u) => (typeof u === 'string' && u.startsWith('/') ? server + u : u);
        for (const b of Object.values(msg.buttons || {})) {
            if (b.icon && b.icon.type === 'image') b.icon.value = fix(b.icon.value);
            if (b.media && b.media.art) b.media.art = fix(b.media.art);
        }
        return msg;
    }

    // ───── Siatka ─────
    function layout() {
        const grid = $('.grid'), wrap = $('.grid-wrap');
        const { cols, rows } = state.profile;
        const sp = (state.style.spacing ?? 10) / 100;
        const box = wrap.getBoundingClientRect();
        const portraitHint = box.height > box.width * 1.25 && cols > rows;
        $('.rotate-hint').hidden = !portraitHint;
        const W = box.width - 24, H = box.height - 18 - (portraitHint ? 32 : 0);
        const cell = Math.max(10, Math.floor(Math.min(W / (cols + (cols - 1) * sp), H / (rows + (rows - 1) * sp))));
        const gap = Math.round(cell * sp);
        grid.style.setProperty('--gap', `${gap}px`);
        grid.style.setProperty('--cell', `${cell}px`);
        grid.style.setProperty('--pd-radius', `${Math.round((cell * (state.style.radius ?? 22)) / 100)}px`);
        grid.style.gridTemplateColumns = `repeat(${cols}, ${cell}px)`;
        grid.style.gridTemplateRows = `repeat(${rows}, ${cell}px)`;
        const bg = state.style.background || 'var(--bg)';
        el.style.background = state.style.gradient === false ? bg : `radial-gradient(700px 400px at 100% -10%, rgba(255,60,160,0.16), transparent 70%), ${bg}`;
        grid.classList.toggle('empty-hidden', state.style.emptyCells === 'transparent');
        return cell;
    }
    function render() {
        if (!el || !state) return;
        const grid = $('.grid');
        const { cols, rows } = state.profile;
        $('.folder-name').textContent = state.folder.name || state.profile.name;
        $('.profile-name').textContent = state.folder.canBack ? state.profile.name : (state.device ? state.device.name : '');
        $('.btn-back').hidden = !state.folder.canBack;
        $('.bar-clock').hidden = !state.settings.showClock;
        const cell = layout();
        const covered = new Set();
        const items = [];
        for (const [key, b] of Object.entries(state.buttons)) {
            const [x, y] = key.split(',').map(Number);
            if (x >= cols || y >= rows) continue;
            const w = Math.min(b.w || 1, cols - x), h = Math.min(b.h || 1, rows - y);
            for (let dx = 0; dx < w; dx++) for (let dy = 0; dy < h; dy++) covered.add(`${x + dx},${y + dy}`);
            items.push({ key, x, y, w, h, b });
        }
        for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (!covered.has(`${x},${y}`)) items.push({ key: `${x},${y}`, x, y, w: 1, h: 1, b: null });
        grid.innerHTML = '';
        for (const it of items) {
            const c = makeCell(it.key);
            c.style.gridColumn = `${it.x + 1} / span ${it.w}`;
            c.style.gridRow = `${it.y + 1} / span ${it.h}`;
            PitayaDeckRender.paint(c, it.b, cell);
            if (it.b && it.b.type === 'media' && it.w < 2) c.classList.add('narrow');
            grid.appendChild(c);
        }
    }

    // Krótkie dotknięcie = „press”, przytrzymanie = „long”, puszczenie = „release” — jak na stronie decka
    function makeCell(key) {
        const c = document.createElement('div');
        c.dataset.key = key;
        let timer = null, longSent = false, active = false, tapTimer = null;
        const button = () => state && state.buttons[key];
        c.addEventListener('pointerdown', (e) => {
            const b = button();
            if (!b) return;
            const mbtn = e.target.closest('[data-media]');
            if (b.type === 'media') {
                if (mbtn) { e.preventDefault(); if (navigator.vibrate) navigator.vibrate(12); send({ t: 'media', key, cmd: mbtn.dataset.media }); }
                return;
            }
            if (b.type === 'slider') return startSlider(e, c, key);
            e.preventDefault();
            active = true;
            longSent = false;
            c.classList.add('pressed');
            try { c.setPointerCapture(e.pointerId); } catch {}
            if (navigator.vibrate) navigator.vibrate(12);
            const tr = b.triggers || {};
            if (tr.touchStart) send({ t: 'press', key, phase: 'down' });
            if (b.hasLong || tr.longPress) {
                timer = setTimeout(() => {
                    longSent = true;
                    if (navigator.vibrate) navigator.vibrate([10, 40, 20]);
                    send({ t: 'press', key, phase: 'long' });
                }, LONG_MS);
            } else if (!tr.doublePress) {
                send({ t: 'press', key, phase: 'press' });
            }
        });
        const shortPress = (tr) => {
            if (!tr.doublePress) return send({ t: 'press', key, phase: 'press' });
            if (tapTimer) { clearTimeout(tapTimer); tapTimer = null; return send({ t: 'press', key, phase: 'double' }); }
            tapTimer = setTimeout(() => { tapTimer = null; send({ t: 'press', key, phase: 'press' }); }, DOUBLE_MS);
        };
        const up = (cancelled) => {
            if (!active) return;
            active = false;
            clearTimeout(timer);
            c.classList.remove('pressed');
            const b = button();
            if (!b) return;
            const tr = b.triggers || {};
            if ((b.hasLong || tr.longPress || tr.doublePress) && !longSent && !cancelled) shortPress(tr);
            if (tr.release !== false) send({ t: 'press', key, phase: 'release' });
        };
        c.addEventListener('pointerup', () => up(false));
        c.addEventListener('pointercancel', () => up(true));
        c.addEventListener('contextmenu', (e) => e.preventDefault());
        return c;
    }

    function startSlider(e, c, key) {
        e.preventDefault();
        const box = c.querySelector('.pd-sl');
        const track = c.querySelector('.pd-sl-track');
        if (!box || !track) return;
        const vertical = box.classList.contains('vertical');
        const min = parseFloat(box.dataset.min), max = parseFloat(box.dataset.max), step = parseFloat(box.dataset.step) || 1;
        const fill = c.querySelector('.pd-sl-fill');
        const valueEl = c.querySelector('.pd-sl-value');
        let last = null;
        const apply = (ev) => {
            const r = track.getBoundingClientRect();
            const f = vertical ? 1 - (ev.clientY - r.top) / r.height : (ev.clientX - r.left) / r.width;
            const v = Math.round((min + Math.max(0, Math.min(1, f)) * (max - min)) / step) * step;
            if (v === last) return;
            last = v;
            fill.style.setProperty('--pct', `${((v - min) / (max - min)) * 100}%`);
            if (valueEl) valueEl.textContent = valueEl.textContent.replace(/^-?[\d.,]+/, String(Math.round(v)));
            send({ t: 'slider', key, value: v });
        };
        state.sliding = key;
        try { c.setPointerCapture(e.pointerId); } catch {}
        apply(e);
        const move = (ev) => apply(ev);
        const end = () => {
            c.removeEventListener('pointermove', move);
            c.removeEventListener('pointerup', end);
            c.removeEventListener('pointercancel', end);
            setTimeout(() => { if (state && state.sliding === key) state.sliding = null; }, 600);
        };
        c.addEventListener('pointermove', move);
        c.addEventListener('pointerup', end);
        c.addEventListener('pointercancel', end);
    }

    const hhmm = (n) => `${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`;
    function clock() {
        const n = new Date();
        $('.bar-clock').textContent = hhmm(n);
        if (!$('.saver').hidden) {
            $('.saver-time').textContent = hhmm(n);
            $('.saver-date').textContent = n.toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' });
        }
    }

    // ───── Ekran: nie wygaszaj + wygaszacz z zegarem ─────
    function applyAwake() {
        const k = api && api.Plugins.KeepAwake;
        if (k) (prefs.keepAwake ? k.keepAwake() : k.allowSleep()).catch(() => {});
    }
    let idleTimer = null, driftTimer = null;
    function resetIdle() {
        clearTimeout(idleTimer);
        if (el && prefs.saver) idleTimer = setTimeout(showSaver, prefs.saver * 1000);
    }
    function showSaver() {
        if (!el || !$('.panel').hidden) return resetIdle();   // nie zasłaniamy otwartych ustawień
        $('.saver').hidden = false;
        clock();
        drift();
        driftTimer = setInterval(drift, 20000);
    }
    // Zegar co chwilę lekko się przesuwa, żeby nie wypalał ekranu OLED
    function drift() {
        const x = Math.round((Math.random() - 0.5) * 40), y = Math.round((Math.random() - 0.5) * 60);
        $('.saver-clock').style.transform = `translate(${x}px, ${y}px)`;
    }
    function hideSaver() {
        $('.saver').hidden = true;
        clearInterval(driftTimer);
        resetIdle();
    }
    function onActivity(e) {
        if (!$('.saver').hidden) {
            // Pierwsze dotknięcie tylko budzi deck — nie naciska przycisku pod spodem
            e.preventDefault();
            e.stopPropagation();
            hideSaver();
            return;
        }
        resetIdle();
    }

    function openPanel() {
        const p = $('.panel');
        p.innerHTML = `
            <div class="panel-card">
              <div class="panel-head"><b>Ekran</b><button class="deck-btn panel-close" title="Zamknij"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
              <label class="panel-row"><span>Nie wygaszaj ekranu<small>Telefon nie zgaśnie, póki deck jest otwarty</small></span>
                <input type="checkbox" class="p-awake" ${prefs.keepAwake ? 'checked' : ''}></label>
              <div class="panel-row"><span>Wygaszacz z zegarem<small>Po bezczynności deck chowa się pod dużym zegarem</small></span></div>
              <div class="panel-chips">${SAVER_OPTIONS.map(([v, l]) => `<button class="p-chip ${prefs.saver === v ? 'on' : ''}" data-saver="${v}">${l}</button>`).join('')}</div>
              <button class="p-test">Pokaż wygaszacz teraz</button>
            </div>`;
        p.hidden = false;
        p.querySelector('.panel-close').onclick = closePanel;
        p.onclick = (e) => { if (e.target === p) closePanel(); };
        p.querySelector('.p-awake').onchange = (e) => { prefs.keepAwake = e.target.checked; savePrefs(); applyAwake(); };
        p.querySelectorAll('[data-saver]').forEach((b) => (b.onclick = () => {
            prefs.saver = Number(b.dataset.saver);
            savePrefs();
            p.querySelectorAll('[data-saver]').forEach((x) => x.classList.toggle('on', x === b));
        }));
        p.querySelector('.p-test').onclick = () => { closePanel(); showSaver(); };
    }
    function closePanel() { $('.panel').hidden = true; resetIdle(); }
    const onResize = () => state && render();

    Pitayas.register({
        id: 'deck',

        probe: (api) => api.probe(api.url('/icons/32x32.png'), false),

        async mount(body, moduleApi) {
            api = moduleApi;
            el = body;
            view = body.closest('.view');
            view.classList.add('deck-full');   // pełny ekran: własny pasek decka zamiast paska rdzenia
            el.classList.add('deck-mod');
            server = api.url('').replace(/\/$/, '');
            el.innerHTML = `
                <header class="deck-bar">
                  <button class="deck-btn btn-close" title="Pitayas"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
                  <button class="deck-btn btn-back" title="Wstecz" hidden><svg viewBox="0 0 24 24"><path d="M14 6l-6 6 6 6"/></svg></button>
                  <div class="deck-title"><span class="folder-name">Pitaya Deck</span><small class="profile-name"></small></div>
                  <span class="bar-clock"></span>
                  <button class="deck-btn btn-screen" title="Ekran"><svg viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg></button>
                </header>
                <main class="grid-wrap">
                  <div class="grid"></div>
                  <div class="rotate-hint" hidden>
                    <svg viewBox="0 0 24 24"><rect x="7" y="3" width="10" height="18" rx="2"/><path d="M3 14a9 9 0 0 0 6 6M21 10a9 9 0 0 0-6-6"/></svg>
                    Obróć telefon poziomo — przyciski będą większe
                  </div>
                </main>
                <div class="screen">
                  <div class="screen-card">
                    <img src="${BASE}icon.png" alt="" class="screen-logo">
                    <div class="screen-title">Łączenie…</div>
                    <div class="screen-text">Łączę się z Pitaya Deck na komputerze.</div>
                    <div class="spinner"></div>
                  </div>
                </div>
                <div class="saver" hidden><div class="saver-clock"><div class="saver-time"></div><div class="saver-date"></div></div></div>
                <div class="panel" hidden></div>
                <div class="toast"></div>`;
            $('.btn-close').onclick = () => api.close();
            $('.btn-back').onclick = () => send({ t: 'nav', to: 'back' });
            $('.btn-screen').onclick = openPanel;
            el.addEventListener('pointerdown', onActivity, true);
            clock();
            ticks = [setInterval(clock, 5000), setInterval(() => window.PitayaDeckRender && el && PitayaDeckRender.tickClocks($('.grid')), 1000)];
            addEventListener('resize', onResize);
            applyAwake();
            resetIdle();
            try { await loadRender(); } catch (err) { return screen('Błąd modułu', escapeHtml(err.message), false); }
            connect();
        },

        // W tle system i tak zrywa połączenie — po powrocie łączymy od razu
        pause() {
            if (ws) { ws.onclose = null; ws.close(); ws = null; }
            clearTimeout(retryTimer);
            retryTimer = setTimeout(connect, 300);
        },

        unmount() {
            const awake = api && api.Plugins.KeepAwake;
            if (awake) awake.allowSleep().catch(() => {});
            removeEventListener('resize', onResize);
            ticks.forEach(clearInterval);
            clearTimeout(idleTimer);
            clearInterval(driftTimer);
            clearTimeout(retryTimer);
            if (ws) { ws.onclose = null; ws.close(); ws = null; }
            state = null; retry = 0; el = null; view = null;
        },
    });
})();

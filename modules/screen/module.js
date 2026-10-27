// ═══════ PITAYAS SCREEN — MODUŁ ═══════
// Telefon jako dodatkowy monitor komputera — tylko przez kabel USB:
//  • Android: komputer (Pitayas Screen) robi tunel ADB, telefon łączy się z 127.0.0.1:8195,
//  • iPhone: aplikacja 0.2.5+ słucha na 127.0.0.1:8195 (wtyczka PitayasUsb), komputer łączy się przez usbmuxd.
// Obraz: H.264 → WebCodecs (dekoder sprzętowy) → canvas. Dotyk → mysz na wirtualnym ekranie komputera.
(() => {
    const PORT = 8195;
    const Cap = window.Capacitor;
    const PLATFORM = Cap && Cap.getPlatform ? Cap.getPlatform() : 'web';
    const KEY = 'pitayas-screen';
    const opts = (() => { try { return Object.assign({ quality: 'mid', scale: 1.5 }, JSON.parse(localStorage.getItem(KEY))); } catch { return { quality: 'mid', scale: 1.5 }; } })();
    const saveOpts = () => { try { localStorage.setItem(KEY, JSON.stringify(opts)); } catch {} };

    let stepTimer = null;
    let el = null, api = null, ws = null, decoder = null, full = null, canvas = null, ctx = null;
    let size = [0, 0], ts = 0, live = false, resizeTimer = null, statusText = '', statusTone = '';
    // Kroki połączenia widoczne na ekranie modułu: link (kabel/aplikacja) → pc (komputer) → video (obraz)
    let phase = 'idle', phaseSince = Date.now(), paused = false, linkError = '';
    function setPhase(p) { if (p !== phase) { phase = p; phaseSince = Date.now(); } renderSteps(); }
    const q = (s) => el && el.querySelector(s);
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

    function setStatus(text, tone) {
        statusText = text; statusTone = tone || '';
        const s = q('.scr-status');
        if (s) { s.textContent = text; s.className = `scr-status ${statusTone}`; }
        const f = full && full.querySelector('.scr-wait');
        if (f) { f.textContent = text; f.hidden = live; }
    }

    function awake(on) {
        const k = api && api.Plugins.KeepAwake;
        if (k) (on ? k.keepAwake() : k.allowSleep()).catch(() => {});
    }

    // Rozmiar wirtualnego monitora = ekran telefonu w pikselach / skala tekstu
    function wanted() {
        const dpr = window.devicePixelRatio || 2;
        return { w: Math.round(window.innerWidth * dpr / opts.scale), h: Math.round(window.innerHeight * dpr / opts.scale) };
    }
    const hello = () => { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'hello', ...wanted(), quality: opts.quality })); };
    const sendMsg = (m) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); };

    // ───── Połączenie ─────
    async function connect() {
        if (!('VideoDecoder' in window)) { linkError = 'Ten telefon nie ma dekodera wideo (WebCodecs) — potrzebny iOS 16.4+ albo Android z aktualnym Chrome.'; return renderSteps(); }
        if (PLATFORM === 'ios') {
            const usb = api.Plugins.PitayasUsb;
            if (!usb) { linkError = 'Potrzebna aplikacja Pitayas 0.2.5 lub nowsza.'; return renderSteps(); }
            try { await usb.start({ port: PORT }); } catch (err) { linkError = `Nie mogę nasłuchiwać: ${err.message || err}`; return renderSteps(); }
        }
        paused = false;
        linkError = '';
        setPhase(PLATFORM === 'ios' ? 'link' : 'idle');
        awake(true);
        window.addEventListener('resize', onResize);
        open();
    }

    let retry = null;
    function open() {
        clearTimeout(retry);
        if (paused || !el) return;
        ws = new WebSocket(`ws://127.0.0.1:${PORT}/`);
        ws.binaryType = 'arraybuffer';
        ws.onopen = () => {
            ws.send(JSON.stringify({ role: 'app' }));
            // Android: otwarte połączenie = komputer jest po drugiej stronie kabla; iPhone: czekamy, aż przekaźnik powie, że komputer się połączył
            if (PLATFORM !== 'ios') { setPhase('pc'); hello(); } else setPhase('link');
        };
        ws.onmessage = (e) => {
            if (typeof e.data !== 'string') return frame(new Uint8Array(e.data));
            let m; try { m = JSON.parse(e.data); } catch { return; }
            if (m.t === 'peer' && m.role === 'pc') {
                if (m.state === 'up') { setPhase('pc'); hello(); }
                else { live = false; closeFull(); setPhase('link'); }
            } else if (m.t === 'config') { openFull(); configure(m); setPhase('video'); }
            else if (m.t === 'error') { linkError = `Komputer: ${m.message}`; renderSteps(); }
        };
        ws.onclose = () => {
            ws = null;
            live = false;
            closeFull();
            if (paused || !el) return;
            setPhase(PLATFORM === 'ios' ? 'link' : 'idle');
            retry = setTimeout(open, 1500);
        };
    }

    // Klatki „delta” odwołują się do poprzednich — po pominięciu choćby jednej obraz się sypie (smugi, bloki),
    // więc po każdej stracie czekamy na następną klatkę kluczową (komputer wysyła ją co sekundę).
    let lastConfig = null, needKey = true, pendingFrame = null, drawing = false;
    function makeDecoder() {
        if (decoder) { try { decoder.close(); } catch {} }
        const m = lastConfig;
        const desc = Uint8Array.from(atob(m.description), (c) => c.charCodeAt(0));
        decoder = new VideoDecoder({
            // Rysujemy tylko najnowszą klatkę, raz na odświeżenie ekranu (bez kolejki starych klatek = mniejsze opóźnienie)
            output: (f) => {
                if (pendingFrame) pendingFrame.close();
                pendingFrame = f;
                if (!drawing) { drawing = true; requestAnimationFrame(paint); }
            },
            // Błąd dekodera (np. uszkodzona klatka) — nowy dekoder i czekamy na klatkę kluczową
            error: (err) => { console.warn('Dekoder:', err && err.message); needKey = true; setTimeout(() => { if (lastConfig && full) makeDecoder(); }, 0); },
        });
        decoder.configure({ codec: m.codec, description: desc, optimizeForLatency: true, hardwareAcceleration: 'prefer-hardware' });
        needKey = true;
        ts = 0;
    }
    function paint() {
        drawing = false;
        const f = pendingFrame;
        pendingFrame = null;
        if (!f) return;
        if (ctx) ctx.drawImage(f, 0, 0, canvas.width, canvas.height);
        f.close();
        if (!live) { live = true; setStatus(''); }
    }
    function configure(m) {
        size = [m.w, m.h];
        canvas.width = m.w; canvas.height = m.h;
        lastConfig = m;
        makeDecoder();
    }

    function frame(buf) {
        if (!decoder || decoder.state !== 'configured') { needKey = true; return; }
        const key = buf[0] === 1;
        // Telefon nie nadąża — gubimy klatki aż do najbliższej kluczowej
        if (!key && (needKey || decoder.decodeQueueSize > 3)) { needKey = true; return; }
        needKey = false;
        ts += 16666;
        try { decoder.decode(new EncodedVideoChunk({ type: key ? 'key' : 'delta', timestamp: ts, data: buf.subarray(1) })); } catch { needKey = true; }
    }

    function closeFull() {
        if (decoder) { try { decoder.close(); } catch {} decoder = null; }
        if (pendingFrame) { pendingFrame.close(); pendingFrame = null; }
        lastConfig = null;
        live = false;
        if (full) { full.remove(); full = null; }
    }

    function disconnect() {
        paused = true;
        clearTimeout(retry);
        if (ws) { ws.onclose = null; ws.close(); ws = null; }
        closeFull();
        awake(false);
        if (PLATFORM === 'ios' && api && api.Plugins.PitayasUsb) api.Plugins.PitayasUsb.stop().catch(() => {});
        window.removeEventListener('resize', onResize);
        setPhase('idle');
    }

    function onResize() {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(hello, 500);   // obrót telefonu = nowy rozmiar monitora
    }

    // ───── Pełny ekran i dotyk ─────
    function openFull() {
        if (full) return;
        full = document.createElement('div');
        full.className = 'scr-full md-player';   // md-player: rdzeń chowa wtedy szklane przyciski
        full.innerHTML = `
            <canvas></canvas>
            <div class="scr-wait"></div>
            <input class="scr-kbd" autocapitalize="off" autocomplete="off" autocorrect="off" spellcheck="false">
            <button class="scr-handle" title="Menu"><svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button>
            <div class="scr-menu" hidden>
              <button data-a="kbd"><svg viewBox="0 0 24 24"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/></svg>Klawiatura</button>
              <button data-a="right"><svg viewBox="0 0 24 24"><rect x="6" y="3" width="12" height="18" rx="6"/><path d="M12 3v6M12 9h6"/></svg>Prawy klik</button>
              <button data-a="esc"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>Esc</button>
              <button data-a="off" class="off"><svg viewBox="0 0 24 24"><path d="M12 3v9M6.3 6.3a8 8 0 1 0 11.4 0"/></svg>Rozłącz</button>
            </div>`;
        document.body.appendChild(full);
        canvas = full.querySelector('canvas');
        full.querySelector('.scr-wait').textContent = 'Komputer tworzy ekran… (na komputerze może pojawić się pytanie o udostępnienie)';
        ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
        const menu = full.querySelector('.scr-menu'), kbd = full.querySelector('.scr-kbd');
        let rightNext = false;
        full.querySelector('.scr-handle').onclick = () => { menu.hidden = !menu.hidden; };
        menu.onclick = (e) => {
            const b = e.target.closest('[data-a]');
            if (!b) return;
            menu.hidden = true;
            if (b.dataset.a === 'off') { disconnect(); render(); }
            else if (b.dataset.a === 'kbd') { kbd.value = ''; kbd.focus(); }
            else if (b.dataset.a === 'esc') sendMsg({ t: 'key', sym: 'Escape' });
            else if (b.dataset.a === 'right') { rightNext = true; api.toast('Dotknij miejsca — prawy klik'); }
        };
        kbd.addEventListener('input', () => { if (kbd.value) { sendMsg({ t: 'text', text: kbd.value }); kbd.value = ''; } });
        kbd.addEventListener('keydown', (e) => {
            const map = { Backspace: 'Backspace', Enter: 'Enter', Tab: 'Tab', ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down', Escape: 'Escape', Delete: 'Delete' };
            if (map[e.key]) { e.preventDefault(); sendMsg({ t: 'key', sym: map[e.key] }); }
        });

        // Pozycja dotyku → 0–1 w obrazie (canvas ma object-fit: contain, więc odejmujemy czarne pasy)
        const point = (t) => {
            const r = canvas.getBoundingClientRect();
            const s = Math.min(r.width / size[0], r.height / size[1]) || 1;
            const w = size[0] * s, h = size[1] * s;
            return { x: (t.clientX - r.left - (r.width - w) / 2) / w, y: (t.clientY - r.top - (r.height - h) / 2) / h };
        };
        // Stuknięcie = klik, przytrzymanie = prawy klik, przeciągnięcie = przeciąganie, dwa palce = przewijanie
        let start = null, down = false, longTimer = null, lastY = null, lastX = null;
        canvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            menu.hidden = true;
            if (e.touches.length === 2) {
                clearTimeout(longTimer);
                if (down) { sendMsg({ t: 'pointer', ...point(e.touches[0]), b: 'up', btn: 'left' }); down = false; }
                start = null;
                lastY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
                lastX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
                return;
            }
            if (e.touches.length !== 1) return;
            const p = point(e.touches[0]);
            start = { ...p, cx: e.touches[0].clientX, cy: e.touches[0].clientY, t: Date.now() };
            sendMsg({ t: 'pointer', ...p, b: 'move' });
            longTimer = setTimeout(() => {
                if (!start || down) return;
                sendMsg({ t: 'pointer', ...p, b: 'down', btn: 'right' });
                sendMsg({ t: 'pointer', ...p, b: 'up', btn: 'right' });
                if (navigator.vibrate) navigator.vibrate(15);
                start = null;
            }, 550);
        }, { passive: false });
        canvas.addEventListener('touchmove', (e) => {
            e.preventDefault();
            if (e.touches.length === 2 && lastY != null) {
                const y = (e.touches[0].clientY + e.touches[1].clientY) / 2, x = (e.touches[0].clientX + e.touches[1].clientX) / 2;
                sendMsg({ t: 'scroll', dx: (lastX - x) / 3, dy: (lastY - y) / 3 });
                lastY = y; lastX = x;
                return;
            }
            if (!start || e.touches.length !== 1) return;
            const t = e.touches[0], p = point(t);
            if (!down && Math.hypot(t.clientX - start.cx, t.clientY - start.cy) > 8) {
                clearTimeout(longTimer);
                sendMsg({ t: 'pointer', x: start.x, y: start.y, b: 'down', btn: 'left' });
                down = true;
            }
            if (down) sendMsg({ t: 'pointer', ...p, b: 'move' });
        }, { passive: false });
        canvas.addEventListener('touchend', (e) => {
            e.preventDefault();
            clearTimeout(longTimer);
            if (e.touches.length) return;
            lastY = lastX = null;
            const t = e.changedTouches[0];
            if (down) { sendMsg({ t: 'pointer', ...point(t), b: 'up', btn: 'left' }); down = false; }
            else if (start) {
                const btn = rightNext ? 'right' : 'left';
                rightNext = false;
                sendMsg({ t: 'pointer', x: start.x, y: start.y, b: 'down', btn });
                sendMsg({ t: 'pointer', x: start.x, y: start.y, b: 'up', btn });
            }
            start = null;
        }, { passive: false });
    }

    // ───── Ekran modułu: kroki połączenia ─────
    const STEPS = PLATFORM === 'ios'
        ? [['link', 'Aplikacja czeka na komputer', 'Podłącz iPhone kablem do komputera i potwierdź „Zaufaj”.'],
           ['pc', 'Komputer połączony', 'Uruchom na komputerze Pitayas Screen — połączy się sam przez kabel.'],
           ['video', 'Obraz', 'Na komputerze zgódź się na udostępnienie ekranu (pyta tylko za pierwszym razem).']]
        : [['link', 'Kabel USB', 'Opcje programisty → Debugowanie USB, podłącz kabel i zezwól na debugowanie.'],
           ['pc', 'Komputer połączony', 'Uruchom na komputerze Pitayas Screen — tunel przez kabel zrobi sam.'],
           ['video', 'Obraz', 'Na komputerze zgódź się na udostępnienie ekranu (pyta tylko za pierwszym razem).']];
    const ORDER = { idle: -1, link: 0, pc: 1, video: 2 };

    function renderSteps() {
        const box = q('.scr-steps');
        if (!box) return;
        // Android nie widzi samego kabla — „link” = udało się połączyć z komputerem; iPhone: link = przekaźnik nasłuchuje
        const reached = PLATFORM === 'ios' ? ORDER[phase] : Math.max(ORDER[phase], phase === 'idle' ? -1 : 0);
        const current = paused ? -1 : reached + 1;
        const slow = Date.now() - phaseSince > 4000;
        box.innerHTML = STEPS.map(([id, title, help], i) => {
            const done = i <= reached && !paused;
            const now = i === current && !paused;
            return `<div class="scr-step ${done ? 'done' : now ? 'now' : ''}">
                <span class="scr-mark">${done ? '✓' : now ? '<i class="mini-spin"></i>' : i + 1}</span>
                <span class="scr-st"><b>${title}</b>${now && slow ? `<small>${help}</small>` : ''}</span></div>`;
        }).join('') + (linkError ? `<p class="scr-status err">${esc(linkError)}</p>` : '');
        const go = q('.scr-go');
        if (go) go.hidden = !paused;
    }

    function render() {
        if (!el) return;
        const chips = (name, list, cur) => list.map(([v, l]) => `<button class="scr-chip ${String(cur) === String(v) ? 'on' : ''}" data-${name}="${v}">${l}</button>`).join('');
        el.innerHTML = `
            <div class="scr-hero">
              <svg viewBox="0 0 120 80" class="scr-art ${phase === 'pc' || phase === 'video' ? 'linked' : ''}"><rect x="4" y="6" width="74" height="48" rx="5"/><path d="M30 66h22M41 54v12"/><rect x="88" y="22" width="28" height="50" rx="5"/><path d="M78 40c4 0 6 2 10 2" class="cable"/></svg>
              <b>Telefon jako monitor</b>
              <small>Wszystko łączy się samo przez kabel — wystarczy, że Pitayas Screen działa na komputerze.</small>
            </div>
            <div class="scr-steps"></div>
            <button class="btn scr-go" hidden>Połącz ponownie</button>
            <div class="set-label">Rozmiar tekstu na monitorze</div>
            <div class="scr-chips">${chips('scale', [[1, 'Mały'], [1.5, 'Średni'], [2, 'Duży']], opts.scale)}</div>
            <div class="set-label">Jakość obrazu</div>
            <div class="scr-chips">${chips('quality', [['high', 'Najlepsza'], ['mid', 'Zbalansowana'], ['low', 'Oszczędna']], opts.quality)}</div>
            <p class="hint">Stuknięcie — klik · przytrzymanie — prawy klik · przeciągnięcie — przeciąganie · dwa palce — przewijanie. Menu w rogu: klawiatura i rozłączenie.</p>`;
        el.querySelectorAll('[data-scale]').forEach((b) => (b.onclick = () => { opts.scale = Number(b.dataset.scale); saveOpts(); render(); hello(); }));
        el.querySelectorAll('[data-quality]').forEach((b) => (b.onclick = () => { opts.quality = b.dataset.quality; saveOpts(); render(); hello(); }));
        q('.scr-go').onclick = () => { connect(); render(); };
        renderSteps();
    }

    Pitayas.register({
        id: 'screen',
        mount(body, moduleApi) {
            api = moduleApi;
            el = body;
            el.classList.add('scr-mod');
            render();
            connect();   // od razu: nasłuch (iPhone) / szukanie komputera przez kabel (Android)
            stepTimer = setInterval(renderSteps, 1500);
        },
        pause() { if (!paused) { disconnect(); render(); } },
        resume() { if (el && paused) { connect(); render(); } },
        unmount() { clearInterval(stepTimer); disconnect(); el = null; },
    });
})();

// ═══════ PITAYA GEAR — MODUŁ ═══════
// Sterowanie sprzętem komputera (słuchawki Arctis, mysz G502, klawiatura RGB, wentylatory GIGABYTE).
// Telefon łączy się z Pitaya Deck (ws://komputer:8191/ws, to samo urządzenie co moduł Deck — bez nowego parowania),
// a deck przekazuje polecenia do Pitaya Gear przez kanał sterowania Pitaya Core (uruchamia Gear w tle, gdy nie działa).
(() => {
    const FAN_PRESETS = [['auto', 'Auto'], ['silent', 'Cichy'], ['normal', 'Normalny'], ['gaming', 'Gaming']];
    const NOISE = [['off', 'Wył.'], ['transparency', 'Otoczenie'], ['anc', 'ANC']];
    const COLORS = ['#ff4fa6', '#ff3b30', '#ff9500', '#ffd60a', '#34c759', '#00c7be', '#0a84ff', '#5e5ce6', '#bf5af2', '#ffffff'];

    let el = null, api = null, ws = null, seq = 0, timer = null, retry = null, data = null, error = '';
    const waiting = new Map();
    const q = (s) => el && el.querySelector(s);
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

    // To samo urządzenie co moduł Deck — zatwierdzone raz w Pitaya Deck na komputerze
    function deviceId() {
        let id = localStorage.getItem('pitaya-deck-id');
        if (!id) {
            id = 'd' + Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
            localStorage.setItem('pitaya-deck-id', id);
        }
        return id;
    }
    function deviceName() {
        const ua = navigator.userAgent;
        const os = /iPad/.test(ua) ? 'iPad' : /iPhone/.test(ua) ? 'iPhone' : /Android/.test(ua) ? ((ua.match(/Android[^;]*;\s*([^;)]+?)(?:\sBuild|\))/) || [])[1] || 'Android') : 'Telefon';
        return `${os.trim()} · Pitayas`;
    }
    // Port decka z ustawień komputera (wspólny z modułem Deck), inaczej własny
    function wsUrl() {
        const pc = api.pc() || {};
        const port = (pc.ports && parseInt(pc.ports.deck, 10)) || api.port() || 8191;
        return `ws://${api.host()}:${port}/ws`;
    }

    // ───── Połączenie ─────
    function connect() {
        clearTimeout(retry);
        try { ws = new WebSocket(wsUrl()); } catch { return fail('Zły adres komputera'); }
        ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', deviceId: deviceId(), name: deviceName() }));
        ws.onmessage = (e) => {
            let msg;
            try { msg = JSON.parse(e.data); } catch { return; }
            if (msg.t === 'state') { if (!data) refresh(); }   // deck nas wpuścił
            else if (msg.t === 'pending') fail('Zatwierdź to urządzenie w Pitaya Deck na komputerze.');
            else if (msg.t === 'denied') fail('Komputer odrzucił to urządzenie (Pitaya Deck → Urządzenia).');
            else if (msg.t === 'app-reply') {
                const w = waiting.get(msg.id);
                if (!w) return;
                waiting.delete(msg.id);
                msg.ok ? w.resolve(msg.result) : w.reject(new Error(msg.error || 'Błąd'));
            }
        };
        ws.onclose = () => {
            ws = null;
            for (const w of waiting.values()) w.reject(new Error('Rozłączono'));
            waiting.clear();
            if (!el) return;
            if (!data) fail('Nie widzę Pitaya Deck na komputerze. Gear łączy się przez Deck — uruchom go.');
            retry = setTimeout(connect, 3000);
        };
        ws.onerror = () => {};
    }
    function call(cmd, args = {}) {
        if (!ws || ws.readyState !== 1) return Promise.reject(new Error('Brak połączenia'));
        const id = ++seq;
        ws.send(JSON.stringify({ t: 'app', id, app: 'gear', cmd, args }));
        return new Promise((resolve, reject) => {
            waiting.set(id, { resolve, reject });
            setTimeout(() => { if (waiting.delete(id)) reject(new Error('Pitaya Gear nie odpowiada')); }, 15000);
        });
    }
    async function refresh() {
        try {
            data = await call('summary');
            error = '';
        } catch (err) {
            error = /niedozwolone/i.test(err.message) ? 'Zaktualizuj Pitaya Deck na komputerze — ta wersja nie przekazuje poleceń do Gear.' : err.message;
        }
        render();
    }
    function fail(text) { error = text; data = null; render(); }

    // Zmiana: wysyłamy, odświeżamy tylko tę część
    async function act(part, args) {
        try {
            const r = await call(part, args);
            if (data) data[part] = part === 'mouse' || part === 'keyboard' || part === 'fans' || part === 'headset' ? { ...data[part], ...r } : r;
            render();
        } catch (err) { api.toast(err.message, 'err'); }
    }

    // ───── Wygląd ─────
    const seg = (name, items, current) => `<div class="gr-seg" data-seg="${name}">${items.map(([v, l]) => `<button data-v="${v}" class="${String(current) === String(v) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    const card = (icon, title, sub, body) => `<section class="gr-card"><header><span class="gr-ic">${icon}</span><div><b>${title}</b>${sub ? `<small>${sub}</small>` : ''}</div></header>${body}</section>`;
    const svg = (p) => `<svg viewBox="0 0 24 24">${p}</svg>`;
    const ICONS = {
        headset: svg('<path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="14" width="4" height="6" rx="1.5"/><rect x="17" y="14" width="4" height="6" rx="1.5"/>'),
        mouse: svg('<rect x="6" y="3" width="12" height="18" rx="6"/><path d="M12 7v4"/>'),
        keyboard: svg('<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>'),
        fans: svg('<circle cx="12" cy="12" r="2"/><path d="M12 10c0-4 1-7 4-7s2 5-2 7M14 12c4 0 7 1 7 4s-5 2-7-2M12 14c0 4-1 7-4 7s-2-5 2-7M10 12c-4 0-7-1-7-4s5-2 7 2"/>'),
    };

    function headsetCard(h) {
        if (!h || h.error) return card(ICONS.headset, 'Słuchawki Arctis', esc(h ? h.error : 'brak'), '');
        if (!h.connected) return card(ICONS.headset, 'Słuchawki Arctis', 'Stacja podłączona, słuchawki wyłączone', '');
        const bat = `${h.battery}%${h.charging ? ' · ładowanie' : ''}`;
        const mode = ['off', 'transparency', 'anc'][h.noiseMode] || 'off';
        return card(ICONS.headset, 'Słuchawki Arctis', `Bateria ${esc(bat)}${h.micMuted ? ' · mikrofon wyciszony' : ''}`,
            `${seg('noise', NOISE, mode)}
             <div class="gr-row"><span>Korektor</span><button class="gr-btn" data-eq>Następny preset</button></div>`);
    }
    function mouseCard(m) {
        if (!m || m.error) return card(ICONS.mouse, 'Mysz G502', esc(m ? m.error : 'brak'), '');
        const led = m.led || {};
        return card(ICONS.mouse, 'Mysz G502', `Profil ${m.profile} · ${m.dpi || '?'} DPI · ${m.reportRate || '?'} Hz`,
            `<div class="gr-row"><span>DPI</span><div class="gr-pair"><button class="gr-btn" data-dpi="prev">−</button><b>${m.dpi || '?'}</b><button class="gr-btn" data-dpi="next">+</button></div></div>
             <div class="gr-row"><span>Profil</span><button class="gr-btn" data-profile>Następny</button></div>
             ${seg('mled', [['static', 'Stały'], ['breathing', 'Oddech'], ['cycle', 'Tęcza'], ['off', 'Wył.']], led.mode || 'static')}
             <div class="gr-colors" data-colors="mouse">${COLORS.map((c) => `<button style="background:${c}" data-c="${c}" class="${(led.color || '').toLowerCase() === c ? 'on' : ''}"></button>`).join('')}</div>`);
    }
    function keyboardCard(k) {
        if (!k) return '';
        return card(ICONS.keyboard, 'Klawiatura RGB', k.autonomous ? 'Efekt wbudowany' : `Jasność ${k.brightness}%`,
            `<div class="gr-colors" data-colors="keyboard">${COLORS.map((c) => `<button style="background:${c}" data-c="${c}" class="${!k.autonomous && (k.color || '').toLowerCase() === c ? 'on' : ''}"></button>`).join('')}</div>
             <div class="gr-row"><span>Jasność</span><input type="range" min="0" max="100" step="5" value="${k.brightness}" data-kb-bright></div>
             <div class="gr-row"><span>Efekt wbudowany</span><button class="gr-btn${k.autonomous ? ' on' : ''}" data-kb-auto>${k.autonomous ? 'Włączony' : 'Włącz'}</button></div>`);
    }
    function fansCard(f) {
        if (!f || !f.available) return card(ICONS.fans, 'Wentylatory', 'Sterownik gigabyte-laptop-wmi niedostępny', '');
        const t = (s) => (s ? `${s.temp ?? '?'}°C · ${s.rpm ?? '?'} obr.` : '—');
        return card(ICONS.fans, 'Wentylatory', `CPU ${t(f.cpu)} · GPU ${t(f.gpu)}`,
            `${seg('fan', FAN_PRESETS, f.preset)}
             <div class="gr-row"><span>Turbo</span><button class="gr-btn${f.turbo ? ' on' : ''}" data-turbo>${f.turbo ? 'Włączone' : 'Wyłączone'}</button></div>
             ${f.chargeLimit != null ? `<div class="gr-row"><span>Limit ładowania</span>${seg('charge', [[60, '60%'], [80, '80%'], [100, '100%']], f.chargeLimit)}</div>` : ''}
             ${f.writable === false ? '<p class="gr-hint">Brak uprawnień do zmiany — uruchom raz <code>system/install.sh</code> w Pitaya Gear.</p>' : ''}`);
    }

    function render() {
        if (!el) return;
        if (!data) {
            el.innerHTML = `<div class="gr-empty">${error ? esc(error) : 'Łączę z komputerem…'}</div>`;
            return;
        }
        const scroll = el.scrollTop;
        el.innerHTML = (error ? `<div class="gr-empty small">${esc(error)}</div>` : '') +
            headsetCard(data.headset) + mouseCard(data.mouse) + keyboardCard(data.keyboard) + fansCard(data.fans);
        el.scrollTop = scroll;
    }

    function onClick(e) {
        const b = e.target.closest('button');
        if (!b || !el.contains(b)) return;
        const s = b.closest('[data-seg]');
        if (s) {
            const v = b.dataset.v;
            if (s.dataset.seg === 'noise') return act('headset', { noiseMode: v });
            if (s.dataset.seg === 'fan') return act('fans', { preset: v });
            if (s.dataset.seg === 'charge') return act('fans', { chargeLimit: Number(v) });
            if (s.dataset.seg === 'mled') return act('mouse', { led: { mode: v } });
        }
        const colors = b.closest('[data-colors]');
        if (colors) return colors.dataset.colors === 'mouse' ? act('mouse', { led: { color: b.dataset.c, mode: 'static' } }) : act('keyboard', { color: b.dataset.c, autonomous: false });
        if (b.dataset.dpi) return act('mouse', { dpi: b.dataset.dpi });
        if ('profile' in b.dataset) return act('mouse', { profile: 'next' });
        if ('eq' in b.dataset) return act('headset', { eqPreset: 'cycle' });
        if ('turbo' in b.dataset) return act('fans', { turbo: 'toggle' });
        if ('kbAuto' in b.dataset) return act('keyboard', { autonomous: !(data.keyboard && data.keyboard.autonomous) });
    }
    function onChange(e) {
        if (e.target.matches('[data-kb-bright]')) act('keyboard', { brightness: Number(e.target.value), autonomous: false });
    }

    function stop() {
        clearInterval(timer); clearTimeout(retry);
        if (ws) { ws.onclose = null; try { ws.close(); } catch {} ws = null; }
    }
    function start() {
        stop();
        connect();
        timer = setInterval(() => { if (data && document.visibilityState === 'visible') refresh(); }, 5000);   // temperatury, bateria
    }

    Pitayas.register({
        id: 'gear',
        probe: (a) => { api = api || a; return a.probe(`http://${a.host()}:${((a.pc() || {}).ports && parseInt(a.pc().ports.deck, 10)) || a.port() || 8191}/icons/32x32.png`, false); },
        mount(body, moduleApi) {
            api = moduleApi; el = body; data = null; error = '';
            el.classList.add('gear-mod');
            el.addEventListener('click', onClick);
            el.addEventListener('change', onChange);
            render();
            start();
        },
        pause() { stop(); },
        resume() { if (el) start(); },
        unmount() { stop(); el = null; },
    });
})();

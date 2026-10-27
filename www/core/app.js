// ═══════ PITAYAS MOBILE — RDZEŃ ═══════
// Rdzeń aplikacji na telefon: komputery, moduły (Deck, Cam…) i aktualizacje.
// Powłoka (www/index.html) ładuje pobraną wersję rdzenia albo wbudowaną. Rdzeń i moduły
// aktualizują się z kanału aktualizacji (folder updates/ w repozytorium) bez nowego APK/IPA.
(() => {
const CORE_VERSION = '4.1.0';
const DEFAULT_SOURCE = 'https://raw.githubusercontent.com/Pitayas-Team/Pitayas-Mobile/main/updates/';
const DEFAULT_ACCOUNTS = 'https://admin.pitayas.eu/';

const $ = (id) => document.getElementById(id);
// Ostatnie błędy JS — widać je w Ustawieniach → Diagnostyka (łatwiej pomóc na odległość)
const jsErrors = [];
window.addEventListener('error', (e) => {
    jsErrors.unshift(`${e.message} (${String(e.filename || '').split('/').pop()}:${e.lineno})`);
    jsErrors.length = Math.min(jsErrors.length, 8);
    // Błąd widać od razu na ekranie głównym — zrzut ekranu wystarczy do naprawy
    const h = document.getElementById('homeHint');
    if (h) { h.textContent = `Błąd: ${jsErrors[0]}`; h.style.color = '#ff6b7f'; }
});
window.addEventListener('unhandledrejection', (e) => { jsErrors.unshift(`Promise: ${(e.reason && e.reason.message) || e.reason}`); jsErrors.length = Math.min(jsErrors.length, 8); });
const Plugins = (window.Capacitor && window.Capacitor.Plugins) || {};
const NATIVE = Boolean(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
const FS = NATIVE ? Plugins.Filesystem : null;
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const ls = {
    get(key, fallback) { try { const v = JSON.parse(localStorage.getItem(key)); return v == null ? fallback : v; } catch { return fallback; } },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} },
};

// „0.2.10” > „0.2.9”; dopisek „-beta” nie liczy się do porównania
function vcmp(a, b) {
    const pa = String(a || '0').split('-')[0].split('.').map(Number);
    const pb = String(b || '0').split('-')[0].split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const d = (pa[i] || 0) - (pb[i] || 0);
        if (d) return d > 0 ? 1 : -1;
    }
    return 0;
}

function toast(text, tone) {
    const t = $('toast');
    t.textContent = text;
    t.className = `toast show ${tone || ''}`;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => (t.className = 'toast'), 2800);
}

// ─── Wygląd ───
document.body.insertAdjacentHTML('beforeend', `
  <div class="ptr" id="ptr" data-core-ui><svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg></div>
  <section class="view" id="home" data-core-ui>
    <header class="head">
      <img src="icons/pitayas.png" alt="" class="head-logo">
      <div class="head-title"><div class="kicker">PITAYAS</div><h1>Twoje <span>aplikacje</span></h1></div>
      <button class="bar-btn" id="setBtn" title="Ustawienia"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg></button>
    </header>

    <div class="banner" id="banner" hidden></div>

    <button class="pc" id="pcBtn">
      <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>
      <div class="pc-text"><small>Komputer</small><b id="pcName">Dodaj komputer</b></div>
      <svg viewBox="0 0 24 24" class="pc-chev"><path d="M9 6l6 6-6 6"/></svg>
    </button>

    <div class="tiles" id="tiles"></div>
    <p class="hint" id="homeHint"></p>
  </section>

  <div class="sheet" id="sheet" hidden data-core-ui>
    <div class="sheet-card">
      <div class="sheet-head"><button class="bar-btn" id="sheetBackBtn" data-glass="chevron.left" title="Wstecz"><svg viewBox="0 0 24 24"><path d="M14 6l-6 6 6 6"/></svg></button><b id="sheetTitle"></b></div>
      <div id="sheetBody" class="sheet-body"></div>
    </div>
  </div>

  <div class="toast" id="toast" data-core-ui></div>
`);

// ═══════ KOMPUTERY ═══════
const pcs = ls.get('pitayas-pcs', { list: [], current: null });
const savePcs = () => ls.set('pitayas-pcs', pcs);
const current = () => pcs.list.find((p) => p.id === pcs.current) || pcs.list[0] || null;
const hostOf = (pc) => (pc.host.includes(':') && !pc.host.startsWith('[') ? `[${pc.host}]` : pc.host);   // IPv6 w nawiasach
const cleanHost = (text) => text.trim().replace(/^[a-z]+:\/\//i, '').replace(/[/?#].*$/, '').replace(/:\d+$/, '');

// ═══════ MODUŁY ═══════
// installed: { id: { id, name, description, version, port, files, path | url } } — path w pamięci telefonu,
// url tylko w przeglądarce (podgląd na komputerze), gdzie nie ma systemu plików.
const installed = ls.get('pitayas-modules', {});
const saveInstalled = () => ls.set('pitayas-modules', JSON.parse(JSON.stringify(installed, (k, v) => (k === 'base' ? undefined : v))));
const defs = {};          // kod modułów po załadowaniu: Pitayas.register({...})
const online = {};

function portOf(pc, id) {
    const m = installed[id];
    return (pc && pc.ports && parseInt(pc.ports[id], 10)) || (m && m.port && m.port.default) || 0;
}

function makeApi(id) {
    return {
        id,
        native: NATIVE,
        Plugins,
        toast,
        pc: () => current(),
        host: () => hostOf(current()),
        port: () => portOf(current(), id),
        url: (path = '/', proto = 'http') => `${proto}://${hostOf(current())}:${portOf(current(), id)}${path}`,
        probe,
        close: () => showHome(),
        switcher: () => openSwitcher(),   // lista aplikacji — przejście do innego modułu
        account: () => (account.token ? { user: account.user, token: account.token, server: accountServer() } : null),
        // Dostęp do aplikacji z panelu kont: { name, testersOnly, access } albo null, gdy aplikacji nie ma w panelu
        access: (appId) => (access[appId] ? { ...access[appId] } : null),
    };
}
// Moduł, który działa też bez komputera (port w module.json z "optional": true)
const needsPc = (m) => Boolean(m && m.port && !m.port.optional);

async function moduleBase(m) {
    if (m.url) return m.url;
    const r = await FS.getUri({ directory: 'DATA', path: m.path });
    return window.Capacitor.convertFileSrc(r.uri) + '/';
}

function injectModule(m) {
    return moduleBase(m).then((base) => new Promise((resolve) => {
        document.querySelectorAll(`[data-module="${m.id}"]`).forEach((el) => el.remove());
        if (m.files.includes('module.css')) {
            const css = document.createElement('link');
            css.rel = 'stylesheet'; css.href = `${base}module.css?v=${m.version}`; css.dataset.module = m.id;
            document.head.appendChild(css);
        }
        const js = document.createElement('script');
        js.src = `${base}module.js?v=${m.version}`; js.dataset.module = m.id;
        js.onload = js.onerror = () => resolve();
        document.body.appendChild(js);
        m.base = base;
    })).catch(() => {});
}

window.Pitayas = {
    coreVersion: CORE_VERSION,
    register(def) {
        if (!def || !installed[def.id]) return;
        defs[def.id] = def;
        renderTiles();
    },
};

// ═══════ CZY APLIKACJE NA KOMPUTERZE DZIAŁAJĄ ═══════
async function probe(url, json) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2500);
    try {
        const r = await fetch(url, { signal: ctrl.signal, cache: 'no-store', mode: json ? 'cors' : 'no-cors' });
        return json ? await r.json() : true;   // no-cors: odpowiedź nieczytelna, ale serwer odpowiedział
    } catch { return null; }
    finally { clearTimeout(timer); }
}

async function refreshStatus() {
    const pc = current();
    if (!pc) return;
    const ids = Object.keys(defs).filter((id) => defs[id].probe);
    const res = await Promise.all(ids.map((id) => Promise.resolve(defs[id].probe(makeApi(id))).catch(() => false)));
    if (pc !== current()) return;   // w międzyczasie wybrano inny komputer
    ids.forEach((id, i) => {
        online[id] = Boolean(res[i]);
        const dot = $(`dot-${id}`);
        if (dot) dot.className = `dot ${online[id] ? 'on' : 'off'}`;
    });
    const off = ids.filter((id) => !online[id] && needsPc(installed[id])).map((id) => installed[id].name);
    $('homeHint').textContent = off.length
        ? `Nie widzę: ${off.join(', ')} na ${pc.host}. Uruchom na komputerze i sprawdź, czy telefon jest w tej samej sieci.`
        : '';
}

// ═══════ EKRAN STARTOWY ═══════
function renderTiles() {
    const list = Object.values(installed).filter((m) => !isHidden(m.id)).sort((a, b) => a.name.localeCompare(b.name));
    $('tiles').innerHTML = list.map((m) => `
        <button class="tile${hasAccess(m.id) ? '' : ' locked'}" data-open="${esc(m.id)}">
          <img src="${esc((m.base || '') + 'icon.png')}" alt="">
          <div class="tile-text"><b>${esc(m.name)}</b><small>${esc(m.description)}</small></div>
          <span class="dot ${online[m.id] === true ? 'on' : online[m.id] === false ? 'off' : ''}" id="dot-${esc(m.id)}"></span>
        </button>`).join('') + `
        <button class="tile add" data-modules>
          <div class="tile-plus"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></div>
          <div class="tile-text"><b>${list.length ? 'Moduły' : 'Dodaj moduły'}</b><small>Pobierz Deck, Cam i inne — bez instalowania nowej aplikacji</small></div>
        </button>`;
}

function renderHome() {
    const pc = current();
    $('pcName').textContent = pc ? pc.name || pc.host : 'Dodaj komputer';
    $('homeHint').textContent = pc ? '' : 'Dodaj komputer, na którym działa Pitaya Deck albo Pitaya Cam.';
    renderTiles();
    refreshStatus();
}

$('tiles').addEventListener('click', (e) => {
    if (e.target.closest('[data-modules]')) return openModules();
    const tile = e.target.closest('[data-open]');
    if (tile) openModule(tile.dataset.open);
});

// Przełączanie: z jednego modułu prosto do innego (bez wracania na ekran startowy)
function openSwitcher() {
    const list = Object.values(installed).filter((m) => !isHidden(m.id) && defs[m.id]).sort((a, b) => a.name.localeCompare(b.name));
    openSheet('Aplikacje', `<div class="switch-grid">${list.map((m) => `
        <button class="switch-app${activeView && activeView.id === m.id ? ' on' : ''}" data-switch="${esc(m.id)}">
          <img src="${esc((m.base || '') + 'icon.png')}" alt=""><span>${esc(m.name.replace(/^Pitayas? /, ''))}</span>
        </button>`).join('')}
        <button class="switch-app" data-switch=""><span class="switch-home"><svg viewBox="0 0 24 24"><path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z"/></svg></span><span>Start</span></button></div>`);
    $('sheetBody').querySelectorAll('[data-switch]').forEach((b) => (b.onclick = () => {
        const id = b.dataset.switch;
        closeSheet();
        if (activeView && activeView.id === id) return;
        showHome();
        if (id) openModule(id);
    }));
}

function openModule(id) {
    if (!hasAccess(id)) return toast(account.token ? 'Ten moduł jest tylko dla testerów' : 'Moduł dla testerów — zaloguj się w Ustawieniach', 'err');
    if (!current() && needsPc(installed[id])) return openPcs();   // Deck, Cam potrzebują komputera; Convert nie
    const def = defs[id];
    if (!def) return toast('Moduł się nie wczytał — zaktualizuj go w „Moduły”.', 'err');
    if (def.open) return def.open(makeApi(id));
    if (def.mount) openView(id);
}

// Moduł z własnym ekranem: rdzeń daje pasek z „wstecz”, moduł wypełnia resztę
let activeView = null;
function openView(id) {
    const def = defs[id];
    const view = document.createElement('section');
    view.className = 'view';
    view.dataset.coreUi = '';
    view.innerHTML = `
        <header class="bar">
          <button class="bar-btn" data-back id="viewBack" data-glass="chevron.left" title="Wstecz"><svg viewBox="0 0 24 24"><path d="M14 6l-6 6 6 6"/></svg></button>
          <div class="bar-title">${esc(installed[id].name).replace(/^Pitaya /, 'Pitaya <span>') + (installed[id].name.startsWith('Pitaya ') ? '</span>' : '')}</div>
          <div class="bar-slot"></div>
          <button class="bar-btn" data-switcher data-glass="square.grid.2x2" title="Aplikacje"><svg viewBox="0 0 24 24"><rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/><rect x="4" y="14" width="6" height="6" rx="1.5"/><rect x="14" y="14" width="6" height="6" rx="1.5"/></svg></button>
        </header>
        <div class="view-body"></div>`;
    view.querySelector('[data-back]').onclick = showHome;
    view.querySelector('[data-switcher]').onclick = openSwitcher;
    document.body.appendChild(view);
    $('home').hidden = true;
    activeView = { id, view };
    def.mount(view.querySelector('.view-body'), makeApi(id), view.querySelector('.bar-slot'));
}

function showHome() {
    if (activeView) {
        const { id, view } = activeView;
        activeView = null;
        try { defs[id] && defs[id].unmount && defs[id].unmount(); } catch {}
        view.remove();
    }
    $('home').hidden = false;
    renderHome();
}

// ═══════ STRONY (Ustawienia, Moduły, Komputery, Konto, Panel admina) ═══════
// Pełny ekran: nagłówek z przyciskiem „wstecz” stoi, przewija się tylko treść. Wstecz = poprzednia strona
// (onBack) albo ekran startowy. To samo robi przesunięcie od lewej krawędzi i przycisk „wstecz” w Androidzie.
let sheetBack = null;
function openSheet(title, html, onBack) {
    $('sheetTitle').textContent = title;
    $('sheetBody').innerHTML = html;
    $('sheet').hidden = false;
    sheetBack = typeof onBack === 'function' ? onBack : null;
    $('sheetBody').scrollTop = 0;
}
function closeSheet() { $('sheet').hidden = true; sheetBack = null; }
const goBack = () => (sheetBack ? sheetBack() : closeSheet());
document.addEventListener('click', (e) => { if (e.target.closest('#sheetBackBtn')) goBack(); });

// ─── Komputery ───
function openPcs(back) {
    if (typeof back !== 'function') back = null;
    if (!pcs.list.length) return editPc(null);
    const cur = current();
    openSheet('Komputery', `
        <div class="pc-list">${pcs.list.map((p) => `
          <div class="pc-item ${cur && p.id === cur.id ? 'active' : ''}" data-id="${esc(p.id)}">
            <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>
            <div class="pc-text"><b>${esc(p.name || p.host)}</b><small>${esc(p.host)}</small></div>
            <button class="bar-btn" data-edit title="Edytuj"><svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg></button>
          </div>`).join('')}</div>
        <button class="btn ghost" id="pcAdd">+ Dodaj komputer</button>`, back);
    $('pcAdd').onclick = () => editPc(null);
    $('sheetBody').querySelectorAll('.pc-item').forEach((el) => {
        const pc = pcs.list.find((p) => p.id === el.dataset.id);
        el.onclick = (e) => {
            if (e.target.closest('[data-edit]')) return editPc(pc);
            pcs.current = pc.id;
            savePcs();
            renderHome();
            back ? back() : closeSheet();
        };
    });
}

function editPc(pc) {
    const withPort = Object.values(installed).filter((m) => m.port);
    openSheet(pc ? 'Edytuj komputer' : 'Dodaj komputer', `
        <form class="pc-form" id="pcForm">
          <div><label for="fName">Nazwa</label><input id="fName" placeholder="np. Komputer w pokoju" autocomplete="off" value="${esc(pc ? pc.name : '')}"></div>
          <div><label for="fHost">Adres komputera</label><input id="fHost" placeholder="np. 192.168.1.20" inputmode="url" autocapitalize="off" autocomplete="off" required value="${esc(pc ? pc.host : '')}"></div>
          ${withPort.length ? `<div class="row">${withPort.map((m) => `
            <div><label for="fPort-${esc(m.id)}">${esc(m.port.label || m.name)}</label>
              <input id="fPort-${esc(m.id)}" data-port="${esc(m.id)}" type="number" inputmode="numeric" placeholder="${esc(m.port.default)}" value="${esc(pc && pc.ports && pc.ports[m.id] || '')}"></div>`).join('')}</div>` : ''}
          <p class="hint">Adres pokazuje Pitaya Deck (kod QR) i Pitaya Cam na komputerze. Telefon musi być w tej samej sieci Wi‑Fi albo Tailscale.</p>
          <div class="row">
            ${pc ? '<button type="button" class="btn ghost danger" id="pcDelete">Usuń</button>' : '<span></span>'}
            <button type="submit" class="btn">Zapisz</button>
          </div>
        </form>`, pcs.list.length ? openPcs : null);
    if (!pc) setTimeout(() => $('fHost').focus(), 250);
    $('pcForm').onsubmit = (e) => {
        e.preventDefault();
        const host = cleanHost($('fHost').value);
        if (!host) return toast('Wpisz adres komputera', 'err');
        const ports = Object.assign({}, pc && pc.ports);
        $('pcForm').querySelectorAll('[data-port]').forEach((i) => { ports[i.dataset.port] = parseInt(i.value, 10) || null; });
        const data = { name: $('fName').value.trim(), host, ports };
        if (pc) Object.assign(pc, data);
        else {
            const n = { id: Date.now().toString(36), ...data };
            pcs.list.push(n);
            pcs.current = n.id;
        }
        savePcs();
        closeSheet();
        renderHome();
    };
    if (pc) $('pcDelete').onclick = () => {
        if (!confirm(`Usunąć „${pc.name || pc.host}”?`)) return;
        pcs.list = pcs.list.filter((p) => p !== pc);
        if (pcs.current === pc.id) pcs.current = pcs.list[0] ? pcs.list[0].id : null;
        savePcs();
        renderHome();
        pcs.list.length ? openPcs() : closeSheet();
    };
}
$('pcBtn').onclick = openPcs;

// ═══════ AKTUALIZACJE ═══════
const settings = ls.get('pitayas-settings', { source: '', autoUpdate: true });
const source = () => {
    const s = (settings.source || DEFAULT_SOURCE).trim();
    return s.endsWith('/') ? s : `${s}/`;
};
let manifest = null;
let bundled = null;     // moduły wbudowane w aplikację (www/modules) — działają bez internetu
let shellVersion = '0.0.0';

// Dziennik aktualizacji (Ustawienia → Dziennik) — żeby było widać, co poszło nie tak na telefonie
const updateLog = ls.get('pitayas-update-log', []);
function logUpdate(text, error) {
    updateLog.unshift({ t: new Date().toISOString(), text, error: Boolean(error) });
    updateLog.length = Math.min(updateLog.length, 30);
    ls.set('pitayas-update-log', updateLog);
}
const errText = (err) => (err && err.message) || String(err);

async function loadBundled() {
    try {
        const r = await fetch(`modules/index.json?t=${Date.now()}`, { cache: 'no-store' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const list = (await r.json()).modules || [];
        bundled = list.map((m) => ({ ...m, src: new URL(m.base, location.href).href, bundled: true }));
    } catch { bundled = []; }   // starsza aplikacja bez wbudowanych modułów
}

// Lista do wyboru: kanał + wbudowane; przy tej samej wersji wbudowany (nie potrzebuje internetu)
function available() {
    const map = new Map();
    for (const m of manifest ? manifest.modules || [] : []) map.set(m.id, { ...m, src: `${source()}${m.base}` });
    for (const m of bundled || []) {
        const net = map.get(m.id);
        if (!net || vcmp(m.version, net.version) >= 0) map.set(m.id, m);
    }
    return [...map.values()];
}
let coreReady = null;   // pobrana nowsza wersja rdzenia czeka na ponowne uruchomienie

async function fetchManifest() {
    try {
        const r = await fetch(`${source()}manifest.json?t=${Date.now()}`, { cache: 'no-store' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        manifest = await r.json();
        const off = Boolean(manifest.flags && manifest.flags.glass === false);
        if (off !== ls.get('pitayas-glass-off', false)) {
            ls.set('pitayas-glass-off', off);
            if (off && typeof disableGlass === 'function') disableGlass(new Error('wyłączone zdalnie'));
        }
        return manifest;
    } catch (err) {
        logUpdate(`Lista aktualizacji: ${errText(err)}`, true);
        throw err;
    }
}

function toBase64(buf) {
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
}

// Pobiera pliki do nowego folderu i dopiero gdy wszystkie są na miejscu, zwraca ścieżkę.
// Stara wersja działa do końca, więc przerwane pobieranie niczego nie psuje.
async function downloadTo(dir, src, files) {
    try { await FS.rmdir({ directory: 'DATA', path: dir, recursive: true }); } catch {}
    for (const f of files) {
        let r;
        try { r = await fetch(`${src}${f}`, { cache: 'no-store' }); } catch (err) { throw new Error(`${f}: ${errText(err)}`); }
        if (!r.ok) throw new Error(`${f}: HTTP ${r.status}`);
        try {
            await FS.writeFile({ directory: 'DATA', path: `${dir}/${f}`, data: toBase64(await r.arrayBuffer()), recursive: true });
        } catch (err) { throw new Error(`zapis ${f}: ${errText(err)}`); }
    }
    return dir;
}

async function removeDir(dir) {
    if (!FS || !dir) return;
    try { await FS.rmdir({ directory: 'DATA', path: dir, recursive: true }); } catch {}
}

const coreUpdate = () => manifest && manifest.core && vcmp(manifest.core.version, CORE_VERSION) > 0
    && vcmp(shellVersion, manifest.core.minShell) >= 0 ? manifest.core : null;
const shellUpdate = () => manifest && manifest.shell && NATIVE && vcmp(manifest.shell.version, shellVersion) > 0 ? manifest.shell : null;
const moduleUpdates = () => available().filter((m) => installed[m.id] && vcmp(m.version, installed[m.id].version) > 0 && compatible(m));
const compatible = (m) => vcmp(CORE_VERSION, m.minCore) >= 0;

async function installCore(entry) {
    if (!FS) throw new Error('Aktualizacja rdzenia działa tylko w aplikacji na telefonie');
    const prev = ls.get('pitayas-core', null);
    const dir = await downloadTo(`pitayas/core/${entry.version}`, `${source()}${entry.base}`, entry.files);
    ls.set('pitayas-core', { version: entry.version, path: dir });
    try { localStorage.removeItem('pitayas-core-failed'); } catch {}
    if (prev && prev.path !== dir) removeDir(prev.path);
    coreReady = entry.version;
}

async function installModule(entry) {
    const prev = installed[entry.id];
    const info = {
        id: entry.id, name: entry.name, description: entry.description, version: entry.version,
        port: entry.port || null, files: entry.files,
    };
    // Wbudowany moduł w przeglądarce czytamy prosto z folderu aplikacji; w telefonie kopiujemy go jak pobrany
    if (FS) info.path = await downloadTo(`pitayas/modules/${entry.id}/${entry.version}`, entry.src, entry.files);
    else info.url = entry.src;
    installed[entry.id] = info;
    saveInstalled();
    if (prev && prev.path && prev.path !== info.path) removeDir(prev.path);
    await injectModule(info);
    logUpdate(`${entry.name} ${entry.version}${entry.bundled ? ' (wbudowany)' : ''}`);
    renderHome();
}

async function removeModule(id) {
    const m = installed[id];
    if (!m) return;
    delete installed[id];
    delete defs[id];
    saveInstalled();
    document.querySelectorAll(`[data-module="${id}"]`).forEach((el) => el.remove());
    removeDir(m.path);
    renderHome();
}

function renderBanner() {
    const b = $('banner');
    const mods = moduleUpdates();
    const core = coreUpdate();
    const shell = shellUpdate();
    if (coreReady) {
        b.innerHTML = `<span>Rdzeń ${esc(coreReady)} pobrany</span><button class="chip" id="bReload">Uruchom ponownie</button>`;
    } else if (core || mods.length) {
        const names = [core && `Rdzeń ${core.version}`, ...mods.map((m) => `${m.name} ${m.version}`)].filter(Boolean);
        b.innerHTML = `<span>Aktualizacje: ${esc(names.join(', '))}</span><button class="chip" id="bUpdate">Aktualizuj</button>`;
    } else if (shell) {
        b.innerHTML = `<span>Nowa wersja aplikacji ${esc(shell.version)}</span><button class="chip" id="bShell">${IS_ANDROID ? 'Zainstaluj' : 'Pobierz'}</button>`;
    } else {
        b.hidden = true;
        return;
    }
    b.hidden = false;
    if ($('bReload')) $('bReload').onclick = () => location.reload();
    if ($('bUpdate')) $('bUpdate').onclick = () => updateAll(true);
    if ($('bShell')) $('bShell').onclick = () => openShellDownload(shell);
}

const IS_ANDROID = Boolean(window.Capacitor && window.Capacitor.getPlatform && window.Capacitor.getPlatform() === 'android');
function openShellDownload(shell) {
    // Android (aplikacja 0.2.7+): pobieramy APK w aplikacji i od razu otwieramy instalator systemu
    if (IS_ANDROID && shell.android && device()) return installShell(shell, true);
    openShellPage(shell);
}
function openShellPage(shell) {
    const platform = window.Capacitor && window.Capacitor.getPlatform && window.Capacitor.getPlatform();
    const url = (platform === 'ios' ? shell.ios : shell.android) || shell.page;
    if (!url) return toast('Brak pliku dla tego telefonu', 'err');
    if (Plugins.InAppBrowser) Plugins.InAppBrowser.openInExternalBrowser({ url }).catch(() => window.open(url, '_blank'));
    else window.open(url, '_blank');
}
let shellBusy = false;
async function installShell(shell, manual) {
    if (shellBusy) return;
    shellBusy = true;
    const b = $('banner');
    const show = (text) => { b.hidden = false; b.innerHTML = `<span>${esc(text)}</span>`; };
    show(`Pobieram aplikację ${shell.version}…`);
    let sub = null;
    try { sub = await device().addListener('apkProgress', (e) => { if (e.percent >= 0) show(`Pobieram aplikację ${shell.version} — ${e.percent}%`); }); } catch {}
    try {
        await device().installApk({ url: shell.android });
        show(`Zainstaluj aplikację ${shell.version} w oknie systemu`);
    } catch (err) {
        const msg = (err && err.message) || String(err);
        if (/not implemented|nie jest zaimplementowan/i.test(msg)) { if (manual) openShellPage(shell); }   // starsza aplikacja — strona wydania
        else if (manual || (err && err.code !== 'PERMISSION')) toast(msg, 'err');
        setTimeout(renderBanner, 1500);
    } finally {
        shellBusy = false;
        if (sub && sub.remove) sub.remove();
    }
}
// Automatyczne aktualizacje: nowa aplikacja na Androidzie pobiera się sama i otwiera instalator (raz na wersję;
// potwierdzenie „Zainstaluj” zawsze należy do użytkownika — tak działa Android)
async function autoShell() {
    const shell = shellUpdate();
    if (!shell || !IS_ANDROID || !shell.android || !device() || !settings.autoUpdate) return;
    if (ls.get('pitayas-shell-auto', '') === shell.version) return;
    try { const r = await device().canInstall(); if (!r || !r.allowed) return; } catch { return; }
    ls.set('pitayas-shell-auto', shell.version);
    installShell(shell, false);
}

let updating = false;
async function updateAll(manual) {
    if (updating) return;
    updating = true;
    // Każda część osobno — błąd jednego modułu nie blokuje rdzenia ani pozostałych
    const failed = [];
    try {
        const core = coreUpdate();
        if (core && FS) {
            try { await installCore(core); logUpdate(`Rdzeń ${core.version} — zadziała po ponownym uruchomieniu`); }
            catch (err) { failed.push('rdzeń'); logUpdate(`Rdzeń ${core.version}: ${errText(err)}`, true); }
        }
        for (const m of moduleUpdates()) {
            try { await installModule(m); }
            catch (err) { failed.push(m.name); logUpdate(`${m.name} ${m.version}: ${errText(err)}`, true); }
        }
        if (failed.length) toast(`Nie udało się zaktualizować: ${failed.join(', ')} — szczegóły w Ustawieniach`, 'err');
        else if (manual) toast(coreReady ? 'Gotowe — uruchom ponownie, by użyć nowego rdzenia' : 'Wszystko aktualne');
    } finally {
        updating = false;
        renderBanner();
    }
}

async function checkUpdates(manual) {
    try {
        await fetchManifest();
    } catch (err) {
        if (manual) toast(`Nie mogę sprawdzić aktualizacji: ${errText(err)}`, 'err');
        // Bez internetu i tak można przejść na nowsze moduły wbudowane w aplikację
        if (moduleUpdates().length) await updateAll(manual);
        renderBanner();
        return false;
    }
    if (settings.autoUpdate || manual) await updateAll(manual);
    renderBanner();
    autoShell();
    return true;
}

// ═══════ KONTO PITAYAS ═══════
// Logowanie loginem albo przez Discord na serwerze kont (admin.pitayas.eu). Serwer mówi, które moduły
// są tylko dla testerów i czy to konto ma do nich dostęp. Bez logowania widać moduły dla wszystkich.
const account = ls.get('pitayas-account', { token: '', user: null, server: '' });
const saveAccount = () => ls.set('pitayas-account', account);
let access = ls.get('pitayas-access', {});    // { id: { testersOnly, access } } — ostatnia znana odpowiedź serwera
const accountServer = () => {
    const s = (account.server || DEFAULT_ACCOUNTS).trim();
    return s.endsWith('/') ? s : `${s}/`;
};
const hasAccess = (id) => !access[id] || !access[id].testersOnly || Boolean(access[id].access);
// Ukryta aplikacja: bez dostępu nie widać jej ani na ekranie głównym, ani w „Moduły”
const isHidden = (id) => Boolean(access[id] && access[id].hidden && !hasAccess(id));

async function accountFetch(path, body) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    try {
        const headers = { 'Content-Type': 'application/json' };
        if (account.token) headers.Authorization = `Bearer ${account.token}`;
        const r = await fetch(`${accountServer()}${path}`, {
            method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store', signal: ctrl.signal,
        });
        const data = await r.json().catch(() => ({}));
        if (r.status === 401 && account.token && path === 'api/access') logoutLocal();
        if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
        return data;
    } finally { clearTimeout(timer); }
}

async function refreshAccess() {
    try {
        const d = await accountFetch('api/access');
        access = d.apps || {};
        ls.set('pitayas-access', access);
        if (d.user) {
            const roleChanged = Boolean(account.user && account.user.admin) !== Boolean(d.user.admin) || (account.user && account.user.hasPassword) !== d.user.hasPassword;
            account.user = d.user; saveAccount();
            if (roleChanged && !$('sheet').hidden && $('sheetTitle').textContent === 'Ustawienia') openSettings();   // pojawia się Panel admina
        }
    } catch {}   // bez internetu zostaje ostatnia znana lista
    renderTiles();
    if (!$('sheet').hidden && $('sheetTitle').textContent === 'Moduły') renderModules();
}

function setLogin(d) {
    account.token = d.token;
    account.user = d.user;
    saveAccount();
    toast(`Zalogowano: ${d.user.name || d.user.login}`);
    refreshAccess();
    refreshNotifs();
}

function logoutLocal() {
    account.token = '';
    account.user = null;
    saveAccount();
    if (typeof syncRunner === 'function') syncRunner();
}

async function logout() {
    try { await accountFetch('api/logout', {}); } catch {}
    logoutLocal();
    await refreshAccess();
    openSettings();
}

const DISCORD_ICON = `<svg viewBox="0 0 24 24"><path d="M19.6 5.3A17 17 0 0 0 15.4 4l-.5 1.1a15.6 15.6 0 0 0-5.8 0L8.6 4a17 17 0 0 0-4.2 1.3C1.7 9.3 1 13.2 1.3 17a17 17 0 0 0 5.2 2.6l1.1-1.8-1.8-.9.4-.3a12 12 0 0 0 11.6 0l.4.3-1.8.9 1.1 1.8a17 17 0 0 0 5.2-2.6c.4-4.4-.7-8.3-3.1-11.7zM8.5 14.7c-1 0-1.9-1-1.9-2.1s.8-2.1 1.9-2.1 1.9 1 1.9 2.1-.8 2.1-1.9 2.1zm7 0c-1 0-1.9-1-1.9-2.1s.8-2.1 1.9-2.1 1.9 1 1.9 2.1-.8 2.1-1.9 2.1z"/></svg>`;
const BROWSER_NAME = (window.Capacitor && window.Capacitor.getPlatform && window.Capacitor.getPlatform() === 'ios') ? 'Safari' : 'przeglądarce';
function openLogin() {
    openSheet('', `
        <div class="login-hero">
          <img src="icons/pitayas.png" alt="">
          <h2>Konto <span>Pitayas</span></h2>
          <p>Zaloguj się, żeby odblokować moduły dla testerów i powiadomienia.</p>
        </div>
        <button class="btn discord glass-btn" id="lgDiscord">${DISCORD_ICON}Zaloguj przez Discord</button>
        <div class="or">albo loginem</div>
        <form class="pc-form login-form" id="lgForm">
          <div class="field"><svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 20c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg><input id="lgLogin" placeholder="Login" autocapitalize="off" autocomplete="username" required></div>
          <div class="field"><svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg><input id="lgPass" type="password" placeholder="Hasło" autocomplete="current-password" required></div>
          <button type="submit" class="btn">Zaloguj</button>
        </form>
        <p class="hint login-foot">Nie masz konta? Poproś administratora Pitayas.</p>`, openSettings);
    $('lgDiscord').onclick = loginDiscord;
    setTimeout(() => $('lgLogin') && $('lgLogin').focus(), 250);
    $('lgForm').onsubmit = async (e) => {
        e.preventDefault();
        const btn = $('lgForm').querySelector('.btn');
        btn.disabled = true;
        try {
            setLogin(await accountFetch('api/login', { login: $('lgLogin').value.trim(), password: $('lgPass').value }));
            openSettings();
        } catch (err) { toast(errText(err), 'err'); btn.disabled = false; }
    };
}

// Discord: serwer daje jednorazowy kod, logowanie odbywa się w przeglądarce, aplikacja pyta serwer, czy już gotowe.
// Dzięki temu nie trzeba własnego adresu pitayas:// (to wymagałoby nowej aplikacji).
let discordPoll = null;
// Logowanie w okienku wewnątrz aplikacji (InAppBrowser WebView); bez wtyczki — przeglądarka
const WEBVIEW = {
    showToolbar: true, showURL: false, clearCache: false, clearSessionCache: false, mediaPlaybackRequiresUserAction: false,
    closeButtonText: 'Zamknij', toolbarPosition: 0, showNavigationButtons: false, leftToRight: false, customWebViewUserAgent: null,
    android: { allowZoom: false, hardwareBack: true, pauseMedia: true, isIsolated: false, successUrlPatterns: [] },
    iOS: { allowOverScroll: true, enableViewportScale: false, allowInLineMediaPlayback: false, surpressIncrementalRendering: false, viewStyle: 2, animationEffect: 2, allowsBackForwardNavigationGestures: true },
};
function openDiscordWindow(url) {
    const iab = Plugins.InAppBrowser;
    if (!iab) return window.open(url, '_blank');
    iab.openInWebView({ url, options: WEBVIEW })
        .catch(() => iab.openInExternalBrowser({ url }))
        .catch(() => window.open(url, '_blank'));
}
function closeDiscordWindow() {
    if (Plugins.InAppBrowser) Promise.resolve().then(() => Plugins.InAppBrowser.close()).catch(() => {});
}
async function loginDiscord() {
    let start;
    try { start = await accountFetch('api/discord/start', {}); } catch (err) { return toast(`Discord: ${errText(err)}`, 'err'); }
    openDiscordWindow(start.url);
    openSheet('', `
        <div class="login-hero">
          <div class="dc-badge">${DISCORD_ICON}</div>
          <h2>Logowanie przez <span>Discord</span></h2>
          <p>Zaloguj się w okienku Discorda — aplikacja zaloguje się sama.</p>
        </div>
        <div class="spinner"></div>
        <button class="btn glass-btn" id="dcSafari">Nie działa? Otwórz w ${BROWSER_NAME}</button>
        <p class="hint login-foot">Po zalogowaniu w ${BROWSER_NAME} wróć do aplikacji Pitayas.</p>
        <button class="btn ghost" id="dcCancel">Anuluj</button>`, openSettings);
    $('dcSafari').onclick = () => {
        closeDiscordWindow();
        const iab = Plugins.InAppBrowser;
        if (iab) iab.openInExternalBrowser({ url: start.url }).catch(() => window.open(start.url, '_blank'));
        else window.open(start.url, '_blank');
    };
    $('dcCancel').onclick = () => { clearInterval(discordPoll); closeDiscordWindow(); openSettings(); };
    const until = Date.now() + 5 * 60 * 1000;
    clearInterval(discordPoll);
    discordPoll = setInterval(async () => {
        if (Date.now() > until) { clearInterval(discordPoll); return toast('Logowanie przez Discord wygasło', 'err'); }
        try {
            const d = await accountFetch(`api/discord/poll?c=${encodeURIComponent(start.code)}`);
            if (d.pending) return;
            clearInterval(discordPoll);
            closeDiscordWindow();
            setLogin(d);
            if (!$('sheet').hidden) openSettings();
        } catch (err) {
            clearInterval(discordPoll);
            setTimeout(closeDiscordWindow, 4000);   // chwila na przeczytanie komunikatu w okienku
            toast(errText(err), 'err');
            if (!$('sheet').hidden) openSettings();
        }
    }, 2000);
}

function accountHtml() {
    const u = account.token && account.user;
    return `<div><label>Konto Pitayas</label>
        ${u ? `<div class="mod-item"><div class="pc-text"><b>${esc(u.name || u.login)}</b><small>${esc(u.login)}${u.discord ? ' · Discord' : ''}</small></div>
                 <div class="mod-actions"><button class="chip ghost" id="aOut">Wyloguj</button></div></div>`
            : `<button class="account-btn" id="aLogin"><svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 20c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg><div class="pc-text"><b>Zaloguj się</b><small>Login i hasło albo Discord — dostęp do modułów dla testerów</small></div><svg viewBox="0 0 24 24" class="pc-chev"><path d="M9 6l6 6-6 6"/></svg></button>`}
      </div>`;
}

function bindAccount() {
    if ($('aOut')) $('aOut').onclick = () => { if (confirm('Wylogować z konta Pitayas?')) logout(); };
    if ($('aOpen')) $('aOpen').onclick = openAccount;
    if ($('aLogin')) $('aLogin').onclick = openLogin;
}

// ═══════ POWIADOMIENIA ═══════
// Wysyłane z panelu (admin.pitayas.eu → Powiadomienia) i automatycznie przy nowej aktualizacji.
// Bez nowej aplikacji nie ma powiadomień systemowych — pokazujemy je w aplikacji: przy starcie, po powrocie i co 5 minut.
let notifs = ls.get('pitayas-notifs', []);
const seen = new Set(ls.get('pitayas-notifs-seen', []));
const saveSeen = () => ls.set('pitayas-notifs-seen', [...seen].slice(-300));
const NOTIF_ICON = (n) => (n.level === 'critical' ? '⚠️' : n.kind === 'update' ? '⬇️' : '🔔');

// Aplikacja 0.2.0+: prawdziwe powiadomienia systemowe (LocalNotifications) i sprawdzanie w tle (BackgroundRunner)
const hasPlugin = (name) => Boolean(window.Capacitor && window.Capacitor.isPluginAvailable && window.Capacitor.isPluginAvailable(name));
const RUNNER = 'com.pitayas.mobile.notifications';
const notified = new Set(ls.get('pitayas-notified', []));
const intId = (str) => { let h = 0; for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0; return Math.abs(h) || 1; };

async function askNotifyPermission() {
    if (!hasPlugin('LocalNotifications')) return false;
    try {
        let p = await Plugins.LocalNotifications.checkPermissions();
        if (p.display === 'prompt' || p.display === 'prompt-with-rationale') p = await Plugins.LocalNotifications.requestPermissions();
        return p.display === 'granted';
    } catch { return false; }
}

// Runner w tle musi wiedzieć, kim jesteś i co już widziałeś — inaczej pokazałby to samo drugi raz
function syncRunner() {
    if (!hasPlugin('BackgroundRunner')) return;
    Plugins.BackgroundRunner.dispatchEvent({
        label: RUNNER, event: 'setAccount',
        details: { server: accountServer(), token: account.token || '', notified: [...notified].slice(-300) },
    }).catch(() => {});
}

async function systemNotify(list) {
    if (!list.length || !(await askNotifyPermission())) return false;
    try {
        await Plugins.LocalNotifications.schedule({ notifications: list.slice(0, 5).map((n) => ({
            id: intId(n.id), title: `${n.level === 'critical' ? '⚠️ ' : ''}${n.title}`, body: n.body || '', largeBody: n.body || '',
            threadIdentifier: 'pitayas', group: 'pitayas', extra: { pitayasId: n.id },
            // Android 0.2.8+: kolorowa ikona Pitayas obok treści (zasób w APK); iPhone zawsze pokazuje ikonę aplikacji
            ...(IS_ANDROID && vcmp(shellVersion, '0.2.8') >= 0 ? { largeIcon: 'ic_notif_large' } : {}),
        })) });
        return true;
    } catch { return false; }
}

async function refreshNotifs() {
    try {
        notifs = (await accountFetch('api/notifications')).notifications || [];
        ls.set('pitayas-notifs', notifs);
    } catch { return; }
    renderBell();
    const fresh = notifs.filter((n) => !seen.has(n.id));
    // Każde powiadomienie raz jako systemowe (też gdy aplikacja jest otwarta)
    const toSystem = fresh.filter((n) => !notified.has(n.id));
    const shown = await systemNotify(toSystem);
    notifs.forEach((n) => notified.add(n.id));
    ls.set('pitayas-notified', [...notified].slice(-300));
    syncRunner();
    const critical = fresh.find((n) => n.level === 'critical');
    if (critical) return showCritical(critical);
    const normal = fresh.filter((n) => n.level !== 'critical');
    if (normal.length && !(shown && toSystem.length)) showNotifBanner(normal[0], normal.length);
}
// Wtyczki natywne nie mogą wywrócić rdzenia — każde wywołanie osobno, w try
const safely = (fn) => { try { const r = fn(); if (r && r.catch) r.catch(() => {}); } catch (err) { jsErrors.unshift(`Wtyczka: ${errText(err)}`); } };
if (hasPlugin('LocalNotifications')) safely(() => Plugins.LocalNotifications.addListener('localNotificationActionPerformed', () => setTimeout(openNotifs, 300)));
if (hasPlugin('BackgroundRunner')) safely(() => Plugins.BackgroundRunner.addListener('backgroundRunnerNotificationReceived', () => setTimeout(openNotifs, 300)));

function renderBell() {
    const b = $('bellBtn');
    if (!b) return;
    const unread = notifs.filter((n) => !seen.has(n.id)).length;
    b.querySelector('.badge').textContent = unread > 9 ? '9+' : unread;
    b.dataset.badge = unread ? (unread > 9 ? '9+' : String(unread)) : '';
    b.classList.toggle('has', unread > 0);
    syncGlass();
}

function showNotifBanner(n, count) {
    document.querySelectorAll('.notif-pop').forEach((x) => x.remove());
    const pop = document.createElement('button');
    pop.className = 'notif-pop glass';
    pop.dataset.coreUi = '';
    pop.innerHTML = `<span class="ni">${NOTIF_ICON(n)}</span><span class="nt"><b>${esc(n.title)}</b><small>${esc(count > 1 ? `+${count - 1} więcej · dotknij, by zobaczyć` : n.body.split('\n')[0])}</small></span>`;
    pop.onclick = () => { pop.remove(); openNotifs(); };
    document.body.appendChild(pop);
    requestAnimationFrame(() => pop.classList.add('show'));
    setTimeout(() => { pop.classList.remove('show'); setTimeout(() => pop.remove(), 400); }, 6000);
}

function showCritical(n) {
    if (document.querySelector('.critical')) return;
    const box = document.createElement('div');
    box.className = 'critical';
    box.dataset.coreUi = '';
    box.innerHTML = `<div class="critical-card glass">
        <div class="critical-icon">⚠️</div>
        <small>Ważne powiadomienie</small>
        <h2>${esc(n.title)}</h2>
        <p>${esc(n.body)}</p>
        <button class="btn">Rozumiem</button>
      </div>`;
    box.querySelector('.btn').onclick = () => {
        seen.add(n.id); saveSeen();
        box.remove();
        renderBell();
        refreshNotifs();   // kolejne krytyczne albo zwykłe
    };
    if (navigator.vibrate) navigator.vibrate([60, 60, 60]);
    document.body.appendChild(box);
}

function openNotifs(fromSettings) {
    openSheet('Powiadomienia', notifs.length ? `<div class="set-label">Ostatnie 30 dni</div><div class="notif-list">${notifs.map((n) => `
        <div class="notif ${n.level === 'critical' ? 'crit' : ''} ${seen.has(n.id) ? '' : 'new'}">
          <span class="ni">${NOTIF_ICON(n)}</span>
          <div class="nt"><b>${esc(n.title)}</b>${n.body ? `<p>${esc(n.body)}</p>` : ''}<small>${esc(new Date(n.createdAt).toLocaleString('pl-PL'))}</small></div>
        </div>`).join('')}</div>` : '<p class="hint" style="text-align:center">Brak powiadomień.</p>', fromSettings === true ? openSettings : null);
    notifs.forEach((n) => { if (n.level !== 'critical') seen.add(n.id); });
    saveSeen();
    renderBell();
}

// ─── Moduły do pobrania ───
let modulesBack = null;
async function openModules(fromSettings) {
    modulesBack = fromSettings === true ? openSettings : null;
    openSheet('Moduły', '<div class="spinner"></div>', modulesBack);
    try { await fetchManifest(); } catch (err) {   // zawsze świeża lista, nie ta sprzed godziny
        if (!available().length) {
            if ($('sheet').hidden) return;
            $('sheetBody').innerHTML = `<p class="hint">Nie mogę pobrać listy modułów (${esc(err.message || err)}). Sprawdź internet albo źródło aktualizacji w Ustawieniach.</p>
              <button class="btn ghost" id="mRetry">Spróbuj ponownie</button>`;
            $('mRetry').onclick = openModules;
            return;
        }
    }
    renderModules();
}

function renderModules() {
    if ($('sheet').hidden) return;
    const avail = available().filter((m) => !isHidden(m.id));
    const ids = new Set(avail.map((m) => m.id));
    const local = Object.values(installed).filter((m) => !ids.has(m.id) && !isHidden(m.id));   // wycofane z kanału, ale zainstalowane
    const row = (m) => {
        const have = installed[m.id];
        const newer = have && vcmp(m.version, have.version) > 0;
        const ok = compatible(m);
        const action = !hasAccess(m.id) ? '<span class="mod-pill lock">🔒 Testerzy</span>'
            : !ok ? `<span class="mod-pill">Rdzeń ${esc(m.minCore)}+</span>`
            : !have ? `<button class="mod-get" data-install="${esc(m.id)}">Pobierz</button>`
            : newer ? `<button class="mod-get upd" data-install="${esc(m.id)}">Aktualizuj</button>`
            : '<span class="mod-pill ok">✓ Aktualny</span>';
        const icon = have && have.base ? `${have.base}icon.png` : `${m.src}icon.png`;
        const ver = have ? `${esc(have.version)}${newer ? ` → ${esc(m.version)}` : ''}` : esc(m.version);
        return `
          <div class="mod-card">
            <img class="mod-ic" src="${esc(icon)}" alt="" onerror="this.style.visibility='hidden'">
            <div class="mod-t"><b>${esc(m.name)}</b><p>${esc(m.description)}</p>
              <small>Wersja ${ver}${m.port && !m.port.optional ? ' · potrzebuje komputera' : ''}</small></div>
            <div class="mod-a">${action}${have ? `<button class="mod-del" data-remove="${esc(m.id)}" id="del-${esc(m.id)}" data-glass="trash" title="Usuń"><svg viewBox="0 0 24 24"><path d="M5 7h14M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg></button>` : ''}</div>
          </div>`;
    };
    const all = [...avail, ...local];
    const mine = all.filter((m) => installed[m.id]);
    const rest = all.filter((m) => !installed[m.id]);
    $('sheetBody').innerHTML = (mine.length ? `<div class="set-label">Zainstalowane</div><div class="mod-group">${mine.map(row).join('')}</div>` : '')
        + (rest.length ? `<div class="set-label">Do pobrania</div><div class="mod-group">${rest.map(row).join('')}</div>` : '')
        + (!all.length ? '<p class="hint">Brak modułów w kanale aktualizacji.</p>' : '')
        + '<p class="hint mod-foot">Moduły pobierają się i aktualizują bez instalowania nowej aplikacji.</p>';
    $('sheetBody').querySelectorAll('[data-install]').forEach((b) => (b.onclick = async () => {
        const entry = avail.find((m) => m.id === b.dataset.install);
        b.disabled = true; b.textContent = 'Pobieranie…';
        try { await installModule(entry); toast(`${entry.name} ${entry.version} gotowy`); }
        catch (err) { logUpdate(`${entry.name} ${entry.version}: ${errText(err)}`, true); toast(`Nie udało się pobrać: ${errText(err)}`, 'err'); }
        renderModules();
        renderBanner();
    }));
    $('sheetBody').querySelectorAll('[data-remove]').forEach((b) => (b.onclick = async () => {
        const m = installed[b.dataset.remove];
        if (!confirm(`Usunąć moduł ${m.name}?`)) return;
        await removeModule(m.id);
        renderModules();
    }));
}

// ─── Ustawienia ───
function setRow(icon, title, value, opts = {}) {
    const tag = opts.id ? 'button' : 'div';
    return `<${tag} class="set-row${opts.id ? ' tap' : ''}"${opts.id ? ` id="${opts.id}"` : ''}>${icon}<span class="set-t">${title}${opts.sub ? `<small>${opts.sub}</small>` : ''}</span>${value != null ? `<span class="set-v">${value}</span>` : ''}${opts.toggle != null ? `<span class="ios-sw"><input type="checkbox" id="${opts.toggleId}" ${opts.toggle ? 'checked' : ''}><i></i></span>` : ''}${opts.id ? '<svg viewBox="0 0 24 24" class="set-chev"><path d="M9 6l6 6-6 6"/></svg>' : ''}</${tag}>`;
}
function setIcon(k, color) { return `<span class="set-ic" style="background:${color}"><svg viewBox="0 0 24 24">${SET_ICON_PATHS[k]}</svg></span>`; }
const SET_ICON_PATHS = {"user":"<circle cx=\"12\" cy=\"8\" r=\"4\"/><path d=\"M4 20c1.5-4 4.5-6 8-6s6.5 2 8 6\"/>","refresh":"<path d=\"M21 12a9 9 0 1 1-3-6.7L21 8\"/><path d=\"M21 3v5h-5\"/>","auto":"<path d=\"M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8\"/>","phone":"<rect x=\"7\" y=\"2\" width=\"10\" height=\"20\" rx=\"2\"/><path d=\"M11 18h2\"/>","core":"<rect x=\"5\" y=\"5\" width=\"14\" height=\"14\" rx=\"3\"/><path d=\"M9 9h6v6H9z\"/>","box":"<path d=\"M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8\"/>","bell":"<path d=\"M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0\"/>","code":"<path d=\"M8 6l-6 6 6 6M16 6l6 6-6 6\"/>","dl":"<path d=\"M12 4v11M7 10l5 5 5-5M5 20h14\"/>"};

function openSettings() {
    const shell = shellUpdate();
    const u = account.token && account.user;
    const unread = notifs.filter((n) => !seen.has(n.id)).length;
    const pc = current();
    const cu = coreUpdate();
    const pending = [coreReady ? `Rdzeń ${coreReady} czeka na restart` : cu ? `Rdzeń ${cu.version}` : '', ...moduleUpdates().map((m) => `${m.name} ${m.version}`)].filter(Boolean);
    const upToDate = !pending.length && !shell;
    openSheet('Ustawienia', `
        ${u ? `<div class="acc-row">
                 <button class="acc-main" id="aOpen"><span class="set-av">${esc((u.name || u.login).trim().slice(0, 1).toUpperCase())}</span>
                   <span class="set-pt"><b>${esc(u.name || u.login)}</b><small>Konto Pitayas${u.admin ? ' · Administrator' : ''}</small></span>
                   <svg viewBox="0 0 24 24" class="set-chev"><path d="M9 6l6 6-6 6"/></svg></button>
                 <button class="bar-btn out-btn" id="aOut" title="Wyloguj"><svg viewBox="0 0 24 24"><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H4"/></svg></button>
               </div>`
            : `<button class="account-btn" id="aLogin">${setIcon('user', 'var(--m-accent)')}<div class="pc-text"><b>Zaloguj się</b><small>Konto Pitayas: moduły dla testerów, powiadomienia</small></div><svg viewBox="0 0 24 24" class="pc-chev"><path d="M9 6l6 6-6 6"/></svg></button>`}

        ${u ? `<div class="set-label">Konto</div><div class="set-group">
          ${setRow(setIcon('user', '#3a8ef0'), u.hasPassword === false ? 'Ustaw hasło' : 'Zmień hasło', null, { id: 'sPass' })}
          ${u.admin ? setRow(setIcon('code', '#4cc38a'), 'Panel admina', null, { id: 'sAdmin', sub: 'Konta, aplikacje, strona, powiadomienia' }) : ''}
        </div>` : ''}

        <div class="set-label">Aplikacje</div>
        <div class="set-group">
          ${setRow(setIcon('phone', '#5b6170'), 'Komputer', esc(pc ? pc.name || pc.host : 'nie wybrano'), { id: 'sPc', sub: 'Z którym komputerem łączy się telefon' })}
          ${setRow(setIcon('box', '#a77bff'), 'Moduły', esc(String(Object.keys(installed).length)), { id: 'sMods', sub: 'Pobierz, aktualizuj i usuwaj' })}
          ${setRow(setIcon('bell', '#ff9f45'), 'Powiadomienia', unread ? `<span class="set-badge">${unread}</span>` : '', { id: 'sNotifs' })}
        </div>

        <div class="set-label">Aktualizacje</div>
        <div class="set-group">
          ${setRow(setIcon('refresh', upToDate ? '#4cc38a' : '#3a8ef0'), upToDate ? 'Wszystko aktualne' : 'Dostępne aktualizacje', coreReady ? 'Uruchom ponownie' : '',
              { id: 'sCheck', sub: upToDate ? 'Dotknij, żeby sprawdzić teraz' : esc(pending.join(', ') || 'Dotknij, żeby zainstalować') })}
          ${shell ? setRow(setIcon('dl', '#3fa8ff'), `Nowa aplikacja ${esc(shell.version)}`, null, { id: 'sShell', sub: IS_ANDROID ? 'Pobierz i zainstaluj' : 'Wymaga ponownej instalacji' }) : ''}
          ${setRow(setIcon('auto', '#7ddc5a'), 'Aktualizuj automatycznie', null, { toggle: settings.autoUpdate, toggleId: 'sAuto', sub: IS_ANDROID ? 'Rdzeń, moduły i aplikacja' : 'Rdzeń i moduły w tle' })}
        </div>
        ${ls.get('pitayas-core-failed', false) ? '<p class="hint warn">Pobrany rdzeń nie uruchomił się — działa wbudowany. Spróbuj zaktualizować ponownie.</p>' : ''}

        <div class="set-label">O aplikacji</div>
        <div class="set-group">
          ${setRow(setIcon('phone', '#5b6170'), 'Aplikacja', esc(shellVersion))}
          ${setRow(setIcon('core', '#5b6170'), 'Rdzeń', `${esc(CORE_VERSION)}${coreReady ? ` → ${esc(coreReady)}` : ''}`)}
          ${Object.values(installed).map((m) => setRow(`<img class="set-ic img" src="${esc((m.base || '') + 'icon.png')}" alt="">`, esc(m.name), esc(m.version))).join('')}
        </div>

        <div class="set-group">${setRow(setIcon('code', '#3a3646'), 'Zaawansowane', null, { id: 'sDev', sub: 'Źródło aktualizacji, diagnostyka, dziennik' })}</div>`);
    bindAccount();
    $('sAuto').onchange = () => { settings.autoUpdate = $('sAuto').checked; ls.set('pitayas-settings', settings); };
    $('sCheck').onclick = async () => {
        if (coreReady) return location.reload();
        const v = $('sCheck').querySelector('.set-v');
        if (v) v.innerHTML = '<span class="mini-spin"></span>';
        await checkUpdates(true);
        if (!$('sheet').hidden && $('sCheck')) openSettings();
    };
    if (shell) $('sShell').onclick = () => openShellDownload(shell);
    $('sPc').onclick = () => openPcs(openSettings);
    $('sNotifs').onclick = () => openNotifs(true);
    $('sMods').onclick = () => openModules(true);
    $('sDev').onclick = openDeveloper;
    if ($('sAdmin')) $('sAdmin').onclick = openAdmin;
    if ($('sPass')) $('sPass').onclick = () => openPassword(openSettings);
    refreshAccess();   // rola konta (admin) bierze się z serwera — odświeżamy przy każdym otwarciu
}

// ═══════ PANEL ADMINA (admin.js, wczytywany dopiero przy pierwszym otwarciu) ═══════
window.PitayasCore = { $, esc, toast, openSheet, closeSheet, setRow, setIcon: (k, c) => setIcon(k, c), accountFetch: (p, b) => accountFetch(p, b), openSettings: () => openSettings() };
function openAdmin() {
    if (window.PitayasAdmin) return window.PitayasAdmin.open();
    const base = (window.PITAYAS_CORE && window.PITAYAS_CORE.base) || 'core/';
    const js = document.createElement('script');
    js.src = `${base}admin.js?v=${CORE_VERSION}`;
    js.onload = () => window.PitayasAdmin && window.PitayasAdmin.open();
    js.onerror = () => toast('Nie udało się wczytać panelu admina — zaktualizuj aplikację', 'err');
    document.body.appendChild(js);
}

// Konto: dane, dostęp do aplikacji dla testerów, wylogowanie
function openAccount() {
    const u = account.user || {};
    const apps = Object.entries(access).filter(([, a]) => a.testersOnly);
    openSheet('Konto', `
        <div class="acc-hero"><span class="set-av big">${esc((u.name || u.login || '?').trim().slice(0, 1).toUpperCase())}</span>
          <b>${esc(u.name || u.login || '')}</b><small>${esc(u.login || '')}</small></div>
        <div class="set-label">Dane</div>
        <div class="set-group">
          ${setRow(setIcon('user', '#ff4fa6'), 'Login', esc(u.login || ''))}
          ${setRow(setIcon('code', '#5865f2'), 'Discord', u.discord ? 'połączony' : 'nie')}
          ${setRow(setIcon('core', '#7ddc5a'), 'Rola', u.admin ? 'Administrator' : 'Użytkownik')}
        </div>
        <div class="set-label">Dostęp do aplikacji dla testerów</div>
        <div class="set-group">${apps.length ? apps.map(([id, a]) => setRow(setIcon('box', a.access ? '#7ddc5a' : '#5b6170'), esc(a.name || id), a.access ? '<span class="ok">✓ masz dostęp</span>' : '<span class="no">brak</span>')).join('') : setRow('', 'Wszystkie moduły są dla wszystkich', '')}</div>
        <p class="hint">Dostęp nadaje administrator w panelu Pitayas.</p>
        <div class="set-group">${setRow(setIcon('user', '#3a8ef0'), u.hasPassword === false ? 'Ustaw hasło' : 'Zmień hasło', null, { id: 'accPass' })}${u.admin ? setRow(setIcon('code', '#4cc38a'), 'Panel admina', null, { id: 'accAdmin' }) : ''}</div>
        <button class="btn danger-btn" id="accOut">Wyloguj</button>`, openSettings);
    $('accOut').onclick = () => { if (confirm('Wylogować z konta Pitayas?')) logout(); };
    $('accPass').onclick = () => openPassword(openAccount);
    if ($('accAdmin')) $('accAdmin').onclick = openAdmin;
}

// Własne hasło: obecne + nowe (2×). Pozostałe urządzenia zostają wylogowane, to zostaje zalogowane.
function openPassword(backTo = openAccount) {
    const u = account.user || {};
    const noPass = u.hasPassword === false;
    openSheet(noPass ? 'Ustaw hasło' : 'Zmień hasło', `
        <div class="pc-form">
          ${noPass ? '<p class="hint">Logujesz się przez Discord — możesz dodać hasło, żeby logować się też loginem.</p>'
            : '<div><label for="pwOld">Obecne hasło</label><input id="pwOld" type="password" autocomplete="current-password"></div>'}
          <div><label for="pwNew">Nowe hasło (min. 8 znaków)</label><input id="pwNew" type="password" autocomplete="new-password"></div>
          <div><label for="pwNew2">Powtórz nowe hasło</label><input id="pwNew2" type="password" autocomplete="new-password"></div>
          <button class="btn" id="pwSave">Zapisz hasło</button>
          <p class="hint">Inne urządzenia zostaną wylogowane.</p>
        </div>`, backTo);
    $('pwSave').onclick = async () => {
        const nw = $('pwNew').value;
        if (nw.length < 8) return toast('Nowe hasło: co najmniej 8 znaków', 'err');
        if (nw !== $('pwNew2').value) return toast('Hasła się różnią', 'err');
        $('pwSave').disabled = true;
        try {
            await accountFetch('api/password', { oldPassword: noPass ? '' : $('pwOld').value, newPassword: nw });
            account.user = { ...u, hasPassword: true };
            ls.set('pitayas-account', account);
            toast('Hasło zmienione');
            backTo();
        } catch (err) { toast(err.message || String(err), 'err'); $('pwSave').disabled = false; }
    };
}

// Developer: źródło aktualizacji, diagnostyka i dziennik — schowane, żeby nie straszyły w zwykłych ustawieniach
function openDeveloper() {
    const plug = (p) => (window.Capacitor && window.Capacitor.isPluginAvailable && window.Capacitor.isPluginAvailable(p));
    openSheet('Developer', `
        <div class="set-label">Źródło aktualizacji</div>
        <div class="set-group pad">
          <input id="sSource" autocapitalize="off" inputmode="url" placeholder="${esc(DEFAULT_SOURCE)}" value="${esc(settings.source)}">
          <p class="hint">Puste = oficjalny kanał Pitayas na GitHubie. Do testów: adres lokalnego serwera z folderem updates/.</p>
        </div>

        <div class="set-label">Diagnostyka</div>
        <div class="set-group">
          ${[['LocalNotifications', 'Powiadomienia'], ['BackgroundRunner', 'Praca w tle'], ['PitayasGlass', 'Liquid Glass']].map(([p, n]) => setRow('', n, plug(p) ? '<span class="ok">✓</span>' : '<span class="no">✗</span>')).join('')}
          ${setRow('', 'Stan szkła', esc(glassState))}
          ${setRow('', 'Odświeżenia szkła', `${Math.round(glassCalls * 60000 / Math.max(1, Date.now() - glassCallsFrom))}/min`)}
          ${setRow('', 'Serwer kont', esc(accountServer().replace(/^https?:\/\//, '').replace(/\/$/, '')))}
        </div>

        <div id="devAndroid"></div>

        ${jsErrors.length ? `<div class="set-label">Błędy</div><div class="log">${jsErrors.map((e) => `<div class="err">${esc(e)}</div>`).join('')}</div>` : ''}

        <div class="set-label">Dziennik aktualizacji <button class="link" id="sClearLog">Wyczyść</button></div>
        <div class="log">${updateLog.length ? updateLog.map((e) => `<div class="${e.error ? 'err' : ''}"><small>${esc(new Date(e.t).toLocaleString('pl-PL'))}</small>${esc(e.text)}</div>`).join('') : '<div><small>Pusto</small></div>'}</div>`, openSettings);
    $('sSource').onchange = () => { settings.source = $('sSource').value.trim(); manifest = null; ls.set('pitayas-settings', settings); toast('Źródło zapisane'); };
    $('sClearLog').onclick = () => { updateLog.length = 0; ls.set('pitayas-update-log', updateLog); openDeveloper(); };
    renderDevAndroid();
}

// ═══════ ANDROID: aplikacja domowa, start po włączeniu, ekran (aplikacja 0.2.5+) ═══════
const device = () => (hasPlugin('PitayasDevice') ? Plugins.PitayasDevice : null);
let dimTimer = null, dimmed = false;
function applyScreenMode() {
    const d = device();
    if (!d) return;
    const mode = settings.screenMode || 'normal';
    d.keepScreenOn({ on: mode !== 'normal' }).catch(() => {});
    clearTimeout(dimTimer);
    if (dimmed) { dimmed = false; d.setBrightness({ value: -1 }).catch(() => {}); }
    // Przyciemnianie: po minucie bez dotyku jasność spada prawie do zera, ekran się nie wyłącza
    if (mode === 'dim') dimTimer = setTimeout(() => { dimmed = true; d.setBrightness({ value: 0.02 }).catch(() => {}); }, 60000);
}
['touchstart', 'keydown', 'pointerdown'].forEach((ev) => document.addEventListener(ev, () => { if ((settings.screenMode || 'normal') === 'dim') applyScreenMode(); }, { passive: true, capture: true }));

async function renderDevAndroid() {
    const box = $('devAndroid'), d = device();
    if (!box || !d) return;
    let st = {};
    try { st = await d.getState(); } catch {}
    const mode = settings.screenMode || 'normal';
    box.innerHTML = `
        <div class="set-label">Android</div>
        <div class="set-group">
          ${setRow(setIcon('phone', '#ff4fa6'), 'Aplikacja domowa', null, { toggle: st.home, toggleId: 'dHome', sub: st.defaultHome ? 'Pitayas jest ekranem głównym' : 'Startuje z telefonem jako ekran główny' })}
          ${setRow(setIcon('refresh', '#7ddc5a'), 'Uruchamiaj po włączeniu telefonu', null, { toggle: st.boot, toggleId: 'dBoot', sub: st.boot && !st.overlay ? 'Zezwól na „Wyświetlanie nad innymi aplikacjami”' : 'Bez ustawiania jako ekran główny' })}
          ${typeof st.fullscreen === 'boolean' ? setRow(setIcon('phone', '#3a8ef0'), 'Pełny ekran', null, { toggle: st.fullscreen, toggleId: 'dFull', sub: 'Bez paska stanu i nawigacji — przeciągnij od krawędzi, by je pokazać' }) : ''}
        </div>
        <div class="set-label">Ekran</div>
        <div class="seg">${[['normal', 'Normalnie'], ['on', 'Nie wygaszaj'], ['dim', 'Przyciemniaj']].map(([v, l]) => `<button data-mode="${v}" class="${mode === v ? 'on' : ''}">${l}</button>`).join('')}</div>
        <p class="hint">„Przyciemniaj” — ekran się nie wyłącza, po minucie bez dotyku jasność spada prawie do zera; dotknięcie przywraca jasność.</p>`;
    $('dHome').onchange = async () => { await d.setHome({ enabled: $('dHome').checked }).catch(() => {}); setTimeout(renderDevAndroid, 1500); };
    $('dBoot').onchange = async () => { await d.setBoot({ enabled: $('dBoot').checked }).catch(() => {}); setTimeout(renderDevAndroid, 1500); };
    if ($('dFull')) $('dFull').onchange = () => d.setFullscreen({ enabled: $('dFull').checked }).catch(() => {});
    box.querySelectorAll('[data-mode]').forEach((b) => (b.onclick = () => {
        settings.screenMode = b.dataset.mode;
        ls.set('pitayas-settings', settings);
        applyScreenMode();
        renderDevAndroid();
    }));
}
$('setBtn').onclick = openSettings;
$('setBtn').insertAdjacentHTML('beforebegin', '<button class="bar-btn bell glass" id="bellBtn" title="Powiadomienia"><svg viewBox="0 0 24 24"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0"/></svg><span class="badge"></span></button>');
$('setBtn').classList.add('glass');
$('bellBtn').onclick = openNotifs;
$('bellBtn').dataset.glass = 'bell';
$('setBtn').dataset.glass = 'gearshape';

// ═══════ LIQUID GLASS (iOS 26, aplikacja 0.2.0+) ═══════
// Natywna wtyczka PitayasGlass stawia prawdziwe szklane przyciski (UIButton .glass()) nad przyciskami HTML.
// Przycisk HTML zostaje pod spodem (niewidoczny) i to on obsługuje kliknięcie.
// Szkło leży NAD stroną, więc każdy ruch strony musi być powtórzony natywnie — zawsze o klatkę później (miganie).
// Dlatego szkło dostają tylko przyciski, które stoją w miejscu: pasek startu, pasek modułu, nagłówek okna.
// W trakcie gestu przeciągania szkło znika na chwilę (glassHold), a widać zwykłe matowe przyciski.
let glassOn = false, glassFrame = 0, glassHold = false, glassState = 'brak wtyczki (aplikacja < 0.2.0)';
let glassLast = '', glassCalls = 0, glassCallsFrom = Date.now();
const GLASS_PLACES = '#home > .head, .view > .bar, .sheet-head';
function setGlassHold(on) {
    if (glassHold === on) return;
    glassHold = on;
    syncGlass();
}
function syncGlass() {
    if (!glassOn || glassFrame) return;
    glassFrame = requestAnimationFrame(() => {
        glassFrame = 0;
        // Otwarte okienko zasłania ekran — wtedy szklane są tylko przyciski w okienku
        const blocked = glassHold || document.querySelector('.critical, .egg-lock, .egg-lab, .md-player, .notif-pop.show');
        const sheetOpen = !$('sheet').hidden;
        const scope = sheetOpen ? $('sheet') : document;
        const buttons = blocked ? [] : [...scope.querySelectorAll('[data-glass]')].filter((el) => {
            if (!el.closest(GLASS_PLACES) || (!sheetOpen && $('sheet').contains(el))) return false;
            if (el.offsetParent === null || el.disabled) return false;
            const view = el.closest('.view');
            return !view || !view.hidden;
        }).map((el, i) => {
            const r = el.getBoundingClientRect();
            if (!el.id) el.id = `glass${i}-${Date.now().toString(36)}`;
            return { id: el.id, symbol: el.dataset.glass, title: '', x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), badge: el.dataset.badge || '', style: 'normal', tint: '' };
        }).filter((x) => x.w >= 4);
        const ids = new Set(buttons.map((x) => x.id));
        document.querySelectorAll('[data-glass]').forEach((el) => el.classList.toggle('glass-host', ids.has(el.id)));
        document.documentElement.classList.toggle('native-glass', !glassHold);
        const payload = JSON.stringify(buttons);
        if (payload === glassLast) return;
        glassLast = payload;
        glassCalls++;
        Plugins.PitayasGlass.setButtons({ buttons }).then((r) => {
            if (buttons.length && (!r || typeof r.placed !== 'number' || r.placed < buttons.length)) disableGlass();
        }).catch(disableGlass);
    });
}
function disableGlass(err) {
    glassState = `wyłączone: ${err && err.message ? err.message : 'nie postawiło przycisków'}`;
    if (!glassOn) return;
    glassOn = false;
    document.documentElement.classList.remove('native-glass');
    document.querySelectorAll('.glass-host').forEach((el) => el.classList.remove('glass-host'));
    Plugins.PitayasGlass.setButtons({ buttons: [] }).catch(() => {});
}
// Wyłącznik awaryjny: "flags": { "glass": false } w updates/manifest.json wyłącza natywne szkło na wszystkich telefonach
// (rdzeń czyta kanał przy starcie, bez dotykania ekranu — działa nawet, gdyby szkło blokowało dotyk).
const GLASS_ENABLED = !ls.get('pitayas-glass-off', false);
if (!GLASS_ENABLED && hasPlugin('PitayasGlass')) {
    glassState = 'wyłączone (naprawiam)';
    safely(() => Plugins.PitayasGlass.setButtons({ buttons: [] }));
}
if (GLASS_ENABLED && hasPlugin('PitayasGlass')) {
    glassState = 'sprawdzam…';
    Plugins.PitayasGlass.isSupported().then((r) => {
        if (!r.supported) { glassState = 'niedostępne (iOS < 26)'; return; }
        glassOn = true;
        glassState = 'aktywne';
        Plugins.PitayasGlass.addListener('tap', (e) => {
            const el = document.getElementById(e.id);
            if (el) el.click();
        });
        // Przyciski szkła stoją w miejscu — przeliczamy tylko, gdy coś się pojawia/znika (bez przewijania i animacji)
        new MutationObserver(syncGlass).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden'] });
        addEventListener('resize', syncGlass);
        syncGlass();
    }).catch(() => {});
}
if (window.Capacitor && window.Capacitor.getPlatform && window.Capacitor.getPlatform() === 'ios') document.documentElement.classList.add('ios');

// ═══════ EASTER EGG: 5× logo ═══════
// Kod (egg.js) wczytujemy dopiero teraz — leży obok app.js, w tym samym folderze rdzenia
let logoTaps = [];
document.querySelector('.head-logo').addEventListener('click', () => {
    const now = Date.now();
    logoTaps = logoTaps.filter((t) => now - t < 1500).concat(now);
    if (logoTaps.length < 5) return;
    logoTaps = [];
    if (navigator.vibrate) navigator.vibrate(25);
    const start = () => window.PitayasEgg && window.PitayasEgg.start();
    if (window.PitayasEgg) return start();
    const base = (window.PITAYAS_CORE && window.PITAYAS_CORE.base) || 'core/';
    const js = document.createElement('script');
    js.src = `${base}egg.js?v=${CORE_VERSION}`;
    js.onload = start;
    document.body.appendChild(js);
});

// ═══════ ODŚWIEŻANIE: mocne przeciągnięcie w dół na ekranie startowym ═══════
// Sprawdza aktualizacje i przeładowuje aplikację (nowy rdzeń i moduły od razu w użyciu)
(() => {
    const PULL = 130;   // „mocno” — tyle trzeba przeciągnąć (po oporze), żeby odświeżyć
    const home = $('home'), ptr = $('ptr');
    let y0 = null, dist = 0, busy = false;
    const show = (d) => {
        ptr.style.transform = `translate(-50%, ${Math.min(d, PULL + 30) - 60}px) rotate(${d * 2.4}deg)`;
        ptr.style.opacity = Math.min(1, d / 60);
        ptr.classList.toggle('ready', d >= PULL);
    };
    home.addEventListener('touchstart', (e) => {
        if (busy || home.hidden || home.scrollTop > 0 || !$('sheet').hidden || e.touches.length > 1) return;
        y0 = e.touches[0].clientY; dist = 0;
        ptr.classList.remove('back');
    }, { passive: true });
    home.addEventListener('touchmove', (e) => {
        if (y0 == null) return;
        const dy = e.touches[0].clientY - y0;
        if (dy <= 0 || home.scrollTop > 0) { dist = 0; show(0); return; }
        dist = dy * 0.55;   // opór: palec musi przejechać ok. 240 px
        show(dist);
    }, { passive: true });
    const end = async () => {
        if (y0 == null) return;
        y0 = null;
        if (dist < PULL) { ptr.classList.add('back'); show(0); return; }
        busy = true;
        ptr.classList.add('spin');
        if (navigator.vibrate) navigator.vibrate(20);
        try { await Promise.race([checkUpdates(false), new Promise((r) => setTimeout(r, 6000))]); } catch {}
        location.reload();
    };
    home.addEventListener('touchend', end);
    home.addEventListener('touchcancel', () => { y0 = null; ptr.classList.add('back'); show(0); });
})();

// ═══════ GESTY JAK NA iPHONIE ═══════
// Przesunięcie od lewej krawędzi w prawo = wstecz (arkusz → poprzedni ekran / zamknij, moduł → start).
// Przeciągnięcie arkusza w dół (gdy jest przewinięty na górę) = zamknij.
(() => {
    const EDGE = 28;   // tyle px od lewej krawędzi musi zacząć się gest „wstecz”
    let g = null;      // { kind: 'back' | 'down', el, x0, y0, t0, d, locked }
    const ease = 'transform .25s cubic-bezier(.2,.8,.3,1), opacity .25s';
    // Szkło (iOS 26) nie nadąża za przeciąganym ekranem — na czas gestu je chowamy (setGlassHold)
    const hold = (on) => { if (typeof setGlassHold === 'function') setGlassHold(on); };
    const target = () => (!$('sheet').hidden ? $('sheet').querySelector('.sheet-card') : activeView ? activeView.view : null);
    // Przy cofaniu z modułu pod spodem widać ekran startowy
    const peekHome = (on) => { if (activeView && $('sheet').hidden) $('home').hidden = !on; };
    const reset = (el) => {
        el.style.transition = ease; el.style.transform = ''; el.style.opacity = '';
        setTimeout(() => { el.style.transition = ''; peekHome(false); hold(false); }, 260);
    };
    const finish = (el, transform, action) => {
        el.style.transition = ease; el.style.transform = transform;
        setTimeout(() => {
            action();
            el.style.transition = ''; el.style.transform = ''; el.style.opacity = '';
            hold(false);
        }, 240);
    };
    const back = () => {
        if (!$('sheet').hidden) return goBack();
        if (activeView) showHome();
    };
    // iOS potrafi nie wysłać końca dotyku (system albo natywna warstwa szkła przejmie palec) — wtedy ekran
    // zostałby przesunięty. Strażnik: brak ruchu przez 0,7 s albo nowy dotyk = koniec gestu.
    let watchdog = 0;
    const arm = () => { clearTimeout(watchdog); watchdog = setTimeout(end, 700); };
    document.addEventListener('touchstart', (e) => {
        if (g && g.locked) end();
        g = null;
        if (e.touches.length > 1 || document.querySelector('.egg-lock') || (window.PitayasEgg && window.PitayasEgg.onClose)) return;
        const t = e.touches[0], el = target();
        if (!el) return;
        if (t.clientX <= EDGE) g = { kind: 'back', el };
        if (g) Object.assign(g, { x0: t.clientX, y0: t.clientY, t0: Date.now(), d: 0, locked: false });
    }, { passive: true });
    document.addEventListener('touchmove', (e) => {
        if (!g) return;
        const t = e.touches[0], dx = t.clientX - g.x0, dy = t.clientY - g.y0;
        if (!g.locked) {
            if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
            // gest musi iść w swoim kierunku, inaczej oddajemy go przewijaniu / suwakom
            const ok = g.kind === 'back' ? dx > 0 && Math.abs(dx) > Math.abs(dy) : dy > 0 && Math.abs(dy) > Math.abs(dx) && $('sheetBody').scrollTop <= 0;
            if (!ok) { g = null; return; }
            g.locked = true;
            hold(true);
            if (g.kind === 'back') peekHome(true);
        }
        if (e.cancelable) e.preventDefault();
        arm();
        g.d = Math.max(0, g.kind === 'back' ? dx : dy);
        g.el.style.transition = 'none';
        g.el.style.transform = g.kind === 'back' ? `translateX(${g.d}px)` : `translateY(${g.d}px)`;
    }, { passive: false });
    function end() {
        clearTimeout(watchdog);
        if (!g) return;
        const { kind, el, d, t0, locked } = g;
        g = null;
        if (!locked) return;
        const size = kind === 'back' ? innerWidth : el.offsetHeight;
        const fast = d / Math.max(1, Date.now() - t0) > 0.6;   // szybki ruch wystarczy nawet na krótkim odcinku
        if (d > size * 0.33 || (fast && d > 40)) {
            if (navigator.vibrate) navigator.vibrate(8);
            finish(el, kind === 'back' ? `translateX(${innerWidth}px)` : `translateY(${size}px)`, kind === 'back' ? back : closeSheet);
        } else reset(el);
    }
    document.addEventListener('touchend', (e) => { if (!e.touches.length) end(); });
    document.addEventListener('touchcancel', () => { clearTimeout(watchdog); if (g && g.locked) reset(g.el); g = null; });
})();

// ═══════ PRZYCISK „WSTECZ” (Android) I PRACA W TLE ═══════
if (Plugins.App) {
    Plugins.App.addListener('backButton', () => {
        const lock = document.querySelector('.egg-lock');
        if (lock) return lock.remove();
        if (window.PitayasEgg && window.PitayasEgg.onClose) return window.PitayasEgg.onClose();
        if (!$('sheet').hidden) return sheetBack ? sheetBack() : closeSheet();
        if (activeView) return showHome();
        Plugins.App.minimizeApp();
    });
    Plugins.App.addListener('appStateChange', ({ isActive }) => {
        if (!isActive && activeView && defs[activeView.id] && defs[activeView.id].pause) defs[activeView.id].pause();
        if (isActive && activeView && defs[activeView.id] && defs[activeView.id].resume) defs[activeView.id].resume();
        if (isActive && !activeView) { refreshStatus(); checkUpdates(false); refreshAccess(); }
        if (isActive) refreshNotifs();
    });
}

// ═══════ START ═══════
renderHome();
window.PITAYAS_CORE_OK = true;   // powłoka wie, że rdzeń się uruchomił
Promise.all(Object.values(installed).map(injectModule)).then(renderTiles);
setInterval(() => { if (!activeView && document.visibilityState === 'visible') refreshStatus(); }, 5000);
(Plugins.App && NATIVE ? Plugins.App.getInfo().then((i) => { shellVersion = i.version; }).catch(() => {}) : Promise.resolve())
    .then(loadBundled)
    .then(() => { applyScreenMode(); refreshAccess(); askNotifyPermission().finally(refreshNotifs); setInterval(refreshNotifs, 5 * 60 * 1000); return checkUpdates(false); })
    .then(() => {
        if (!Object.keys(installed).length) openModules();
        else if (!pcs.list.length) editPc(null);
    });
})();

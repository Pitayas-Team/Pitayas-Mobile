#!/usr/bin/env node
// ═══════ KANAŁ AKTUALIZACJI ═══════
// Składa folder updates/ z rdzenia (www/core) i modułów (modules/<id>), który telefon pobiera z GitHuba:
//   updates/manifest.json                     wersje + listy plików
//   updates/core/<wersja>/app.js …            rdzeń
//   updates/modules/<id>/<wersja>/module.js … moduły
// Po zmianie rdzenia albo modułu: podbij wersję w core.json / module.json, uruchom `npm run channel`
// i wypchnij repozytorium — telefony pobiorą zmiany same, bez nowego APK/IPA.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'updates');
const REPO = 'Pitayas-Team/Pitayas-Mobile';
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

function copyVersion(srcDir, files, dest) {
    fs.rmSync(path.dirname(dest), { recursive: true, force: true });   // zostaje tylko bieżąca wersja
    fs.mkdirSync(dest, { recursive: true });
    for (const f of files) {
        const src = path.join(srcDir, f);
        if (!fs.existsSync(src)) throw new Error(`Brak pliku ${path.relative(ROOT, src)}`);
        fs.copyFileSync(src, path.join(dest, f));
    }
}

const pkg = read('package.json');
const shellVersion = pkg.version.split('-')[0];

const core = read('www/core/core.json');
const coreJs = fs.readFileSync(path.join(ROOT, 'www/core/app.js'), 'utf8');
const coreConst = (coreJs.match(/const CORE_VERSION = '([^']+)'/) || [])[1];
if (coreConst !== core.version) {
    console.error(`Wersja rdzenia się nie zgadza: core.json ${core.version}, app.js ${coreConst}`);
    process.exit(1);
}
copyVersion(path.join(ROOT, 'www/core'), core.files, path.join(OUT, 'core', core.version));

const modules = [];
for (const id of fs.readdirSync(path.join(ROOT, 'modules')).sort()) {
    const dir = path.join(ROOT, 'modules', id);
    if (!fs.existsSync(path.join(dir, 'module.json'))) continue;
    const m = read(`modules/${id}/module.json`);
    if (m.id !== id) throw new Error(`modules/${id}/module.json ma id „${m.id}”`);
    // Pliki wspólne z aplikacją na komputer (np. rysowanie widżetów z Pitaya Deck) — kopiujemy świeże, jeśli jest obok
    for (const [file, from] of Object.entries(m.copyFrom || {})) {
        const src = path.join(dir, from);
        if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dir, file));
    }
    delete m.copyFrom;
    copyVersion(dir, m.files, path.join(OUT, 'modules', id, m.version));
    modules.push({ ...m, base: `modules/${id}/${m.version}/` });
}
// Usunięte moduły znikają też z kanału
for (const id of fs.existsSync(path.join(OUT, 'modules')) ? fs.readdirSync(path.join(OUT, 'modules')) : []) {
    if (!modules.some((m) => m.id === id)) fs.rmSync(path.join(OUT, 'modules', id), { recursive: true, force: true });
}

// Kopie w aplikacji (www/): rdzeń jest tam zawsze, moduły w www/modules/<id>/ — działają bez internetu,
// a nowy APK/IPA od razu ma najnowsze wersje. Kanał i tak dostarcza późniejsze poprawki.
const WWW_MODS = path.join(ROOT, 'www', 'modules');
fs.rmSync(WWW_MODS, { recursive: true, force: true });
for (const m of modules) {
    const dest = path.join(WWW_MODS, m.id);
    fs.mkdirSync(dest, { recursive: true });
    for (const f of m.files) fs.copyFileSync(path.join(ROOT, 'modules', m.id, f), path.join(dest, f));
}
fs.writeFileSync(path.join(WWW_MODS, 'index.json'), JSON.stringify({ modules: modules.map((m) => ({ ...m, base: `modules/${m.id}/` })) }, null, 2) + '\n');
const loaderPath = path.join(ROOT, 'www', 'index.html');
fs.writeFileSync(loaderPath, fs.readFileSync(loaderPath, 'utf8').replace(/var BUNDLED = \{ version: '[^']*'/, `var BUNDLED = { version: '${core.version}'`));

const manifest = {
    schema: 1,
    generated: new Date().toISOString(),
    shell: {
        version: shellVersion,
        android: `https://github.com/${REPO}/releases/download/v${pkg.version}/Pitayas-${pkg.version}.apk`,
        ios: `https://github.com/${REPO}/releases/download/v${pkg.version}/Pitayas-${pkg.version}.ipa`,
        page: `https://github.com/${REPO}/releases/latest`,
    },
    core: { version: core.version, label: core.label || core.version, minShell: core.minShell, base: `core/${core.version}/`, files: core.files },
    // Przełączniki zdalne (scripts/flags.json), np. { "glass": false } wyłącza natywne szkło na telefonach
    flags: fs.existsSync(path.join(ROOT, 'scripts/flags.json')) ? read('scripts/flags.json') : {},
    modules,
};
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Kanał gotowy: aplikacja ${shellVersion}, rdzeń ${core.version}, moduły: ${modules.map((m) => `${m.id} ${m.version}`).join(', ')}`);

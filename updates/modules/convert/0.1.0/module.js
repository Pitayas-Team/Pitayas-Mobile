// ═══════ PITAYA CONVERT — MODUŁ ═══════
// Konwersja na telefonie, bez komputera:
//  • zdjęcia (także HEIC z iPhone'a) — przez przeglądarkę (canvas), od razu,
//  • muzyka i filmy — FFmpeg w WebAssembly; silnik (32 MB) pobiera się raz, przy pierwszym użyciu.
// Wynik zapisujesz przez systemowe „Udostępnij” (Zapisz w Plikach / Zdjęciach, wyślij dalej).
(() => {
    const BASE = document.currentScript.src.replace(/[^/]*$/, '');
    const CORE_VER = '0.12.10';
    const CORE_CDN = `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${CORE_VER}/dist/umd/`;
    const CORE_DIR = `pitayas/ffmpeg/${CORE_VER}`;
    const Cap = window.Capacitor;
    const FS = Cap && Cap.isNativePlatform && Cap.isNativePlatform() ? Cap.Plugins.Filesystem : null;

    const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|heic|heif|avif|tiff?|ico|svg)$/i;
    const AUDIO_EXT = /\.(mp3|wav|flac|aac|m4a|ogg|oga|opus|wma|aiff?|amr|ac3)$/i;
    const VIDEO_EXT = /\.(mp4|mkv|avi|mov|webm|flv|ts|m4v|mpe?g|wmv|3gp|m2ts|ogv)$/i;

    const canWebp = (() => { try { const c = document.createElement('canvas'); c.width = c.height = 1; return c.toDataURL('image/webp').startsWith('data:image/webp'); } catch { return false; } })();

    // Formaty wyjściowe: [id, etykieta, rozszerzenie, mime]
    const OUT = {
        image: [['jpg', 'JPG', 'jpg', 'image/jpeg'], ['png', 'PNG', 'png', 'image/png'], ...(canWebp ? [['webp', 'WEBP', 'webp', 'image/webp']] : [])],
        audio: [['mp3', 'MP3', 'mp3', 'audio/mpeg'], ['m4a', 'M4A', 'm4a', 'audio/mp4'], ['ogg', 'OGG', 'ogg', 'audio/ogg'], ['opus', 'OPUS', 'opus', 'audio/ogg'], ['flac', 'FLAC', 'flac', 'audio/flac'], ['wav', 'WAV', 'wav', 'audio/wav']],
        video: [['mp4', 'MP4', 'mp4', 'video/mp4'], ['mov', 'MOV', 'mov', 'video/quicktime'], ['webm', 'WEBM', 'webm', 'video/webm'], ['gif', 'GIF', 'gif', 'image/gif'], ['mp3', 'MP3 (dźwięk)', 'mp3', 'audio/mpeg'], ['m4a', 'M4A (dźwięk)', 'm4a', 'audio/mp4']],
    };
    const QUALITY = {
        image: [['high', 'Wysoka', 0.92], ['mid', 'Zbalansowana', 0.8], ['low', 'Mały plik', 0.6]],
        audio: [['high', 'Wysoka', '256k'], ['mid', 'Zbalansowana', '192k'], ['low', 'Mały plik', '96k']],
        video: [['high', 'Wysoka', 20], ['mid', 'Zbalansowana', 26], ['low', 'Mały plik', 31], ['copy', 'Bez kodowania', null]],
    };
    const SIZES = [[0, 'Oryginał'], [3840, '4K'], [1920, '1920'], [1280, '1280'], [800, '800']];

    let el = null, api = null;
    let file = null, kind = null, out = null, quality = 'mid', maxSize = 0;
    let result = null;        // { blob, name, mime }
    let ffmpeg = null, ffmpegLoading = null, busy = false, cancelled = false;
    const $ = (sel) => el.querySelector(sel);
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
    const mb = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
    const stem = (name) => name.replace(/\.[^.]+$/, '') || 'plik';

    function kindOf(f) {
        const t = f.type || '';
        if (t.startsWith('image/') || IMAGE_EXT.test(f.name)) return 'image';
        if (t.startsWith('audio/') || AUDIO_EXT.test(f.name)) return 'audio';
        if (t.startsWith('video/') || VIDEO_EXT.test(f.name)) return 'video';
        return null;
    }

    // ───── Wygląd ─────
    function render() {
        if (!el) return;
        if (!file) {
            el.innerHTML = `
                <button class="cv-pick" data-pick>
                  <svg viewBox="0 0 24 24"><path d="M12 16V4M7 9l5-5 5 5M5 20h14"/></svg>
                  <b>Wybierz plik</b>
                  <small>Zdjęcie, muzyka albo film — z galerii lub Plików</small>
                </button>
                <p class="hint">Wszystko dzieje się na telefonie, plik nigdzie nie jest wysyłany. Zdjęcia konwertują się od razu; dla muzyki i filmów przy pierwszym użyciu pobierze się silnik FFmpeg (32 MB).</p>
                <input type="file" class="cv-input" accept="image/*,audio/*,video/*" hidden>`;
            bindPick();
            return;
        }
        const outs = OUT[kind];
        const quals = QUALITY[kind].filter(([q]) => q !== 'copy' || ['mp4', 'mov'].includes(out));
        if (!quals.some(([q]) => q === quality)) quality = 'mid';
        el.innerHTML = `
            <div class="cv-file">
              <div class="cv-kind">${kind === 'image' ? '🖼️' : kind === 'audio' ? '🎵' : '🎬'}</div>
              <div class="pc-text"><b>${esc(file.name)}</b><small>${mb(file.size)}${file.type ? ` · ${esc(file.type)}` : ''}</small></div>
              <button class="bar-btn small" data-pick title="Inny plik"><svg viewBox="0 0 24 24"><path d="M4 4v6h6M20 20v-6h-6M5 15a7 7 0 0 0 12 3M19 9A7 7 0 0 0 7 6"/></svg></button>
            </div>
            <input type="file" class="cv-input" accept="image/*,audio/*,video/*" hidden>
            <div class="panel">
              <div><label>Format</label><div class="cv-chips">${outs.map(([id, l]) => `<button class="cv-chip ${out === id ? 'on' : ''}" data-out="${id}">${l}</button>`).join('')}</div></div>
              ${out === 'png' ? '' : `<div><label>Jakość</label><div class="cv-chips">${quals.map(([id, l]) => `<button class="cv-chip ${quality === id ? 'on' : ''}" data-q="${id}">${l}</button>`).join('')}</div></div>`}
              ${kind === 'image' ? `<div><label>Największy bok</label><div class="cv-chips">${SIZES.map(([v, l]) => `<button class="cv-chip ${maxSize === v ? 'on' : ''}" data-size="${v}">${l}</button>`).join('')}</div></div>` : ''}
              <button class="btn" data-go ${busy ? 'disabled' : ''}>Konwertuj</button>
              <div class="cv-progress" hidden><div class="cv-bar"><i></i></div><div class="cv-pstat"><span class="cv-ptext"></span><button class="cv-cancel" data-cancel>Anuluj</button></div></div>
            </div>
            <div class="cv-result" hidden></div>`;
        bindPick();
        el.querySelectorAll('[data-out]').forEach((b) => (b.onclick = () => { out = b.dataset.out; result = null; render(); }));
        el.querySelectorAll('[data-q]').forEach((b) => (b.onclick = () => { quality = b.dataset.q; render(); }));
        el.querySelectorAll('[data-size]').forEach((b) => (b.onclick = () => { maxSize = Number(b.dataset.size); render(); }));
        $('[data-go]').onclick = convert;
        $('[data-cancel]').onclick = cancel;
        if (result) showResult();
    }

    function bindPick() {
        const input = $('.cv-input');
        el.querySelectorAll('[data-pick]').forEach((b) => (b.onclick = () => { if (!busy) input.click(); }));
        input.onchange = () => {
            const f = input.files && input.files[0];
            if (!f) return;
            const k = kindOf(f);
            if (!k) return api.toast('Tego pliku nie umiem przekonwertować', 'err');
            file = f; kind = k; result = null;
            out = OUT[k][0][0];
            quality = 'mid';
            if (k === 'video' && f.size > 400 * 1048576) api.toast('Duży film — konwersja na telefonie może trwać długo', 'err');
            render();
        };
    }

    function progress(frac, text) {
        if (!el) return;
        const p = $('.cv-progress');
        if (!p) return;
        p.hidden = frac == null;
        if (frac == null) return;
        $('.cv-bar i').style.width = `${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%`;
        $('.cv-ptext').textContent = text;
    }

    // ───── Zdjęcia: canvas ─────
    async function convertImage() {
        const [, , ext, mime] = OUT.image.find(([id]) => id === out);
        const q = QUALITY.image.find(([id]) => id === quality)[2];
        const url = URL.createObjectURL(file);
        try {
            const img = await new Promise((resolve, reject) => {
                const i = new Image();
                i.onload = () => resolve(i);
                i.onerror = () => reject(new Error('Telefon nie umie otworzyć tego zdjęcia'));
                i.src = url;
            });
            let w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
            if (!w || !h) throw new Error('Puste zdjęcie');
            if (maxSize && Math.max(w, h) > maxSize) {
                const s = maxSize / Math.max(w, h);
                w = Math.round(w * s); h = Math.round(h * s);
            }
            const c = document.createElement('canvas');
            c.width = w; c.height = h;
            const ctx = c.getContext('2d');
            if (out === 'jpg') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h); }   // JPG nie ma przezroczystości
            ctx.drawImage(img, 0, 0, w, h);
            const blob = await new Promise((resolve) => c.toBlob(resolve, mime, q));
            if (!blob) throw new Error('Nie udało się zapisać zdjęcia');
            return { blob, name: `${stem(file.name)}_pitaya.${ext}`, mime, info: `${w}×${h}` };
        } finally {
            URL.revokeObjectURL(url);
        }
    }

    // ───── Muzyka i filmy: FFmpeg ─────
    function toBase64(bytes) {
        let bin = '';
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        return btoa(bin);
    }

    // Duże pliki zapisujemy kawałkami (wielokrotność 3 bajtów, żeby base64 sklejało się bez dziur)
    async function writeChunks(directory, path, bytes) {
        const CH = 3 * 1024 * 1024;
        for (let i = 0; i < bytes.length; i += CH) {
            const data = toBase64(bytes.subarray(i, i + CH));
            if (i === 0) await FS.writeFile({ directory, path, data, recursive: true });
            else await FS.appendFile({ directory, path, data });
        }
        if (!bytes.length) await FS.writeFile({ directory, path, data: '', recursive: true });
    }

    async function download(url, onProgress, expected) {
        const r = await fetch(url);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        // content-length bywa rozmiarem po kompresji — wtedy liczymy procent od znanego rozmiaru pliku
        const total = Math.max(Number(r.headers.get('content-length')) || 0, expected || 0);
        if (!r.body || !r.body.getReader) return new Uint8Array(await r.arrayBuffer());
        const reader = r.body.getReader();
        const parts = [];
        let got = 0;
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            parts.push(value);
            got += value.length;
            if (total) onProgress(Math.min(1, got / total));
        }
        const all = new Uint8Array(got);
        let o = 0;
        for (const p of parts) { all.set(p, o); o += p.length; }
        return all;
    }

    // Silnik w pamięci telefonu (pobrany raz); w przeglądarce prosto z sieci
    async function coreBlobUrl(name, mime, onProgress, expected) {
        if (FS) {
            const path = `${CORE_DIR}/${name}`;
            let have = false;
            try { have = (await FS.stat({ directory: 'DATA', path })).size > 0; } catch {}
            if (!have) {
                const bytes = await download(CORE_CDN + name, onProgress, expected);
                await writeChunks('DATA', `${path}.part`, bytes);
                await FS.rename({ directory: 'DATA', from: `${path}.part`, to: path });
            }
            const uri = (await FS.getUri({ directory: 'DATA', path })).uri;
            const blob = await (await fetch(Cap.convertFileSrc(uri))).blob();
            return URL.createObjectURL(new Blob([blob], { type: mime }));
        }
        return URL.createObjectURL(new Blob([await download(CORE_CDN + name, onProgress, expected)], { type: mime }));
    }

    function loadScript(src) {
        return new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = src; s.dataset.module = 'convert';
            s.onload = resolve;
            s.onerror = () => reject(new Error(`Brak pliku ${src.split('/').pop()}`));
            document.body.appendChild(s);
        });
    }

    async function loadFFmpeg() {
        if (ffmpeg && ffmpeg.loaded) return ffmpeg;
        if (ffmpegLoading) return ffmpegLoading;
        ffmpegLoading = (async () => {
            if (!window.FFmpegWASM) await loadScript(`${BASE}ffmpeg.js`);
            progress(0, 'Przygotowanie silnika FFmpeg…');
            const coreURL = await coreBlobUrl('ffmpeg-core.js', 'text/javascript', () => {});
            const wasmURL = await coreBlobUrl('ffmpeg-core.wasm', 'application/wasm',
                (f) => progress(f, `Pobieranie silnika FFmpeg (jednorazowo) · ${Math.round(f * 100)}%`), 32232419);
            const ff = new FFmpegWASM.FFmpeg();
            // Bez classWorkerURL: z nim FFmpeg tworzy wątek typu „module”, który nie wczyta silnika UMD.
            // ffmpeg.js sam znajdzie 814.ffmpeg.js obok siebie (folder modułu).
            await ff.load({ coreURL, wasmURL });
            ffmpeg = ff;
            return ff;
        })();
        try { return await ffmpegLoading; } finally { ffmpegLoading = null; }
    }

    function ffArgs(input, output) {
        const q = QUALITY[kind].find(([id]) => id === quality);
        const v = q && q[2];
        const a = ['-hide_banner', '-i', input];
        if (kind === 'audio' || out === 'mp3' || out === 'm4a') {
            a.push('-vn');
            const br = kind === 'audio' ? v : '192k';
            if (out === 'mp3') a.push('-c:a', 'libmp3lame', '-b:a', br);
            else if (out === 'm4a') a.push('-c:a', 'aac', '-b:a', br);
            else if (out === 'ogg') a.push('-c:a', 'libvorbis', '-b:a', br);
            else if (out === 'opus') a.push('-c:a', 'libopus', '-b:a', br);
            else if (out === 'flac') a.push('-c:a', 'flac');
            else if (out === 'wav') a.push('-c:a', 'pcm_s16le');
        } else if (out === 'gif') {
            a.push('-vf', 'fps=12,scale=480:-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer', '-loop', '0');
        } else if (quality === 'copy') {
            a.push('-c', 'copy', '-map', '0');
        } else {
            const scale = quality === 'low' ? ['-vf', "scale='min(1280,iw)':-2"] : [];
            // WEBM: VP8 — VP9 w tej wersji FFmpeg (WebAssembly) wysypuje się błędem pamięci
            if (out === 'webm') {
                const vp8 = { high: ['6', '8M'], mid: ['12', '4M'], low: ['20', '1500k'] }[quality];
                a.push(...scale, '-c:v', 'libvpx', '-crf', vp8[0], '-b:v', vp8[1], '-deadline', 'realtime', '-cpu-used', '8', '-c:a', 'libvorbis', '-b:a', '128k');
            }
            else a.push(...scale, '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', String(v), '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart');
        }
        a.push(output);
        return a;
    }

    async function convertMedia() {
        const ff = await loadFFmpeg();
        const [, , ext, mime] = OUT[kind].find(([id]) => id === out);
        const inName = `in_${Date.now()}${(file.name.match(/\.[^.]+$/) || ['.bin'])[0].toLowerCase()}`;
        const outName = `out_${Date.now()}.${ext}`;
        progress(0, 'Wczytywanie pliku…');
        await ff.writeFile(inName, new Uint8Array(await file.arrayBuffer()));
        const started = Date.now();
        const onProgress = ({ progress: p }) => {
            if (!(p > 0 && p <= 1)) return;
            const left = ((Date.now() - started) / p) * (1 - p) / 1000;
            progress(p, `Konwersja · ${Math.round(p * 100)}%${p > 0.03 ? ` · zostało ok. ${left > 90 ? `${Math.round(left / 60)} min` : `${Math.round(left)} s`}` : ''}`);
        };
        ff.on('progress', onProgress);
        try {
            progress(0, 'Konwersja…');
            let code;
            try { code = await ff.exec(ffArgs(inName, outName)); } catch (err) {
                // Silnik po awarii jest bezużyteczny — następna konwersja załaduje go od nowa
                try { ff.terminate(); } catch {}
                if (ffmpeg === ff) ffmpeg = null;
                throw new Error(cancelled ? 'Przerwano' : `FFmpeg przerwał pracę (${err && err.message ? err.message : err}) — spróbuj innego formatu albo mniejszej jakości`);
            }
            if (cancelled) throw new Error('Przerwano');
            if (code !== 0) throw new Error(quality === 'copy' ? 'Ten plik trzeba przekodować — wybierz inną jakość' : 'FFmpeg nie dał rady przekonwertować pliku');
            const data = await ff.readFile(outName);
            return { blob: new Blob([data], { type: mime }), name: `${stem(file.name)}_pitaya.${ext}`, mime };
        } finally {
            ff.off('progress', onProgress);
            if (!cancelled && ffmpeg === ff) {
                try { await ff.deleteFile(inName); } catch {}
                try { await ff.deleteFile(outName); } catch {}
            }
        }
    }

    async function convert() {
        if (busy || !file) return;
        busy = true; cancelled = false; result = null;
        $('[data-go]').disabled = true;
        $('.cv-result').hidden = true;
        progress(0, 'Konwersja…');
        try {
            result = kind === 'image' ? await convertImage() : await convertMedia();
            if (!el) return;
            progress(null);
            showResult();
        } catch (err) {
            if (!el) return;
            progress(null);
            api.toast(cancelled ? 'Przerwano konwersję' : `Błąd: ${(err && err.message) || err}`, 'err');
        } finally {
            busy = false;
            if (el && $('[data-go]')) $('[data-go]').disabled = false;
        }
    }

    // Przerwanie = zabicie silnika; następna konwersja załaduje go od nowa (z pamięci telefonu, bez pobierania)
    function cancel() {
        if (!busy) return;
        cancelled = true;
        if (ffmpeg) { try { ffmpeg.terminate(); } catch {} ffmpeg = null; }
    }

    function showResult() {
        const box = $('.cv-result');
        if (!box || !result) return;
        const url = URL.createObjectURL(result.blob);
        if (box.dataset.url) URL.revokeObjectURL(box.dataset.url);
        box.dataset.url = url;
        const preview = result.mime.startsWith('image/') ? `<img src="${url}" alt="">`
            : result.mime.startsWith('video/') ? `<video src="${url}" controls playsinline></video>`
            : `<audio src="${url}" controls></audio>`;
        box.innerHTML = `
            <div class="cv-preview">${preview}</div>
            <div class="cv-sum"><b>${esc(result.name)}</b><small>${mb(file.size)} → ${mb(result.blob.size)}${result.info ? ` · ${result.info}` : ''}</small></div>
            <button class="btn" data-save>Zapisz / udostępnij</button>`;
        box.hidden = false;
        $('[data-save]').onclick = save;
        box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    // Zapis bez nowej wersji aplikacji: moduł sprawdza, co umie powłoka, i wybiera najlepszą drogę
    //  1. wtyczka Udostępnij (nowsze powłoki),  2. udostępnianie z WebView (navigator.share),
    //  3. Android: folder Dokumenty/Pitayas,  4. przeglądarka: zwykłe pobranie.
    async function save() {
        if (!result) return;
        const btn = $('[data-save]');
        const file = new File([result.blob], result.name, { type: result.mime });
        if (!FS) {
            if (navigator.canShare && navigator.canShare({ files: [file] })) return webShare(file);
            const a = document.createElement('a');
            a.href = URL.createObjectURL(result.blob); a.download = result.name;
            document.body.appendChild(a); a.click(); a.remove();
            return;
        }
        btn.disabled = true; btn.textContent = 'Przygotowanie…';
        try {
            if (Cap.isPluginAvailable('Share')) {
                const path = `convert/${result.name}`;
                await writeChunks('CACHE', path, new Uint8Array(await result.blob.arrayBuffer()));
                const { uri } = await FS.getUri({ directory: 'CACHE', path });
                await Cap.Plugins.Share.share({ title: result.name, files: [uri] });
            } else if (navigator.canShare && navigator.canShare({ files: [file] })) {
                await webShare(file);
            } else if (Cap.getPlatform() === 'android') {
                const path = `Pitayas/${result.name}`;
                await writeChunks('DOCUMENTS', path, new Uint8Array(await result.blob.arrayBuffer()));
                api.toast(`Zapisano w Dokumenty/Pitayas/${result.name}`);
            } else {
                api.toast('Ten telefon nie pozwala zapisać pliku z aplikacji', 'err');
            }
        } catch (err) {
            if (!/cancel|abort/i.test(String(err && (err.name || '') + (err.message || err)))) api.toast(`Nie udało się zapisać: ${(err && err.message) || err}`, 'err');
        } finally {
            if (el && $('[data-save]')) { btn.disabled = false; btn.textContent = 'Zapisz / udostępnij'; }
        }
    }

    async function webShare(file) {
        try { await navigator.share({ files: [file], title: file.name }); }
        catch (err) { if (err && err.name !== 'AbortError') throw err; }
    }

    Pitayas.register({
        id: 'convert',

        mount(body, moduleApi) {
            api = moduleApi;
            el = body;
            el.classList.add('cv-mod');
            render();
        },

        unmount() {
            cancel();
            const box = el && el.querySelector('.cv-result');
            if (box && box.dataset.url) URL.revokeObjectURL(box.dataset.url);
            el = null;
            // Plik i wynik zostają w pamięci modułu — po powrocie widać ostatnią konwersję
        },
    });
})();

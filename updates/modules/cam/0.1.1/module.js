// ═══════ PITAYA CAM — MODUŁ ═══════
// Aparat telefonu → klatki JPEG → WebSocket do Pitaya Cam na komputerze (port aplikacji, domyślnie 2139).
(() => {
    let stream = null, ws = null, timer = null, sent = 0, lastStat = Date.now();
    let el = null, api = null;
    const q = (sel) => el.querySelector(sel);

    function awake(on) {
        const k = api && api.Plugins.KeepAwake;
        if (k) (on ? k.keepAwake() : k.allowSleep()).catch(() => {});
    }

    function status(text, tone) {
        const st = q('.status');
        st.textContent = text;
        st.className = `status ${tone || ''}`;
    }

    function stop(message, tone) {
        clearInterval(timer); timer = null;
        if (ws) { ws.onclose = null; ws.close(); ws = null; }
        if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
        awake(false);
        if (!el) return;
        q('video').srcObject = null;
        q('.preview').classList.remove('on');
        const btn = q('.btn');
        btn.textContent = 'Uruchom kamerę'; btn.classList.remove('stop');
        q('.stats').textContent = '';
        status(message || 'Gotowy do połączenia', tone);
    }

    async function start() {
        const pc = api.pc();
        const [w, h] = q('[name=res]').value.split('x').map(Number);
        if (!navigator.mediaDevices) return status('Ten telefon nie udostępnia aparatu aplikacji.', 'err');
        try {
            stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: q('[name=facing]').value, width: { ideal: w }, height: { ideal: h }, frameRate: { ideal: 30 } },
                audio: false,
            });
        } catch (err) {
            stream = null;
            return status(err.name === 'NotAllowedError'
                ? 'Brak zgody na aparat — zezwól w Ustawieniach telefonu → Pitayas → Aparat.'
                : `Nie można uruchomić aparatu: ${err.message}`, 'err');
        }
        if (!el) return stop();   // ekran zamknięty, zanim aparat wystartował
        q('video').srcObject = stream;
        const btn = q('.btn');
        btn.textContent = 'Zatrzymaj'; btn.classList.add('stop');
        status(`Łączenie z ${pc.name || pc.host}…`, 'warn');
        awake(true);
        ws = new WebSocket(api.url('/', 'ws'));
        ws.binaryType = 'arraybuffer';
        ws.onopen = () => {
            status('Przesyłanie obrazu do Pitaya Cam', 'ok');
            q('.preview').classList.add('on');
            timer = setInterval(sendFrame, 1000 / 30);
        };
        ws.onclose = () => stop('Rozłączono z komputerem — sprawdź, czy Pitaya Cam działa i czy telefon jest w tej samej sieci.', 'err');
    }

    function sendFrame() {
        const video = q('video'), canvas = q('canvas');
        if (!ws || ws.readyState !== WebSocket.OPEN || video.readyState < 2) return;
        // Nie dokładamy klatek, gdy poprzednie jeszcze nie wyszły — inaczej rośnie opóźnienie
        if (ws.bufferedAmount > 512 * 1024) return;
        if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
            canvas.width = video.videoWidth; canvas.height = video.videoHeight;
        }
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
            if (blob && ws && ws.readyState === WebSocket.OPEN) blob.arrayBuffer().then((buf) => { ws.send(buf); sent++; });
        }, 'image/jpeg', 0.85);
        const now = Date.now();
        if (now - lastStat > 1000) {
            q('.stats').textContent = `${canvas.width}×${canvas.height} · ${Math.round(sent * 1000 / (now - lastStat))} kl/s`;
            sent = 0; lastStat = now;
        }
    }

    const restart = () => { if (stream) { stop(); start(); } };

    Pitayas.register({
        id: 'cam',

        probe: (api) => api.probe(api.url('/info'), true),

        mount(body, moduleApi, barSlot) {
            api = moduleApi;
            el = body;
            el.classList.add('cam-mod');
            el.innerHTML = `
                <div class="preview">
                  <video autoplay playsinline muted></video>
                  <div class="live"><i></i>NA ŻYWO</div>
                </div>
                <div class="panel">
                  <div class="row">
                    <div><label>Aparat</label>
                      <select name="facing"><option value="environment">Tylny</option><option value="user">Przedni</option></select></div>
                    <div><label>Jakość</label>
                      <select name="res"><option value="1920x1080">1080p</option><option value="1280x720">720p</option><option value="854x480">480p</option></select></div>
                  </div>
                  <button class="btn">Uruchom kamerę</button>
                  <div class="status">Gotowy do połączenia</div>
                  <div class="stats"></div>
                </div>
                <canvas hidden></canvas>`;
            barSlot.innerHTML = '<button class="bar-btn" id="camFlip" data-glass="arrow.triangle.2.circlepath.camera" title="Zmień aparat"><svg viewBox="0 0 24 24"><path d="M4 9a8 8 0 0 1 14-3l2 2M20 15a8 8 0 0 1-14 3l-2-2"/><path d="M20 4v4h-4M4 20v-4h4"/></svg></button>';
            barSlot.firstElementChild.onclick = () => {
                const f = q('[name=facing]');
                f.value = f.value === 'user' ? 'environment' : 'user';
                restart();
            };
            q('.btn').onclick = () => (stream ? stop() : start());
            q('[name=facing]').onchange = restart;
            q('[name=res]').onchange = restart;
        },

        // System i tak odbiera aparat aplikacji w tle — zatrzymujemy porządnie zamiast zawiesić obraz
        pause() { if (stream) stop('Aplikacja w tle — kamera zatrzymana'); },

        unmount() { stop(); el = null; },
    });
})();

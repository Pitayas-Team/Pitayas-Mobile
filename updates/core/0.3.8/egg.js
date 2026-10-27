// ═══════ PITAYA LAB — EASTER EGG ═══════
// 5× dotknięcie logo na ekranie startowym → hasło → panel, w którym kroisz pitaję palcem.
// Wczytywany dopiero wtedy (rdzeń dokłada ten plik na żądanie), więc nie spowalnia startu.
// Hasło trzymamy jako skrót SHA‑256, nie otwartym tekstem.
(() => {
    const HASH = '7585c5623c7320e7e913e1c5b7eb2a0b6bb5ffe98a565f8aa5977ef692a1f19b';
    const MAX_PIECES = 48;

    // ───── SHA-256 (crypto.subtle, a gdy WebView go nie daje — prosta wersja w JS) ─────
    async function sha256(text) {
        const data = new TextEncoder().encode(text);
        if (window.crypto && crypto.subtle) {
            try {
                const buf = await crypto.subtle.digest('SHA-256', data);
                return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
            } catch {}
        }
        return sha256js(data);
    }
    function sha256js(bytes) {
        const K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
        const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
        const len = bytes.length;
        const padded = new Uint8Array(((len + 9 + 63) >> 6) << 6);
        padded.set(bytes);
        padded[len] = 0x80;
        new DataView(padded.buffer).setUint32(padded.length - 4, len * 8);
        const w = new Uint32Array(64);
        const rotr = (x, n) => (x >>> n) | (x << (32 - n));
        for (let o = 0; o < padded.length; o += 64) {
            const dv = new DataView(padded.buffer, o, 64);
            for (let i = 0; i < 16; i++) w[i] = dv.getUint32(i * 4);
            for (let i = 16; i < 64; i++) {
                const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
                const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
                w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
            }
            let [a, b, c, d, e, f, g, h] = H;
            for (let i = 0; i < 64; i++) {
                const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
                const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
                h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
            }
            [a, b, c, d, e, f, g, h].forEach((v, i) => { H[i] = (H[i] + v) | 0; });
        }
        return H.map((v) => (v >>> 0).toString(16).padStart(8, '0')).join('');
    }

    // ───── Okno hasła ─────
    function askPassword() {
        const box = document.createElement('div');
        box.className = 'egg-lock';
        box.innerHTML = `
            <form class="egg-lock-card">
              <div class="egg-lock-icon">🔒</div>
              <b>Tajne laboratorium</b>
              <input type="password" placeholder="Hasło" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false">
              <div class="row"><button type="button" class="btn ghost" data-cancel>Anuluj</button><button type="submit" class="btn">Otwórz</button></div>
            </form>`;
        document.body.appendChild(box);
        const input = box.querySelector('input');
        setTimeout(() => input.focus(), 150);
        const close = () => box.remove();
        box.querySelector('[data-cancel]').onclick = close;
        box.onclick = (e) => { if (e.target === box) close(); };
        box.querySelector('form').onsubmit = async (e) => {
            e.preventDefault();
            if ((await sha256(input.value)) === HASH) { close(); openLab(); return; }
            const card = box.querySelector('.egg-lock-card');
            card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake');
            if (navigator.vibrate) navigator.vibrate([30, 40, 30]);
            input.value = '';
        };
    }

    // ───── Panel krojenia ─────
    function openLab() {
        const lab = document.createElement('div');
        lab.className = 'egg-lab';
        lab.innerHTML = `
            <header class="egg-bar">
              <button class="bar-btn" data-close title="Zamknij"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
              <div class="egg-title">Pitaya <span>Lab</span></div>
              <span class="egg-count">1 kawałek</span>
            </header>
            <canvas></canvas>
            <p class="egg-hint">Przeciągnij palcem przez pitaję, żeby ją pokroić</p>
            <footer class="egg-tools">
              <button class="chip" data-auto>🔪 Pokrój</button>
              <button class="chip ghost" data-flesh>Miąższ: biały</button>
              <button class="chip ghost" data-reset>Złóż z powrotem</button>
            </footer>`;
        document.body.appendChild(lab);
        const canvas = lab.querySelector('canvas');
        const ctx = canvas.getContext('2d');
        const dpr = Math.min(window.devicePixelRatio || 1, 3);

        let W = 0, H = 0, cx = 0, cy = 0, rx = 0, ry = 0;
        let pieces = [], drops = [], trails = [], cut = false, red = false;
        let skinTex = null, fleshTex = null, scales = [];
        let raf = 0, last = performance.now(), assembling = null, autoTimers = [];

        // Ziarenko losowości stałe — pestki i łuski zawsze w tych samych miejscach
        let seed = 7;
        const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

        function ellipse(n = 96) {
            const pts = [];
            for (let i = 0; i < n; i++) {
                const t = (i / n) * Math.PI * 2;
                // lekko jajowaty kształt: szerszy dół
                const k = 1 + 0.06 * Math.sin(t);
                pts.push([rx * Math.cos(t) * k, ry * Math.sin(t)]);
            }
            return pts;
        }

        function makeTextures() {
            const tw = Math.ceil(rx * 2.3 * dpr), th = Math.ceil(ry * 2.2 * dpr);
            // Skórka
            skinTex = document.createElement('canvas');
            skinTex.width = tw; skinTex.height = th;
            let g = skinTex.getContext('2d');
            g.scale(dpr, dpr); g.translate(tw / dpr / 2, th / dpr / 2);
            let grad = g.createRadialGradient(-rx * 0.35, -ry * 0.4, rx * 0.1, 0, 0, ry * 1.1);
            grad.addColorStop(0, '#ff8cc6'); grad.addColorStop(0.45, '#f0288f'); grad.addColorStop(1, '#a8005c');
            g.fillStyle = grad;
            path(g, ellipse()); g.fill();
            // Łuski na powierzchni: rzędy szerokich listków skierowanych w górę, z zielonymi końcówkami
            seed = 11;
            const rows = [[-0.62, 2], [-0.3, 3], [0.02, 3], [0.34, 3], [0.64, 2]];
            rows.forEach(([ry0, n], ri) => {
                for (let i = 0; i < n; i++) {
                    const fx = n === 1 ? 0 : (i / (n - 1) - 0.5) * (n === 2 ? 0.9 : 1.2) + (ri % 2 ? 0.12 : -0.08);
                    const y = ry0 * ry + (rnd() - 0.5) * ry * 0.06;
                    const half = Math.sqrt(Math.max(0, 1 - (y / ry) ** 2));
                    const x = fx * rx * half * 0.85;
                    scale(g, x, y + rx * 0.18, (x / rx) * 0.7, rx * (0.36 + rnd() * 0.08), 1, rnd() < 0.5 ? -1 : 1);
                }
            });
            // Miąższ (przekrój): różowa skórka dookoła, w środku biały albo czerwony z pestkami
            fleshTex = document.createElement('canvas');
            fleshTex.width = tw; fleshTex.height = th;
            g = fleshTex.getContext('2d');
            g.scale(dpr, dpr); g.translate(tw / dpr / 2, th / dpr / 2);
            g.fillStyle = '#d4006f'; path(g, ellipse()); g.fill();
            const inner = ellipse().map(([x, y]) => [x * 0.9, y * 0.92]);
            grad = g.createRadialGradient(0, 0, rx * 0.1, 0, 0, ry);
            if (red) { grad.addColorStop(0, '#ff3d8b'); grad.addColorStop(1, '#b0004f'); }
            else { grad.addColorStop(0, '#ffffff'); grad.addColorStop(1, '#f1e8ea'); }
            g.fillStyle = grad; path(g, inner); g.fill();
            g.fillStyle = '#16121a';
            seed = 23;
            for (let i = 0; i < 420; i++) {
                const t = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 0.84;
                g.beginPath();
                g.ellipse(Math.cos(t) * rx * r, Math.sin(t) * ry * r, rx * 0.012 + rnd() * rx * 0.006, rx * 0.009, rnd() * Math.PI, 0, Math.PI * 2);
                g.fill();
            }
            // Łuski na brzegu i liście na górze (tylko cała pitaja)
            seed = 5;
            scales = [];
            for (let i = 0; i < 12; i++) {
                const t = (i / 12) * Math.PI * 2 + Math.PI / 12 + (rnd() - 0.5) * 0.25;
                if (Math.sin(t) < -0.8) continue;   // góra ma koronę z liści
                scales.push({ t, len: rx * (0.34 + rnd() * 0.1), bend: Math.cos(t) > 0 ? 1 : -1 });
            }
        }

        // Łuska pitai: szeroki listek, końcówka lekko wygięta w bok (bend = -1 / 1) i zielona
        function scale(g, x, y, ang, len, alpha = 1, bend = 1) {
            g.save();
            g.translate(x, y); g.rotate(ang); g.globalAlpha = alpha;
            const w = len * 0.46, tip = len * 0.22 * bend;
            const grad = g.createLinearGradient(0, 0, tip, -len);
            grad.addColorStop(0, '#d1006f'); grad.addColorStop(0.45, '#ff5fae'); grad.addColorStop(0.68, '#ffb0d6'); grad.addColorStop(0.8, '#a8e6b0'); grad.addColorStop(1, '#3fb37c');
            g.fillStyle = grad;
            g.strokeStyle = 'rgba(110,0,55,0.35)'; g.lineWidth = Math.max(1, len * 0.03);
            g.beginPath();
            g.moveTo(-w, 0);
            g.bezierCurveTo(-w * 0.9, -len * 0.45, tip - len * 0.12, -len * 0.8, tip, -len);
            g.bezierCurveTo(tip + len * 0.05, -len * 0.7, w * 0.8, -len * 0.4, w, 0);
            g.quadraticCurveTo(0, len * 0.12, -w, 0);
            g.closePath(); g.fill(); g.stroke();
            // żyłka środkowa
            g.strokeStyle = 'rgba(255,255,255,0.28)'; g.lineWidth = Math.max(1, len * 0.025);
            g.beginPath(); g.moveTo(0, -len * 0.05); g.quadraticCurveTo(tip * 0.3, -len * 0.5, tip * 0.9, -len * 0.92); g.stroke();
            g.restore();
        }

        function path(g, pts) {
            g.beginPath();
            pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
            g.closePath();
        }

        function reset() {
            pieces = [{ poly: ellipse(), x: 0, y: 0, a: 0, vx: 0, vy: 0, va: 0 }];
            cut = false; drops = []; assembling = null;
            updateCount();
        }

        function resize() {
            const r = canvas.getBoundingClientRect();
            W = r.width; H = r.height;
            canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
            cx = W / 2; cy = H / 2;
            rx = Math.min(W * 0.27, H * 0.21); ry = rx * 1.28;
            makeTextures();
            if (!pieces.length || !cut) reset();
        }

        function updateCount() {
            const n = pieces.length;
            lab.querySelector('.egg-count').textContent = `${n} ${n === 1 ? 'kawałek' : n < 5 ? 'kawałki' : 'kawałków'}`;
        }

        // ───── Krojenie: linia w świecie → linia w układzie kawałka → dwa wielokąty ─────
        function toLocal(p, [px, py]) {
            const dx = px - (cx + p.x), dy = py - (cy + p.y);
            const c = Math.cos(-p.a), s = Math.sin(-p.a);
            return [dx * c - dy * s, dx * s + dy * c];
        }
        function splitPoly(poly, a, b) {
            const side = ([x, y]) => (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
            const L = [], R = [];
            for (let i = 0; i < poly.length; i++) {
                const p = poly[i], q = poly[(i + 1) % poly.length];
                const sp = side(p), sq = side(q);
                if (sp >= 0) L.push(p); else R.push(p);
                if ((sp >= 0) !== (sq >= 0)) {
                    const t = sp / (sp - sq);
                    const m = [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
                    L.push(m); R.push(m);
                }
            }
            return [L, R];
        }
        const area = (poly) => Math.abs(poly.reduce((s, [x, y], i) => { const [x2, y2] = poly[(i + 1) % poly.length]; return s + x * y2 - x2 * y; }, 0) / 2);

        function slice(p0, p1) {
            const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
            if (len < 30 || pieces.length >= MAX_PIECES) return false;
            const nx = -(p1[1] - p0[1]) / len, ny = (p1[0] - p0[0]) / len;   // normalna linii cięcia
            const out = [];
            let any = false;
            for (const p of pieces) {
                const [L, R] = splitPoly(p.poly, toLocal(p, p0), toLocal(p, p1));
                const minArea = rx * ry * 0.015;
                if (L.length < 3 || R.length < 3 || area(L) < minArea || area(R) < minArea || out.length >= MAX_PIECES) { out.push(p); continue; }
                any = true;
                const push = 70 + Math.random() * 50;
                out.push({ ...p, poly: L, vx: p.vx + nx * push, vy: p.vy + ny * push, va: p.va + 0.5 + Math.random() * 0.4 });
                out.push({ ...p, poly: R, vx: p.vx - nx * push, vy: p.vy - ny * push, va: p.va - 0.5 - Math.random() * 0.4 });
            }
            if (!any) return false;
            pieces = out;
            cut = true;
            juice(p0, p1);
            if (navigator.vibrate) navigator.vibrate(18);
            updateCount();
            return true;
        }

        // Krople soku wzdłuż cięcia (tylko tam, gdzie linia przechodzi przez owoc)
        function juice(p0, p1) {
            for (let i = 0; i < 26; i++) {
                const t = Math.random();
                const x = p0[0] + (p1[0] - p0[0]) * t, y = p0[1] + (p1[1] - p0[1]) * t;
                if (((x - cx) / (rx * 1.1)) ** 2 + ((y - cy) / (ry * 1.05)) ** 2 > 1) continue;
                drops.push({ x, y, vx: (Math.random() - 0.5) * 260, vy: -Math.random() * 220, r: 1.5 + Math.random() * 3, life: 1, c: Math.random() < 0.6 ? (red ? '#ff3d8b' : '#ffffff') : '#e6007e' });
            }
        }

        // ───── Klatka animacji ─────
        function frame(now) {
            const dt = Math.min(0.05, (now - last) / 1000);
            last = now;
            const damp = Math.pow(0.06, dt);   // kawałki odjeżdżają i łagodnie się zatrzymują
            if (assembling) {
                const k = Math.min(1, (now - assembling.start) / 650);
                const e = 1 - Math.pow(1 - k, 3);
                pieces.forEach((p, i) => { const s = assembling.from[i]; p.x = s.x * (1 - e); p.y = s.y * (1 - e); p.a = s.a * (1 - e); });
                if (k >= 1) reset();
            } else {
                for (const p of pieces) {
                    p.x += p.vx * dt; p.y += p.vy * dt; p.a += p.va * dt;
                    p.vx *= damp; p.vy *= damp; p.va *= damp;
                    // nie uciekaj za ekran
                    const lim = Math.min(W, H) * 0.42;
                    if (Math.hypot(p.x, p.y) > lim) { p.vx -= p.x * dt * 4; p.vy -= p.y * dt * 4; }
                }
            }
            for (const d of drops) { d.vy += 900 * dt; d.x += d.vx * dt; d.y += d.vy * dt; d.life -= dt * 0.9; }
            drops = drops.filter((d) => d.life > 0 && d.y < H + 20);
            trails.forEach((t) => (t.life -= dt * 2.6));
            trails = trails.filter((t) => t.life > 0);
            draw();
            raf = requestAnimationFrame(frame);
        }

        function draw() {
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, W, H);
            const glow = ctx.createRadialGradient(cx, cy, 10, cx, cy, Math.max(W, H) * 0.6);
            glow.addColorStop(0, 'rgba(255,60,160,0.18)'); glow.addColorStop(1, 'rgba(18,17,22,0)');
            ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);

            const tw = skinTex.width / dpr, th = skinTex.height / dpr;
            if (!cut) {
                // Cała pitaja: łuski na brzegu, liście na górze, skórka
                ctx.save(); ctx.translate(cx, cy);
                ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 30; ctx.shadowOffsetY = 18;
                ctx.fillStyle = '#a8005c'; path(ctx, pieces[0].poly); ctx.fill();
                ctx.shadowColor = 'transparent';
                // Listki na brzegu: odchylone na zewnątrz i w górę
                for (const s of scales) {
                    const x = Math.cos(s.t) * rx * 0.97 * (1 + 0.06 * Math.sin(s.t)), y = Math.sin(s.t) * ry * 0.95;
                    const out = s.t + Math.PI / 2;
                    scale(ctx, x, y, out * 0.72 + (Math.cos(s.t) > 0 ? 0.25 : -0.25), s.len, 1, s.bend);
                }
                // Korona na górze
                for (let i = -3; i <= 3; i++) scale(ctx, i * rx * 0.1, -ry * 0.9, i * 0.32, rx * (0.5 - Math.abs(i) * 0.06), 1, i < 0 ? -1 : 1);
                ctx.drawImage(skinTex, -tw / 2, -th / 2, tw, th);
                ctx.restore();
            } else {
                for (const p of pieces) {
                    ctx.save();
                    ctx.translate(cx + p.x, cy + p.y); ctx.rotate(p.a);
                    ctx.shadowColor = 'rgba(0,0,0,0.4)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 10;
                    ctx.fillStyle = '#d4006f'; path(ctx, p.poly); ctx.fill();
                    ctx.shadowColor = 'transparent';
                    path(ctx, p.poly); ctx.clip();
                    ctx.drawImage(fleshTex, -tw / 2, -th / 2, tw, th);
                    ctx.restore();
                }
            }
            for (const d of drops) {
                ctx.globalAlpha = Math.max(0, d.life);
                ctx.fillStyle = d.c;
                ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2); ctx.fill();
            }
            ctx.globalAlpha = 1;
            // Ślad noża
            for (const t of trails) {
                ctx.globalAlpha = Math.max(0, t.life);
                ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3; ctx.lineCap = 'round';
                ctx.shadowColor = '#ff4fa6'; ctx.shadowBlur = 16;
                ctx.beginPath(); ctx.moveTo(t.a[0], t.a[1]); ctx.lineTo(t.b[0], t.b[1]); ctx.stroke();
                ctx.shadowBlur = 0;
            }
            ctx.globalAlpha = 1;
            if (drag) {
                ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 2; ctx.setLineDash([6, 6]);
                ctx.beginPath(); ctx.moveTo(drag.a[0], drag.a[1]); ctx.lineTo(drag.b[0], drag.b[1]); ctx.stroke();
                ctx.setLineDash([]);
            }
        }

        // ───── Palec: przeciągnięcie = cięcie ─────
        let drag = null;
        const pt = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
        canvas.addEventListener('pointerdown', (e) => {
            if (assembling) return;
            drag = { a: pt(e), b: pt(e) };
            try { canvas.setPointerCapture(e.pointerId); } catch {}
        });
        canvas.addEventListener('pointermove', (e) => { if (drag) drag.b = pt(e); });
        const end = () => {
            if (!drag) return;
            const { a, b } = drag;
            drag = null;
            // Linię wydłużamy, żeby krótkie machnięcie przez środek przecięło całość
            const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy);
            if (l < 30) return;
            const ext = Math.max(W, H);
            const a2 = [a[0] - (dx / l) * ext, a[1] - (dy / l) * ext], b2 = [b[0] + (dx / l) * ext, b[1] + (dy / l) * ext];
            trails.push({ a, b, life: 1 });
            if (slice(a2, b2)) lab.querySelector('.egg-hint').classList.add('gone');
        };
        canvas.addEventListener('pointerup', end);
        canvas.addEventListener('pointercancel', () => { drag = null; });

        // ───── Przyciski ─────
        function autoSlice() {
            autoTimers.forEach(clearTimeout);
            autoTimers = [];
            if (assembling) return;
            const cuts = pieces.length >= MAX_PIECES ? 0 : 3;
            for (let i = 0; i < cuts; i++) {
                autoTimers.push(setTimeout(() => {
                    const ang = Math.random() * Math.PI;
                    const off = (Math.random() - 0.5) * rx * 0.6;
                    const dx = Math.cos(ang), dy = Math.sin(ang);
                    const ox = cx - dy * off, oy = cy + dx * off, L = Math.max(W, H);
                    const a = [ox - dx * rx * 1.6, oy - dy * ry * 1.4], b = [ox + dx * rx * 1.6, oy + dy * ry * 1.4];
                    trails.push({ a, b, life: 1 });
                    slice([ox - dx * L, oy - dy * L], [ox + dx * L, oy + dy * L]);
                    lab.querySelector('.egg-hint').classList.add('gone');
                }, i * 420));
            }
        }
        lab.querySelector('[data-auto]').onclick = autoSlice;
        lab.querySelector('[data-reset]').onclick = () => {
            if (!cut || assembling) return;
            pieces.forEach((p) => { p.vx = p.vy = p.va = 0; });
            assembling = { start: performance.now(), from: pieces.map((p) => ({ x: p.x, y: p.y, a: p.a })) };
        };
        lab.querySelector('[data-flesh]').onclick = (e) => {
            red = !red;
            e.target.textContent = `Miąższ: ${red ? 'czerwony' : 'biały'}`;
            makeTextures();
        };
        const close = () => {
            cancelAnimationFrame(raf);
            autoTimers.forEach(clearTimeout);
            removeEventListener('resize', resize);
            lab.remove();
            if (window.PitayasEgg) window.PitayasEgg.onClose = null;
        };
        lab.querySelector('[data-close]').onclick = close;
        window.PitayasEgg.onClose = close;   // przycisk „wstecz” na Androidzie

        addEventListener('resize', resize);
        resize();
        raf = requestAnimationFrame((t) => { last = t; frame(t); });
    }

    window.PitayasEgg = { start: askPassword, onClose: null };
})();

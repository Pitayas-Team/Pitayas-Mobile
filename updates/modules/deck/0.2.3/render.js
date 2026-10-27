// ═══════ PITAYA DECK — RYSOWANIE WIDŻETÓW ═══════
// Wspólne dla telefonu (client/) i edytora, żeby widżet wyglądał wszędzie tak samo.
// Ikony: Lucide (ISC, shared/lucide.json — serwer dołącza gotowy kształt w icon.svg),
// emoji, własne obrazy oraz starsze proste ikony „glyph” z pierwszej wersji.
(function (global) {
    // Proste ikony z wersji 0.1 — zostają dla zgodności ze starymi przyciskami
    const G = {
        play: '<path d="M8 5v14l11-7z"/>',
        pause: '<path d="M7 5h4v14H7zM13 5h4v14h-4z"/>',
        'play-pause': '<path d="M4 6v12l8-6zM14 6h3v12h-3zM19 6h2v12h-2z"/>',
        next: '<path d="M5 6v12l9-6zM16 6h2.5v12H16z"/>',
        prev: '<path d="M19 6v12l-9-6zM8 6H5.5v12H8z"/>',
        stop: '<path d="M7 7h10v10H7z"/>',
        'volume-up': '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
        'volume-down': '<path d="M5 9h4l5-4v14l-5-4H5z"/><path d="M17 8.5a5 5 0 0 1 0 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
        'volume-off': '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 9l5 6M21 9l-5 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
        mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M6 11a6 6 0 0 0 12 0M12 17v4M9 21h6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
        'mic-off': '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M6 11a6 6 0 0 0 12 0M12 17v4M9 21h6M4 4l16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
        record: '<circle cx="12" cy="12" r="7"/>',
        folder: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H10l2 2h7.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/>',
        chip: '<rect x="7" y="7" width="10" height="10" rx="1.5"/><path d="M9 3v3M12 3v3M15 3v3M9 18v3M12 18v3M15 18v3M3 9h3M3 12h3M3 15h3M18 9h3M18 12h3M18 15h3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
        star: '<path d="M12 3l2.7 5.6 6.1.8-4.4 4.3 1 6.1L12 17l-5.4 2.8 1-6.1-4.4-4.3 6.1-.8z"/>',
    };
    const LABELS = { play: 'Graj', pause: 'Pauza', 'play-pause': 'Graj / pauza', next: 'Następny', prev: 'Poprzedni', stop: 'Stop', 'volume-up': 'Głośniej', 'volume-down': 'Ciszej', 'volume-off': 'Wycisz', mic: 'Mikrofon', 'mic-off': 'Mikrofon wył.', record: 'Nagrywanie', folder: 'Folder', chip: 'Procesor', star: 'Gwiazdka' };

    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const glyph = (name) => (G[name] ? `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${G[name]}</svg>` : '');
    const lucide = (inner) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
    const pad = (n) => String(n).padStart(2, '0');
    const fmtTime = (s) => { s = Math.max(0, Math.round(s || 0)); return `${Math.floor(s / 60)}:${pad(s % 60)}`; };

    // Kontrastowy kolor tekstu, gdy nie podano własnego
    function readable(bg) {
        const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(bg || '');
        if (!m) return '#ffffff';
        const [r, g, b] = m.slice(1).map((h) => parseInt(h, 16) / 255);
        return 0.299 * r + 0.587 * g + 0.114 * b > 0.62 ? '#17161c' : '#ffffff';
    }

    function iconHtml(icon) {
        if (!icon || !icon.type || icon.type === 'none') return '';
        const style = `opacity:${(icon.opacity ?? 100) / 100};${icon.zoom && icon.zoom !== 100 ? `transform:scale(${icon.zoom / 100});` : ''}${icon.color ? `color:${icon.color};` : ''}`;
        if (icon.type === 'lucide' && icon.svg) return `<span class="pd-icon" style="${style}">${lucide(icon.svg)}</span>`;
        if (icon.type === 'glyph') return `<span class="pd-icon" style="${style}">${glyph(icon.value)}</span>`;
        if (icon.type === 'emoji') return `<span class="pd-icon" style="${style}"><span class="pd-emoji">${esc(icon.value)}</span></span>`;
        if (icon.type === 'image' && icon.value) {
            const cover = icon.fill || icon.fit === 'cover';
            return `<span class="pd-icon${cover ? ' fill' : ''}" style="${style}"><img src="${esc(icon.value)}" alt="" draggable="false"></span>`;
        }
        return '';
    }

    // ───── Widżety ─────
    function clockHtml(c) {
        const d = new Date();
        let h = d.getHours();
        const suffix = c.h12 ? (h >= 12 ? ' PM' : ' AM') : '';
        if (c.h12) h = h % 12 || 12;
        const time = `${c.h12 ? h : pad(h)}:${pad(d.getMinutes())}${c.seconds ? `<small>:${pad(d.getSeconds())}</small>` : ''}${suffix}`;
        const date = d.toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' });
        return `<div class="pd-clock">${c.date ? `<div class="pd-clock-date">${esc(date)}</div>` : ''}<div class="pd-clock-time">${time}</div></div>`;
    }
    function gaugeHtml(b) {
        const items = b.gauges || [];
        if (!items.length) return '<div class="pd-gauges empty">Dodaj wskaźnik w edytorze</div>';
        if (b.gaugeStyle === 'bar') {
            return `<div class="pd-gauges bars">${items.map((g) => `<div class="pd-bar"><div class="pd-bar-top"><span>${esc(g.name)}</span><b>${Math.round(g.value)}${esc(g.unit)}</b></div>
                <div class="pd-bar-track"><div class="pd-bar-fill" style="width:${g.pct}%;--hue:${hue(g.pct)}"></div></div></div>`).join('')}</div>`;
        }
        const R = 15.5, C = 2 * Math.PI * R;
        return `<div class="pd-gauges rings n${Math.min(items.length, 4)}">${items.map((g) => `<div class="pd-ring">
            <svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="${R}" class="pd-ring-bg"/><circle cx="18" cy="18" r="${R}" class="pd-ring-fg" style="stroke-dasharray:${(C * g.pct) / 100} ${C};--hue:${hue(g.pct)}"/></svg>
            <div class="pd-ring-text"><b>${Math.round(g.value)}<small>${esc(g.unit)}</small></b><span>${esc(g.name)}</span></div></div>`).join('')}</div>`;
    }
    // Kolor wskaźnika: zielony → żółty → czerwony
    const hue = (pct) => Math.round(140 - Math.min(100, pct) * 1.4);
    function sliderHtml(b) {
        const s = b.slider;
        const pct = s.max > s.min ? ((s.value - s.min) / (s.max - s.min)) * 100 : 0;
        return `<div class="pd-sl ${s.orientation}" data-min="${s.min}" data-max="${s.max}" data-step="${s.step}">
            ${b.label ? `<span class="pd-sl-label">${esc(b.label)}</span>` : ''}
            <div class="pd-sl-track"><div class="pd-sl-fill" style="--pct:${Math.max(0, Math.min(100, pct))}%"></div></div>
            ${s.showValue ? `<span class="pd-sl-value">${Math.round(s.value)}${esc(s.unit)}</span>` : ''}
        </div>`;
    }
    function mediaHtml(b) {
        const m = b.media;
        const pct = m.length > 0 ? Math.min(100, (m.position / m.length) * 100) : 0;
        const icon = (name) => lucide({
            prev: '<path d="M17 18 9 12l8-6z" fill="currentColor"/><path d="M6 6v12"/>',
            next: '<path d="m7 18 8-6-8-6z" fill="currentColor"/><path d="M18 6v12"/>',
            play: '<path d="M8 5.5v13l10-6.5z" fill="currentColor"/>',
            pause: '<rect x="7" y="5" width="3.5" height="14" rx="1" fill="currentColor"/><rect x="13.5" y="5" width="3.5" height="14" rx="1" fill="currentColor"/>',
        }[name]);
        return `<div class="pd-mp${m.art ? ' has-art' : ''}">
            ${m.art ? `<div class="pd-media-bg" style="background-image:url('${esc(m.art)}')"></div><img class="pd-media-art" src="${esc(m.art)}" alt="">` : '<div class="pd-media-art none">♪</div>'}
            <div class="pd-media-info">
              <div class="pd-media-title">${esc(m.title || 'Nic nie gra')}</div>
              <div class="pd-media-artist">${esc([m.artist, m.album].filter(Boolean).join(' · ') || m.player)}</div>
              ${m.timeline && m.length ? `<div class="pd-media-time"><span>${fmtTime(m.position)}</span><div class="pd-media-bar"><div style="width:${pct}%"></div></div><span>${fmtTime(m.length)}</span></div>` : ''}
              <div class="pd-media-ctl">
                <button data-media="previous">${icon('prev')}</button>
                <button data-media="play-pause" class="main">${icon(m.playing ? 'pause' : 'play')}</button>
                <button data-media="next">${icon('next')}</button>
              </div>
            </div>
        </div>`;
    }

    // b = widżet z serwera (renderButton): { type, w, h, label, labelPos, textAlign, icon, bg, color, fontSize, shadow, outline, border, on, … }
    // size = bok jednego pola w px (skalowanie napisów)
    function paint(el, b, size) {
        const type = (b && b.type) || 'button';
        el.className = `pd-btn pd-${type}` + (b ? '' : ' empty') + (b && b.on ? ' on' : '');
        if (b && type === 'media' && (b.w || 1) > (b.h || 1)) el.classList.add('wide');
        if (type !== 'clock') delete el.dataset.clock;
        if (!b) { el.innerHTML = ''; el.style.cssText = el.style.gridColumn ? `grid-column:${el.style.gridColumn};grid-row:${el.style.gridRow}` : ''; return; }
        const scale = (size || 100) / 100;
        el.style.background = b.bg === 'transparent' ? 'transparent' : (b.bg || '#23222a');
        el.style.color = b.color || readable(b.bg);
        el.style.setProperty('--pd-font', `${Math.round((b.fontSize || 14) * scale)}px`);
        el.style.setProperty('--pd-scale', scale);
        el.style.boxShadow = b.border ? `inset 0 0 0 ${b.border.width}px ${b.border.color}` : '';
        el.classList.toggle('transparent', b.bg === 'transparent');
        el.classList.toggle('shadow', b.shadow !== false);
        el.classList.toggle('outline', Boolean(b.outline));
        el.dataset.pos = b.labelPos || 'bottom';
        el.dataset.align = b.textAlign || 'center';
        if (type === 'slider' && b.slider) { el.innerHTML = sliderHtml(b); return; }
        if (type === 'clock') { el._clock = b.clock || {}; el.innerHTML = clockHtml(el._clock); el.dataset.clock = '1'; return; }
        if (type === 'gauge') { el.innerHTML = gaugeHtml(b); return; }
        if (type === 'media' && b.media) { el.innerHTML = mediaHtml(b); return; }

        const pos = b.labelPos || 'bottom';
        const icon = iconHtml(b.icon);
        const label = pos === 'hidden' ? '' : String(b.label || '');
        const lab = (cls = '') => (label ? `<span class="pd-label${cls}">${esc(label)}</span>` : '');
        el.innerHTML = (pos === 'top' ? lab() : '') + icon + (pos === 'bottom' ? lab() : '') + (pos === 'center' ? lab(' center') : '') +
            (b.hasLong ? '<span class="pd-long" title="Ma akcję przytrzymania"></span>' : '');
        el.classList.toggle('no-icon', !icon);
        el.classList.toggle('icon-under', Boolean(icon && pos === 'center' && label));
    }

    // Zegary odświeżają się same (bez pytania serwera)
    function tickClocks(root) {
        root.querySelectorAll('[data-clock="1"]').forEach((el) => {
            const c = el._clock;
            if (c) el.querySelector('.pd-clock').outerHTML = clockHtml(c);
        });
    }

    global.PitayaDeckRender = { paint, glyph, lucide, readable, tickClocks, GLYPHS: G, GLYPH_LABELS: LABELS, fmtTime };
})(typeof window !== 'undefined' ? window : globalThis);

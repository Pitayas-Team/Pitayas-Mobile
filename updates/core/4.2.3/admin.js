// ═══════ PITAYAS — PANEL ADMINA W APLIKACJI ═══════
// Tylko dla kont z uprawnieniami administratora (serwer i tak sprawdza token: /api/admin/…).
// Konta, dostęp do aplikacji, projekty na stronie i powiadomienia — to samo co panel admin.pitayas.eu.
(() => {
    const C = window.PitayasCore;
    const { $, esc, toast, openSheet, setRow, setIcon } = C;
    const api = (path, body) => C.accountFetch(`api/admin/${path}`, body);
    const ORG = 'Pitayas-Team';
    let st = null;   // { me, users, apps, site, notifications, settings }

    const load = async () => { st = await api('state'); return st; };
    const userName = (id) => { const u = st.users.find((x) => x.id === id); return u ? u.name || u.login : '?'; };
    const fail = (err) => toast(err.message || String(err), 'err');
    const busy = (btn, on) => { if (btn) { btn.disabled = on; btn.style.opacity = on ? '.6' : ''; } };
    // Akcja z przyciskiem: blokada, wywołanie, odświeżenie stanu, ekran po akcji
    async function act(btn, fn, okText, then) {
        busy(btn, true);
        try {
            const r = await fn();
            await load();
            if (okText) toast(okText);
            if (then) then(r);
        } catch (err) { fail(err); } finally { busy(btn, false); }
    }
    const field = (id, label, value = '', attrs = '') => `<div><label for="${id}">${label}</label><input id="${id}" value="${esc(value)}" ${attrs}></div>`;
    const area = (id, label, value = '') => `<div><label for="${id}">${label}</label><textarea id="${id}" rows="4" style="width:100%;background:var(--m-field);color:var(--m-text);border:1px solid var(--m-line-strong);border-radius:12px;padding:12px;font:inherit;font-size:16px;resize:vertical">${esc(value)}</textarea></div>`;
    // Boolean(): pole bez wartości (undefined) nie może znikać — setRow rysuje przełącznik tylko, gdy toggle != null
const toggle = (id, title, on, sub) => `<div class="set-group">${setRow('', title, null, { toggle: Boolean(on), toggleId: id, sub })}</div>`;
    const ICON = {
        users: setIcon('user', '#3a8ef0'), apps: setIcon('box', '#a77bff'), site: setIcon('code', '#4cc38a'), bell: setIcon('bell', '#ff9f45'),
    };
    // Prawdziwa ikona aplikacji (moduł z kanału Pitayas); gdy jej nie ma — ogólny klocek
    const appIcon = (id) => {
        const src = C.moduleIcon && C.moduleIcon(id);
        return src ? `<img class="set-ic img" src="${esc(src)}" alt="" onerror="this.style.visibility='hidden'">` : ICON.apps;
    };

    // ───── Start ─────
    async function open() {
        openSheet('Administracja', '<div class="spinner"></div>', () => window.PitayasCore.openSettings());
        try { await load(); } catch (err) { openSheet('Administracja', `<p class="hint warn">${esc(err.message)}</p>`, () => window.PitayasCore.openSettings()); return; }
        home();
    }
    function home() {
        openSheet('Administracja', `
            <div class="set-group">
              ${setRow(ICON.users, 'Konta', String(st.users.length), { id: 'adUsers', sub: 'Tworzenie, hasła, uprawnienia' })}
              ${setRow(ICON.apps, 'Aplikacje', String(st.apps.length), { id: 'adApps', sub: 'Dostęp dla testerów, ukrywanie' })}
              ${setRow(ICON.site, 'Strona', '', { id: 'adSite', sub: 'Projekty na pitayas.eu' })}
              ${setRow(ICON.bell, 'Powiadomienia', String(st.notifications.length), { id: 'adNotif', sub: 'Wyślij do wszystkich albo wybranych' })}
            </div>
            <p class="hint">Zalogowano jako ${esc(st.me)}. Te same dane co w panelu admin.pitayas.eu.</p>`, () => window.PitayasCore.openSettings());
        $('adUsers').onclick = users;
        $('adApps').onclick = apps;
        $('adSite').onclick = site;
        $('adNotif').onclick = notifications;
    }

    // ───── Konta ─────
    function users() {
        const list = [...st.users].sort((a, b) => (b.admin - a.admin) || a.login.localeCompare(b.login));
        openSheet('Konta', `
            <button class="btn" id="uNew">Nowe konto</button>
            <div class="set-group">${list.map((u) => setRow(
                `<span class="set-av" style="width:30px;height:30px;font-size:14px">${esc((u.name || u.login).slice(0, 1).toUpperCase())}</span>`,
                esc(u.name || u.login), u.disabled ? '<span class="no">wyłączone</span>' : u.admin ? 'admin' : '',
                { id: `u-${u.id}`, sub: esc([u.login, u.discord ? 'Discord' : '', u.hasPassword ? '' : 'bez hasła'].filter(Boolean).join(' · ')) })).join('')}</div>`, home);
        $('uNew').onclick = newUser;
        list.forEach((u) => ($(`u-${u.id}`).onclick = () => userEdit(u.id)));
    }
    function showPassword(login, password, back) {
        openSheet('Hasło', `
            <p class="hint">Przekaż te dane osobie. Hasło widać tylko teraz.</p>
            <div class="set-group pad"><div style="font-size:15px">Login: <b style="color:var(--m-text)">${esc(login)}</b></div>
              <div style="font-size:22px;font-weight:700;color:var(--m-text);user-select:text;-webkit-user-select:text;letter-spacing:.04em">${esc(password)}</div></div>
            <button class="btn ghost" id="pwCopy">Kopiuj login i hasło</button>
            <button class="btn" id="pwDone">Gotowe</button>`, back);
        $('pwCopy').onclick = () => navigator.clipboard.writeText(`Login: ${login}\nHasło: ${password}`).then(() => toast('Skopiowano'), () => toast('Nie udało się skopiować', 'err'));
        $('pwDone').onclick = back;
    }
    function newUser() {
        openSheet('Nowe konto', `
            <div class="pc-form">
              ${field('nuLogin', 'Login', '', 'autocapitalize="off" autocorrect="off" placeholder="np. kasia"')}
              ${field('nuName', 'Imię / nazwa', '')}
              ${field('nuDiscord', 'Discord ID (opcjonalnie)', '', 'inputmode="numeric"')}
              ${toggle('nuAdmin', 'Administrator', false, 'Pełny dostęp do tego panelu')}
              ${toggle('nuPass', 'Z hasłem', true, 'Wyłącz, jeśli osoba loguje się tylko przez Discord')}
              <button class="btn" id="nuSave">Utwórz konto</button>
            </div>`, users);
        $('nuSave').onclick = () => act($('nuSave'), () => api('users', {
            login: $('nuLogin').value, name: $('nuName').value, discordId: $('nuDiscord').value, admin: $('nuAdmin').checked, withPassword: $('nuPass').checked,
        }), 'Konto utworzone', (r) => (r.password ? showPassword(r.user.login, r.password, users) : users()));
    }
    function userEdit(id) {
        const u = st.users.find((x) => x.id === id);
        if (!u) return users();
        openSheet(u.name || u.login, `
            <div class="pc-form">
              ${field('ueLogin', 'Login', u.login, 'autocapitalize="off" autocorrect="off"')}
              ${field('ueName', 'Imię / nazwa', u.name)}
              ${field('ueDiscord', 'Discord ID', u.discordId, 'inputmode="numeric"')}
              ${field('ueNote', 'Notatka', u.note)}
              ${toggle('ueAdmin', 'Administrator', u.admin)}
              ${toggle('ueOff', 'Konto wyłączone', u.disabled, 'Nie może się zalogować')}
              <button class="btn" id="ueSave">Zapisz</button>
            </div>
            <div class="set-group">
              ${setRow(setIcon('refresh', '#3a8ef0'), 'Nowe hasło', null, { id: 'uePass', sub: 'Wygeneruj i pokaż nowe hasło' })}
              ${setRow(setIcon('phone', '#5b6170'), 'Wyloguj ze wszystkich urządzeń', null, { id: 'ueOut' })}
              ${setRow(setIcon('box', '#ef5b6e'), '<span style="color:var(--m-danger)">Usuń konto</span>', null, { id: 'ueDel' })}
            </div>`, users);
        $('ueSave').onclick = () => act($('ueSave'), () => api(`users/${id}/update`, {
            login: $('ueLogin').value, name: $('ueName').value, discordId: $('ueDiscord').value, note: $('ueNote').value, admin: $('ueAdmin').checked, disabled: $('ueOff').checked,
        }), 'Zapisano', users);
        $('uePass').onclick = () => act(null, () => api(`users/${id}/reset`, {}), '', (r) => showPassword(r.login, r.password, () => userEdit(id)));
        $('ueOut').onclick = () => act(null, () => api(`users/${id}/logout`, {}), 'Wylogowano ze wszystkich urządzeń');
        $('ueDel').onclick = () => { if (confirm(`Usunąć konto ${u.login}? Tego nie da się cofnąć.`)) act(null, () => api(`users/${id}/delete`, {}), 'Konto usunięte', users); };
    }

    // ───── Aplikacje (dostęp) ─────
    function apps() {
        openSheet('Aplikacje', `
            <button class="btn" id="apNew">Dodaj aplikację</button>
            <div class="set-group">${st.apps.map((a) => setRow(appIcon(a.id), esc(a.name), a.hidden ? 'ukryta' : a.testersOnly ? 'testerzy' : 'wszyscy',
                { id: `ap-${a.id}`, sub: esc(`${a.id} · ${(a.users || []).length} z dostępem`) })).join('') || '<p class="hint" style="padding:12px">Brak aplikacji</p>'}</div>
            <p class="hint">Aplikacja „tylko dla testerów” działa tylko dla kont z listy. Ukryta znika z telefonu tym, którzy nie mają dostępu.</p>`, home);
        $('apNew').onclick = newApp;
        st.apps.forEach((a) => ($(`ap-${a.id}`).onclick = () => appEdit(a.id)));
    }
    function newApp() {
        openSheet('Nowa aplikacja', `
            <div class="pc-form">
              ${field('naId', 'Id (jak moduł na telefonie, np. gear)', '', 'autocapitalize="off" autocorrect="off"')}
              ${field('naName', 'Nazwa', '')}
              ${toggle('naTest', 'Tylko dla testerów', true)}
              <button class="btn" id="naSave">Dodaj</button>
            </div>`, apps);
        $('naSave').onclick = () => act($('naSave'), () => api('apps', { id: $('naId').value, name: $('naName').value, testersOnly: $('naTest').checked }), 'Dodano', (r) => appEdit(r.app.id));
    }
    function appEdit(id) {
        const a = st.apps.find((x) => x.id === id);
        if (!a) return apps();
        openSheet(a.name, `
            <div class="pc-form">
              ${field('aeName', 'Nazwa', a.name)}
              ${toggle('aeTest', 'Tylko dla testerów', a.testersOnly)}
              ${toggle('aeHidden', 'Ukryta', a.hidden, 'Niewidoczna dla osób bez dostępu')}
              <button class="btn" id="aeSave">Zapisz</button>
            </div>
            <div class="set-label">Dostęp</div>
            <div class="set-group">${(a.users || []).map((uid) => setRow('', esc(userName(uid)), '<span class="no">usuń</span>', { id: `rv-${uid}` })).join('') || '<p class="hint" style="padding:12px">Nikt nie ma jeszcze dostępu</p>'}</div>
            <div class="row" style="grid-template-columns:1fr auto">
              <input id="aeWho" placeholder="Login albo Discord ID" autocapitalize="off" autocorrect="off">
              <button class="chip" id="aeGrant">Dodaj</button>
            </div>
            <div class="set-group">${setRow(setIcon('box', '#ef5b6e'), '<span style="color:var(--m-danger)">Usuń aplikację z panelu</span>', null, { id: 'aeDel' })}</div>`, apps);
        $('aeSave').onclick = () => act($('aeSave'), () => api(`apps/${id}/update`, { name: $('aeName').value, testersOnly: $('aeTest').checked, hidden: $('aeHidden').checked }), 'Zapisano', () => appEdit(id));
        $('aeGrant').onclick = () => act($('aeGrant'), () => api(`apps/${id}/grant`, { who: $('aeWho').value }), 'Dodano dostęp', (r) => { if (r.created) toast('Utworzono konto dla tego Discord ID'); appEdit(id); });
        (a.users || []).forEach((uid) => ($(`rv-${uid}`).onclick = () => act(null, () => api(`apps/${id}/revoke`, { userId: uid }), 'Odebrano dostęp', () => appEdit(id))));
        $('aeDel').onclick = () => { if (confirm(`Usunąć ${a.name} z panelu? Aplikacja stanie się dostępna dla wszystkich.`)) act(null, () => api(`apps/${id}/delete`, {}), 'Usunięto', apps); };
    }

    // ───── Strona (projekty z GitHuba + własne nazwy i opisy) ─────
    let repos = null;
    async function site() {
        openSheet('Strona', '<div class="spinner"></div>', home);
        try {
            if (!repos) {
                const r = await fetch(`https://api.github.com/orgs/${ORG}/repos?per_page=100&sort=pushed`, { cache: 'no-store' });
                if (!r.ok) throw new Error(`GitHub: HTTP ${r.status}`);
                repos = (await r.json()).filter((x) => !x.archived && !x.private && !x.name.startsWith('.') && !/\.github\.io$/.test(x.name));
            }
        } catch (err) { openSheet('Strona', `<p class="hint warn">${esc(err.message)}</p>`, home); return; }
        openSheet('Strona', `
            <div class="set-group">${repos.map((r) => {
                const o = st.site[r.name] || {};
                return setRow(`<img class="set-ic img" src="https://raw.githubusercontent.com/${ORG}/${esc(r.name)}/${esc(r.default_branch || 'main')}/icon.png" alt="" onerror="this.style.visibility='hidden'">`,
                    esc(o.name || r.name), o.hidden ? 'ukryty' : o.status ? esc(o.status) : '', { id: `st-${r.name}`, sub: esc((o.desc || r.description || '').slice(0, 60)) });
            }).join('')}</div>
            <p class="hint">Nazwa i opis z GitHuba, chyba że zmienisz je tutaj. „Przywróć” wraca do danych z repozytorium.</p>`, home);
        repos.forEach((r) => ($(`st-${r.name}`).onclick = () => siteEdit(r)));
    }
    function siteEdit(r) {
        const o = st.site[r.name] || {};
        openSheet(o.name || r.name, `
            <div class="pc-form">
              ${field('seName', 'Nazwa na stronie', o.name || '', `placeholder="${esc(r.name)}"`)}
              ${area('seDesc', 'Opis', o.desc || '')}
              ${field('seStatus', 'Etykieta (np. BETA, Wkrótce)', o.status || '')}
              ${toggle('seHidden', 'Ukryj na stronie', o.hidden)}
              <button class="btn" id="seSave">Zapisz</button>
              <button class="btn ghost" id="seReset">Przywróć z GitHuba</button>
            </div>`, site);
        if (!o.desc && r.description) $('seDesc').placeholder = r.description;
        $('seSave').onclick = () => act($('seSave'), () => api(`site/${r.name}`, { name: $('seName').value, desc: $('seDesc').value, status: $('seStatus').value, hidden: $('seHidden').checked }), 'Zapisano', site);
        $('seReset').onclick = () => act($('seReset'), () => api(`site/${r.name}/reset`, {}), 'Przywrócono', site);
    }

    // ───── Powiadomienia ─────
    function notifications() {
        const when = (d) => new Date(d).toLocaleString('pl-PL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
        openSheet('Powiadomienia', `
            <button class="btn" id="nfNew">Nowe powiadomienie</button>
            ${toggle('nfAuto', 'Powiadamiaj o aktualizacjach', st.settings.updateNotify !== false, 'Automatycznie, gdy wyjdzie nowy rdzeń albo moduł')}
            <div class="notif-list">${st.notifications.slice(0, 50).map((n) => `
                <div class="notif${n.level === 'critical' ? ' crit' : ''}"><span class="ni">${n.level === 'critical' ? '⚠️' : n.kind === 'update' ? '⬇️' : '🔔'}</span>
                  <div class="nt"><b>${esc(n.title)}</b>${n.body ? `<p>${esc(n.body)}</p>` : ''}<small>${esc(when(n.createdAt))} · ${n.users && n.users.length ? esc(n.users.map(userName).join(', ')) : 'wszyscy'}</small></div>
                  <button class="mod-del" data-nd="${esc(n.id)}" title="Usuń"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>`).join('') || '<p class="hint" style="padding:12px">Brak powiadomień</p>'}</div>`, home);
        $('nfNew').onclick = newNotification;
        $('nfAuto').onchange = () => act(null, () => api('settings', { updateNotify: $('nfAuto').checked }), 'Zapisano');
        document.querySelectorAll('[data-nd]').forEach((b) => (b.onclick = () => act(b, () => api(`notify/${b.dataset.nd}/delete`, {}), 'Usunięto', notifications)));
    }
    function newNotification() {
        const picked = new Set();
        openSheet('Nowe powiadomienie', `
            <div class="pc-form">
              ${field('nnTitle', 'Tytuł', '')}
              ${area('nnBody', 'Treść', '')}
              ${toggle('nnCrit', 'Ważne (okno na cały ekran)', false, 'Pokazuje się, aż ktoś kliknie „Rozumiem”')}
              <div class="set-label">Do kogo</div>
              <div class="set-group">${setRow('', 'Wszyscy', null, { toggle: true, toggleId: 'nnAll' })}</div>
              <div class="set-group" id="nnUsers" hidden>${st.users.filter((u) => !u.disabled).map((u) => setRow('', esc(u.name || u.login), null, { toggle: false, toggleId: `nu-${u.id}` })).join('')}</div>
              <button class="btn" id="nnSend">Wyślij</button>
            </div>`, notifications);
        $('nnAll').onchange = () => { $('nnUsers').hidden = $('nnAll').checked; };
        st.users.forEach((u) => { const t = $(`nu-${u.id}`); if (t) t.onchange = () => (t.checked ? picked.add(u.id) : picked.delete(u.id)); });
        $('nnSend').onclick = () => {
            const users = $('nnAll').checked ? [] : [...picked];
            if (!$('nnAll').checked && !users.length) return toast('Wybierz, do kogo wysłać', 'err');
            act($('nnSend'), () => api('notify', { title: $('nnTitle').value, body: $('nnBody').value, level: $('nnCrit').checked ? 'critical' : 'normal', users }), 'Wysłano', notifications);
        };
    }

    window.PitayasAdmin = { open };
})();

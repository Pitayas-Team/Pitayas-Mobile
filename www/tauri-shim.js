// ═══════ PITAYAS — NAKŁADKA DLA NOWEJ APLIKACJI (Tauri) ═══════
// Rdzeń i moduły pisane były dla Capacitora (window.Capacitor.Plugins.*). W nowej aplikacji (Rust/Tauri) ta nakładka
// podstawia te same nazwy i metody, a pod spodem woła polecenia z app/src-tauri. W starej aplikacji (Capacitor) nic nie robi.
(function () {
  var T = window.__TAURI__;
  if (!T || window.Capacitor) return;
  var invoke = function (cmd, args) { return T.core.invoke(cmd, args || {}); };
  var listeners = {};
  var handle = function (fn) { return { remove: function () { return Promise.resolve(fn && fn()); } }; };
  var ua = navigator.userAgent || '';
  // Android, iPhone albo komputer (Fedora/Linux — aplikacja desktop z trybem telewizora)
  var DESKTOP = !/Android|iPhone|iPad|iPod/.test(ua);
  var platform = /iPhone|iPad|iPod/.test(ua) ? 'ios' : DESKTOP ? 'linux' : 'android';
  var dir = function (o) { return String((o && o.directory) || 'DATA').toUpperCase(); };

  var Filesystem = {
    getUri: function (o) { return invoke('fs_uri', { directory: dir(o), path: o.path }); },
    writeFile: function (o) { return invoke('fs_write', { directory: dir(o), path: o.path, data: String(o.data || ''), recursive: Boolean(o.recursive), append: false, encoding: o.encoding || null }); },
    appendFile: function (o) { return invoke('fs_write', { directory: dir(o), path: o.path, data: String(o.data || ''), recursive: true, append: true, encoding: o.encoding || null }); },
    readFile: function (o) { return invoke('fs_read', { directory: dir(o), path: o.path }); },
    mkdir: function (o) { return invoke('fs_mkdir', { directory: dir(o), path: o.path }); },
    rmdir: function (o) { return invoke('fs_rmdir', { directory: dir(o), path: o.path, recursive: Boolean(o.recursive) }); },
    deleteFile: function (o) { return invoke('fs_delete', { directory: dir(o), path: o.path }); },
    stat: function (o) { return invoke('fs_stat', { directory: dir(o), path: o.path }); },
    rename: function (o) { return invoke('fs_rename', { directory: dir(o), from: o.from, to: o.to }); },
    downloadFile: function (o) { return invoke('fs_download', { url: o.url, directory: dir(o), path: o.path, progress: Boolean(o.progress) }); },
    requestPermissions: function () { return Promise.resolve({ publicStorage: 'granted' }); },
    checkPermissions: function () { return Promise.resolve({ publicStorage: 'granted' }); },
    addListener: function (name, cb) {
      if (name !== 'progress') return Promise.resolve(handle());
      var off = null;
      T.event.listen('fs-progress', function (e) { cb(e.payload); }).then(function (u) { off = u; });
      return Promise.resolve(handle(function () { if (off) off(); }));
    },
  };

  var openUrl = function (o) { return invoke('plugin:opener|open_url', { url: (o && o.url) || o }); };
  var InAppBrowser = { openInExternalBrowser: openUrl, openInSystemBrowser: openUrl, openInWebView: openUrl, close: function () { return Promise.resolve(); } };

  var App = {
    getInfo: function () { return invoke('app_info'); },
    minimizeApp: function () { return Promise.resolve(); },
    exitApp: function () { return Promise.resolve(); },
    addListener: function (name, cb) {
      if (name === 'appStateChange') {
        var fn = function () { cb({ isActive: document.visibilityState === 'visible' }); };
        document.addEventListener('visibilitychange', fn);
        return Promise.resolve(handle(function () { document.removeEventListener('visibilitychange', fn); }));
      }
      if (name === 'backButton' && T.app && T.app.onBackButtonPress) {
        var p = T.app.onBackButtonPress(function () { cb({ canGoBack: false }); });
        return Promise.resolve(handle(function () { p.then(function (l) { if (l && l.unregister) l.unregister(); }); }));
      }
      return Promise.resolve(handle());
    },
  };

  var LocalNotifications = {
    checkPermissions: function () { return invoke('plugin:notification|is_permission_granted').then(function (g) { return { display: g ? 'granted' : 'prompt' }; }); },
    requestPermissions: function () { return invoke('plugin:notification|request_permission').then(function (s) { return { display: s === 'granted' ? 'granted' : 'denied' }; }); },
    schedule: function (o) {
      return Promise.all(((o && o.notifications) || []).map(function (n) {
        return invoke('plugin:notification|notify', { options: { title: n.title || 'Pitayas', body: n.body || '' } });
      })).then(function () { return { notifications: (o && o.notifications) || [] }; });
    },
    addListener: function () { return Promise.resolve(handle()); },
  };

  // Ekran nie gaśnie, gdy działa Deck, Cam albo Screen (Wake Lock API w WebView)
  var lock = null;
  var KeepAwake = {
    keepAwake: function () {
      if (!navigator.wakeLock) return Promise.resolve();
      return navigator.wakeLock.request('screen').then(function (l) { lock = l; }).catch(function () {});
    },
    allowSleep: function () { var l = lock; lock = null; return l ? l.release().catch(function () {}) : Promise.resolve(); },
    isSupported: function () { return Promise.resolve({ isSupported: Boolean(navigator.wakeLock) }); },
  };
  document.addEventListener('visibilitychange', function () { if (lock && document.visibilityState === 'visible') KeepAwake.keepAwake(); });

  var PitayasUsb = {
    start: function (o) { return invoke('usb_start', { port: (o && o.port) || 8195 }); },
    stop: function () { return invoke('usb_stop'); },
  };

  // Odtwarzacz VOD modułu Watch (WebView z Widevine) — tylko w aplikacji z natywnym mostkiem (Android)
  var PitayasWatch = window.PitayasWatchNative ? {
    open: function (o) {
      window.PitayasWatchNative.open(String(o.url || ''), String(o.title || ''), o.desktop !== false);
      return Promise.resolve();
    },
    addListener: function (name, cb) {
      if (name !== 'closed') return Promise.resolve(handle());
      var fn = function (e) { cb(e.detail || {}); };
      window.addEventListener('pitayas-watch-closed', fn);
      return Promise.resolve(handle(function () { window.removeEventListener('pitayas-watch-closed', fn); }));
    },
  } : null;

  // Komputer: film gra w przeglądarce z Widevine (tv_open), a „zamknięto” wraca zdarzeniem z czasem oglądania
  if (DESKTOP) {
    PitayasWatch = {
      open: function (o) { return invoke('tv_open', { url: String(o.url || ''), title: String(o.title || '') }); },
      addListener: function (name, cb) {
        if (name !== 'closed') return Promise.resolve(handle());
        var off = null;
        T.event.listen('pitayas-watch-closed', function (e) { cb(e.payload || {}); }).then(function (u) { off = u; });
        return Promise.resolve(handle(function () { if (off) off(); }));
      },
    };
    // Tryb telewizora (ten komputer jako telewizor dla telefonów): używa go moduł Watch
    window.PitayasDesktop = {
      state: function () { return invoke('tv_state'); },
      newPin: function () { return invoke('tv_new_pin'); },
      forget: function (id) { return invoke('tv_forget', { id: id || null }); },
      anyHost: function (on) { return invoke('tv_any_host', { on: Boolean(on) }); },
      fullscreen: function (on) { return invoke('tv_fullscreen', { on: Boolean(on) }); },
      stop: function () { return invoke('tv_stop'); },
      cmd: function (action, value) { return invoke('tv_cmd', { action: action, value: value === undefined ? null : value }); },
      onState: function (cb) { T.event.listen('tv:state', function (e) { cb(e.payload); }); },
    };
  }

  var Plugins = { Filesystem: Filesystem, App: App, InAppBrowser: InAppBrowser, LocalNotifications: LocalNotifications, KeepAwake: KeepAwake, PitayasUsb: PitayasUsb };
  if (PitayasWatch) Plugins.PitayasWatch = PitayasWatch;
  window.Capacitor = {
    Plugins: Plugins,
    platform: platform,
    getPlatform: function () { return platform; },
    isNativePlatform: function () { return true; },
    isPluginAvailable: function (name) { return Boolean(Plugins[name]); },
    convertFileSrc: function (path) { return T.core.convertFileSrc(String(path).replace(/^file:\/\//, '')); },
    PITAYAS_TAURI: true,
  };
})();

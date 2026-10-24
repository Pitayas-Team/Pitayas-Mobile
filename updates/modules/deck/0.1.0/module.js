// ═══════ PITAYA DECK — MODUŁ ═══════
// Deck działa w przeglądarce na komputerze — otwieramy go w pełnoekranowym oknie w aplikacji.
// Pamięć tego okna zostaje, więc telefon nie musi być zatwierdzany za każdym razem od nowa.
Pitayas.register({
    id: 'deck',

    probe: (api) => api.probe(api.url('/icons/32x32.png'), false),

    async open(api) {
        const url = api.url('/');
        if (!api.native || !api.Plugins.InAppBrowser) { window.open(url, '_blank'); return; }
        try {
            await api.Plugins.InAppBrowser.openInWebView({
                url,
                options: {
                    showToolbar: true,
                    showURL: false,
                    clearCache: false,
                    clearSessionCache: false,
                    mediaPlaybackRequiresUserAction: false,
                    closeButtonText: 'Gotowe',
                    toolbarPosition: 0,
                    showNavigationButtons: false,
                    leftToRight: false,
                    android: { allowZoom: false, hardwareBack: false, pauseMedia: true, isIsolated: false },
                    iOS: { allowOverScroll: false, enableViewportScale: false, allowInLineMediaPlayback: true, surpressIncrementalRendering: false, viewStyle: 2, animationEffect: 2, allowsBackForwardNavigationGestures: false },
                },
            });
        } catch (err) {
            api.toast(`Nie udało się otworzyć Decka: ${err.message || err}`, 'err');
        }
    },
});

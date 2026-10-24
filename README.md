<h2 align="center"><u>Pitayas na telefon</u></h2>

<p align="center">
  <img src="www/icons/pitayas.png" width="200">
</p>
<h4 align="center"> Jedna aplikacja na Androida i iPhone'a dla rodziny Pitayas — Pitaya Deck, Pitaya Cam i kolejne moduły </h4>

### [+] Opis
Instalujesz raz małą aplikację **Pitayas**, a w niej pobierasz moduły, których potrzebujesz:

| Moduł | Co robi | Na komputerze |
| --- | --- | --- |
| **Pitaya Deck** | panel przycisków do komputera (pełny ekran w aplikacji) | Pitaya Deck, port 8191 |
| **Pitaya Cam** | aparat telefonu jako kamera internetowa w komputerze | Pitaya Cam, port 2139 (port strony iPhone + 2) |

Rdzeń aplikacji i moduły **aktualizują się same** — bez pobierania nowego APK/IPA.

### [+] Instalacja
Pobierz najnowszą wersję z [Releases](https://github.com/Pitayas-Team/Pitayas-Mobile/releases):
- **Android:** `Pitayas-….apk` — otwórz plik na telefonie i zezwól na instalację z tego źródła.
- **iPhone (poza UE):** `Pitayas-….ipa` — zainstaluj przez [AltStore](https://altstore.io), [SideStore](https://sidestore.io) albo [Sideloadly](https://sideloadly.io). Z darmowym kontem Apple aplikację trzeba odświeżać co 7 dni (AltStore/SideStore robią to same).

Pierwsze uruchomienie: **Moduły → Pobierz** (Deck, Cam), potem **Komputer → adres** (np. `192.168.1.20`). Telefon musi być w tej samej sieci Wi‑Fi albo Tailscale co komputer.

### [+] Jak działają aktualizacje
```
Powłoka (APK / IPA)        www/index.html + wtyczki natywne    → nowa wersja tylko przy zmianie uprawnień / wtyczek
 └─ Rdzeń                  www/core (app.js, app.css)           → pobierany z updates/core/<wersja>/
     └─ Moduły             modules/<id> (module.js, …)          → pobierane z updates/modules/<id>/<wersja>/
```
- Aplikacja przy starcie i po powrocie z tła czyta `updates/manifest.json` z GitHuba.
- Moduły podmieniają się od razu, nowy rdzeń działa po ponownym uruchomieniu (przycisk na pasku).
- Pliki pobierają się do nowego folderu — przerwane pobieranie niczego nie psuje. Jeśli pobrany rdzeń się nie uruchomi, powłoka wraca do wbudowanego.
- Gdy wyjdzie nowa powłoka, aplikacja pokaże „Nowa wersja aplikacji — Pobierz”.
- W *Ustawieniach* można wyłączyć automatyczne aktualizacje albo podać własne źródło (np. lokalny serwer do testów).

### [+] Wydawanie zmian
**Rdzeń albo moduł** (najczęściej):
1. Zmień kod w `www/core/` albo `modules/<id>/`.
2. Podbij wersję: `www/core/core.json` + `CORE_VERSION` w `app.js`, albo `modules/<id>/module.json`.
3. `npm run channel` i wypchnij repozytorium — telefony pobiorą zmiany same.

**Nowy moduł:** folder `modules/<id>/` z `module.json`, `module.js` (wywołuje `Pitayas.register({...})`) i `icon.png`, potem `npm run channel`.

**Powłoka** (nowe uprawnienia, wtyczki Capacitor): podbij `version` w `package.json`, `versionCode`/`versionName` w `android/app/build.gradle` i `MARKETING_VERSION` w Xcode, potem tag `v<wersja>` — GitHub Actions zbuduje APK i IPA i utworzy wydanie.

Stały podpis APK (aktualizacja bez odinstalowania): sekrety repozytorium `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.

### [+] API modułu
```js
Pitayas.register({
    id: 'cam',
    probe: (api) => api.probe(api.url('/info'), true),   // kropka „działa” na ekranie startowym
    open(api) { … },                                       // moduł bez własnego ekranu (np. Deck)
    mount(body, api, barSlot) { … },                       // albo własny ekran pod paskiem z „wstecz”
    pause() { … }, unmount() { … },
});
```
`api`: `pc()`, `host()`, `port()`, `url(path, proto)`, `probe(url, json)`, `toast(text, tone)`, `close()`, `Plugins` (wtyczki Capacitor), `native`.

### [+] Uruchomienie ze źródeł
```bash
npm install
npm run channel
npx cap sync
npx cap open android      # Android Studio
```
Podgląd w przeglądarce: serwer HTTP w tym folderze, otwórz `/www/index.html`, w *Ustawieniach* ustaw źródło `http://localhost:<port>/updates/`.

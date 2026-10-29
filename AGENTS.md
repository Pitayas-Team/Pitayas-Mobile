# Pitayas Mobile – aplikacja na telefon (Android/iPhone), rdzeń OTA i moduły

> Plik przekazania projektu między narzędziami AI (Claude Code ⇄ Antigravity ⇄ inne).
> Przeczytaj go w całości, zanim cokolwiek zmienisz. **Nie ma tu żadnych sekretów** – hasła i klucze są poza repozytorium i nie wolno ich kopiować do kodu, logów ani rozmów.
> Stan na: 2026-10-29. Jeśli zmieniasz architekturę albo sposób wdrażania, zaktualizuj ten plik.

## 1. Czym to jest
Jedna aplikacja **Pitayas** na Androida i iPhone'a (Capacitor): ekran startowy z modułami — **Deck** (panel przycisków), **Cam** (kamera jako webcam), **Convert** (konwersja na telefonie), **Media** (pobieranie), **Screen** (telefon jako monitor przez USB), **Gear** (sprzęt komputera przez Decka) — oraz ustawienia, konto Pitayas, powiadomienia, panel admina i plan „Co dalej”.
Rdzeń i moduły są pobierane z GitHuba, więc zmiany trafiają do telefonów bez nowej instalacji.

## 2. Zasady od właściciela
- **Tylko aktualizacje rdzenia/modułów (OTA).** Nie wymagaj nowego APK/IPA; moduły mają wykrywać wtyczki natywne (`Capacitor.isPluginAvailable`) i mieć zapas dla powłoki 0.1.0. Nową powłokę wydajesz tylko za zgodą.
- Wygląd: matowy, płaski; natywny Liquid Glass tylko na przyciskach, które stoją w miejscu (pasek startu, pasek modułu, nagłówek strony). Ekrany (Ustawienia, Moduły, Konto, Panel admina…) to **pełne strony z przyciskiem „wstecz”**, nie okienka.
- Gest „wstecz”: przesunięcie od lewej krawędzi (strona zagnieżdżona pokazuje pod spodem poprzednią, bez migania ekranu startowego).
- Nie ogłaszaj w kanale (`manifest.json`) wersji powłoki, zanim jej APK/IPA nie zostanie zbudowane (telefony dostałyby 404).

## 3. Gdzie co leży i jak wydawać
| Co | Jak |
|---|---|
| Zmiana rdzenia/modułu | edytuj `www/core/*` albo `modules/<id>/*`, **podbij wersję** (`core.json` + `CORE_VERSION`; `module.json`), `npm run channel`, commit z `updates/` i `www/`, push na `main` |
| Kanał aktualizacji | `updates/manifest.json` + `updates/core/<ver>/` + `updates/modules/<id>/<ver>/` (generuje `scripts/channel.js`; zostają 4 ostatnie wersje) — telefon czyta go z `raw.githubusercontent.com/Pitayas-Team/Pitayas-Mobile/main/updates/` |
| Nowa powłoka (APK/IPA) | podbij `version` w `package.json`, `versionCode/versionName` w `android/app/build.gradle`, `MARKETING_VERSION`/`CURRENT_PROJECT_VERSION` w Xcode; commit, tag `v<wersja>` (np. `v0.3.0-beta`), push → GitHub Actions (`.github/workflows/release.yml`) buduje APK i IPA |
| Z kodu | `npm install`, `npm run channel`, `npx cap sync`, `npx cap open android` |

## 4. Struktura
```
www/index.html        ładowarka rdzenia (wpisuje wersję wbudowaną channel.js)
www/core/             app.js (całość aplikacji), app.css, admin.js (panel admina, ładowany tylko adminom), egg.js, core.json
modules/<id>/         module.json, module.js, module.css, icon.png (deck, cam, convert, media, screen, gear)
www/modules/          kopia modułów wbudowanych w powłokę (generuje channel.js)
www/runners/notifications.js   BackgroundRunner: sprawdzanie powiadomień w tle
scripts/channel.js    składa updates/ i sprawdza zgodność wersji rdzenia
scripts/flags.json    zdalne przełączniki (np. wyłączenie natywnego szkła)
android/              Java: MainActivity (pełny ekran), PitayasDevicePlugin (aplikacja domowa, start po włączeniu, jasność, pełny ekran, instalacja APK), BootReceiver
ios/                  projekt Xcode
native/pitayas-glass  wtyczka iOS: natywne szklane przyciski; native/pitayas-usb – gniazdo dla modułu Screen
updates/              WYNIK channel.js – commituj
```
Moduł Deck kopiuje `render.js`/`render.css` z `Pitayas-Deck/shared` (pole `copyFrom` w `module.json`).

## 5. Jak to działa
- `www/core/app.js` to jeden duży plik: komputery (adresy i porty), moduły, aktualizacje (rdzeń, moduły, powłoka — na Androidzie pobiera APK i otwiera instalator), konto Pitayas, powiadomienia, strony (`openSheet`), gesty, szkło (`syncGlass`), panel admina (`window.PitayasAdmin`, plik `admin.js`).
- API modułu: `Pitayas.register({ id, probe, open | mount, pause, resume, unmount })`; `api` ma `pc()`, `host()`, `port()`, `url()`, `probe()`, `toast()`, `close()`, `switcher()`, `Plugins`.
- Serwer kont (`https://admin.pitayas.eu/`) daje dostęp do modułów dla testerów, powiadomienia, panel admina i plan.

## 6. Testowanie
Telefonu nie masz — rdzeń i moduły sprawdzaj w Chromium: `python3 -m http.server` w folderze projektu, otwórz `/www/index.html` (Playwright, emulacja telefonu/tabletu), ustaw `localStorage` (`pitayas-account`, `pitayas-pcs`, `pitayas-modules`). Do kont użyj lokalnego serwera `Pitayas-Accounts` na osobnym `PITAYAS_HOME`. **Nie sprawdzisz** natywnych rzeczy (Android, iOS, Liquid Glass, USB, pełny ekran) — napisz o tym wprost.

## 7. Znane ograniczenia
- Kod natywny Androida nie jest kompilowany lokalnie (brak SDK) — błędy wychodzą dopiero w GitHub Actions.
- Pełny ekran na Androidzie i natywne szkło wymagają testu na prawdziwym telefonie.

## 8. Zasady wspólne
- **Język:** interfejs, komentarze, opisy zmian i odpowiedzi po polsku. Marka „Pitayas”; kolory: róż pitai `#ff4fa6`, ciemne tło `#121116`.
- **Wygląd:** matowy, spokojny, czytelny — **nie „AI slop”**: bez świecących gradientów w tytułach, poświat pod przyciskami i udawanego szkła w CSS. Prawdziwe szkło tylko natywne (iOS 26) na elementach, które się nie ruszają.
- **Pitaya Core:** folder `core/` w aplikacji to **kopia** z projektu `Pitayas-Core`. Nie edytuj jej w aplikacji — zmieniaj w `Pitayas-Core` i uruchom `~/Pitayas-Projects/ADMIN/sync-core.sh`. Każda aplikacja rejestruje się w `~/.config/Pitayas/apps/<id>.json` i wystawia kanał sterowania (kontrakt Core 0.2, dla przyszłego Pitaya Hub).
- **Lista zmian:** po **każdej** zmianie w aplikacji dopisz wpis: `node ~/Pitayas-Projects/ADMIN/changelog.js add <id> <feature|fix|change> "opis po polsku"`. `<id>` = nazwa folderu bez „Pitayas-”, małymi literami (np. `screen`, `mobile`, `accounts`, `admin`, `website`). Wpisy trafiają do opisu wydania na GitHubie.
- **Git:** commity jako właściciel (`Pitayas <inbox@rakunek.com>`), krótki opis po polsku, **bez** `Co-Authored-By` i wzmianek o narzędziach AI. Push tylko na bieżącą gałąź, bez force-push bez zgody.
- **Budowanie i wydania:** nie buduj, nie pakuj i nie publikuj wersji bez wyraźnej prośby właściciela. Wydania robi **Pitayas Admin** (`ADMIN/cli.js`, GitHub Releases organizacji Pitayas-Team). Po budowie nie uruchamiaj aplikacji właściciela.
- **Sekrety:** hasła, tokeny, klucze i pliki `.env` nigdy do kodu, logów, commitów ani rozmów.
- **Uczciwość:** nie masz telefonu, iPhone'a ani Windowsa — wyraźnie napisz, czego nie dało się sprawdzić, zamiast twierdzić, że działa.
- **Praca na serwerze:** projekty leżą w `~/Pitayas-Projects` na serwerze rakunek.com (kopia na komputerze właściciela to zapas). Nie startuj zbędnych procesów w tle ani dodatkowych sesji/agentów.

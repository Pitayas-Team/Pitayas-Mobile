# Instrukcje dla Antigravity / Gemini

Cały kontekst projektu **Pitayas Mobile** (cel, zasady od właściciela, struktura, uruchamianie i wdrażanie, testowanie, znane ograniczenia) jest w pliku **`AGENTS.md`** w tym samym katalogu – przeczytaj go najpierw i traktuj jako obowiązujący.

Najważniejsze w skrócie:
- Trzy warstwy: **powłoka** (APK/IPA, rzadko), **rdzeń** `www/core` i **moduły** `modules/<id>` – dwie ostatnie aktualizują się przez GitHuba (`npm run channel` + push), bez nowego APK/IPA.
- Wszystko wprowadzaj jako zmianę rdzenia/modułu; nowa powłoka tylko gdy konieczny jest kod natywny.
- Numer rdzenia: `CORE_VERSION` w `www/core/app.js` + `version` w `www/core/core.json` (muszą się zgadzać, rośnie zawsze, np. 4.2.x), a `CORE_LABEL`/`label` to wersja pokazywana użytkownikowi (0.4.x).
- Wszystko po polsku; wygląd matowy i spokojny, nie „AI slop”.
- Po każdej zmianie dopisz wpis w liście zmian: `node ~/Pitayas-Projects/ADMIN/changelog.js add <id> <feature|fix|change> "opis"`.
- Commity jako właściciel, **bez** „Co-Authored-By” i wzmianek o AI. Nie buduj ani nie publikuj wersji bez prośby.
- Nigdy nie kopiuj sekretów (hasła, tokeny, `.env`) do kodu, logów ani czatu. Napisz, czego nie mogłeś sprawdzić.

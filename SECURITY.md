# Polityka bezpieczeństwa / Security policy

## Wspierane wersje
Poprawki bezpieczeństwa trafiają tylko do gałęzi domyślnej i wersji wdrożonej na `dn.noblecode.pl`.

## Zgłaszanie podatności
**Nie zakładaj publicznego zgłoszenia (issue) z opisem podatności.** Użyj prywatnego zgłoszenia
w GitHub (zakładka „Security” → „Report a vulnerability”) w repozytorium `NobleCodeSoftware/dn-narzedzia`.
Jeśli ta opcja nie jest dostępna, załóż publiczne zgłoszenie o treści wyłącznie „security contact
requested”, bez szczegółów, a ustalimy kanał prywatny.

Podaj: co znalazłeś, jak to odtworzyć, której strony lub pliku dotyczy i jaki widzisz skutek.
Nie dołączaj prawdziwych plików ewidencji ani danych osobowych.

## Czego się spodziewać
- Potwierdzenie w ciągu 5 dni roboczych (projekt jest mały i prowadzony z udziałem agentów AI).
- Ocena i, po potwierdzeniu, poprawka lub obejście oraz podziękowanie w opisie zmian, jeśli chcesz.
- Aktywnie wykorzystywaną podatność traktujemy priorytetowo i zgłaszamy zgodnie z wymogami CRA
  (wczesne ostrzeżenie w 24 h).
- Skoordynowane ujawnienie: prosimy o rozsądny czas (proponujemy 90 dni) przed publikacją.

## Zakres
W zakresie: kod w `public/` (HTML, CSS, JS), nagłówki `public/_headers`, workflow w `.github/workflows/`.
Szczególnie: wyciek danych z przeglądarki użytkownika na zewnątrz, obejście CSP, wstrzyknięcie
skryptu przez importowany plik CSV, wstrzyknięcie formuły do zapisanego pliku CSV.

Poza zakresem: podatności Cloudflare, API NBP, przeglądarek i platform Gumroad/Polar (zgłoś je dostawcy).

## Model bezpieczeństwa (skrót)
- Strona statyczna, bez backendu, kont i ciasteczek. Dane ewidencji zostają w przeglądarce i w pliku użytkownika.
- CSP: `default-src 'none'`, skrypty i style tylko z tej samej domeny, połączenia tylko do `https://api.nbp.pl`.
- Zapytanie do NBP: `credentials: 'omit'`, `referrerPolicy: 'no-referrer'`; wysyłany jest tylko kod waluty i zakres dat.
- Treść z plików CSV trafia do strony wyłącznie przez `textContent` (bez `innerHTML`).
- Pola tekstowe zapisywane do CSV, które zaczynają się od `= + - @`, dostają prefiks `'` (ochrona przed formułami).

---
English: please report vulnerabilities privately via GitHub Security Advisories on
`NobleCodeSoftware/dn-narzedzia`; do not open a public issue with details. We acknowledge within
5 working days and follow coordinated disclosure (90 days suggested).

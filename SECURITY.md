# Polityka bezpieczeństwa / Security policy

## Wspierane wersje
Poprawki bezpieczeństwa trafiają tylko do gałęzi domyślnej i wersji wdrożonej na `dn.noblecode.pl`.

## Zgłaszanie podatności
**Nie zakładaj publicznego zgłoszenia (issue) z opisem podatności.** Użyj prywatnego zgłoszenia
w GitHub (zakładka „Security” → „Report a vulnerability”) w repozytorium `NobleCodeSoftware/dn-narzedzia`.
Jeśli ta opcja nie jest dostępna, załóż publiczne zgłoszenie o treści wyłącznie „security contact
requested”, bez szczegółów, a ustalimy kanał prywatny.

Podaj: co znalazłeś, jak to odtworzyć, której strony lub pliku dotyczy i jaki widzisz skutek.
Nie dołączaj arkuszy z prawdziwymi danymi ani danych osobowych.

## Czego się spodziewać
- Potwierdzenie w ciągu 5 dni roboczych (projekt jest mały i prowadzony z udziałem agentów AI).
- Ocena i, po potwierdzeniu, poprawka lub obejście oraz podziękowanie w opisie zmian, jeśli chcesz.
- Aktywnie wykorzystywaną podatność traktujemy priorytetowo i zgłaszamy zgodnie z wymogami CRA
  (wczesne ostrzeżenie w 24 h).
- Skoordynowane ujawnienie: prosimy o rozsądny czas (proponujemy 90 dni) przed publikacją.

## Zakres
W zakresie: kod w `public/` (HTML, CSS, JS), nagłówki `public/_headers`, workflow w `.github/workflows/`.
Szczególnie: wyciek danych z przeglądarki użytkownika na zewnątrz, obejście CSP, wstrzyknięcie
skryptu, w arkuszu `public/pobierz/` makra, łącza zewnętrzne lub formuły łączące się z siecią.

Poza zakresem: podatności Cloudflare, przeglądarek i programów arkuszowych (zgłoś je dostawcy).

## Model bezpieczeństwa (skrót)
- Strona statyczna, bez backendu, kont i ciasteczek. Wpisy ewidencji, faktury i dane klientów zostają w pamięci tej
  przeglądarki (`localStorage`, dostęp tylko w `magazyn.js`, z przełącznikiem i „Wyczyść dane”).
- CSP: `default-src 'none'`, skrypty i style tylko z tej samej domeny; połączenia tylko z tą domeną (wzór arkusza)
  i z api.nbp.pl (kurs średni NBP).
- Treść trafia do strony wyłącznie przez `textContent` (bez `innerHTML`).
- Arkusz XLSX generuje `scripts/arkusz.py` i sprawdza go (`--sprawdz`): bez makr, łączy zewnętrznych i `HYPERLINK`.

---
English: please report vulnerabilities privately via GitHub Security Advisories on
`NobleCodeSoftware/dn-narzedzia`; do not open a public issue with details. We acknowledge within
5 working days and follow coordinated disclosure (90 days suggested).

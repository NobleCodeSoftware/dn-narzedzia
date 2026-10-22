# Narzędziownik DN (`dn.noblecode.pl`)

Ewidencja sprzedaży i limit działalności nierejestrowanej (DN) w przeglądarce: stan kwartału, prognoza przekroczenia,
kurs średni NBP, wydruk ewidencji, a do tego szybki licznik limitu i darmowy arkusz do pobrania.
Bez kont i bez serwera aplikacji: wszystko działa w przeglądarce.

> Eksperyment NobleCode, prowadzony z udziałem AI · Nie stanowi doradztwa podatkowego

Wersja 0.3. To wersja testowa: strony mają `noindex` (zob. „Wdrożenie”).

## Co jest w środku

| Ścieżka | Co robi |
|---|---|
| `/` | ewidencja sprzedaży: dodawanie, edycja i usuwanie wpisów; stan bieżącego kwartału z progami 70/85/95/100% (kwota progu, dzień osiągnięcia albo prognozy); prognoza przekroczenia (data, zapas, kwota na koniec kwartału, średnio dziennie do końca kwartału); historia kwartałów; „Co się stanie po przekroczeniu limitu” (data przekroczenia i termin 7 dni na wniosek do CEIDG, linki do biznes.gov.pl i ZUS, bez liczenia podatku); kurs średni NBP z ostatniego dnia roboczego przed sprzedażą (automatycznie, z obsługą świąt, możliwy kurs ręczny, „Uzupełnij kursy NBP” po imporcie); import i eksport XLSX/CSV w układzie arkusza; wydruk/PDF uproszczonej ewidencji za rok; pamięć przeglądarki z przełącznikiem i „Wyczyść dane”; przykładowe dane. Niżej: „Szybkie sprawdzenie bez ewidencji” (licznik kwota ÷ limit), arkusz do pobrania, źródła kwot i krótka sekcja o KSeF od 2027 |
| `/pobierz/arkusz-limit-dn.xlsx` | darmowy arkusz (Excel, LibreOffice, Arkusze Google; bez makr i połączeń z siecią): data, opis, kwota, waluta, kurs NBP, kwota w PLN, suma kwartału narastająco, % limitu i ostrzeżenia (formatowanie warunkowe 70/85/95/100%); zakładki „Podsumowanie” (kwartały 2026–2028), „Limity” (płaca minimalna na rok, do uzupełnienia na 2028+), „Instrukcja” |
| `/regulamin/`, `/prywatnosc/`, `/o-nas/` | regulamin, polityka prywatności oraz informacje o narzędziach, usługodawcy i udziale AI |
| `_redirects` | stałe przekierowania 301 dawnych podstron (`/limit-…`, `/ksef-2027-…`, `/ewidencja-sprzedazy-…`, `/ewidencja/`) na `/` |

### Moduły (`public/js/`)

- `ewidencja-logika.js`: wpisy, kwoty w PLN, kwartały, progi, prognoza, wartości kolumn F–I, wiersze wydruku, import, numeracja dokumentów.
- `kalendarz.js`: dni ustawowo wolne od pracy w Polsce (z regułą Wielkanocy), dzień kursu NBP.
- `nbp.js`: zapytania do api.nbp.pl, wybór kursu, kursy dla wielu wpisów naraz.
- `csv.js`, `xlsx.js`, `zip.js`: własny, minimalny odczyt i zapis CSV i XLSX bez bibliotek (ZIP + `CompressionStream('deflate-raw')`).
- `magazyn.js`: jedyny moduł z dostępem do `localStorage`.
- `ewidencja-widok.js`: widok (DOM). Elementy powstają przez `createElement` i `textContent`, bez wstawiania HTML z tekstu.
- `logic.js`, `wspolne.js`, `limit.js`: szybki licznik limitu.
- Wydruk: `css/druk.css` (`media="print"`).

Kwoty są liczone w groszach na `BigInt`, bez liczb zmiennoprzecinkowych.

### Prognoza

Średnia dzienna sprzedaż od początku kwartału do dziś (włącznie) × pozostałe dni kwartału. Data przekroczenia to pierwszy
dzień, w którym prognozowana suma przekracza limit. Prognoza jest oznaczona jako mało pewna, gdy od początku kwartału
minęło mniej niż 14 dni albo są mniej niż 3 wpisy.

### Kurs NBP

Dzień kursu wynika z kalendarza (`kalendarz.js`): ostatni dzień roboczy przed datą sprzedaży, z pominięciem weekendów
i świąt. Kalendarz porównano z datami tabel A NBP od 1.01.2025 do 21.10.2026 (456 tabel, bez rozbieżności).
Strona pyta o zakres 10 dni kończący się na dniu kursu (`/api/exchangerates/rates/a/{kod}/{od}/{do}/`) i bierze ostatnią
tabelę nie późniejszą niż dzień kursu. Gdy dzień kursu to dziś, a tabeli jeszcze nie ma, strona nie bierze starszego kursu.
API NBP odpowiada nagłówkiem `Access-Control-Allow-Origin: *` (także na 404), więc działa z przeglądarki.

### Kolumny ewidencji i wydruk

Przepisy nie określają dokładnie, co ma zawierać uproszczona ewidencja sprzedaży (art. 109 ust. 1 ustawy o VAT).
Według [biznes.gov.pl](https://www.biznes.gov.pl/pl/portal/00115) zwykle są to: liczba porządkowa, data sprzedaży,
wartość sprzedaży i wartość narastająco od początku roku; można dopisać numer dowodu albo rodzaj transakcji.
Wydruk ma te kolumny oraz opis, narastająco w kwartale i walutę z kursem.

### Eksport XLSX

Eksport wypełnia kolumny A–E wzoru `/pobierz/arkusz-limit-dn.xlsx` i zapisuje wyliczone wartości F–I (formuły zostają),
pozostałe zakładki zostają bez zmian. Przy ponad 1000 wpisach eksport rozszerza zakresy formuł. Wyeksportowany plik
sprawdzono w LibreOffice (headless): otwiera się, a przeliczone wartości są zgodne.

## Arkusz XLSX: jak odtworzyć

```sh
pip install openpyxl                  # MIT
python3 scripts/arkusz.py --sprawdz   # zapisuje public/pobierz/arkusz-limit-dn.xlsx i sprawdza plik
```

Plik jest deterministyczny (stałe daty w metadanych i w ZIP), więc ponowne uruchomienie bez zmian w skrypcie daje
identyczny plik. `--sprawdz` ponownie wczytuje plik przez openpyxl i odrzuca makra, łącza zewnętrzne, `HYPERLINK`
i adresy w formułach. Używane funkcje: `IF`, `OR`, `AND`, `ISNUMBER`, `ROUND`, `SUMIFS`, `COUNTIFS`, `DATE`, `YEAR`,
`MONTH`, `INT`, `EOMONTH`, `VLOOKUP`, `IFERROR` (są w Excelu 2010+, LibreOffice i Arkuszach Google).

Kwoty płacy minimalnej są w dwóch miejscach: `PLACA_MINIMALNA` w `public/js/logic.js` i `PLACA` w `scripts/arkusz.py`.
Zmieniaj je razem.

## Prywatność

- Brak backendu, kont i ciasteczek. Wpisy i pliki nie opuszczają przeglądarki.
- Jedyny zewnętrzny serwer to api.nbp.pl: trafia tam tylko kod waluty i zakres dat, z `credentials: 'omit'`
  i `referrerPolicy: 'no-referrer'` (nagłówek `Origin` z adresem strony przeglądarka wysyła przy zapytaniu CORS zawsze).
- CSP: `default-src 'none'`, `connect-src 'self' https://api.nbp.pl` (`'self'` dla wzoru arkusza przy eksporcie).
- `localStorage` tylko w `magazyn.js`, z przełącznikiem i przyciskiem „Wyczyść dane”. Bez zapisu w przeglądarce strona ostrzega przed zamknięciem z niezapisanymi wpisami.
- Arkusz nie ma makr ani połączeń z siecią.
- Strona jest statyczna i hostowana na Cloudflare Pages. Co przetwarza hosting i jak działa kontakt e-mail, opisuje `/prywatnosc/`.

## Jak uruchomić lokalnie

Nie ma kroku budowania. Katalog `public/` jest gotową stroną.

```sh
npm run serve          # albo: python3 -m http.server 8080 --directory public
# http://localhost:8080/
```

Moduły ES wymagają serwera HTTP. Strona otwarta jako `file://` nie zadziała.

## Testy

```sh
node --test            # Node 20+; bez zależności
```

- `test/logic.test.js`: limit, progi, kwartały, strefa czasowa, kwoty.
- `test/wspolne.test.js`: komunikaty progów, zdanie z kwotami, odczyt wpisu i tekst ogłoszenia dla czytnika ekranu.
- `test/kalendarz-nbp.test.js`: Wielkanoc, święta 2026–2027, Wigilia wolna od 2025, dzień kursu przy weekendach i świętach, wybór kursu i zapytania NBP (bez sieci), kursy dla wielu wpisów naraz.
- `test/ewidencja.test.js`: liczby i kwoty w PLN, sumy kwartałów, progi, prognoza, wartości F–I, wydruk, numeracja, import, CSV i XLSX (round-trip, ponad 1000 wierszy, pliki z innych programów), ZIP (w tym ochrona przed „bombą ZIP”).
- `test/strony.test.js`: higiena stron: `noindex`, meta CSP zgodny z `_headers` (`connect-src` tylko `'self'` i api.nbp.pl), stopka, brak skryptów, stylów i handlerów inline, brak zewnętrznych zasobów, w JS jedyny adres to API NBP w `nbp.js`, brak `document.cookie`/`innerHTML`, `localStorage` tylko w `magazyn.js`, `fetch` tylko w widoku ewidencji, etykiety pól i jeden region `aria-live`, strony prawne krótkie w porównaniu ze stronami funkcji (najwyżej 1,5× słów), brak odwołań do usuniętych stron, sekcja KSeF ≤ 150 słów, jedna akcja pobrania arkusza, arkusz bez makr i łączy, `_redirects` tylko stałe, w HTML jedyny adres e-mail to `kontakt@noblecode.pl`.
- Przed publikacją: `npm run check:publish` kończy się błędem, gdy w `public/` został placeholder `{{...}}` albo znacznik `[DO-UZUPEŁNIENIA…]` (miejsce w tekście do uzupełnienia).

CI: `.github/workflows/ci.yml` uruchamia `node --test` na Node 20 i 22 (push do `main` i pull requesty).

## Układ plików

```
public/                    gotowa strona (Cloudflare Pages, katalog wyjściowy)
  _headers                 nagłówki HTTP: CSP, noindex, nosniff; arkusz zawsze jako załącznik
  _redirects               stałe przekierowania dawnych podstron
  robots.txt
  index.html               ewidencja, szybkie sprawdzenie, arkusz, źródła, KSeF
  css/style.css, css/druk.css
  js/                      moduły opisane wyżej
  pobierz/arkusz-limit-dn.xlsx   arkusz do pobrania i wzór eksportu (generowany)
  regulamin/, prywatnosc/, o-nas/
scripts/arkusz.py          generator i kontrola arkusza (openpyxl)
scripts/sprawdz-publikacje.mjs   kontrola przed publikacją
test/                      testy node:test
```

## Wdrożenie (Cloudflare Pages)

- Build command: brak. Output directory: `public`.
- `public/_headers` ustawia CSP (z `frame-ancestors`), `X-Robots-Tag: noindex`, `nosniff`, `Referrer-Policy` i `Permissions-Policy`,
  a dla `/pobierz/*` typ pliku XLSX i `Content-Disposition: attachment`. Meta CSP w każdym HTML musi być taki sam (pilnuje tego test).
- Wersja testowa ma `noindex` w meta `robots` i w nagłówku `X-Robots-Tag`. `robots.txt` pozwala na crawl, żeby wyszukiwarki widziały `noindex`.
  Włączenie indeksowania wymaga zdjęcia `noindex` (meta, `_headers`, testy) i dodania `sitemap.xml`.
- Cloudflare Web Analytics jest **wyłączone**. Włączenie wymaga dopisania do CSP (meta i `_headers`)
  `https://static.cloudflareinsights.com` w `script-src` i `https://cloudflareinsights.com` w `connect-src`
  oraz opisu analityki w polityce prywatności.

## Źródła

- Limit: art. 5 ust. 1 ustawy z 6 marca 2018 r. – Prawo przedsiębiorców (przychód należny w kwartale do 225% minimalnego wynagrodzenia).
- Minimalne wynagrodzenie: 4806 zł w 2026 r. ([Dz.U. 2025 poz. 1242](https://eli.gov.pl/eli/DU/2025/1242/ogl)),
  4950 zł w 2027 r. ([Dz.U. 2026 poz. 1213](https://eli.gov.pl/eli/DU/2026/1213/ogl)).
- Działalność nierejestrowana, ewidencja i przekroczenie limitu: [biznes.gov.pl](https://www.biznes.gov.pl/pl/portal/00115),
  [podatki.gov.pl](https://www.podatki.gov.pl/poradniki-i-informatory/dzialalnosc-nierejestrowana); art. 109 ustawy o VAT.
- Kurs średni NBP z ostatniego dnia roboczego przed dniem uzyskania przychodu: art. 11a ust. 1 ustawy o PIT; dane z [API NBP](https://api.nbp.pl/).
- Dni wolne od pracy: ustawa z 18 stycznia 1951 r. o dniach wolnych od pracy; Wigilia od 2025 r. (Dz.U. 2024 poz. 1965).
- KSeF: [ksef.podatki.gov.pl](https://ksef.podatki.gov.pl/), [Poniżej 10 000 zł](https://ksef.podatki.gov.pl/ponizej-10-000-zl/).

Narzędzia podają informacje ogólne i nie stanowią doradztwa podatkowego.

## Bezpieczeństwo i kontakt

Podatności zgłaszaj prywatnie, zgodnie z [SECURITY.md](SECURITY.md). Kontakt: `kontakt@noblecode.pl`.

## Licencja

MIT, `Copyright (c) 2026 NobleCode`, zob. [LICENSE](LICENSE). Strona nie ma zależności zewnętrznych;
generator arkusza używa openpyxl (MIT), który nie trafia do `public/`.

# Narzędziownik DN (`dn.noblecode.pl`)

Ewidencja sprzedaży i limit działalności nierejestrowanej (DN) w przeglądarce: stan kwartału, prognoza przekroczenia,
kurs średni NBP, wydruk ewidencji, faktura bez VAT (zwolnienie) do druku i PDF, a do tego szybki licznik limitu
i darmowy arkusz do pobrania.
Bez kont i bez serwera aplikacji: wszystko działa w przeglądarce.

> Eksperyment NobleCode, prowadzony z udziałem AI · Nie stanowi doradztwa podatkowego

Wersja 0.4. Strony są indeksowane przez wyszukiwarki (zob. „Wdrożenie”).

## Co jest w środku

| Ścieżka | Co robi |
|---|---|
| `/` | ewidencja sprzedaży: dodawanie, edycja i usuwanie wpisów; stan bieżącego kwartału z progami 70/85/95/100% (kwota progu, dzień osiągnięcia albo prognozy); prognoza przekroczenia (data, zapas, kwota na koniec kwartału, średnio dziennie do końca kwartału); historia kwartałów; „Co się stanie po przekroczeniu limitu” (data przekroczenia i termin 7 dni na wniosek do CEIDG, linki do biznes.gov.pl i ZUS, bez liczenia podatku); kurs średni NBP z ostatniego dnia roboczego przed sprzedażą (automatycznie, z obsługą świąt, możliwy kurs ręczny, „Uzupełnij kursy NBP” po imporcie); import i eksport XLSX/CSV w układzie arkusza; wydruk/PDF uproszczonej ewidencji za rok; pamięć przeglądarki z przełącznikiem i „Wyczyść dane”; przykładowe dane. Niżej: „Szybkie sprawdzenie bez ewidencji” (licznik kwota ÷ limit), arkusz do pobrania, źródła kwot i krótka sekcja o KSeF od 2027 |
| `/faktura/` | faktura bez VAT (zwolnienie) dla sprzedawcy zwolnionego z VAT: klient prywatny albo firma z Polski (NIP z cyfrą kontrolną), do 10 pozycji (ilość × cena, zaokrąglenie do grosza), kwota słownie, kolejny numer N/RRRR, podstawa zwolnienia (art. 113 ust. 1, ust. 9 albo własna), termin wystawienia i termin prośby klienta, reguła KSeF z blokadą, wydruk/PDF przez okno drukowania, lista wystawionych faktur, zapamiętani klienci i dane sprzedawcy, opcjonalne dopisanie sprzedaży do ewidencji bez dublowania |
| `/pobierz/arkusz-limit-dn.xlsx` | darmowy arkusz (Excel, LibreOffice, Arkusze Google; bez makr i połączeń z siecią): data, opis, kwota, waluta, kurs NBP, kwota w PLN, suma kwartału narastająco, % limitu i ostrzeżenia (formatowanie warunkowe 70/85/95/100%); zakładki „Podsumowanie” (kwartały 2026–2028), „Limity” (płaca minimalna na rok, do uzupełnienia na 2028+), „Instrukcja” |
| `/regulamin/`, `/prywatnosc/`, `/o-nas/` | regulamin, polityka prywatności oraz informacje o narzędziach, usługodawcy i udziale AI |
| `_redirects` | stałe przekierowania 301 dawnych podstron (`/limit-…`, `/ksef-2027-…`, `/ewidencja-sprzedazy-…`, `/ewidencja/`) na `/` |

### Moduły (`public/js/`)

- `faktura-logika.js`: faktura bez DOM: walidacja, NIP i PESEL, sumy, kwota słownie, terminy, reguła KSeF, dane wydruku, dopisanie do ewidencji.
- `faktura-widok.js`: widok strony `/faktura/` (DOM), bez połączeń sieciowych.
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

### Faktura bez VAT (zwolnienie)

Strona składa fakturę z danych użytkownika i nie ocenia jego sytuacji. Blokuje przypadki, w których przepis każe
wystawić fakturę w KSeF. Przepisy sprawdzono u źródła 22.10.2026.

- **Elementy** (art. 106e ust. 1 ustawy o VAT): data wystawienia, kolejny numer, imiona i nazwiska lub nazwy oraz adresy
  sprzedawcy i nabywcy, identyfikator podatkowy sprzedawcy, NIP nabywcy-firmy, data sprzedaży (gdy inna niż data
  wystawienia), nazwa, ilość i miara, cena jednostkowa, wartość, kwota należności ogółem i **podstawa zwolnienia** (pkt 19).
  Faktura na żądanie dla sprzedaży zwolnionej nie zawiera stawki, sumy według stawek ani kwoty podatku (ust. 4 pkt 3).
  Kwoty są zaokrąglane do grosza (ust. 11). Kwota słownie nie jest wymagana, jest dla wygody.
- **Identyfikator sprzedawcy** (art. 106e ust. 1 pkt 4): NIP albo PESEL, pole obowiązkowe. W działalności
  nierejestrowanej identyfikatorem podatkowym jest PESEL, a NIP, gdy osoba jest zarejestrowanym podatnikiem VAT albo ma
  kasę rejestrującą (art. 3 ust. 1 pkt 1 lit. b i ust. 1a ustawy o zasadach ewidencji i identyfikacji podatników
  i płatników). Walidacja: NIP z cyfrą kontrolną albo PESEL (wagi 1-3-7-9 i data urodzenia).
- **Adres sprzedawcy** jest obowiązkowy (art. 106e ust. 1 pkt 3). Przy rozbieżności ze wskazówką biznes.gov.pl, że
  w DN wystarczy imię i nazwisko, strona idzie za brzmieniem ustawy.
- **Tylko nabywca z Polski:** usługa dla firmy z zagranicy ma miejsce świadczenia u nabywcy (art. 28b), więc nie jest
  sprzedażą zwolnioną z art. 113, a faktura wymaga innych oznaczeń (art. 106e ust. 1 pkt 18 i 24).
- **Kiedy faktura i terminy:** zwolniony z art. 113 wystawia fakturę na żądanie nabywcy zgłoszone w ciągu 3 miesięcy od
  końca miesiąca sprzedaży (art. 106b ust. 2 i 3). Termin: do 15. dnia miesiąca po sprzedaży, gdy żądanie przyszło
  w miesiącu sprzedaży, a później do 15 dni od żądania (art. 106i ust. 6). Data wystawienia to zawsze dzisiejsza data
  (art. 106e ust. 1 pkt 1), także dlatego, że od niej zależy reguła KSeF.
- **KSeF i nabywca-firma** (`regulaKsef()`): art. 106ga ust. 1, art. 145l i **art. 145m**. Do 31.03.2026 faktury mogły
  być poza KSeF bez limitu. Od 1.04 do 31.12.2026 poza KSeF tylko wtedy, gdy faktury dla firm wystawione w miesiącu mają
  razem najwyżej 10 000 zł brutto; prawo traci się od faktury, z którą suma przekroczy tę kwotę, i każda kolejna faktura
  dla firmy do końca 2026 r. idzie do KSeF. FAQ MF [Poniżej 10 000 zł](https://ksef.podatki.gov.pl/ponizej-10-000-zl/):
  liczą się tylko faktury obowiązkowo wystawiane w KSeF (bez konsumenckich), miesiąc według daty wystawienia. Strona
  liczy faktury dla firm z tego miesiąca zapisane w przeglądarce, kwotę faktur wystawionych gdzie indziej i tę fakturę.
  Po potwierdzeniu, że faktura przekraczająca limit idzie do KSeF (albo po zaznaczeniu wcześniejszego przekroczenia),
  zapamiętuje miesiąc utraty prawa; pomyłkę można cofnąć z potwierdzeniem. **Od 1.01.2027 każda faktura dla firmy jest
  zablokowana** z odesłaniem do [ksef.podatki.gov.pl](https://ksef.podatki.gov.pl/).
- **Osoba prywatna:** faktury dla osoby fizycznej nieprowadzącej działalności są poza obowiązkiem KSeF (art. 106ga ust. 2
  pkt 4; FAQ MF [Konsumenci i osoby fizyczne](https://ksef.podatki.gov.pl/konsumenci-i-osoby-fizyczne/), pkt 7), także
  od 2027 r., i nie wliczają się do limitu.
- **Ewidencja bez dublowania** (`dodajFaktureDoEwidencji()`): wpis z opisem „Faktura N/RRRR: …” jest aktualizowany, wpis
  bez numeru faktury z tą samą datą sprzedaży i kwotą w PLN dostaje numer w opisie, w pozostałych przypadkach powstaje
  nowy wpis.
- **Ograniczenia:** reguły opierają się na zegarze systemowym i danych przeglądarki użytkownika, więc ich zmiana omija
  te reguły, a za zgodność faktury z przepisami odpowiada wystawca. Bez pamięci przeglądarki licznik limitu zna tylko
  faktury z bieżącej wizyty. Tylko PLN; faktury korygujące, zaliczkowe i w walucie obcej są poza zakresem.

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
- Faktury, dane sprzedawcy, zapisani klienci i zapamiętany miesiąc utraty prawa do faktur poza KSeF są w `localStorage`
  (klucz `dn-faktury-v1`), pod tym samym przełącznikiem „Pamiętaj wpisy” co ewidencja; „Wyczyść dane” usuwa je razem
  z ewidencją. Strona faktury nie łączy się z siecią.
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
- `test/faktura.test.js`: numeracja, blokada faktur dla firm od 2027 r., limit 10 000 zł w 2026 r. (równo, +1 grosz, faktury z innych miejsc, utrata prawa w kolejnych miesiącach, osoba prywatna poza limitem), data wystawienia równa dziś, sumy brutto i zaokrąglenia, kwota słownie, NIP i PESEL, elementy faktury, terminy, wydruk bez „null”, ewidencja bez dublowania, zachowanie bez `localStorage`, teksty okien (najwyżej 2 zdania w akapicie).
- `test/strony.test.js` (metadane): tytuły, opisy, `canonical`, Open Graph, JSON-LD (tylko `/` i `/faktura/`, poprawny JSON, bez `aggregateRating` i `review`), mapa strony (`sitemap.xml`: adresy kanoniczne, aktualne `lastmod`) i `robots.txt`, strona `404.html` (noindex, bez `canonical` i JSON-LD).
- `test/strony.test.js`: higiena stron: brak `noindex` na stronach z treścią i `noindex` na 404, nagłówki `X-Robots-Tag` w `_headers`, meta CSP zgodny z `_headers` (`connect-src` tylko `'self'` i api.nbp.pl), stopka, brak skryptów (poza blokiem danych `application/ld+json`), stylów i handlerów inline, brak zewnętrznych zasobów, w JS jedyny adres to API NBP w `nbp.js`, brak `document.cookie`/`innerHTML`, `localStorage` tylko w `magazyn.js`, `fetch` tylko w widoku ewidencji, etykiety pól i jeden region `aria-live`, strony prawne krótkie w porównaniu ze stronami funkcji (najwyżej 1,5× słów), brak odwołań do usuniętych stron, sekcja KSeF ≤ 150 słów, jedna akcja pobrania arkusza, arkusz bez makr i łączy, `_redirects` tylko stałe, w HTML jedyny adres e-mail to `kontakt@noblecode.pl`.
- Przed publikacją: `npm run check:publish` kończy się błędem, gdy w `public/` został placeholder `{{...}}` albo znacznik `[DO-UZUPEŁNIENIA…]` (miejsce w tekście do uzupełnienia).

CI: `.github/workflows/ci.yml` uruchamia `node --test` na Node 20 i 22 (push do `main` i pull requesty).

## Układ plików

```
public/                    gotowa strona (Cloudflare Pages, katalog wyjściowy)
  _headers                 nagłówki HTTP: CSP, nosniff; noindex tylko dla pliku XLSX i adresów *.pages.dev; arkusz zawsze jako załącznik
  _redirects               stałe przekierowania dawnych podstron
  robots.txt               crawl dozwolony, adres mapy strony
  sitemap.xml              mapa strony: pięć adresów kanonicznych
  index.html               ewidencja, szybkie sprawdzenie, arkusz, źródła, KSeF
  faktura/index.html       faktura bez VAT (zwolnienie)
  css/style.css, css/druk.css
  js/                      moduły opisane wyżej
  pobierz/arkusz-limit-dn.xlsx   arkusz do pobrania i wzór eksportu (generowany)
  regulamin/, prywatnosc/, o-nas/
  404.html                 strona „Nie ma takiej strony” (noindex); bez niej Cloudflare Pages zwraca stronę główną z kodem 200
scripts/arkusz.py          generator i kontrola arkusza (openpyxl)
scripts/sprawdz-publikacje.mjs   kontrola przed publikacją
test/                      testy node:test
```

## Wdrożenie (Cloudflare Pages)

- Build command: brak. Output directory: `public`.
- `public/_headers` ustawia CSP (z `frame-ancestors`), `nosniff`, `Referrer-Policy` i `Permissions-Policy`,
  a dla `/pobierz/*` typ pliku XLSX, `Content-Disposition: attachment` i `X-Robots-Tag: noindex`. Meta CSP w każdym HTML
  musi być taki sam (pilnuje tego test).
- Indeksowanie: strony z treścią nie mają `noindex`, a reguła `/*` w `_headers` nie ma `X-Robots-Tag` (Cloudflare łączy
  nagłówki z kilku pasujących reguł). `noindex` mają tylko `404.html`, plik XLSX i adresy `*.pages.dev`, żeby w wynikach
  był wyłącznie `dn.noblecode.pl`. `robots.txt` pozwala na crawl całej strony i wskazuje `sitemap.xml`; `lastmod` w mapie
  to data ostatniej zmiany pliku HTML (`git log -1 --format=%cs -- public/…/index.html`), więc przy zmianie strony
  zmień też mapę.
- Sprawdzenie po wdrożeniu (`curl -I`):
  - `https://dn.noblecode.pl/` i `https://dn.noblecode.pl/faktura/`: 200, bez `X-Robots-Tag`;
  - `https://dn.noblecode.pl/pobierz/arkusz-limit-dn.xlsx`: `X-Robots-Tag: noindex`;
  - `https://dn-narzedzia.pages.dev/`: `X-Robots-Tag: noindex`;
  - `/faktura` → `/faktura/`, `/index.html` → `/`, `/ewidencja/` → `/` (301), `http://` → `https://`;
  - `https://dn.noblecode.pl/robots.txt` i `https://dn.noblecode.pl/sitemap.xml`: 200;
  - `curl -I https://dn.noblecode.pl/nie-istnieje`: 404 (strona `404.html`, a nie strona główna z kodem 200).
- Metadane wyszukiwarek: każda strona ma `<title>`, `description`, Open Graph (bez obrazu) i `link rel="canonical"`
  na `https://dn.noblecode.pl/…`. Strona główna i `/faktura/` mają dane strukturalne JSON-LD (`WebSite`
  i `WebApplication`) w bloku `<script type="application/ld+json">`: przeglądarka go nie wykonuje, więc CSP zostaje
  bez zmian. Testy pilnują tytułów, opisów, `canonical` = `og:url` i poprawnego JSON-LD bez ocen i recenzji.
- Cloudflare Web Analytics jest **wyłączone**. Włączenie wymaga dopisania do CSP (meta i `_headers`)
  `https://static.cloudflareinsights.com` w `script-src` i `https://cloudflareinsights.com` w `connect-src`
  oraz opisu analityki w polityce prywatności.

## Zmiana roku

Kwota limitu i część opisów zależą od roku. Na początku każdego roku trzeba zaktualizować:

- Płacę minimalną: kwota na nowy rok musi być w `PLACA_MINIMALNA` (`public/js/logic.js`) i w `PLACA`
  (`scripts/arkusz.py`); po zmianie arkusz odtwarza `npm run arkusz`.
- Stronę główną: rok i kwotę limitu w `<title>`, `description`, `og:title`, `og:description` i w opisie JSON-LD
  (dla 2027 r.: 11 137,50 zł); ten sam tytuł trzeba wpisać w `METADANE` w `test/strony.test.js`.
- `/faktura/`: opis strony i ostatni punkt `featureList` opisują zasady KSeF w danym roku. Od 2027 r. opis jest
  w wersji dla osoby prywatnej („Faktury dla firm od 2027 r. wystawiasz w KSeF”), a ostatni punkt `featureList` to
  „Od 2027 r. faktury dla firm tylko w KSeF: strona odsyła do aplikacji Ministerstwa Finansów”.

## Źródła

- Limit: art. 5 ust. 1 ustawy z 6 marca 2018 r. – Prawo przedsiębiorców (przychód należny w kwartale do 225% minimalnego wynagrodzenia).
- Minimalne wynagrodzenie: 4806 zł w 2026 r. ([Dz.U. 2025 poz. 1242](https://eli.gov.pl/eli/DU/2025/1242/ogl)),
  4950 zł w 2027 r. ([Dz.U. 2026 poz. 1213](https://eli.gov.pl/eli/DU/2026/1213/ogl)).
- Działalność nierejestrowana, ewidencja i przekroczenie limitu: [biznes.gov.pl](https://www.biznes.gov.pl/pl/portal/00115),
  [podatki.gov.pl](https://www.podatki.gov.pl/poradniki-i-informatory/dzialalnosc-nierejestrowana); art. 109 ustawy o VAT.
- Kurs średni NBP z ostatniego dnia roboczego przed dniem uzyskania przychodu: art. 11a ust. 1 ustawy o PIT; dane z [API NBP](https://api.nbp.pl/).
- Dni wolne od pracy: ustawa z 18 stycznia 1951 r. o dniach wolnych od pracy; Wigilia od 2025 r. (Dz.U. 2024 poz. 1965).
- KSeF: [ksef.podatki.gov.pl](https://ksef.podatki.gov.pl/), [Poniżej 10 000 zł](https://ksef.podatki.gov.pl/ponizej-10-000-zl/),
  [Konsumenci i osoby fizyczne](https://ksef.podatki.gov.pl/konsumenci-i-osoby-fizyczne/).
- Faktura: ustawa o VAT, t.j. [Dz.U. 2026 poz. 1263](https://api.sejm.gov.pl/eli/acts/DU/2026/1263/text.pdf) (art. 28b, 106b,
  106e, 106ga, 106i, 113, 145l, 145m); ustawa o zasadach ewidencji i identyfikacji podatników i płatników, t.j.
  [Dz.U. 2026 poz. 151](https://api.sejm.gov.pl/eli/acts/DU/2026/151/text.pdf) (art. 3).

Narzędzia podają informacje ogólne i nie stanowią doradztwa podatkowego.

## Bezpieczeństwo i kontakt

Podatności zgłaszaj prywatnie, zgodnie z [SECURITY.md](SECURITY.md). Kontakt: `kontakt@noblecode.pl`.

## Licencja

MIT, `Copyright (c) 2026 NobleCode`, zob. [LICENSE](LICENSE). Strona nie ma zależności zewnętrznych;
generator arkusza używa openpyxl (MIT), który nie trafia do `public/`.

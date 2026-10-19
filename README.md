# Narzędzia DN (`dn.noblecode.pl`)

Darmowe narzędzia dla działalności nierejestrowanej (DN), działające w całości w przeglądarce:
kalkulator limitu przychodu, ewidencja sprzedaży w pliku użytkownika i informacje o KSeF od 2027 r.

> Eksperyment NobleCode, prowadzony z udziałem AI · Nie stanowi doradztwa podatkowego

Wersja 0.1. To wersja testowa: strony mają `noindex` (zob. „Wdrożenie”).

## Co jest w środku

| Strona | Co robi |
|---|---|
| `/` | strona startowa z odnośnikami do narzędzi |
| `/limit-dzialalnosc-nierejestrowana/` | kalkulator limitu kwartalnego: 2026 = 10 813,50 zł (225% × 4806 zł), 2027 = 11 137,50 zł (225% × 4950 zł); płaca minimalna jako parametr; progi 70/85/95/100%; przychód wpisany ręcznie albo wczytany z pliku ewidencji; ogólna informacja o skutkach przekroczenia limitu (7 dni na wniosek do CEIDG) z linkami do biznes.gov.pl i podatki.gov.pl |
| `/ewidencja-sprzedazy-dzialalnosc-nierejestrowana/` | ewidencja sprzedaży w pliku CSV użytkownika: otwieranie i zapis (File System Access API, a bez niego pobranie pliku), dodawanie wpisów, korekty (zwroty), import eksportów Gumroad i Polar, kurs średni NBP z ostatniego dnia roboczego przed sprzedażą (API NBP), status limitu, widok ustawowy (dzień, kwota, narastająco w miesiącu) i wydruk/PDF; opcjonalna kopia robocza w `localStorage` z ostrzeżeniem o Safari (7 dni) |
| `/ksef-2027-dzialalnosc-nierejestrowana/` | informacje ogólne o KSeF z datami i źródłami (stan na 18.10.2026); bez kreatora i bez wniosków indywidualnych |
| `/regulamin/`, `/prywatnosc/`, `/o-nas/` | regulamin, polityka prywatności oraz informacje o narzędziach, usługodawcy i udziale AI |

## Plik ewidencji

Ewidencja to zwykły plik CSV, który zostaje u użytkownika. Kolumny (nagłówek w pierwszym wierszu):

```
lp,data,kanal,id_transakcji,opis,kwota,waluta,kurs_nbp,data_kursu,kwota_pln,korekta_do
```

- Zapis dodaje BOM UTF-8, żeby Excel poprawnie pokazał polskie znaki. Odczyt BOM pomija.
- Korekta (np. zwrot) to wpis z ujemną kwotą i numerem `lp` korygowanego wpisu w `korekta_do`.
  Usunąć można tylko ostatni wpis, żeby nie przenumerowywać `lp` i odwołań korekt.
- Pola tekstowe zaczynające się od `=`, `+`, `-` albo `@` dostają przy zapisie prefiks `'` (ochrona przed formułami w arkuszu).
- Kwoty są liczone w groszach na `BigInt`, z zaokrągleniem połówkowym od zera (jak `ROUND_HALF_UP`), bez liczb zmiennoprzecinkowych.

## Założenia importu (z kodu źródłowego platform, bez próbki prawdziwego eksportu)

- **Gumroad** (eksport sprzedaży): kolumny ustalone z kodu źródłowego Gumroad
  (`antiwork/gumroad`, fixture `spec/support/fixtures/financial-annual-summary-2022.csv`).
  Kwota = `Sale Price ($)`, czyli cena zapłacona przez kupującego (wariant konserwatywny).
  Waluta z nagłówka kolumny (`$` = USD). Data = dzień w strefie Europe/Warsaw z `Purchase Time (UTC timezone)`.
  Pomijamy wiersz `Totals` i sprzedaż za 0. Zwroty i spory nie są księgowane automatycznie (brak daty zwrotu w eksporcie), tylko zgłaszane do ręcznej korekty.
- **Polar** (eksport zamówień): kolumny z `server/polar/order/export.py` w `polarsource/polar`
  (domyślnie: `Email, Created At, Product, Net Amount, Currency, Status, Invoice number`; opcjonalnie m.in. `Total`, `Refunded Amount`).
  Kwota = `Total` (z podatkiem). Bez `Total` używamy `Net Amount` z ostrzeżeniem. Statusy `pending` i `void` pomijamy.
  Bez numeru faktury identyfikator składa się z daty, produktu i kwoty.
- E-maile, imiona i adresy kupujących są odrzucane przy imporcie i nigdy nie trafiają do ewidencji.

## Prywatność

- Brak backendu, kont i ciasteczek. Pliki CSV są czytane lokalnie (`File.text()`), nic nie jest wysyłane.
- Jedyne zapytanie zewnętrzne: `https://api.nbp.pl/api/exchangerates/rates/a/{waluta}/{od}/{do}/`.
  Do NBP trafia tylko kod waluty i zakres dat, z `credentials: 'omit'` (NBP ustawia ciasteczko, przeglądarka go nie zapisze) i bez nagłówka `Referer`.
- Kopia robocza w `localStorage` jest opcjonalna (domyślnie wyłączona) i zawsze stoi przy niej ostrzeżenie o Safari.
- CSP: `default-src 'none'`, skrypty i style tylko z tej samej domeny, połączenia tylko do `https://api.nbp.pl`.
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

- `test/logic.test.js`: limit, progi, kwartały, strefa czasowa, kurs NBP (fetch wstrzyknięty, bez sieci), CSV, walidacja ewidencji, raport, import Gumroad i Polar.
- `test/wspolne.test.js`: komunikaty progów, odporny dostęp do `localStorage`.
- `test/strony.test.js`: higiena stron: `noindex`, meta CSP zgodny z `_headers`, stopka, brak skryptów, stylów i handlerów inline, brak zewnętrznych zasobów, brak `document.cookie`/`innerHTML`, w HTML jedyny adres e-mail to `kontakt@noblecode.pl` (link `mailto:` na każdej stronie; każdy inny adres, także zakodowany jako `&#64;`/`%40`, oblewa test).
- Przed publikacją: `npm run check:publish` kończy się błędem, gdy w `public/` został placeholder `{{...}}` albo znacznik `[DO-UZUPEŁNIENIA…]` (miejsce w tekście do uzupełnienia).

CI: `.github/workflows/ci.yml` uruchamia `node --test` na Node 20 i 22 (push do `main` i pull requesty).

## Układ plików

```
public/                    gotowa strona (Cloudflare Pages, katalog wyjściowy)
  _headers                 nagłówki HTTP: CSP, noindex, nosniff, Referrer-Policy, Permissions-Policy
  robots.txt
  css/style.css
  js/logic.js              logika bez DOM: kwoty, daty, limit, kurs NBP, CSV, ewidencja, import
  js/wspolne.js            komunikaty progów, dostęp do localStorage, nazwa pliku
  js/limit.js              widok kalkulatora limitu
  js/ewidencja.js          widok ewidencji
  */index.html             podstrony
scripts/sprawdz-publikacje.mjs   kontrola przed publikacją
test/                      testy node:test
```

## Wdrożenie (Cloudflare Pages)

- Build command: brak. Output directory: `public`.
- `public/_headers` ustawia CSP (z `frame-ancestors`), `X-Robots-Tag: noindex`, `nosniff`, `Referrer-Policy` i `Permissions-Policy`.
  Meta CSP w każdym HTML musi być taki sam (pilnuje tego test).
- Wersja testowa ma `noindex` w meta `robots` i w nagłówku `X-Robots-Tag`. `robots.txt` pozwala na crawl, żeby wyszukiwarki widziały `noindex`.
  Włączenie indeksowania wymaga zdjęcia `noindex` (meta, `_headers`, testy) i dodania `sitemap.xml`.
- Cloudflare Web Analytics jest **wyłączone**. Włączenie wymaga dopisania do CSP (meta i `_headers`)
  `https://static.cloudflareinsights.com` w `script-src` i `https://cloudflareinsights.com` w `connect-src`
  oraz opisu analityki w polityce prywatności.

## Źródła

- Limit: art. 5 ust. 1 ustawy z 6 marca 2018 r. – Prawo przedsiębiorców (przychód należny w kwartale do 225% minimalnego wynagrodzenia).
- Minimalne wynagrodzenie: 4806 zł w 2026 r. ([Dz.U. 2025 poz. 1242](https://eli.gov.pl/eli/DU/2025/1242/ogl)),
  4950 zł w 2027 r. ([Dz.U. 2026 poz. 1213](https://eli.gov.pl/eli/DU/2026/1213/ogl)).
- Działalność nierejestrowana i przekroczenie limitu: [biznes.gov.pl](https://www.biznes.gov.pl/pl/portal/00115),
  [podatki.gov.pl](https://www.podatki.gov.pl/poradniki-i-informatory/dzialalnosc-nierejestrowana).
- Kurs średni NBP z ostatniego dnia roboczego przed dniem uzyskania przychodu: art. 11a ust. 1 ustawy o PIT; dane z [API NBP](https://api.nbp.pl/).
- KSeF: [ksef.podatki.gov.pl](https://ksef.podatki.gov.pl/) (szczegółowe odnośniki na podstronie KSeF).

Narzędzia podają informacje ogólne i nie stanowią doradztwa podatkowego.

## Bezpieczeństwo i kontakt

Podatności zgłaszaj prywatnie, zgodnie z [SECURITY.md](SECURITY.md). Kontakt: `kontakt@noblecode.pl`.

## Licencja

MIT, `Copyright (c) 2026 NobleCode`, zob. [LICENSE](LICENSE). Bez zależności zewnętrznych.

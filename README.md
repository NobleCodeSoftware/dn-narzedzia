# Limit DN (`dn.noblecode.pl`)

Licznik limitu przychodu działalności nierejestrowanej (DN) i darmowy arkusz do pobrania.
Strona działa w całości w przeglądarce: bez kont, bez serwera aplikacji i bez zapytań do innych serwerów.

> Eksperyment NobleCode, prowadzony z udziałem AI · Nie stanowi doradztwa podatkowego

To wersja testowa: strony mają `noindex` (zob. „Wdrożenie”).

## Co jest w środku

| Ścieżka | Co robi |
|---|---|
| `/` | „Limit działalności nierejestrowanej 2026 i 2027”: licznik (kwartał + sprzedaż w kwartale → procent limitu, progi 70/85/95/100%), kwoty limitu ze źródłami (2026 = 10 813,50 zł = 225% × 4806 zł; 2027 = 11 137,50 zł = 225% × 4950 zł), ogólna informacja o przekroczeniu limitu (7 dni na wniosek do CEIDG), krótka sekcja „KSeF od 2027” z linkami do ksef.podatki.gov.pl i biznes.gov.pl |
| `/pobierz/arkusz-limit-dn.xlsx` | darmowy arkusz (Excel, LibreOffice, Arkusze Google; bez makr i połączeń z siecią): data, opis, kwota, waluta, kurs NBP, kwota w PLN, suma kwartału narastająco, % limitu i ostrzeżenia (formatowanie warunkowe 70/85/95/100%); zakładki „Podsumowanie” (kwartały 2026–2028), „Limity” (płaca minimalna na rok, do uzupełnienia na 2028+), „Instrukcja” (m.in. jak znaleźć kurs średni NBP z dnia roboczego przed sprzedażą) |
| `/regulamin/`, `/prywatnosc/`, `/o-nas/` | regulamin, polityka prywatności oraz informacje o narzędziu, usługodawcy i udziale AI |
| `_redirects` | stałe przekierowania 301 dawnych podstron (`/limit-…`, `/ksef-2027-…`, `/ewidencja-sprzedazy-…`) na `/` |

Logika licznika (`public/js/logic.js`) liczy kwoty w groszach na `BigInt`, z zaokrągleniem połówkowym od zera
(jak `ROUND_HALF_UP`), bez liczb zmiennoprzecinkowych. Kwoty płacy minimalnej są w dwóch miejscach:
`PLACA_MINIMALNA` w `logic.js` i `PLACA` w `scripts/arkusz.py`. Zmieniaj je razem.

## Arkusz XLSX: jak odtworzyć

```sh
pip install openpyxl                  # MIT
python3 scripts/arkusz.py --sprawdz   # zapisuje public/pobierz/arkusz-limit-dn.xlsx i sprawdza plik
```

Plik jest deterministyczny (stałe daty w metadanych i w ZIP), więc ponowne uruchomienie bez zmian w skrypcie daje
identyczny plik. `--sprawdz` ponownie wczytuje plik przez openpyxl i odrzuca makra, łącza zewnętrzne, `HYPERLINK`
i adresy w formułach. Formuły sprawdzono też w LibreOffice (headless, przeliczenie na danych przykładowych, bez błędów `#…`).
Używane funkcje: `IF`, `OR`, `AND`, `ISNUMBER`, `ROUND`, `SUMIFS`, `COUNTIFS`, `DATE`, `YEAR`, `MONTH`, `INT`, `EOMONTH`,
`VLOOKUP`, `IFERROR` (są w Excelu 2010+, LibreOffice i Arkuszach Google).

## Prywatność

- Brak backendu, kont, ciasteczek, pamięci przeglądarki i zapytań do innych serwerów (CSP `default-src 'none'`, bez `connect-src`).
- Kwota wpisana w licznik nie opuszcza przeglądarki. Arkusz nie ma makr ani połączeń z siecią.
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
- `test/wspolne.test.js`: komunikaty progów i zdanie z kwotami.
- `test/strony.test.js`: higiena stron: `noindex`, meta CSP zgodny z `_headers` (bez `connect-src`), stopka, brak skryptów, stylów i handlerów inline, brak zewnętrznych zasobów i adresów w JS, brak `document.cookie`/`innerHTML`/`localStorage`/`fetch`, brak odwołań do usuniętych stron, sekcja KSeF ≤ 150 słów, jedna akcja pobrania arkusza, arkusz bez makr i łączy, `_redirects` tylko stałe, w HTML jedyny adres e-mail to `kontakt@noblecode.pl`.
- Przed publikacją: `npm run check:publish` kończy się błędem, gdy w `public/` został placeholder `{{...}}` albo znacznik `[DO-UZUPEŁNIENIA…]` (miejsce w tekście do uzupełnienia).

CI: `.github/workflows/ci.yml` uruchamia `node --test` na Node 20 i 22 (push do `main` i pull requesty).

## Układ plików

```
public/                    gotowa strona (Cloudflare Pages, katalog wyjściowy)
  _headers                 nagłówki HTTP: CSP, noindex, nosniff; arkusz zawsze jako załącznik
  _redirects               stałe przekierowania dawnych podstron
  robots.txt
  index.html               licznik, kwoty limitu, przekroczenie, KSeF
  css/style.css
  js/logic.js              logika licznika bez DOM: kwoty, kwartały, limit, progi
  js/wspolne.js            teksty wyniku
  js/limit.js              widok licznika
  pobierz/arkusz-limit-dn.xlsx   arkusz do pobrania (generowany)
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
- Działalność nierejestrowana i przekroczenie limitu: [biznes.gov.pl](https://www.biznes.gov.pl/pl/portal/00115),
  [podatki.gov.pl](https://www.podatki.gov.pl/poradniki-i-informatory/dzialalnosc-nierejestrowana).
- KSeF: [ksef.podatki.gov.pl](https://ksef.podatki.gov.pl/), [Poniżej 10 000 zł](https://ksef.podatki.gov.pl/ponizej-10-000-zl/).

Strona podaje informacje ogólne i nie stanowi doradztwa podatkowego.

## Bezpieczeństwo i kontakt

Podatności zgłaszaj prywatnie, zgodnie z [SECURITY.md](SECURITY.md). Kontakt: `kontakt@noblecode.pl`.

## Licencja

MIT, `Copyright (c) 2026 NobleCode`, zob. [LICENSE](LICENSE). Strona nie ma zależności zewnętrznych;
generator arkusza używa openpyxl (MIT), który nie trafia do `public/`.

# Włączenie indeksowania

Katalog zawiera konfigurację serwisu z włączonym indeksowaniem w wyszukiwarkach. Leży poza `public/`, więc jego
pliki nie są publikowane: dopóki strony mają `noindex`, obowiązują odpowiedniki w `public/`.

## Pliki

| Plik | Odpowiednik w `public/` | Czym się różni |
|---|---|---|
| `_headers` | `public/_headers` | reguła `/*` nie ma `X-Robots-Tag`; `X-Robots-Tag: noindex` mają tylko `/pobierz/*` i adresy `*.pages.dev`; CSP i pozostałe nagłówki są takie same |
| `robots.txt` | `public/robots.txt` | ma dodatkowy wiersz `Sitemap:` z adresem mapy strony |
| `sitemap.xml` | brak (nowy plik) | mapa strony z pięcioma adresami kanonicznymi stron z treścią; `lastmod` to data ostatniej zmiany danego pliku HTML (np. `git log -1 --format=%cs -- public/…/index.html`) |

## Serwis z włączonym indeksowaniem

- Strony z treścią nie mają `<meta name="robots" content="noindex, nofollow">`; `404.html` zachowuje `noindex`.
- Pliki z tego katalogu zastępują odpowiedniki w `public/`, a `sitemap.xml` jest nowym plikiem w `public/`.
- Odpowiednie testy w `test/strony.test.js` sprawdzają brak `noindex` na stronach z treścią, `noindex` dla `/pobierz/*`
  i `*.pages.dev` oraz to, że każdy `<loc>` w mapie strony ma plik HTML z takim samym `canonical`.
- Wdrożoną konfigurację widać w nagłówkach HTTP, na przykład:
  - `curl -I https://dn.noblecode.pl/`: 200, bez `X-Robots-Tag`;
  - `curl -I https://dn.noblecode.pl/pobierz/arkusz-limit-dn.xlsx`: `X-Robots-Tag: noindex`;
  - `curl -I https://dn-narzedzia.pages.dev/`: `X-Robots-Tag: noindex`;
  - `curl -I https://dn.noblecode.pl/nie-istnieje`: 404 (strona `404.html`, a nie strona główna z kodem 200).

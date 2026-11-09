# Narzędziownik DN (`dn.noblecode.pl`)

Ewidencja sprzedaży i limit działalności nierejestrowanej (DN) w przeglądarce: stan kwartału, prognoza przekroczenia,
kurs średni NBP, wydruk ewidencji, faktura bez VAT (zwolnienie) do druku i PDF, a do tego szybki licznik limitu
i darmowy arkusz do pobrania.
Bez kont i bez serwera aplikacji: wszystko działa w przeglądarce.

> Eksperyment NobleCode, prowadzony z udziałem AI · Nie stanowi doradztwa podatkowego

Wersja 0.4.5. Strony są indeksowane przez wyszukiwarki (zob. „Wdrożenie”).

## Co jest w środku

| Ścieżka | Co robi |
|---|---|
| `/` | ewidencja sprzedaży: dodawanie, edycja i usuwanie wpisów; stan bieżącego kwartału z progami 70/85/95/100% (kwota progu, dzień osiągnięcia albo prognozy); prognoza przekroczenia (data, zapas, kwota na koniec kwartału, średnio dziennie do końca kwartału); historia kwartałów; „Co się stanie po przekroczeniu limitu” (data przekroczenia i termin 7 dni na wniosek do CEIDG z dopiskiem, gdy termin wypada w dzień wolny, linki do biznes.gov.pl i ZUS, bez liczenia podatku); zwroty z datą dokumentu korekty i ostrzeżeniem, gdy wynik zależy od wyboru kwartału; kurs średni NBP z ostatniego dnia roboczego przed sprzedażą (automatycznie, z obsługą świąt, możliwy kurs ręczny, „Uzupełnij kursy NBP” po imporcie); import i eksport XLSX/CSV w układzie arkusza; wydruk/PDF uproszczonej ewidencji za rok; pamięć przeglądarki z dwoma przełącznikami (wpisy ewidencji; Twoje dane i dane klientów do faktur) i „Wyczyść dane”; przykładowe dane. Niżej: „Szybkie sprawdzenie bez ewidencji” (licznik kwota ÷ limit), arkusz do pobrania, źródła kwot i krótka sekcja o KSeF od 2027 |
| `/faktura/` | faktura bez VAT (zwolnienie) dla sprzedawcy zwolnionego z VAT: klient prywatny albo firma z Polski (NIP z cyfrą kontrolną), do 10 pozycji (ilość × cena, zaokrąglenie do grosza), kwota słownie, kolejny numer N/RRRR, podstawa zwolnienia (art. 113 ust. 1, ust. 9 albo własna), termin wystawienia i termin prośby klienta (także po późniejszej zapłacie albo zaliczce), reguła KSeF z blokadą, wydruk/PDF przez okno drukowania, lista wystawionych faktur, zapamiętani klienci i dane sprzedawcy (tylko po włączeniu), opcjonalne dopisanie sprzedaży do ewidencji bez dublowania |
| `/pobierz/arkusz-limit-dn.xlsx` | darmowy arkusz (Excel, LibreOffice, Arkusze Google; bez makr i połączeń z siecią): data, opis, kwota, waluta, kurs NBP, kwota w PLN, suma kwartału narastająco, % limitu i ostrzeżenia (formatowanie warunkowe 70/85/95/100%); zakładki „Podsumowanie” (kwartały 2026–2035), „Limity” (płaca minimalna na rok, do uzupełnienia na 2028+), „Instrukcja” |
| `/regulamin/`, `/prywatnosc/`, `/o-nas/` | regulamin, polityka prywatności oraz informacje o narzędziach, usługodawcy i udziale AI |
| `_redirects` | stałe przekierowania 301 dawnych podstron (`/limit-…`, `/ksef-2027-…`, `/ewidencja-sprzedazy-…`, `/ewidencja/`) na `/` |

### Moduły (`public/js/`)

- `faktura-logika.js`: faktura bez DOM: walidacja, NIP i PESEL, sumy, kwota słownie, terminy, reguła KSeF, dane wydruku, dopisanie do ewidencji.
- `faktura-widok.js`: widok strony `/faktura/` (DOM), bez połączeń sieciowych.
- `ewidencja-logika.js`: wpisy, kwoty w PLN, kwartały, progi, prognoza, wartości kolumn F–I, wiersze wydruku, import, numeracja dokumentów.
- `kalendarz.js`: dni ustawowo wolne od pracy w Polsce (z regułą Wielkanocy), dzień kursu NBP, najbliższy dzień roboczy.
- `nbp.js`: zapytania do api.nbp.pl, wybór kursu, kursy dla wielu wpisów naraz.
- `csv.js`, `xlsx.js`, `zip.js`: własny, minimalny odczyt i zapis CSV i XLSX bez bibliotek (ZIP + `CompressionStream('deflate-raw')`).
- `magazyn.js`: jedyny moduł z dostępem do `localStorage`.
- `ewidencja-widok.js`: widok (DOM). Elementy powstają przez `createElement` i `textContent`, bez wstawiania HTML z tekstu.
- `logic.js`, `wspolne.js`, `limit.js`: szybki licznik limitu; w `wspolne.js` także dopisek o terminie CEIDG w dzień wolny i treść okna wyłączenia pamięci (o danych do faktur tylko wtedy, gdy mogą być zapisane).
- Wydruk: `css/druk.css` (`media="print"`).

Kwoty są liczone w groszach na `BigInt`, bez liczb zmiennoprzecinkowych.

### Prognoza

Średnia dzienna sprzedaż od początku kwartału do dziś (włącznie) × pozostałe dni kwartału. Data przekroczenia to pierwszy
dzień, w którym prognozowana suma przekracza limit. Prognoza jest oznaczona jako mało pewna, gdy od początku kwartału
minęło mniej niż 14 dni albo są mniej niż 3 wpisy.

Stan kwartału (suma, zapas, progi osiągnięte i przekroczenie) liczy tylko sprzedaż do dziś włącznie. Sprzedaż z datą
po dziś jest zaplanowana: widok pokazuje ją osobno, a prognoza na dany dzień to sprzedaż do dziś plus większa z kwot:
wynik tempa albo zaplanowana sprzedaż do tego dnia (bez liczenia jej dwa razy). Sprzedaż w walucie bez kursu NBP nie
wchodzi do sumy, a stan kwartału mówi, ile takich wpisów jest i że suma może być zaniżona.

### Zwroty i przekroczenie

Zwrot to wpis z kwotą ujemną. Liczy się w kwartale swojej daty, czyli daty dokumentu korekty (faktury korygującej albo
innego dokumentu, np. potwierdzenia zwrotu pieniędzy), a nie daty sprzedaży; formularz mówi o tym przy dacie. To analogia
do art. 14 ust. 1m ustawy o PIT, bo przepisy o limicie tego nie rozstrzygają.

- **Przekroczenie się nie cofa** (art. 5 ust. 3 ustawy Prawo przedsiębiorców): gdy suma narastająco przekroczy limit dnia
  D, kwartał do końca ma stan „przekroczony od D” i termin D + 7 dni, także gdy późniejsze zwroty obniżą sumę poniżej limitu
  (`statusKwartalu()`). Tak samo kolumna „Ostrzeżenie” w eksporcie CSV i XLSX: od dnia przekroczenia do końca kwartału
  ma „Limit przekroczony” (`wartosciArkusza()`). Formuły arkusza XLSX (gdy program
  arkuszowy przelicza je przy otwarciu) liczą tak samo (zob. „Eksport XLSX”).
- **Ostrzeżenie** (`ostrzezeniaZwrotow()`): gdy bez zwrotu limit jego kwartału byłby przekroczony (albo przekroczony
  wcześniej) i gdy zwrot oznaczono jako dotyczący sprzedaży z wcześniejszego kwartału (nieobowiązkowe pole „Zwrot dotyczy
  sprzedaży z dnia”, w pliku CSV i XLSX kolumna J). Pole służy tylko do ostrzeżenia i niczego nie przelicza w innym
  kwartale. Przy zwrocie pole daty ma etykietę „Data dokumentu korekty”. Zdanie „Bez niego limit
  byłby przekroczony dnia …” pojawia się tylko wtedy, gdy to prawda.
- Kwartał z samymi zwrotami ma 0% i pusty pasek, także w kolumnie „% limitu” eksportu; nadwyżka zwrotów nie przechodzi
  do innego kwartału.
- Termin wniosku do CEIDG to D + 7 dni kalendarzowych, bez przesunięcia. Gdy wypada w sobotę, niedzielę albo święto,
  strona dopisuje najbliższy dzień roboczy z zastrzeżeniem, że przepisy tego nie przesądzają (`dopisekTerminu()`).

### Kurs NBP

Dzień kursu wynika z kalendarza (`kalendarz.js`): ostatni dzień roboczy przed datą sprzedaży, z pominięciem weekendów
i świąt. Kalendarz porównano z datami tabel A NBP od 1.01.2025 do 21.10.2026 (456 tabel, bez rozbieżności).
Strona pyta o zakres 10 dni kończący się na dniu kursu (`/api/exchangerates/rates/a/{kod}/{od}/{do}/`) i bierze ostatnią
tabelę nie późniejszą niż dzień kursu. Gdy dzień kursu to dziś, a tabeli jeszcze nie ma, strona nie bierze starszego kursu.
API NBP odpowiada nagłówkiem `Access-Control-Allow-Origin: *` (także na 404), więc działa z przeglądarki.
Kurs jest zapisywany tak, jak podaje go NBP, bez zaokrąglania: część walut ma więcej niż 4 miejsca po przecinku
(np. HUF 0,012115, IDR 0,00021529).

### Kolumny ewidencji i wydruk

Przepisy nie określają dokładnie, co ma zawierać uproszczona ewidencja sprzedaży (art. 109 ust. 1 ustawy o VAT).
Według [biznes.gov.pl](https://www.biznes.gov.pl/pl/portal/00115) zwykle są to: liczba porządkowa, data sprzedaży,
wartość sprzedaży i wartość narastająco od początku roku; można dopisać numer dowodu albo rodzaj transakcji.
Wydruk ma te kolumny oraz opis, narastająco w kwartale i walutę z kursem.

### Import

Import XLSX/CSV przyjmuje kwoty w zapisie polskim i angielskim („1 234,50”, „1.234,50”, „1,234.50”). Kwotę z jednym
separatorem i dokładnie trzema cyframi po nim („1,234”, „1.234”) odrzuca z błędem wiersza, bo może oznaczać 1234 zł
albo 1,234 zł; formularz pokazuje wtedy komunikat. Separator tysięcy (kropka, przecinek albo spacja) musi dzielić
liczbę co trzy cyfry: „1,234,5”, „1.23,45” i „12 34,5” to błąd wiersza, a nie 12345 albo 123,45.

Kolumny są rozpoznawane po nagłówku („Data” albo „Data sprzedaży”, „Kwota” albo „Kwota sprzedaży”, „Opis”, „Waluta”,
„Kurs NBP”, „Zwrot dotyczy sprzedaży z dnia”). **CSV bez nagłówka** jest czytany w układzie A–E (data, opis, kwota,
waluta, kurs), a kolumna J jest wtedy pomijana: datę sprzedaży, której dotyczy zwrot, import czyta tylko z pliku
z nagłówkiem. Gdy nagłówka nie ma, a pierwszy wiersz nie zaczyna się datą i nie ma kwoty w kolumnie C (np. nagłówek
po angielsku), import odmawia z jednym komunikatem zamiast czytać kolumny po pozycji.

Kolumna J („Zwrot dotyczy sprzedaży z dnia”) jest nieobowiązkowa. Pliki bez niej (eksporty sprzed wersji 0.4.4,
arkusze z innych programów) wczytują się jak dotąd. Data w kolumnie J liczy się tylko przy zwrocie; błędna albo późniejsza
niż data dokumentu korekty daje błąd wiersza, a wypełniona przy kwocie dodatniej też (zwrot zapisany bez minusa).

Inne błędy wiersza zamiast cichej zmiany danych: kurs bez waluty, kurs przy kwocie w PLN (inny niż 1), w CSV
z nagłówkiem pole za ostatnią kolumną nagłówka (zwykle przecinek dziesiętny bez cudzysłowu przy separatorze „,”),
w XLSX liczba w kolumnie daty, która nie jest datą Excela (np. 5 albo 3123456789). Niezamknięty cudzysłów w CSV
zatrzymuje cały import z numerem wiersza. CSV zapisany w Windows-1250 (polski Excel) jest rozpoznawany, gdy plik nie
jest poprawnym UTF-8. W XLSX z systemem dat 1904 każda kolumna dat liczy się według tego systemu.

### Eksport XLSX

Eksport wypełnia kolumny A–E i J wzoru `/pobierz/arkusz-limit-dn.xlsx` i zapisuje wyliczone wartości F–I (formuły
zostają), pozostałe zakładki zostają bez zmian. Przy ponad 1000 wpisach eksport rozszerza zakresy formuł.

Wzór ma ustawione pełne przeliczenie przy otwarciu (`fullCalcOnLoad`). Czy program arkuszowy pokaże wynik formuł, czy
zapisane wartości, zależy od programu i jego ustawień (w LibreOffice Calc: przeliczanie przy wczytywaniu plików Excela).
Wynik jest ten sam: zapisane wartości F–I pochodzą ze strony, a formuły liczą tak jak strona:
- G (`Suma kwartału`) i „Przychód” w „Podsumowaniu” są zaokrąglone do grosza (`ROUND(SUMIFS(…), 2)`), więc suma
  ułamkowych kwot równa limitowi daje dokładnie 100%, jak na stronie, niezależnie od arytmetyki programu;
- H (`% limitu`) = `MAX(0, G / limit)`, więc kwartał z samymi zwrotami ma 0%, a nie ujemny procent;
- I (`Ostrzeżenie`) ma „Limit przekroczony”, gdy w tym kwartale do daty wiersza któryś wiersz miał H > 1
  (`COUNTIFS` po H i datach), więc późniejszy zwrot nie cofa przekroczenia; kolor wiersza też zostaje czerwony;
- zakładka „Podsumowanie”: procent nie spada poniżej 0, a kwartał z przekroczeniem ma „Limit przekroczony” i 0 zł
  w kolumnie „Zostało do limitu”, także gdy zwroty obniżyły sumę (strona też pokazuje wtedy, że nic nie zostało).
  Podsumowanie obejmuje lata 2026–2035, te same co zakładka „Limity”.

Sprawdzone w LibreOffice Calc 24.2 (headless, wymuszone przeliczenie przy wczytaniu): eksport 17 wpisów (przekroczenie
i zwrot w tym samym kwartale, zwrot do równego limitu, kwartał z samymi zwrotami, waluta z kursem i bez kursu,
granica 100% i +1 grosz, rok bez płacy minimalnej) daje w F–I te same wartości co strona, także po usunięciu zapisanych
wartości z pliku. Po zaokrągleniu sum do grosza (wersja 0.4.5) sprawdzone tak samo na 10 wpisach: suma równa limitowi
z ułamków (10 813,20 + 0,10 + 0,20), przekroczenie i zwrot, próg 70% co do grosza, połówka grosza w walucie, rok bez
płacy minimalnej (2029); F–I i „Podsumowanie” zgodne ze stroną. W Excelu i Arkuszach Google tego nie sprawdzano; formuły używają tylko funkcji wymienionych
w „Arkusz XLSX: jak odtworzyć”.

### Faktura bez VAT (zwolnienie)

Strona składa fakturę z danych użytkownika i nie ocenia jego sytuacji. Blokuje przypadki, w których przepis każe
wystawić fakturę w KSeF. Przepisy sprawdzono u źródła 22.10.2026; art. 106b ust. 3, art. 106i ust. 1, 2, 6 i 7 oraz art. 145m ustawy o VAT ponownie 05.11.2026, art. 106i ust. 8 (07.11.2026).

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
- **Kiedy faktura i terminy** (`terminy()`): zwolniony z art. 113 wystawia fakturę na żądanie nabywcy zgłoszone w ciągu
  3 miesięcy od końca miesiąca dostawy „bądź otrzymano całość lub część zapłaty” (art. 106b ust. 3 pkt 2). Okno liczy się od
  miesiąca dostawy i od miesiąca każdej wpłaty podanej w formularzu (także zaliczki). Termin wystawienia (art. 106i ust. 1, 2
  i 6), pierwsza pasująca reguła: zaliczka i żądanie do końca jej miesiąca: 15. dzień miesiąca po zaliczce; żądanie
  w miesiącu dostawy: 15. dzień miesiąca po dostawie; żądanie później, ale do końca miesiąca wpłaty po dostawie: przepisy
  tego nie rozstrzygają, więc strona podaje późniejszą z dat (15. dzień po dostawie albo dzień żądania) i prosi o wystawienie
  niezwłocznie; w pozostałych przypadkach 15 dni od żądania. Bez daty zapłaty liczy jak przy samej dostawie i podpowiada,
  kiedy ją podać. Najwcześniej fakturę wystawia się 60 dni przed dostawą, a gdy klient zapłacił (także część) przed
  dostawą, 60 dni przed tą zapłatą (art. 106i ust. 7); ta granica nigdy nie wypada po terminie wystawienia. Wyjątku
  z art. 106i ust. 8 strona nie obsługuje: przy dostawach i usługach rozliczanych okresowo (art. 19a ust. 3, 4 i ust. 5
  pkt 4, np. najem albo stała obsługa) faktura z podanym okresem rozliczeniowym może być wystawiona wcześniej niż 60 dni
  przed wykonaniem, a strona zawsze stosuje granicę z ust. 7. Przy większej
  liczbie wpłat niż pól formularza liczą się najwcześniejsza i najpóźniejsze. Data wystawienia to zawsze dzisiejsza data (art. 106e ust. 1 pkt 1), także dlatego, że od niej zależy
  reguła KSeF.
- **KSeF i nabywca-firma** (`regulaKsef()`): art. 106ga ust. 1, art. 145l i **art. 145m**. Do 31.03.2026 faktury mogły
  być poza KSeF bez limitu. Od 1.04 do 31.12.2026 poza KSeF tylko wtedy, gdy faktury dla firm wystawione w miesiącu mają
  razem najwyżej 10 000 zł brutto; prawo traci się od faktury, z którą suma przekroczy tę kwotę, i każda kolejna faktura
  dla firmy do końca 2026 r. idzie do KSeF. FAQ MF [Poniżej 10 000 zł](https://ksef.podatki.gov.pl/ponizej-10-000-zl/):
  liczą się tylko faktury obowiązkowo wystawiane w KSeF (bez konsumenckich), miesiąc według daty wystawienia. Strona
  liczy faktury dla firm z tego miesiąca zapisane w przeglądarce, kwotę faktur dla firm wystawionych gdzie indziej i tę
  fakturę. Przepis mówi o fakturach wystawionych poza KSeF, ale strona przyjmuje wariant ostrożny: w polu „inne faktury”
  wpisuje się faktury dla firm z tego miesiąca **w KSeF i poza nim** (bez faktur z kasy fiskalnej i dla osób prywatnych),
  żeby nie zaniżyć sumy. Suma równa 10 000,00 zł mieści się w limicie, 10 000,01 zł już nie. Pole przyjmuje zapisy
  jak ewidencja („3000”, „3 000,00 zł”, „3.000,00”, „3,000.00”, `kwotaInnychGr()`). Zapisu niejednoznacznego („10.000”)
  albo błędnego strona nie liczy jako 0 zł: pokazuje błąd pola i nie wystawia faktury dla firmy, dopóki nie zostanie
  poprawiony.
  Po potwierdzeniu, że faktura przekraczająca limit idzie do KSeF (albo po zaznaczeniu wcześniejszego przekroczenia),
  zapamiętuje miesiąc utraty prawa; pomyłkę można cofnąć z potwierdzeniem. **Od 1.01.2027 każda faktura dla firmy jest
  zablokowana** z odesłaniem do [ksef.podatki.gov.pl](https://ksef.podatki.gov.pl/).
- **Osoba prywatna:** faktury dla osoby fizycznej nieprowadzącej działalności są poza obowiązkiem KSeF (art. 106ga ust. 2
  pkt 4; FAQ MF [Konsumenci i osoby fizyczne](https://ksef.podatki.gov.pl/konsumenci-i-osoby-fizyczne/), pkt 7), także
  od 2027 r., i nie wliczają się do limitu.
- **Ewidencja bez dublowania** (`dodajFaktureDoEwidencji()`): wpis z opisem „Faktura N/RRRR: …” jest aktualizowany, wpis
  bez numeru faktury z tą samą datą sprzedaży i kwotą w PLN dostaje numer w opisie, w pozostałych przypadkach powstaje
  nowy wpis. Gdy pamięć danych do faktur jest wyłączona, opis wpisu to samo „Faktura N/RRRR”, bez nazwy pozycji (może
  zawierać dane klienta).
- **Ograniczenia:** reguły opierają się na zegarze systemowym i danych przeglądarki użytkownika, więc ich zmiana omija
  te reguły, a za zgodność faktury z przepisami odpowiada wystawca. Bez pamięci przeglądarki licznik limitu zna tylko
  faktury z bieżącej wizyty. Tylko PLN; faktury korygujące, zaliczkowe i w walucie obcej są poza zakresem (data zaliczki
  służy tylko do terminu faktury na żądanie).

## Arkusz XLSX: jak odtworzyć

```sh
pip install openpyxl==3.1.5 lxml      # MIT, BSD
python3 scripts/arkusz.py --sprawdz   # zapisuje public/pobierz/arkusz-limit-dn.xlsx i sprawdza plik
```

Plik jest deterministyczny (stałe daty w metadanych i w ZIP), więc ponowne uruchomienie bez zmian w skrypcie daje
identyczny plik. Bajt w bajt tylko z tą samą wersją openpyxl i z zainstalowanym `lxml`: bez niego openpyxl zapisuje XML
innym serializatorem (inny układ przestrzeni nazw i spacje w pustych znacznikach), więc plik różni się we wszystkich
częściach, choć treść arkuszy jest ta sama. `--sprawdz` ponownie wczytuje plik przez openpyxl i odrzuca makra, łącza zewnętrzne, `HYPERLINK`
i adresy w formułach. Używane funkcje: `IF`, `OR`, `AND`, `ISNUMBER`, `ROUND`, `MAX`, `LEFT`, `SUMIFS`, `COUNTIFS`,
`DATE`, `YEAR`, `MONTH`, `INT`, `EOMONTH`, `VLOOKUP`, `IFERROR` (są w Excelu 2010+, LibreOffice i Arkuszach Google;
bez `MAXIFS`, które wymaga Excela 2019).

Kwoty płacy minimalnej są w dwóch miejscach: `PLACA_MINIMALNA` w `public/js/logic.js` i `PLACA` w `scripts/arkusz.py`.
Zmieniaj je razem.

## Prywatność

- Brak backendu, kont i ciasteczek. Wpisy i pliki nie opuszczają przeglądarki.
- Jedyny zewnętrzny serwer to api.nbp.pl: trafia tam tylko kod waluty i zakres dat, z `credentials: 'omit'`
  i `referrerPolicy: 'no-referrer'` (nagłówek `Origin` z adresem strony przeglądarka wysyła przy zapytaniu CORS zawsze).
- CSP: `default-src 'none'`, `connect-src 'self' https://api.nbp.pl` (`'self'` jest potrzebne: eksport XLSX pobiera
  wzór arkusza `/pobierz/arkusz-limit-dn.xlsx` przez `fetch`).
- `localStorage` tylko w `magazyn.js`, z dwoma przełącznikami (na obu stronach) i przyciskiem „Wyczyść dane”:
  - „Pamiętaj wpisy ewidencji”, domyślnie włączony: wpisy (`dn-ewidencja-v1`), wystawione faktury i miesiąc utraty
    prawa do faktur poza KSeF (`dn-faktury-v1`). Bez drugiego przełącznika faktury są zapisywane **w skrócie, bez danych
    osobowych**: `{ id, numer, dataWystawienia, dataSprzedazy, suma, nabywca: { rodzaj } }`. To wystarcza do numeracji
    i limitu KSeF; „Drukuj” z listy jest wtedy tylko dla faktur z bieżącej wizyty. Wyłączenie usuwa te klucze;
  - „Zapamiętaj moje dane i dane klientów do faktur”, domyślnie **wyłączony**: dane osobowe tylko za tą zgodą: dane
    sprzedawcy (imię i nazwisko, PESEL albo NIP, adres) i zapisani klienci (`dn-dane-faktur-v1`), pełne faktury do
    ponownego wydruku (`dn-faktury-v1`) i imię do wydruku ewidencji. Wyłączenie usuwa `dn-dane-faktur-v1` i imię do
    wydruku, a zapisane faktury skraca do rekordów bez danych osobowych;
  - ustawienia obu przełączników są w `dn-ewidencja-ustawienia-v1` i zostają po wyłączeniu; „Wyczyść dane” usuwa wszystko.
  Każde usunięcie danych (wyłączenie przełącznika, „Wyczyść dane”, „Usuń” po migracji, usunięcie wpisu albo faktury)
  pyta o potwierdzenie.
- Przejście z wersji 0.4.1 i starszych: tam dane sprzedawcy, klienci i pełne faktury były w `dn-faktury-v1` pod jednym
  przełącznikiem. Drugi przełącznik nie włącza się sam: przy nim pojawia się jednorazowy wybór „Zachowaj moje dane”
  (zapisuje zgodę i przenosi dane do `dn-dane-faktur-v1`) albo „Usuń” (z potwierdzeniem). Do wyboru stare dane zostają
  nietknięte, ale nowe dane osobowe nie są zapisywane (nowe faktury w skrócie). Opisują to testy w `test/pamiec.test.js`.
- Bez zapisu w przeglądarce strona ostrzega przed zamknięciem z niezapisanymi wpisami. Gdy pamięć jest niedostępna,
  przełączniki są wyłączone; gdy zapis się nie uda, ewidencja pokazuje komunikat i ostrzega przed zamknięciem.
  Strona otwarta w dwóch kartach wczytuje dane ponownie po zmianie w drugiej karcie (zdarzenie `storage`), a faktura
  przed wystawieniem liczy numer i regułę KSeF od listy faktur z pamięci przeglądarki. Przy łączeniu wpisów z dwóch kart
  ten sam wpis w dwóch wersjach rozstrzyga znacznik ostatniej zmiany (`zmieniono`); bez znaczników zostaje wersja
  z pamięci. Faktury mają własny identyfikator, więc usunięcie jednej nie usuwa innej o tym samym numerze.
- Strona faktury nie łączy się z siecią.
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
- `test/wspolne.test.js`: komunikaty progów, zdanie z kwotami, odczyt wpisu i tekst ogłoszenia dla czytnika ekranu, termin CEIDG w dzień wolny (dopisek z najbliższym dniem roboczym).
- `test/pamiec.test.js`: dwa przełączniki pamięci, domyślnie faktury bez PESEL i danych klientów (rekord skrócony), numeracja i limit KSeF na rekordach skróconych, wyłączenie drugiego przełącznika usuwa dane osobowe także z faktur, usuwanie kluczy po wyłączeniu (zostaje tylko ustawienie), jednorazowy wybór po przejściu z wcześniejszej wersji (okno wyłączenia pamięci mówi o danych do faktur tylko wtedy, gdy rzeczywiście zostaną), brak zapisu wpisów i faktur po wyłączeniu pamięci w innej karcie, ustawienia wcześniejszych wersji nie są zgodą, „Wyczyść dane” usuwa też kopię roboczą pierwszej wersji strony.
- `test/kalendarz-nbp.test.js`: Wielkanoc, święta 2026–2027, Wigilia wolna od 2025, dzień kursu przy weekendach i świętach, wybór kursu i zapytania NBP (bez sieci), kursy dla wielu wpisów naraz.
- `test/ewidencja.test.js`: liczby i kwoty w PLN, sumy kwartałów, progi, prognoza, wartości F–I, wydruk, numeracja, zwroty (przekroczenie się nie cofa, ostrzeżenia, kwartał z samymi zwrotami), łączenie wpisów z dwóch kart, import, CSV i XLSX (round-trip, kolumna J z datą zwrotu i pliki bez niej, ponad 1000 wierszy, pliki z innych programów), formuły H i I wzoru XLSX (procent nie mniejszy niż 0, przekroczenie się nie cofa), sumy wzoru zaokrąglone do grosza, „Podsumowanie” 2026–2035 i płaca minimalna wzoru zgodna ze stroną, „zostało do limitu” 0 po przekroczeniu i zwrocie, import plików edytowanych ręcznie (niezamknięty cudzysłów, pola za nagłówkiem, nieznany nagłówek, grupy tysięcy, kurs bez waluty, kwota dodatnia z kolumną J, Windows-1250, system dat 1904, liczby w kolumnie daty), ZIP (w tym ochrona przed „bombą ZIP”).
- `test/faktura.test.js`: numeracja, blokada faktur dla firm od 2027 r., limit 10 000 zł w 2026 r. (równo, +1 grosz, faktury z innych miejsc, utrata prawa w kolejnych miesiącach, osoba prywatna poza limitem), data wystawienia równa dziś, sumy brutto i zaokrąglenia, kwota słownie, NIP i PESEL, elementy faktury, terminy (także z datą zapłaty i zaliczki), faktury z KSeF w limicie 10 000 zł, usuwanie faktury po identyfikatorze, wydruk bez „null”, ewidencja bez dublowania, zachowanie bez `localStorage`, teksty okien (najwyżej 2 zdania w akapicie).
- `test/zmiana-roku.test.js`: przejście z 2026 na 2027 przy symulowanym zegarze (31.12.2026, 1.01.2027, ostatnie dni kwartałów, 1.04.2027, 31.12.2027): data w Warszawie, limit kwartału i prognoza według bieżącej daty, historia i wydruk na przełomie roku, blokada faktur dla firm od 1.01.2027, numeracja od 1/2027, terminy faktury, dzień kursu NBP i zapytania przez granicę roku, ponowne przeliczenie po powrocie na kartę otwartą przed północą.
- `test/strony.test.js` (metadane): tytuły, opisy, `canonical`, Open Graph, JSON-LD (tylko `/` i `/faktura/`, poprawny JSON, bez `aggregateRating` i `review`), mapa strony (`sitemap.xml`: adresy kanoniczne, aktualne `lastmod`) i `robots.txt`, strona `404.html` (noindex, bez `canonical` i JSON-LD).
- `test/strony.test.js`: higiena stron: brak `noindex` na stronach z treścią i `noindex` na 404, nagłówki `X-Robots-Tag` w `_headers`, meta CSP zgodny z `_headers` (`connect-src` tylko `'self'` i api.nbp.pl), stopka, brak skryptów (poza blokiem danych `application/ld+json`), stylów i handlerów inline, brak zewnętrznych zasobów, w JS jedyny adres to API NBP w `nbp.js`, brak `document.cookie`/`innerHTML`, `localStorage` tylko w `magazyn.js`, `fetch` tylko w widoku ewidencji, etykiety pól i jeden region `aria-live`, strony prawne krótkie w porównaniu ze stronami funkcji (najwyżej 1,5× słów), brak odwołań do usuniętych stron, sekcja KSeF ≤ 150 słów, jedna akcja pobrania arkusza, arkusz bez makr i łączy, `_redirects` tylko stałe, w HTML jedyny adres e-mail to `kontakt@noblecode.pl`.
- Przed publikacją: `npm run check:publish` kończy się błędem, gdy w `public/` został placeholder `{{...}}` albo znacznik `[DO-UZUPEŁNIENIA…]` (miejsce w tekście do uzupełnienia).

### Test dostępności (`npm run test:a11y`)

Osobny skrypt, poza `node --test` i poza CI. Wymaga **Node ≥ 22.12** (skrypt sprawdza wersję na starcie). Sprawdza stronę narzędziem axe-core pod kątem WCAG 2.2 AA
(tagi `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`).

```sh
npm ci --ignore-scripts    # zależności deweloperskie z package-lock.json, bez skryptów instalacyjnych
npm audit signatures       # podpisy rejestru i atestacje pakietów
npm run test:a11y
```

- Zależności (tylko `devDependencies`, nie trafiają do `public/`): `@axe-core/playwright` 4.14.0
  (z nim `axe-core` 4.14.0) i `playwright-core` 1.56.1, w dokładnych wersjach z `package-lock.json`.
- Skrypt nie pobiera przeglądarki. Używa Chromium z katalogu `PLAYWRIGHT_BROWSERS_PATH` (dla `playwright-core`
  1.56.1 to kompilacja `chromium_headless_shell-1194`). Inną binarkę Chromium wskazuje zmienna `CHROMIUM_PATH`,
  np. `CHROMIUM_PATH=/ścieżka/do/chrome npm run test:a11y`.
- Serwuje lokalną kopię `public/` tak jak `npm run serve`, ale tylko na `127.0.0.1` i na wolnym porcie. Każde
  żądanie przeglądarki poza ten adres jest blokowane i kończy test błędem. axe działa z `preload: false`.
- Skanuje wszystkie adresy z `public/sitemap.xml`, stronę `404.html`, licznik limitu w każdym stanie (poniżej
  progu, 70, 85, 95 i 100% limitu, po przekroczeniu, błędne dane), ewidencję z przykładowymi danymi i ewidencję w każdym
  stanie `poziom-*` (dane testowe w pamięci przeglądarki, zegar strony ustawiony na 31.12.2026: 50, 75, 90, 97, 100%,
  po przekroczeniu, po przekroczeniu i zwrocie, zwrot z ostrzeżeniem).
- Serwer i przeglądarka są zamykane w `finally` oraz po `SIGINT` i `SIGTERM`, więc lokalny serwer nie zostaje po błędzie
  ani po Ctrl+C.
- Kończy się kodem 1 przy każdym naruszeniu, zablokowanym żądaniu albo gdy licznik nie pokaże oczekiwanego stanu.
- Automatyczny skan wykrywa tylko część problemów z dostępnością. Nie zastępuje sprawdzenia ręcznego (czytnik
  ekranu, klawiatura, sens tekstów alternatywnych).

CI: `.github/workflows/ci.yml` uruchamia `node --test` na Node 20 i 22 (push do `main` i pull requesty).

### Przed każdą publikacją

1. `node --test`
2. `npm run check:publish`
3. `npm run test:a11y` (wynik, czyli liczbę skanów i naruszeń, wklej do opisu pull requesta z publikacją)
4. Sprawdzenie ręczne na telefonie i komputerze, także samą klawiaturą.

Publikacja tylko wtedy, gdy wszystkie kroki przechodzą.

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
scripts/sprawdz-dostepnosc.mjs   test dostępności (axe-core): npm run test:a11y
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
generator arkusza używa openpyxl (MIT) i lxml (BSD), które nie trafiają do `public/`.
Test dostępności używa `@axe-core/playwright` i `axe-core` (MPL-2.0) oraz `playwright-core` (Apache-2.0)
jako zależności deweloperskich; nie są kopiowane ani dołączane do `public/`.

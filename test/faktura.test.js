// Faktura bez VAT (zwolnienie). Numeracja, KSeF (art. 145m i 106ga ustawy o VAT), sumy, wydruk,
// ewidencja bez dublowania i zachowanie bez localStorage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizujWpis, kolejnyNumer } from '../public/js/ewidencja-logika.js';
import {
  normalizujFakture, proponowanyNumer, numerZajety, moznaUsunac, regulaKsef, opisKsef, dokumentFaktury, terminy,
  dodajFaktureDoEwidencji, dopiszNabywce, wartoscPozycjiGr, slownie, sprawdzNip, sumaGr, sumaFirmWMiesiacu,
  BladPola, LIMIT_POZA_KSEF_GR, sprawdzIdSprzedawcy, poprawnyPesel, miesiacDopelniacz, TEKSTY_OKIEN, KOMUNIKAT_PO_OKNIE_LIMITU, lukaWNumeracji, polaczUtrate, dataReguly, skrotKsef,
} from '../public/js/faktura-logika.js';

const NIP_OK = '1234563218'; // suma kontrolna: 118 mod 11 = 8
const PESEL_OK = '95251401357'; // 14.05.2095 (miesiąc + 20), cyfra kontrolna 7
const faktura = (zmiany = {}) => ({
  numer: '1/2026',
  dataWystawienia: '2026-10-22',
  dataSprzedazy: '2026-10-20',
  sprzedawca: { nazwa: 'Anna Nowak', adres: 'ul. Lipowa 5, 90-001 Łódź', id: PESEL_OK },
  nabywca: { rodzaj: 'konsument', nazwa: 'Jan Kowalski', adres: 'ul. Polna 3, 00-001 Warszawa', nip: '' },
  pozycje: [{ nazwa: 'Obraz olejny', ilosc: '1', jm: 'szt.', cena: '1250' }],
  podstawa: { kod: 'art113-1' },
  platnosc: '',
  ...zmiany,
});
const firma = (zmiany = {}) => faktura({ nabywca: { rodzaj: 'firma', nazwa: 'Firma sp. z o.o.', adres: 'ul. Długa 1, Kraków', nip: NIP_OK }, ...zmiany });
const zapisana = (numer, data, kwota, rodzaj = 'firma') => normalizujFakture(faktura({
  numer, dataWystawienia: data, dataSprzedazy: data,
  nabywca: rodzaj === 'firma' ? { rodzaj, nazwa: 'Firma', adres: 'Kraków', nip: NIP_OK } : { rodzaj, nazwa: 'Jan', adres: 'Łódź' },
  pozycje: [{ nazwa: 'Usługa', ilosc: '1', cena: kwota }],
}));
const zl = (t) => BigInt(Math.round(Number(t) * 100));
const spacje = (t) => t.replace(/[\u00a0\u202f]/g, ' '); // formatujZl używa twardych spacji

// ---------------------------------------------------------------- numeracja

test('numeracja: kolejny numer N/RRRR w roku wystawienia, ciągła od największego, nowy rok od 1', () => {
  assert.equal(proponowanyNumer([], '2026-10-22'), '1/2026');
  const f = [zapisana('1/2026', '2026-05-02', '100'), zapisana('2/2026', '2026-06-02', '100'), zapisana('9/2025', '2025-12-30', '100')];
  assert.equal(proponowanyNumer(f, '2026-10-22'), '3/2026');
  assert.equal(proponowanyNumer(f, '2027-01-02'), '1/2027');
  assert.equal(proponowanyNumer(f, '2026-10-22'), kolejnyNumer(f.map((x) => x.numer), 2026), 'ta sama funkcja co w ewidencji');
  assert.ok(numerZajety(f, '2/2026'));
  assert.ok(!numerZajety(f, '3/2026'));
  // usunąć można tylko ostatnią fakturę roku (numeracja bez luk)
  assert.ok(moznaUsunac(f, '2/2026'));
  assert.ok(!moznaUsunac(f, '1/2026'));
  assert.ok(moznaUsunac(f, '9/2025'));
});

test('numeracja: format i rok numeru zgodny z datą wystawienia', () => {
  assert.equal(normalizujFakture(faktura({ numer: ' 12 / 2026 ' })).numer, '12/2026');
  assert.throws(() => normalizujFakture(faktura({ numer: 'FV-1' })), (e) => e instanceof BladPola && e.pole === 'numer');
  assert.throws(() => normalizujFakture(faktura({ numer: '0/2026' })), /numer\/rok/);
  assert.throws(() => normalizujFakture(faktura({ numer: '1/2025' })), /różni się od roku wystawienia/);
});

// ---------------------------------------------------------------- KSeF: blokada 2027 i progi 2026

test('KSeF od 1.01.2027: faktura dla firmy zablokowana (odesłanie do KSeF), dla osoby prywatnej dozwolona', () => {
  const b2b = regulaKsef({ dataWystawienia: '2027-01-01', rodzaj: 'firma', kwotaGr: 100n });
  assert.equal(b2b.stan, 'blokada');
  assert.equal(b2b.powod, 'ksef-2027');
  assert.match(opisKsef(b2b), /Od 1\.01\.2027 każdą fakturę dla firmy wystawiasz w KSeF/);
  assert.equal(regulaKsef({ dataWystawienia: '2028-06-30', rodzaj: 'firma', kwotaGr: 1n }).stan, 'blokada');
  // nawet 1 grosz i bez innych faktur: blokada, nie ostrzeżenie
  assert.equal(regulaKsef({ dataWystawienia: '2027-03-15', rodzaj: 'firma', kwotaGr: 1n, faktury: [] }).powod, 'ksef-2027');
  const b2c = regulaKsef({ dataWystawienia: '2027-01-01', rodzaj: 'konsument', kwotaGr: zl('50000') });
  assert.equal(b2c.stan, 'poza-ksef');
  assert.equal(b2c.powod, 'konsument');
  assert.equal(regulaKsef({ dataWystawienia: '2026-12-31', rodzaj: 'firma', kwotaGr: 100n }).stan, 'poza-ksef', '31.12.2026 jeszcze wyjątek');
});

test('KSeF 2026: limit 10 000 zł brutto w miesiącu według daty wystawienia, ≤ dozwolone, > blokada od tej faktury', () => {
  assert.equal(LIMIT_POZA_KSEF_GR, 1_000_000n);
  const f = [zapisana('1/2026', '2026-10-02', '6000'), zapisana('2/2026', '2026-09-30', '9000'), zapisana('3/2026', '2026-10-05', '3000', 'konsument')];
  assert.equal(sumaFirmWMiesiacu(f, '2026-10'), zl('6000'), 'faktura konsumencka się nie wlicza (FAQ MF pkt 11)');
  const rowno = regulaKsef({ dataWystawienia: '2026-10-22', rodzaj: 'firma', kwotaGr: zl('4000'), faktury: f });
  assert.equal(rowno.stan, 'poza-ksef');
  assert.equal(rowno.poGr, zl('10000'));
  assert.equal(rowno.zapasGr, 0n);
  const grosz = regulaKsef({ dataWystawienia: '2026-10-22', rodzaj: 'firma', kwotaGr: zl('4000.01'), faktury: f });
  assert.equal(grosz.stan, 'blokada');
  assert.equal(grosz.powod, 'limit');
  assert.match(spacje(opisKsef(grosz)), /w październiku 2026 dałyby 10 000,01 zł/);
  // ten sam numer jest pomijany w sumie (ponowne sprawdzenie zapisanej faktury)
  assert.equal(regulaKsef({ dataWystawienia: '2026-10-02', rodzaj: 'firma', kwotaGr: zl('6000'), faktury: f, numer: '1/2026' }).poGr, zl('6000'));
  // faktury wystawione gdzie indziej poza KSeF w tym miesiącu
  assert.equal(regulaKsef({ dataWystawienia: '2026-10-22', rodzaj: 'firma', kwotaGr: zl('3000'), faktury: f, inneGr: zl('1000.01') }).powod, 'limit');
  // wrzesień liczony osobno: 9000 + 1000 = 10 000
  assert.equal(regulaKsef({ dataWystawienia: '2026-09-15', rodzaj: 'firma', kwotaGr: zl('1000'), faktury: f }).stan, 'poza-ksef');
  // jedna faktura ponad limit
  assert.equal(regulaKsef({ dataWystawienia: '2026-11-03', rodzaj: 'firma', kwotaGr: zl('10000.01') }).powod, 'limit');
});

test('KSeF 2026: po przekroczeniu każda kolejna faktura dla firmy w KSeF, także w następnych miesiącach', () => {
  const zadeklarowane = regulaKsef({ dataWystawienia: '2026-11-03', rodzaj: 'firma', kwotaGr: 100n, przekroczonoWczesniej: true });
  assert.equal(zadeklarowane.stan, 'blokada');
  assert.equal(zadeklarowane.powod, 'utrata');
  // przekroczenie widoczne w zapisanych fakturach (np. z kwietnia), listopad już w KSeF
  const f = [zapisana('1/2026', '2026-04-10', '6000'), zapisana('2/2026', '2026-04-20', '6000')];
  assert.equal(regulaKsef({ dataWystawienia: '2026-11-03', rodzaj: 'firma', kwotaGr: 100n, faktury: f }).powod, 'utrata');
  // osoba prywatna nadal poza KSeF
  assert.equal(regulaKsef({ dataWystawienia: '2026-11-03', rodzaj: 'konsument', kwotaGr: 100n, faktury: f, przekroczonoWczesniej: true }).stan, 'poza-ksef');
  // przed 1.04.2026 (art. 145l): bez limitu
  const marzec = regulaKsef({ dataWystawienia: '2026-03-31', rodzaj: 'firma', kwotaGr: zl('50000') });
  assert.equal(marzec.stan, 'poza-ksef');
  assert.equal(marzec.powod, 'przed-limitem');
});

// ---------------------------------------------------------------- sumy brutto i słownie

test('sumy brutto: ilość × cena z zaokrągleniem do grosza (art. 106e ust. 11), suma pozycji, bez VAT', () => {
  assert.equal(wartoscPozycjiGr('3', '33.33'), 9999n);
  assert.equal(wartoscPozycjiGr('2.5', '49.90'), 12475n);
  assert.equal(wartoscPozycjiGr('0.333', '10'), 333n); // 3,33
  assert.equal(wartoscPozycjiGr('0.335', '10'), 335n);
  assert.equal(wartoscPozycjiGr('0.0005', '10'), 1n); // 0,5 grosza → 1 grosz
  assert.equal(wartoscPozycjiGr('0.0004', '10'), 0n); // poniżej 0,5 grosza → 0
  const f = normalizujFakture(faktura({ pozycje: [
    { nazwa: 'Kolczyki', ilosc: '3', jm: 'szt.', cena: '49,90' },
    { nazwa: 'Warsztaty', ilosc: '1,5', jm: 'godz.', cena: '120' },
    { nazwa: '', ilosc: '', cena: '' }, // pusta pozycja pomijana
  ] }));
  assert.equal(f.pozycje.length, 2);
  assert.equal(f.pozycje[0].wartosc, '149.70');
  assert.equal(f.pozycje[1].wartosc, '180.00');
  assert.equal(f.suma, '329.70');
  assert.equal(sumaGr(f), 32970n);
  assert.deepEqual(Object.keys(f).filter((k) => /vat|stawk|podatek/i.test(k)), []);
  assert.throws(() => normalizujFakture(faktura({ pozycje: [{ nazwa: 'X', ilosc: '1', cena: '0' }] })), /większa od zera/);
  assert.throws(() => normalizujFakture(faktura({ pozycje: [{ nazwa: 'X', ilosc: '0', cena: '10' }] })), /ilość/);
  assert.throws(() => normalizujFakture(faktura({ pozycje: [{ nazwa: 'X', ilosc: '1', cena: '10,999' }] })), /cena/);
  assert.throws(() => normalizujFakture(faktura({ pozycje: [{ nazwa: '', ilosc: '1', cena: '10' }] })), (e) => e.pole === 'pozycja-0-nazwa');
});

test('kwota słownie (polskie formy liczebników)', () => {
  assert.equal(slownie(0n), 'zero złotych 00/100');
  assert.equal(slownie(100n), 'jeden złoty 00/100');
  assert.equal(slownie(205n), 'dwa złote 05/100');
  assert.equal(slownie(1250n * 100n), 'tysiąc dwieście pięćdziesiąt złotych 00/100');
  assert.equal(slownie(250050n), 'dwa tysiące pięćset złotych 50/100');
  assert.equal(slownie(1_000_000n), 'dziesięć tysięcy złotych 00/100');
  assert.equal(slownie(1_200_000n), 'dwanaście tysięcy złotych 00/100');
  assert.equal(slownie(2_200_099n), 'dwadzieścia dwa tysiące złotych 99/100');
  assert.equal(slownie(1_314n * 100n), 'tysiąc trzysta czternaście złotych 00/100');
  assert.equal(slownie(10_100_000_00n), 'dziesięć milionów sto tysięcy złotych 00/100');
  assert.equal(slownie(1_000_001_00n), 'milion jeden złotych 00/100');
});

// ---------------------------------------------------------------- elementy faktury (art. 106e)

test('elementy faktury: dane obowiązkowe, NIP z sumą kontrolną dla firmy, podstawa zwolnienia', () => {
  assert.deepEqual(sprawdzNip('123-456-32-18'), { stan: 'ok', nip: NIP_OK });
  assert.deepEqual(sprawdzNip('PL 1234563218'), { stan: 'ok', nip: NIP_OK });
  assert.equal(sprawdzNip('1234563219').stan, 'blad');
  assert.equal(sprawdzNip('12345').stan, 'blad');
  assert.equal(sprawdzNip('DE123456789').stan, 'zagraniczny');
  assert.equal(sprawdzNip('DE123456789', { zagraniczny: false }).stan, 'blad');
  assert.equal(sprawdzNip('').stan, 'pusto');

  assert.throws(() => normalizujFakture(firma({ nabywca: { rodzaj: 'firma', nazwa: 'F', adres: 'A', nip: '' } })), (e) => e.pole === 'nabywcaNip');
  assert.throws(() => normalizujFakture(firma({ nabywca: { rodzaj: 'firma', nazwa: 'F', adres: 'A', nip: '1234563219' } })), /cyfrę kontrolną/);
  assert.throws(() => normalizujFakture(faktura({ nabywca: { rodzaj: 'konsument', nazwa: 'Jan', adres: '' } })), (e) => e.pole === 'nabywcaAdres');
  assert.throws(() => normalizujFakture(faktura({ sprzedawca: { nazwa: ' ', adres: 'Łódź', id: PESEL_OK } })), (e) => e.pole === 'sprzedawcaNazwa');
  assert.throws(() => normalizujFakture(faktura({ nabywca: { rodzaj: '', nazwa: 'X', adres: 'Y' } })), (e) => e.pole === 'rodzaj');
  assert.throws(() => normalizujFakture(faktura({ podstawa: { kod: 'inna', tekst: '' } })), (e) => e.pole === 'podstawaTekst');
  assert.throws(() => normalizujFakture(faktura({ dataWystawienia: '2026-08-01', numer: '1/2026', dataSprzedazy: '2026-10-20' })), /60 dni/);
  // konsument: NIP pomijany, nawet gdy wpisany
  assert.equal(normalizujFakture(faktura({ nabywca: { rodzaj: 'konsument', nazwa: 'Jan', adres: 'A', nip: 'x' } })).nabywca.nip, '');

  const f = normalizujFakture(firma({ podstawa: { kod: 'art113-9' } }));
  assert.match(f.podstawa.tekst, /^art\. 113 ust\. 9 ustawy z dnia 11 marca 2004 r\. o podatku od towarów i usług$/);
  assert.equal(normalizujFakture(faktura({ podstawa: { kod: 'inna', tekst: 'art. 43 ust. 1 pkt 29 lit. c ustawy o VAT' } })).podstawa.tekst, 'art. 43 ust. 1 pkt 29 lit. c ustawy o VAT');
  assert.equal(normalizujFakture(faktura({ podstawa: { kod: 'cos' } })).podstawa.kod, 'art113-1');
});

test('terminy: żądanie do 3 miesięcy od końca miesiąca sprzedaży, wystawienie do 15. dnia (art. 106b ust. 3, 106i ust. 6)', () => {
  const t = terminy('2026-10-20');
  assert.equal(t.zadanieDo, '2027-01-31');
  assert.equal(t.termin, '2026-11-15');
  assert.equal(t.przepis, 'art. 106i ust. 6 pkt 1');
  const p = terminy('2026-10-20', '2026-12-03');
  assert.equal(p.termin, '2026-12-18');
  assert.equal(p.przepis, 'art. 106i ust. 6 pkt 2');
  assert.equal(p.poTerminieZadania, false);
  assert.equal(terminy('2026-10-20', '2027-02-01').poTerminieZadania, true);
  assert.equal(terminy('2026-11-30').zadanieDo, '2027-02-28');
  assert.equal(terminy('2026-10-20', '2026-10-25').termin, '2026-11-15', 'żądanie w miesiącu sprzedaży');
});

// ---------------------------------------------------------------- wydruk

const wszystkieTeksty = (o) => (typeof o === 'string' ? [o] : Array.isArray(o) ? o.flatMap(wszystkieTeksty) : Object.values(o).flatMap(wszystkieTeksty));

test('wydruk bez „null” i „undefined”: same teksty, puste pola pominięte', () => {
  for (const f of [
    normalizujFakture(faktura()), // sprzedawca z PESEL, bez płatności, data sprzedaży ≠ wystawienia
    normalizujFakture(firma({ dataSprzedazy: '2026-10-22', platnosc: 'przelew do 5.11.2026', sprzedawca: { nazwa: 'Anna', adres: 'Łódź', nip: NIP_OK } })),
  ]) {
    const d = dokumentFaktury(f);
    const teksty = wszystkieTeksty(d);
    for (const t of teksty) {
      assert.equal(typeof t, 'string');
      assert.ok(!/\bnull\b|\bundefined\b|NaN|\[object/.test(t), `w wydruku: ${t}`);
    }
    assert.ok(!JSON.stringify(d).includes('null'));
    assert.equal(d.tytul, `Faktura nr ${f.numer}`);
    assert.match(d.zwolnienie, /^Podstawa zwolnienia z VAT: art\. 113 ust\. 1 /);
  }
  const k = dokumentFaktury(normalizujFakture(faktura()));
  assert.deepEqual(k.daty, [['Data wystawienia', '22.10.2026'], ['Data sprzedaży', '20.10.2026']]);
  assert.deepEqual(k.sprzedawca.linie, ['Anna Nowak', 'ul. Lipowa 5, 90-001 Łódź', 'PESEL: 95251401357']);
  assert.equal(k.platnosc, '');
  assert.deepEqual(k.pozycje.map((w) => w.map(spacje)), [['1', 'Obraz olejny', '1', 'szt.', '1 250,00', '1 250,00']]);
  assert.equal(spacje(k.razem), 'Razem do zapłaty: 1 250,00 zł');
  assert.equal(k.slownie, 'Słownie: tysiąc dwieście pięćdziesiąt złotych 00/100');
  const b = dokumentFaktury(normalizujFakture(firma({ dataSprzedazy: '2026-10-22' })));
  assert.deepEqual(b.daty, [['Data wystawienia', '22.10.2026']], 'data sprzedaży tylko, gdy inna (art. 106e ust. 1 pkt 6)');
  assert.deepEqual(b.nabywca.linie, ['Firma sp. z o.o.', 'ul. Długa 1, Kraków', 'NIP: 123-456-32-18']);
  assert.ok(!wszystkieTeksty(b).some((t) => /stawk|kwota podatku|\bVAT\s*\d/i.test(t)), 'bez stawki i kwoty podatku (art. 106e ust. 4 pkt 3)');
});

// ---------------------------------------------------------------- ewidencja bez dublowania

test('ewidencja: wpis z faktury raz, ponowne dodanie aktualizuje, istniejąca sprzedaż dostaje numer faktury', () => {
  const f = normalizujFakture(faktura());
  const a = dodajFaktureDoEwidencji([], f, 'n1');
  assert.equal(a.stan, 'dodano');
  assert.equal(a.wpisy.length, 1);
  assert.deepEqual(normalizujWpis(a.wpis), { id: 'n1', data: '2026-10-20', opis: 'Faktura 1/2026: Obraz olejny', kwota: '1250.00', waluta: 'PLN', kurs: '', kursData: '', kursTabela: '' });
  const b = dodajFaktureDoEwidencji(a.wpisy, f, 'n2');
  assert.equal(b.stan, 'bez-zmian');
  assert.equal(b.wpisy.length, 1);
  const zmieniona = normalizujFakture(faktura({ dataSprzedazy: '2026-10-21', pozycje: [{ nazwa: 'Obraz olejny', ilosc: '1', cena: '1300' }] }));
  const c = dodajFaktureDoEwidencji(b.wpisy, zmieniona, 'n3');
  assert.equal(c.stan, 'zaktualizowano');
  assert.equal(c.wpisy.length, 1);
  assert.equal(c.wpisy[0].kwota, '1300.00');
  assert.equal(c.wpisy[0].id, 'n1');
  // sprzedaż wpisana wcześniej w ewidencji (ta sama data i kwota) → numer faktury dopisany, bez nowego wpisu
  const wczesniej = [normalizujWpis({ id: 'w1', data: '2026-10-20', kwota: '1250', opis: 'obraz dla p. Kowalskiego' }),
    normalizujWpis({ id: 'w2', data: '2026-10-20', kwota: '1250', waluta: 'EUR', kurs: '4.3' })];
  const d = dodajFaktureDoEwidencji(wczesniej, f, 'n4');
  assert.equal(d.stan, 'polaczono');
  assert.equal(d.wpisy.length, 2);
  assert.equal(d.wpisy[0].opis, 'Faktura 1/2026: obraz dla p. Kowalskiego');
  // druga faktura z tą samą kwotą i datą nie łączy się z wpisem, który ma już numer innej faktury
  const e = dodajFaktureDoEwidencji(d.wpisy, normalizujFakture(faktura({ numer: '2/2026' })), 'n5');
  assert.equal(e.stan, 'dodano');
  assert.equal(e.wpisy.length, 3);
  // „Faktura 1/2026” nie myli się z „Faktura 1/20260” ani „Faktura 11/2026”
  const g = dodajFaktureDoEwidencji([normalizujWpis({ id: 'x', data: '2026-01-01', kwota: '5', opis: 'Faktura 11/2026: coś' })], f, 'n6');
  assert.equal(g.stan, 'dodano');
});

test('zapisani klienci: najnowszy pierwszy, bez powtórzeń po NIP albo nazwie i adresie', () => {
  let n = dopiszNabywce([], { rodzaj: 'firma', nazwa: 'A', adres: 'X', nip: NIP_OK });
  n = dopiszNabywce(n, { rodzaj: 'konsument', nazwa: 'Jan', adres: 'Y', nip: '' });
  n = dopiszNabywce(n, { rodzaj: 'firma', nazwa: 'A nowa nazwa', adres: 'Z', nip: NIP_OK });
  n = dopiszNabywce(n, { rodzaj: 'konsument', nazwa: 'jan', adres: 'y', nip: '' });
  assert.deepEqual(n.map((x) => x.nazwa), ['jan', 'A nowa nazwa']);
});

// ---------------------------------------------------------------- bez localStorage

test('bez localStorage (tryb prywatny, zablokowana pamięć): magazyn nie rzuca, faktura działa bez zapisu', async () => {
  const opis = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const magazyn = await import('../public/js/magazyn.js');
  try {
    // 1) brak obiektu
    Object.defineProperty(globalThis, 'localStorage', { value: undefined, configurable: true, writable: true });
    assert.deepEqual(magazyn.wczytajFaktury(), { faktury: [], sprzedawca: null, nabywcy: [], utrataOd: null });
    assert.equal(magazyn.zapiszFaktury({ faktury: [], sprzedawca: null, nabywcy: [] }), false);
    assert.equal(magazyn.pamiecWlaczona(), true);
    assert.equal(magazyn.wczytaj(), null);
    assert.equal(magazyn.dostepny(), false, 'widok wyłącza wtedy pamięć i dopisywanie do ewidencji');
    // 2) dostęp rzuca SecurityError
    Object.defineProperty(globalThis, 'localStorage', { get() { throw new Error('SecurityError'); }, configurable: true });
    assert.deepEqual(magazyn.wczytajFaktury().faktury, []);
    assert.equal(magazyn.zapiszFaktury({ faktury: [], sprzedawca: null, nabywcy: [] }), false);
    assert.doesNotThrow(() => magazyn.wyczysc());
    // 3) setItem rzuca (pełna pamięć)
    const dane = new Map();
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
      getItem: (k) => dane.get(k) ?? null, setItem: () => { throw new Error('QuotaExceededError'); }, removeItem: (k) => dane.delete(k) } });
    assert.equal(magazyn.zapiszFaktury({ faktury: [], sprzedawca: null, nabywcy: [] }), false);
    // logika faktury nie zależy od pamięci
    const f = normalizujFakture(firma());
    assert.equal(regulaKsef({ dataWystawienia: f.dataWystawienia, rodzaj: 'firma', kwotaGr: sumaGr(f) }).stan, 'poza-ksef');
    assert.equal(proponowanyNumer([], f.dataWystawienia), '1/2026');
    // 4) działająca pamięć: zapis i odczyt, uszkodzony JSON, wyczyść usuwa faktury
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
      getItem: (k) => dane.get(k) ?? null, setItem: (k, v) => dane.set(k, String(v)), removeItem: (k) => dane.delete(k) } });
    assert.equal(magazyn.dostepny(), true);
    assert.equal(magazyn.zapiszFaktury({ faktury: [f], sprzedawca: f.sprzedawca, nabywcy: [f.nabywca] }), true);
    assert.equal(magazyn.wczytajFaktury().faktury[0].numer, '1/2026');
    magazyn.zapiszUstawienia({ pamietaj: false });
    assert.equal(magazyn.pamiecWlaczona(), false);
    magazyn.wyczysc();
    assert.equal(dane.size, 0);
    dane.set('dn-faktury-v1', '{zepsute');
    assert.deepEqual(magazyn.wczytajFaktury().faktury, []);
  } finally {
    if (opis) Object.defineProperty(globalThis, 'localStorage', opis);
    else delete globalThis.localStorage;
  }
});

// ---------------------------------------------------------------- próby obejścia reguł i zapamiętana utrata prawa

test('atak: cofnięcie daty wystawienia nie omija blokady 2027 ani utraty prawa', () => {
  // atak: w 2027 r. faktura dla firmy z datą wystawienia 2026-12-31
  const atak = regulaKsef({ dataWystawienia: '2026-12-31', dzis: '2027-01-05', rodzaj: 'firma', kwotaGr: 100n });
  assert.equal(atak.stan, 'blokada');
  assert.equal(atak.powod, 'ksef-2027');
  assert.equal(regulaKsef({ dataWystawienia: '2020-01-01', dzis: '2027-01-01', rodzaj: 'firma', kwotaGr: 1n }).powod, 'ksef-2027');
  // osoba prywatna: data z formularza bez zmian (B2C poza KSeF)
  assert.equal(regulaKsef({ dataWystawienia: '2026-12-31', dzis: '2027-01-05', rodzaj: 'konsument', kwotaGr: 100n }).stan, 'poza-ksef');
  // atak: powrót do miesiąca sprzed utraty prawa (utrata od listopada, data cofnięta na październik)
  const powrot = regulaKsef({ dataWystawienia: '2026-10-20', dzis: '2026-11-03', rodzaj: 'firma', kwotaGr: 100n, utrataOd: '2026-11' });
  assert.equal(powrot.powod, 'utrata');
  // przed 1.04.2026 też nie da się wrócić
  assert.equal(regulaKsef({ dataWystawienia: '2026-03-01', dzis: '2026-10-22', rodzaj: 'firma', kwotaGr: 1n }).powod, 'w-limicie');
  assert.equal(dataReguly('2026-10-01', '2026-10-22'), '2026-10-22');
  assert.equal(dataReguly('2026-11-01', '2026-10-22'), '2026-11-01', 'późniejsza data z formularza zostaje');
  // walidacja: dla firmy data wystawienia nie wcześniej niż dziś; dla osoby prywatnej bez tego ograniczenia
  assert.throws(() => normalizujFakture(firma({ dataWystawienia: '2026-10-21', dataSprzedazy: '2026-10-20' }), { dzis: '2026-10-22' }),
    (e) => e instanceof BladPola && e.pole === 'dataWystawienia' && /czyli dziś/.test(e.message));
  assert.equal(normalizujFakture(firma({ dataWystawienia: '2026-10-22' }), { dzis: '2026-10-22' }).dataWystawienia, '2026-10-22');
});

test('błąd: utrata prawa po przekroczeniu limitu jest pamiętana dla kolejnych faktur i miesięcy 2026', () => {
  // scenariusz: 9000 zł (1/2026, 5.10), 2000 zł 20.10 → limit, potem 500 zł 21.10 i 500 zł 3.11
  const f = [zapisana('1/2026', '2026-10-05', '9000')];
  const r2 = regulaKsef({ dataWystawienia: '2026-10-20', dzis: '2026-10-20', rodzaj: 'firma', kwotaGr: zl('2000'), faktury: f });
  assert.equal(r2.powod, 'limit');
  const utrataOd = polaczUtrate(null, r2.miesiac); // widok zapisuje to w magazyn po potwierdzeniu
  assert.equal(utrataOd, '2026-10');
  assert.equal(regulaKsef({ dataWystawienia: '2026-10-21', dzis: '2026-10-21', rodzaj: 'firma', kwotaGr: zl('500'), faktury: f, utrataOd }).powod, 'utrata');
  assert.equal(regulaKsef({ dataWystawienia: '2026-11-03', dzis: '2026-11-03', rodzaj: 'firma', kwotaGr: zl('500'), faktury: f, utrataOd }).powod, 'utrata');
  assert.equal(regulaKsef({ dataWystawienia: '2026-11-03', dzis: '2026-11-03', rodzaj: 'konsument', kwotaGr: zl('500'), utrataOd }).stan, 'poza-ksef');
  assert.equal(polaczUtrate('2026-11', '2026-10'), '2026-10', 'wcześniejszy miesiąc wygrywa');
  assert.equal(polaczUtrate('x', null), null);
});

test('błąd: utrata prawa przetrwa ponowne wejście (magazyn), uszkodzona wartość jest pomijana', async () => {
  const opis = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const magazyn = await import('../public/js/magazyn.js');
  const dane = new Map();
  try {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
      getItem: (k) => dane.get(k) ?? null, setItem: (k, v) => dane.set(k, String(v)), removeItem: (k) => dane.delete(k) } });
    assert.equal(magazyn.zapiszFaktury({ faktury: [], sprzedawca: null, nabywcy: [], utrataOd: '2026-10' }), true);
    assert.equal(magazyn.wczytajFaktury().utrataOd, '2026-10');
    dane.set('dn-faktury-v1', JSON.stringify({ faktury: [], utrataOd: '<script>' }));
    assert.equal(magazyn.wczytajFaktury().utrataOd, null);
  } finally {
    if (opis) Object.defineProperty(globalThis, 'localStorage', opis);
    else delete globalThis.localStorage;
  }
});

test('NIP z samych zer odrzucony, luka w numeracji wykrywana', () => {
  assert.equal(sprawdzNip('0000000000').stan, 'blad');
  assert.equal(sprawdzNip('PL000-000-00-00').stan, 'blad');
  const f = [zapisana('1/2026', '2026-05-02', '100'), zapisana('2/2026', '2026-06-02', '100')];
  assert.equal(lukaWNumeracji(f, '7/2026'), '3/2026');
  assert.equal(lukaWNumeracji(f, '3/2026'), null);
  assert.equal(lukaWNumeracji(f, '2/2026'), null);
  assert.equal(lukaWNumeracji([], '1/2027'), null);
  assert.equal(lukaWNumeracji([], '2/2027'), '1/2027');
});

// ---------------------------------------------------------------- adres sprzedawcy i nabywca z Polski

test('błąd: adres sprzedawcy obowiązkowy (art. 106e ust. 1 pkt 3)', () => {
  for (const adres of ['', '   ', undefined]) {
    assert.throws(() => normalizujFakture(faktura({ sprzedawca: { nazwa: 'Anna Nowak', adres, id: PESEL_OK } })),
      (e) => e instanceof BladPola && e.pole === 'sprzedawcaAdres' && /art\. 106e ust\. 1 pkt 3/.test(e.message));
  }
  assert.deepEqual(dokumentFaktury(normalizujFakture(faktura())).sprzedawca.linie, ['Anna Nowak', 'ul. Lipowa 5, 90-001 Łódź', 'PESEL: 95251401357']);
});

test('błąd: firma z zagranicy odrzucona (art. 28b, art. 106e ust. 1 pkt 18 i 24), bez podstawy z art. 113', () => {
  for (const nip of ['DE123456789', 'CZ12345678', 'FR12345678901', 'GB123456789']) {
    assert.throws(() => normalizujFakture(firma({ nabywca: { rodzaj: 'firma', nazwa: 'GmbH', adres: 'Berlin', nip } })),
      (e) => e.pole === 'nabywcaNip' && /z zagranicy tu nie przygotujesz/.test(e.message) && /art\. 28b/.test(e.message));
  }
  assert.equal(normalizujFakture(firma({ nabywca: { rodzaj: 'firma', nazwa: 'F', adres: 'A', nip: 'PL1234563218' } })).nabywca.nip, NIP_OK);
});

// ---------------------------------------------------------------- stan KSeF w skrócie

test('krótki stan KSeF dla firmy pod „Kto kupuje”', () => {
  const sp = (t) => t.replace(/[  ]/g, ' ');
  const f = [zapisana('1/2026', '2026-10-05', '2500')];
  assert.equal(sp(skrotKsef(regulaKsef({ dataWystawienia: '2026-10-22', dzis: '2026-10-22', rodzaj: 'firma', kwotaGr: 0n, faktury: f }))),
    'Firma: w październiku 2026 2 500,00 zł z 10 000,00 zł poza KSeF.');
  assert.equal(skrotKsef(regulaKsef({ dataWystawienia: '2027-01-04', dzis: '2027-01-04', rodzaj: 'firma' })), 'Firma: od 2027 r. faktury tylko w KSeF.');
  assert.match(skrotKsef(regulaKsef({ dataWystawienia: '2026-11-04', rodzaj: 'firma', utrataOd: '2026-10' })), /już przekroczony/);
  assert.match(sp(skrotKsef(regulaKsef({ dataWystawienia: '2026-11-04', rodzaj: 'firma', kwotaGr: zl('10000.01') }))), /ponad 10 000,00 zł/);
  assert.equal(skrotKsef(regulaKsef({ dataWystawienia: '2026-11-04', rodzaj: 'konsument' })), '');
});

test('atak: data wystawienia w przód nie omija limitu; data wystawienia = dziś dla firmy i osoby prywatnej', () => {
  // 22.10.2026: w październiku 9000 zł faktur dla firm, faktura na 2000 zł z datą wystawienia 1.11
  const f = [zapisana('1/2026', '2026-10-05', '9000')];
  assert.throws(() => normalizujFakture(firma({ numer: '2/2026', dataWystawienia: '2026-11-01', dataSprzedazy: '2026-10-22',
    pozycje: [{ nazwa: 'X', ilosc: '1', cena: '2000' }] }), { dzis: '2026-10-22' }), (e) => e.pole === 'dataWystawienia');
  // widok liczy regułę zawsze od dzisiejszej daty, więc wynik to „limit”, nie „w-limicie” z listopada
  const r = regulaKsef({ dataWystawienia: '2026-10-22', dzis: '2026-10-22', rodzaj: 'firma', kwotaGr: zl('2000'), faktury: f });
  assert.equal(r.stan, 'blokada');
  assert.equal(r.powod, 'limit');
  // osoba prywatna: także bez antydatowania i bez daty w przód
  for (const d of ['2026-10-21', '2026-10-23']) {
    assert.throws(() => normalizujFakture(faktura({ dataWystawienia: d, dataSprzedazy: '2026-10-20' }), { dzis: '2026-10-22' }), (e) => e.pole === 'dataWystawienia');
  }
  assert.equal(normalizujFakture(faktura({ dataWystawienia: '2026-10-22' }), { dzis: '2026-10-22' }).dataWystawienia, '2026-10-22');
});

// ---------------------------------------------------------------- identyfikator podatkowy sprzedawcy

const pesel = (dziesiec) => dziesiec + String((10 - ([1, 3, 7, 9, 1, 3, 7, 9, 1, 3].reduce((a, w, i) => a + w * Number(dziesiec[i]), 0) % 10)) % 10);

test('błąd: NIP albo PESEL sprzedawcy obowiązkowy (art. 106e ust. 1 pkt 4), na wydruku z rodzajem', () => {
  for (const id of ['', '  ', undefined]) {
    assert.throws(() => normalizujFakture(faktura({ sprzedawca: { nazwa: 'Anna', adres: 'Łódź', id } })),
      (e) => e instanceof BladPola && e.pole === 'sprzedawcaId' && e.message === 'Wpisz swój NIP albo PESEL (art. 106e ust. 1 pkt 4 ustawy o VAT).');
  }
  // PESEL: suma kontrolna i data (stulecia 1800–2299)
  assert.ok(poprawnyPesel(PESEL_OK));
  assert.ok(poprawnyPesel(pesel('9427080362')), '8.07.2094 (miesiąc + 20)');
  assert.ok(poprawnyPesel(pesel('9992310000')), '31.12.1899 (miesiąc + 80)');
  assert.ok(!poprawnyPesel('95251401358'), 'zła cyfra kontrolna');
  assert.ok(!poprawnyPesel(pesel('9533140135')), 'miesiąc 13');
  assert.ok(!poprawnyPesel(pesel('0202300000')), '30 lutego');
  assert.deepEqual(sprawdzIdSprzedawcy(' 952514 01357 '), { stan: 'ok', rodzajId: 'PESEL', id: PESEL_OK });
  assert.deepEqual(sprawdzIdSprzedawcy('123-456-32-18'), { stan: 'ok', rodzajId: 'NIP', id: NIP_OK });
  assert.equal(sprawdzIdSprzedawcy('95251401358').stan, 'blad');
  assert.equal(sprawdzIdSprzedawcy('1234563219').stan, 'blad');
  assert.equal(sprawdzIdSprzedawcy('DE123456789').stan, 'blad');
  assert.equal(sprawdzIdSprzedawcy('123').stan, 'blad');
  // wydruk: „PESEL: …” albo „NIP: …”
  const zPesel = dokumentFaktury(normalizujFakture(faktura()));
  assert.equal(zPesel.sprzedawca.linie.at(-1), 'PESEL: 95251401357');
  const zNip = dokumentFaktury(normalizujFakture(faktura({ sprzedawca: { nazwa: 'Anna', adres: 'Łódź', id: 'PL1234563218' } })));
  assert.equal(zNip.sprzedawca.linie.at(-1), 'NIP: 123-456-32-18');
  // starszy zapis sprzedawcy z polem nip też jest czytany
  assert.equal(normalizujFakture(faktura({ sprzedawca: { nazwa: 'Anna', adres: 'Łódź', nip: NIP_OK } })).sprzedawca.rodzajId, 'NIP');
  // stara zapisana faktura bez identyfikatora: dokument bez linii identyfikatora, bez „null”/„undefined”
  const stara = { ...normalizujFakture(faktura()), sprzedawca: { nazwa: 'Anna', adres: 'Łódź', nip: '' } };
  const d = dokumentFaktury(stara);
  assert.deepEqual(d.sprzedawca.linie, ['Anna', 'Łódź']);
  assert.ok(!/null|undefined/.test(JSON.stringify(d)));
});

test('miesiąc w dopełniaczu w oknie limitu', () => {
  assert.equal(miesiacDopelniacz('2026-10'), 'października 2026\u00a0r.');
  assert.equal(miesiacDopelniacz('2026-04'), 'kwietnia 2026\u00a0r.');
  assert.equal(miesiacDopelniacz('2026-12'), 'grudnia 2026\u00a0r.');
});

// ---------------------------------------------------------------- teksty okien

const zdania = (t) => 1 + [...t.replace(/ /g, ' ').matchAll(/[.!?]\s+(?=[A-ZĄĆĘŁŃÓŚŹŻ])/g)].length;

test('okna mają akapity po najwyżej 2 zdania, twarde spacje przed „r.” i „zł”, ustalone brzmienia', () => {
  const okna = { limit: TEKSTY_OKIEN.limit('2026-10'), zaznacz: TEKSTY_OKIEN.zaznacz, cofnij: TEKSTY_OKIEN.cofnij };
  for (const [nazwa, akapity] of Object.entries(okna)) {
    assert.ok(Array.isArray(akapity) && akapity.length >= 1, nazwa);
    for (const a of akapity) {
      assert.ok(zdania(a) <= 2, `${nazwa}: ${zdania(a)} zdania: ${a}`);
      assert.ok(!/\d r\./.test(a), `${nazwa}: zwykła spacja przed „r.”: ${a}`);
      assert.ok(!/\d zł/.test(a) && !/10 000/.test(a), `${nazwa}: zwykła spacja w kwocie: ${a}`);
    }
  }
  const sp = (t) => t.replace(/ /g, ' ');
  assert.deepEqual(TEKSTY_OKIEN.cofnij.map(sp), [
    'Zrób to tylko, jeśli zaznaczyłeś to przez pomyłkę, czyli w żadnym miesiącu od kwietnia 2026 r. faktury dla firm nie przekroczyły razem 10 000 zł brutto.',
    'Strona znów pozwoli wystawiać tu faktury dla firm do 10 000 zł w miesiącu, a za zgodność z przepisami odpowiadasz Ty.',
  ]);
  assert.match(sp(TEKSTY_OKIEN.limit('2026-10')[0]), /Zapamiętamy to od października 2026 r\.$/);
  assert.equal(KOMUNIKAT_PO_OKNIE_LIMITU, 'Sprawdź kwotę albo wystaw tę fakturę w KSeF.');
});

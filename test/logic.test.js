import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  POLA, BladDanych, naGrosze, iloczynWGroszach, groszeNaTekst, formatujZl, normalizujLiczbe,
  limitKwartalny, limitDlaRoku, statusLimitu, przychodKwartalu, kwartal, dodajDni, dataWarszawa,
  oknoKursu, adresKursuNbp, wybierzKurs, pobierzKursNbp, parsujCsv, doCsv, zneutralizujFormule,
  wczytajEwidencje, zapiszEwidencje, sprawdzEwidencje, dodajWpis, usunOstatni, raportMiesiaca,
  wykryjFormat, importujPlik, dopiszImport, poprawnaData,
} from '../public/js/logic.js';

// ---------------------------------------------------------------- liczby

test('naGrosze: przecinek, kropka, spacje, zaokrąglenie połówkowe od zera', () => {
  assert.equal(naGrosze('10 813,50'), 1081350n);
  assert.equal(naGrosze('12.5'), 1250n);
  assert.equal(naGrosze('0.005'), 1n);
  assert.equal(naGrosze('-0.005'), -1n);
  assert.equal(naGrosze('0.004'), 0n);
  assert.throws(() => naGrosze('1e3'), BladDanych);
  assert.throws(() => naGrosze('abc'), BladDanych);
  assert.throws(() => naGrosze(''), BladDanych);
});

test('iloczynWGroszach: zaokrąglenie połówkowe od zera (jak Decimal ROUND_HALF_UP)', () => {
  assert.equal(iloczynWGroszach('29.00', '3.9042'), 11322n); // 113.2218
  assert.equal(iloczynWGroszach('7.99', '4.2325'), 3382n); // 33.817675 → 33.82
  assert.equal(iloczynWGroszach('1.5', '0.01'), 2n); // 0.015 → 0.02
  assert.equal(iloczynWGroszach('-1.5', '0.01'), -2n);
  assert.equal(iloczynWGroszach('100', '1'), 10000n);
});

test('formatowanie kwot', () => {
  assert.equal(groszeNaTekst(1081350n), '10813.50');
  assert.equal(groszeNaTekst(-5n), '-0.05');
  assert.equal(formatujZl(1081350n), '10 813,50 zł');
  assert.equal(formatujZl(-123456789n), '−1 234 567,89 zł');
  assert.equal(normalizujLiczbe('12,50'), '12.50');
  assert.equal(normalizujLiczbe('-0,5'), '-0.5');
  assert.equal(normalizujLiczbe('7'), '7');
});

// ---------------------------------------------------------------- daty

test('daty: walidacja, dodawanie dni, kwartały, strefa Warszawy', () => {
  assert.ok(poprawnaData('2026-02-28'));
  assert.ok(!poprawnaData('2026-02-29'));
  assert.ok(poprawnaData('2028-02-29'));
  assert.equal(dodajDni('2026-01-01', -1), '2025-12-31');
  assert.deepEqual(kwartal('2026-03-31'), { rok: 2026, q: 1 });
  assert.deepEqual(kwartal('2026-04-01'), { rok: 2026, q: 2 });
  assert.deepEqual(kwartal('2026-12-31'), { rok: 2026, q: 4 });
  // 23:30 UTC 31.03 to już 1.04 w Warszawie (CEST, UTC+2) — inny kwartał.
  assert.equal(dataWarszawa('2026-03-31T23:30:00Z'), '2026-04-01');
  assert.equal(dataWarszawa('2026-12-31T22:59:59Z'), '2026-12-31');
  assert.equal(dataWarszawa('2026-12-31T23:00:00Z'), '2027-01-01');
});

// ---------------------------------------------------------------- limit

test('limit kwartalny 2026 = 10 813,50 zł, 2027 = 11 137,50 zł, parametr płacy', () => {
  assert.equal(limitKwartalny('4806'), 1081350n);
  assert.equal(limitDlaRoku(2026), 1081350n);
  assert.equal(limitDlaRoku(2027), 1113750n);
  assert.equal(limitDlaRoku(2027, '5000'), 1125000n);
  assert.throws(() => limitDlaRoku(2030), BladDanych);
  assert.throws(() => limitKwartalny('0'), BladDanych);
});

test('statusLimitu: procent i progi 70/85/95/100%', () => {
  const limit = 1081350n;
  assert.equal(statusLimitu(0n, limit).prog, null);
  const s70 = statusLimitu(756945n, limit); // dokładnie 70%
  assert.equal(s70.prog, '0.70');
  assert.equal(s70.procent, 70);
  assert.equal(statusLimitu(756944n, limit).prog, null);
  assert.equal(statusLimitu(919148n, limit).prog, '0.85'); // 85,0000…%
  assert.equal(statusLimitu(1027283n, limit).prog, '0.95');
  const s100 = statusLimitu(1081350n, limit);
  assert.equal(s100.prog, '1.00');
  assert.equal(s100.przekroczony, false);
  assert.equal(s100.pozostaloGr, 0n);
  const sPonad = statusLimitu(1081351n, limit);
  assert.equal(sPonad.przekroczony, true);
  assert.equal(sPonad.pozostaloGr, -1n);
  assert.equal(statusLimitu(540675n, limit).procent, 50);
});

test('przychodKwartalu liczy tylko bieżący kwartał i odejmuje korekty', () => {
  const w = [
    { data: '2026-03-31', kwota_pln: '100.00' },
    { data: '2026-04-01', kwota_pln: '200.00' },
    { data: '2026-06-30', kwota_pln: '50.50' },
    { data: '2026-06-30', kwota_pln: '-20.00' },
    { data: '2026-07-01', kwota_pln: '999.00' },
  ];
  assert.equal(przychodKwartalu(w, '2026-05-15'), 23050n);
});

// ---------------------------------------------------------------- NBP

test('okno i adres zapytania NBP: 10 dni przed, bez dnia przychodu', () => {
  assert.deepEqual(oknoKursu('2026-01-05'), { od: '2025-12-26', do: '2026-01-04' });
  assert.equal(adresKursuNbp('usd', '2026-10-15'),
    'https://api.nbp.pl/api/exchangerates/rates/a/usd/2026-10-05/2026-10-14/?format=json');
  assert.throws(() => adresKursuNbp('US', '2026-10-15'), BladDanych);
});

const ODP_NBP = {
  table: 'A', code: 'USD',
  rates: [
    { no: '197/A/NBP/2026', effectiveDate: '2026-10-09', mid: 3.9022 },
    { no: '198/A/NBP/2026', effectiveDate: '2026-10-12', mid: 3.9211 },
  ],
};

test('wybierzKurs: ostatni dzień roboczy przed sprzedażą (weekend)', () => {
  // Sprzedaż w poniedziałek 12.10 → kurs z piątku 9.10, nie z dnia sprzedaży.
  assert.deepEqual(wybierzKurs(ODP_NBP, '2026-10-12'), { kurs: '3.9022', dataKursu: '2026-10-09', tabela: '197/A/NBP/2026' });
  assert.equal(wybierzKurs(ODP_NBP, '2026-10-13').dataKursu, '2026-10-12');
  assert.throws(() => wybierzKurs({ rates: [] }, '2026-10-13'), BladDanych);
});

test('pobierzKursNbp: fetch bez ciasteczek, obsługa 404 i PLN', async () => {
  let wywolanie;
  const fetchFn = async (url, opcje) => { wywolanie = { url, opcje }; return { ok: true, status: 200, json: async () => ODP_NBP }; };
  const k = await pobierzKursNbp('USD', '2026-10-13', fetchFn);
  assert.equal(k.kurs, '3.9211');
  assert.equal(wywolanie.opcje.credentials, 'omit');
  assert.equal(wywolanie.opcje.referrerPolicy, 'no-referrer');
  assert.match(wywolanie.url, /\/rates\/a\/usd\/2026-10-03\/2026-10-12\//);
  await assert.rejects(pobierzKursNbp('XYZ', '2026-10-13', async () => ({ ok: false, status: 404 })), BladDanych);
  await assert.rejects(pobierzKursNbp('USD', '2026-10-13', async () => { throw new Error('offline'); }), /API NBP/);
  assert.deepEqual(await pobierzKursNbp('PLN', '2026-10-13', () => { throw new Error('nie wołać'); }), { kurs: '1', dataKursu: '', tabela: '' });
});

// ---------------------------------------------------------------- CSV

test('parsujCsv: cudzysłowy, nowe linie, BOM, średnik', () => {
  assert.deepEqual(parsujCsv('﻿a,b\r\n"x, y","z ""q"""\n'), [['a', 'b'], ['x, y', 'z "q"']]);
  assert.deepEqual(parsujCsv('a;b\n1,5;2\n'), [['a', 'b'], ['1,5', '2']]);
  assert.deepEqual(parsujCsv('a\n"wiele\nlinii"'), [['a'], ['wiele\nlinii']]);
  assert.throws(() => parsujCsv('a\n"otwarte'), BladDanych);
  const wiersze = [['a', 'b'], ['1,5', 'x"y']];
  assert.deepEqual(parsujCsv(doCsv(wiersze)), wiersze);
});

test('zneutralizujFormule chroni pola tekstowe przed formułami', () => {
  assert.equal(zneutralizujFormule('=HYPERLINK("x")'), '\'=HYPERLINK("x")');
  assert.equal(zneutralizujFormule('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(zneutralizujFormule('Zwykły opis'), 'Zwykły opis');
});

// ---------------------------------------------------------------- ewidencja

function ewidencjaPrzykladowa() {
  let w = [];
  w = dodajWpis(w, { data: '2026-10-12', kanal: 'gumroad', idTransakcji: 'A1', opis: 'Produkt testowy', kwota: '7.99', waluta: 'USD', kurs: '3.9022', dataKursu: '2026-10-09' });
  w = dodajWpis(w, { data: '2026-10-12', kanal: 'reczna', idTransakcji: 'R1', opis: 'Sprzedaż', kwota: '29', waluta: 'PLN' });
  w = dodajWpis(w, { data: '2026-10-14', kanal: 'gumroad', idTransakcji: 'A2', opis: 'Produkt testowy', kwota: '7.99', waluta: 'usd', kurs: '3,9177', dataKursu: '2026-10-13' });
  w = dodajWpis(w, { data: '2026-10-20', kanal: 'gumroad', idTransakcji: 'A1-zwrot', opis: 'Zwrot', kwota: '-7.99', waluta: 'USD', kurs: '3.9022', dataKursu: '2026-10-09', korektaDo: '1' });
  return w;
}

test('dodajWpis: format pliku, kwota_pln, PLN z kursem 1, walidacja', () => {
  const w = ewidencjaPrzykladowa();
  assert.equal(w.length, 4);
  assert.deepEqual(w[0], {
    lp: '1', data: '2026-10-12', kanal: 'gumroad', id_transakcji: 'A1', opis: 'Produkt testowy', kwota: '7.99',
    waluta: 'USD', kurs_nbp: '3.9022', data_kursu: '2026-10-09', kwota_pln: '31.18', korekta_do: '',
  });
  assert.equal(w[1].kurs_nbp, '1');
  assert.equal(w[1].kwota_pln, '29.00');
  assert.equal(w[2].waluta, 'USD');
  assert.equal(w[2].kurs_nbp, '3.9177');
  assert.equal(w[3].kwota_pln, '-31.18');
  assert.deepEqual(sprawdzEwidencje(w), []);
  assert.throws(() => dodajWpis(w, { data: '2026-10-21', kanal: 'gumroad', idTransakcji: 'A1', kwota: '1', waluta: 'PLN' }), /już jest/);
  assert.throws(() => dodajWpis(w, { data: '2026-10-21', kanal: 'x', idTransakcji: 'B', kwota: '-1', waluta: 'PLN' }), /korekta_do/);
  assert.throws(() => dodajWpis(w, { data: '2026-10-21', kanal: 'x', idTransakcji: 'B', kwota: '1', waluta: 'EUR' }), /kurs/);
  assert.throws(() => dodajWpis(w, { data: '2026-02-30', kanal: 'x', idTransakcji: 'B', kwota: '1', waluta: 'PLN' }), /data/);
  assert.throws(() => dodajWpis(w, { data: '2026-10-21', kanal: 'x', idTransakcji: 'B', kwota: '1', waluta: 'PLN', korektaDo: '9' }), /brak wpisu/);
});

test('sprawdzEwidencje wykrywa błędy w pliku ewidencji', () => {
  const w = ewidencjaPrzykladowa().map((x) => ({ ...x }));
  w[0].kwota_pln = '31.19';
  w[1].kurs_nbp = '2';
  w[2].lp = '7';
  w[3].korekta_do = '';
  const bledy = sprawdzEwidencje(w).join('\n');
  assert.match(bledy, /lp 1: kwota_pln ≠ kwota × kurs/);
  assert.match(bledy, /dla PLN kurs musi wynosić 1/);
  assert.match(bledy, /lp powinno wynosić 3/);
  assert.match(bledy, /kwota ujemna/);
});

test('zapis i odczyt pliku ewidencji: nagłówek, round-trip, pusty plik', () => {
  const w = ewidencjaPrzykladowa();
  const tekst = zapiszEwidencje(w);
  assert.ok(tekst.startsWith(`${POLA.join(',')}\r\n`));
  assert.deepEqual(wczytajEwidencje(tekst), w);
  assert.deepEqual(wczytajEwidencje(''), []);
  assert.throws(() => wczytajEwidencje('a,b\n1,2\n'), /nagłówek/);
  assert.deepEqual(usunOstatni(w).length, 3);
});

test('raportMiesiaca: dzień i narastająco od początku miesiąca', () => {
  const r = raportMiesiaca(ewidencjaPrzykladowa(), '2026-10');
  assert.deepEqual(r.map((x) => [x.lp, x.data, groszeNaTekst(x.kwotaGr), groszeNaTekst(x.narastajacoGr)]), [
    [1, '2026-10-12', '60.18', '60.18'],
    [2, '2026-10-14', '31.30', '91.48'],
    [3, '2026-10-20', '-31.18', '60.30'],
  ]);
  assert.deepEqual(raportMiesiaca(ewidencjaPrzykladowa(), '2026-11'), []);
  assert.throws(() => raportMiesiaca([], '2026-1'), BladDanych);
});

// ---------------------------------------------------------------- import

const GUMROAD = [
  'Purchase ID,Item Name,Buyer Name,Purchase Email,Buyer Email,Do not contact?,Purchase Date,Purchase Time (UTC timezone),Subtotal ($),Taxes ($),Shipping ($),Sale Price ($),Gumroad Fee ($),Net Total ($),Tax Included in Price?,Street Address,City,Zip Code,State,Country,Referrer,Refunded?,Partial Refund ($),Fully Refunded?,Disputed?',
  'gjLB==,Produkt testowy,Jan Testowy,kupujacy@example.com,,0,2026-03-31,2026-03-31 22:30:00 +0000,7.99,0.0,0.0,7.99,0.95,7.04,,,,,,Poland,direct,0,0.0,0,0',
  'nIPM==,"=HYPERLINK(""x"")",,kupujacy2@example.com,,0,2026-04-02,2026-04-02 10:00:00 +0000,7.99,0.0,0.0,7.99,0.95,7.04,,,,,,Poland,direct,1,0.0,1,0',
  'free==,Darmowy,,k3@example.com,,0,2026-04-02,2026-04-02 11:00:00 +0000,0.0,0.0,0.0,0.0,0.0,0.0,,,,,,Poland,direct,0,0.0,0,0',
  'Totals,,,,,,,,15.98,0,0,15.98,1.9,14.08,,,,,,,,,,,',
].join('\n');

test('import Gumroad: data w strefie Warszawy, Sale Price, bez danych osobowych, zwroty jako uwagi', () => {
  const wynik = importujPlik(GUMROAD);
  assert.equal(wynik.format, 'gumroad');
  assert.equal(wynik.pozycje.length, 2);
  assert.deepEqual(wynik.pozycje[0], { data: '2026-04-01', kanal: 'gumroad', idTransakcji: 'gjLB==', opis: 'Produkt testowy', kwota: '7.99', waluta: 'USD' });
  assert.ok(!JSON.stringify(wynik.pozycje).includes('@example.com'));
  assert.ok(!JSON.stringify(wynik.pozycje).includes('Testowy'));
  assert.ok(wynik.uwagi.some((u) => u.includes('nIPM==') && u.includes('zwrot')));
  assert.ok(wynik.uwagi.some((u) => u.includes('free==')));
});

const POLAR = [
  'Email,Created At,Product,Net Amount,Currency,Status,Invoice number,Total',
  'a@example.com,2026-10-12T09:00:00+00:00,Produkt testowy,7.0,usd,paid,INV-1,8.61',
  'b@example.com,2026-10-13T09:00:00+00:00,Produkt testowy,7.0,usd,pending,INV-2,8.61',
  'c@example.com,2026-10-13 23:30:00+00:00,Produkt testowy,7.0,eur,refunded,,8.61',
].join('\n');

test('import Polar: Total (brutto), pomija pending, uwagi o zwrotach i braku numeru', () => {
  const wynik = importujPlik(POLAR);
  assert.equal(wynik.format, 'polar');
  assert.equal(wynik.pozycje.length, 2);
  assert.deepEqual(wynik.pozycje[0], { data: '2026-10-12', kanal: 'polar', idTransakcji: 'INV-1', opis: 'Produkt testowy', kwota: '8.61', waluta: 'USD' });
  assert.equal(wynik.pozycje[1].data, '2026-10-14');
  assert.equal(wynik.pozycje[1].waluta, 'EUR');
  assert.ok(wynik.uwagi.some((u) => u.includes('pending')));
  assert.ok(wynik.uwagi.some((u) => u.includes('zwrot')));
  const bezTotal = importujPlik('Email,Created At,Product,Net Amount,Currency,Status,Invoice number\nx@example.com,2026-10-12T09:00:00+00:00,P,7.0,usd,paid,INV-9\n');
  assert.equal(bezTotal.pozycje[0].kwota, '7.0');
  assert.ok(bezTotal.uwagi.some((u) => u.includes('Net Amount')));
});

test('wykryjFormat i błędy importu', () => {
  assert.equal(wykryjFormat(POLA), 'ewidencja');
  assert.equal(wykryjFormat(['x', 'y']), null);
  assert.throws(() => importujPlik('x,y\n1,2\n'), /nie rozpoznano/);
  assert.throws(() => importujPlik(`${POLA.join(',')}\n`), /plik ewidencji/);
});

test('dopiszImport: kursy z pamięci podręcznej, pomija duplikaty, neutralizuje formuły', async () => {
  const { pozycje } = importujPlik(GUMROAD);
  let zapytania = 0;
  const pobierz = async (waluta, data) => { zapytania += 1; return { kurs: '4.0000', dataKursu: dodajDni(data, -1) }; };
  const r1 = await dopiszImport([], [...pozycje, { ...pozycje[0] }], pobierz);
  assert.equal(r1.dodane, 2);
  assert.equal(r1.pominiete.length, 1);
  assert.equal(zapytania, 2);
  assert.equal(r1.wiersze[1].opis, '\'=HYPERLINK("x")');
  assert.equal(r1.wiersze[0].kwota_pln, '31.96');
  assert.deepEqual(sprawdzEwidencje(r1.wiersze), []);
  const r2 = await dopiszImport(r1.wiersze, pozycje, pobierz);
  assert.equal(r2.dodane, 0);
  assert.equal(r2.pominiete.length, 2);
  const r3 = await dopiszImport([], pozycje.slice(0, 1), async () => { throw new BladDanych('offline'); });
  assert.equal(r3.dodane, 0);
  assert.match(r3.bledy[0], /offline/);
});

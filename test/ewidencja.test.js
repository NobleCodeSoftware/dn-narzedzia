import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BladDanych } from '../public/js/logic.js';
import { opisProgu, klasaProgu, procentTekst } from '../public/js/wspolne.js';
import {
  normalizujWpis, tekstLiczby, kwotaPlnGr, historiaKwartalow, prognoza, przebiegKwartalu, wartosciArkusza,
  wierszeEwidencji, wierszeNaWpisy, odczytajDate, granicaKwartalu, kolejnyNumer, posortuj, kwotaProgu,
  niejednoznacznaKwota, polaczWpisy, ostrzezeniaZwrotow, opisOstrzezeniaZwrotu, statusKwartalu,
} from '../public/js/ewidencja-logika.js';
import { eksportujCsv, importujCsv, parsujCsv } from '../public/js/csv.js';
import { eksportujXlsx, importujXlsx, komorkiArkusza } from '../public/js/xlsx.js';
import { czytajZip, zapiszZip, crc32 } from '../public/js/zip.js';

const WZOR = readFileSync(new URL('../public/pobierz/arkusz-limit-dn.xlsx', import.meta.url));
let nr = 0;
const w = (data, kwota, waluta = 'PLN', kurs = '', opis = '') => normalizujWpis({ id: `t${nr += 1}`, data, kwota, waluta, kurs, opis });
const zl = (t) => BigInt(Math.round(Number(t) * 100));

// ---------------------------------------------------------------- wpisy i kwoty

test('liczby z pliku: formaty polskie i angielskie', () => {
  assert.equal(tekstLiczby('1 234,50'), '1234.50');
  assert.equal(tekstLiczby('1.234,50'), '1234.50');
  assert.equal(tekstLiczby('1,234.50'), '1234.50');
  assert.equal(tekstLiczby('49,9 zł'), '49.9');
  assert.equal(tekstLiczby('−20'), '-20');
  assert.equal(tekstLiczby(49.900000000000006), '49.9');
  assert.equal(tekstLiczby(4.3641), '4.3641');
  assert.equal(tekstLiczby(100), '100');
  assert.throws(() => tekstLiczby('abc'), BladDanych);
});

test('wpis: walidacja i kwota w PLN z zaokrągleniem jak ROUND(C*E;2)', () => {
  assert.equal(kwotaPlnGr(w('2026-10-01', '49,90')), 4990n);
  assert.equal(kwotaPlnGr(w('2026-10-01', '10', 'EUR', '4,3641')), 4364n); // 43,641 → 43,64
  assert.equal(kwotaPlnGr(w('2026-10-01', '0,5', 'EUR', '4,3650')), 218n); // 2,1825 → 2,18
  assert.equal(kwotaPlnGr(w('2026-10-01', '0,7', 'EUR', '4,3650')), 306n); // 3,0555 → 3,06 (połówka w górę)
  assert.equal(kwotaPlnGr(w('2026-10-01', '-25', 'USD', '3,9')), -9750n); // zwrot
  assert.equal(kwotaPlnGr(w('2026-10-01', '10', 'EUR')), null);
  assert.throws(() => normalizujWpis({ data: '2026-13-01', kwota: '1' }), /datę/);
  assert.throws(() => normalizujWpis({ data: '2026-10-01', kwota: '0' }), /zerem/);
  assert.throws(() => normalizujWpis({ data: '2026-10-01', kwota: '5', waluta: 'EURO' }), /trzyliterowy/);
  assert.throws(() => normalizujWpis({ data: '2026-10-01', kwota: '5', waluta: 'EUR', kurs: '-1' }), /większy od zera/);
  assert.equal(normalizujWpis({ data: '2026-10-01', kwota: '5', waluta: 'PLN', kurs: '4' }).kurs, '', 'PLN bez kursu');
});

// ---------------------------------------------------------------- kwartały

test('sumy kwartałów: grupowanie, waluty bez kursu, zwroty, kolejność od najnowszego', () => {
  const wpisy = [
    w('2026-01-15', '1000'), w('2026-03-31', '500,50'), w('2026-04-01', '200'),
    w('2026-04-10', '100', 'EUR', '4,25'), w('2026-04-11', '50', 'USD'), w('2026-05-01', '-30'),
    w('2027-01-02', '11137,51'),
  ];
  const h = historiaKwartalow(wpisy);
  assert.deepEqual(h.map((k) => [k.klucz, k.sumaGr, k.liczba, k.bezKursu]), [
    ['2027-1', 1113751n, 1, 0], ['2026-2', 20000n + 42500n - 3000n, 4, 1], ['2026-1', 150050n, 2, 0],
  ]);
  assert.equal(h[0].limitGr, 1113750n);
  assert.ok(h[0].status.przekroczony);
  assert.deepEqual(h[0].przekroczenie, { data: '2027-01-02', termin: '2027-01-09' });
  assert.equal(h[1].przekroczenie, null);
  assert.equal(historiaKwartalow([w('2028-01-01', '5')])[0].limitGr, null, 'brak płacy minimalnej 2028');
  assert.equal(historiaKwartalow([w('2025-12-01', '5')])[0].limitGr, null, 'limit kwartalny od 2026');
});

test('granice kwartałów', () => {
  assert.deepEqual(granicaKwartalu(2026, 1), { od: '2026-01-01', doDnia: '2026-03-31' });
  assert.deepEqual(granicaKwartalu(2026, 4), { od: '2026-10-01', doDnia: '2026-12-31' });
  assert.deepEqual(granicaKwartalu(2028, 1), { od: '2028-01-01', doDnia: '2028-03-31' });
});

test('przebieg kwartału: suma dzień po dniu, kilka wpisów jednego dnia', () => {
  const p = przebiegKwartalu([w('2026-10-02', '10'), w('2026-10-01', '5'), w('2026-10-02', '1'), w('2026-09-30', '99')], 2026, 4);
  assert.deepEqual(p.map((x) => [x.data, x.sumaGr]), [['2026-10-01', 500n], ['2026-10-02', 1600n]]);
});

// ---------------------------------------------------------------- progi

test('progi 70/85/95/100%: kwoty i dzień osiągnięcia', () => {
  const limit = 1081350n;
  assert.equal(kwotaProgu(limit, '0.70'), 756945n);
  assert.equal(kwotaProgu(limit, '0.85'), 919148n); // 9191,475 → 9191,48
  assert.equal(kwotaProgu(limit, '0.95'), 1027283n); // 10272,825 → 10272,83
  const wpisy = [w('2026-10-01', '7569,45'), w('2026-10-05', '1622'), w('2026-10-06', '0,03'), w('2026-10-08', '1081,35'), w('2026-10-09', '540,67'), w('2026-10-10', '0,01')];
  const p = prognoza(wpisy, '2026-10-10');
  const dni = Object.fromEntries(p.progi.map((x) => [x.prog, x.osiagnietyDnia]));
  assert.deepEqual(dni, { '0.70': '2026-10-01', '0.85': '2026-10-06', '0.95': '2026-10-08', '1.00': '2026-10-09', przekroczenie: '2026-10-10' });
  // 85%: 9191,45 to jeszcze nie próg (9191,475), 9191,48 już tak.
  assert.equal(p.status.przekroczony, true);
  assert.deepEqual(p.przekroczenie, { data: '2026-10-10', termin: '2026-10-17', prognoza: false });
});

// ---------------------------------------------------------------- prognoza

test('prognoza: tempo od początku kwartału, data przekroczenia, zapas, budżet dzienny', () => {
  // 22 dni października (1–22.10), 4400 zł → 200 zł dziennie. Limit 10 813,50 zł.
  const wpisy = [w('2026-10-01', '1000'), w('2026-10-10', '1400'), w('2026-10-20', '2000')];
  const p = prognoza(wpisy, '2026-10-22');
  assert.equal(p.dniMinelo, 22);
  assert.equal(p.dniZostalo, 70);
  assert.equal(p.sumaGr, 440000n);
  assert.equal(p.zapasGr, 641350n);
  assert.equal(p.tempoDzienneGr, 20000n);
  // 4400 + 200·k > 10 813,50 → k > 32,0675 → k = 33 → 22.10 + 33 dni = 24.11.
  assert.deepEqual(p.przekroczenie, { data: '2026-11-24', termin: '2026-12-01', prognoza: true });
  assert.equal(p.sumaNaKoniecGr, 440000n + 20000n * 70n);
  assert.equal(p.budzetDziennyGr, 641350n / 71n);
  const progi = Object.fromEntries(p.progi.map((x) => [x.prog, x.prognozaDnia]));
  // 70% = 7569,45: 4400 + 200k ≥ 7569,45 → k ≥ 15,85 → 16 → 7.11.
  assert.equal(progi['0.70'], '2026-11-07');
  // 100%: 4400 + 200k ≥ 10 813,50 → k ≥ 32,07 → 33 → 24.11 (ten sam dzień co przekroczenie).
  assert.equal(progi['1.00'], '2026-11-24');
  assert.equal(p.pewnosc, 'zwykla');
});

test('prognoza: brak przekroczenia w kwartale, mała pewność na początku kwartału, brak sprzedaży', () => {
  const wolno = prognoza([w('2026-10-01', '100'), w('2026-10-15', '100'), w('2026-10-20', '100')], '2026-10-22');
  assert.equal(wolno.przekroczenie, null);
  assert.ok(wolno.progi.every((x) => x.prognozaDnia === null));
  assert.equal(prognoza([w('2026-10-02', '3000')], '2026-10-05').pewnosc, 'mala');
  const pusto = prognoza([], '2026-10-22');
  assert.equal(pusto.sumaGr, 0n);
  assert.equal(pusto.przekroczenie, null);
  assert.equal(pusto.zapasGr, 1081350n);
  assert.equal(prognoza([], '2028-02-01'), null, 'bez limitu na 2028');
});

test('prognoza: ostatni dzień kwartału nie przewiduje przekroczenia po jego końcu', () => {
  const p = prognoza([w('2026-12-01', '10000')], '2026-12-31');
  assert.equal(p.dniZostalo, 0);
  assert.equal(p.przekroczenie, null);
});

test('prognoza: sprzedaż z datą po dziś to plan, nie fakt (stan, progi i przekroczenie tylko do dziś)', () => {
  const wpisy = [w('2026-10-01', '1000'), w('2026-12-20', '10000')];
  const p = prognoza(wpisy, '2026-10-22');
  assert.equal(p.sumaGr, 100000n, 'suma do dziś');
  assert.equal(p.zapasGr, 1081350n - 100000n);
  assert.equal(p.status.przekroczony, false);
  assert.equal(p.zaplanowaneGr, 1000000n);
  assert.equal(p.liczbaZaplanowanych, 1);
  assert.equal(p.liczbaWpisow, 1);
  assert.ok(p.progi.every((x) => x.osiagnietyDnia === null), 'żaden próg nie jest osiągnięty dziś');
  // Plan wchodzi do prognozy: 20.12 suma do dziś i plan (11 000 zł) przekroczy limit.
  assert.deepEqual(p.przekroczenie, { data: '2026-12-20', termin: '2026-12-27', prognoza: true });
  // Na koniec kwartału: 1000 zł + większa z kwot: tempo (1000/22 × 70 dni ≈ 3181,81 zł) albo plan (10 000 zł), bez sumowania obu.
  assert.equal(p.sumaNaKoniecGr, 100000n + 1000000n);
  assert.equal(p.statusNaKoniec.przekroczony, true);
  // Historia z datą dzisiejszą: bez przekroczenia jako faktu, plan osobno.
  const [kw] = historiaKwartalow(wpisy, '2026-10-22');
  assert.equal(kw.sumaGr, 100000n);
  assert.equal(kw.przekroczenie, null);
  assert.equal(kw.status.przekroczony, false);
  assert.deepEqual([kw.zaplanowane, kw.zaplanowaneGr], [1, 1000000n]);
  // Bez daty dzisiejszej historia liczy wszystkie wpisy, jak formuły arkusza.
  assert.deepEqual(historiaKwartalow(wpisy)[0].przekroczenie, { data: '2026-12-20', termin: '2026-12-27' });
  // Gdy plan przyjdzie, liczy się jak fakt.
  assert.deepEqual(prognoza(wpisy, '2026-12-20').przekroczenie, { data: '2026-12-20', termin: '2026-12-27', prognoza: false });
});

test('prognoza: tempo większe od planu liczy się raz, plan nie dolicza się do tempa', () => {
  // 4400 zł w 22 dni → 200 zł dziennie; plan 500 zł na 1.11 jest mniejszy od wyniku tempa, więc nie zmienia prognozy.
  const bez = prognoza([w('2026-10-01', '1000'), w('2026-10-10', '1400'), w('2026-10-20', '2000')], '2026-10-22');
  const z = prognoza([w('2026-10-01', '1000'), w('2026-10-10', '1400'), w('2026-10-20', '2000'), w('2026-11-01', '500')], '2026-10-22');
  assert.equal(z.sumaGr, bez.sumaGr);
  assert.equal(z.sumaNaKoniecGr, bez.sumaNaKoniecGr);
  assert.deepEqual(z.przekroczenie, bez.przekroczenie);
  assert.equal(z.zaplanowaneGr, 50000n);
});

test('kwartał w przyszłości: zaplanowana sprzedaż ponad limit to prognozowane przekroczenie', () => {
  // Dziś 4.11.2026, sprzedaż 12.01.2027 na 12 000 zł (limit I kwartału 2027: 11 137,50 zł).
  const wpisy = [w('2026-10-01', '500'), w('2027-01-12', '12000')];
  const kw = historiaKwartalow(wpisy, '2026-11-04').find((k) => k.klucz === '2027-1');
  assert.equal(kw.sumaGr, 0n);
  assert.equal(kw.przekroczenie, null, 'to nie fakt');
  assert.deepEqual(kw.prognozaPrzekroczenia, { data: '2027-01-12', termin: '2027-01-19', prognoza: true });
  assert.equal(kw.statusZPlanem.przekroczony, true);
  assert.equal(kw.wolneGr, 0n);
  // Plan w limicie: bez prognozy przekroczenia, „zostało” po odjęciu planu.
  const wLimicie = historiaKwartalow([w('2027-01-12', '1000')], '2026-11-04')[0];
  assert.equal(wLimicie.prognozaPrzekroczenia, null);
  assert.equal(wLimicie.wolneGr, 1113750n - 100000n);
  assert.equal(historiaKwartalow(wpisy, '2026-11-04').find((k) => k.klucz === '2026-4').prognozaPrzekroczenia, null);
});

test('bieżący kwartał: przekroczenie z planu ma przyczynę „plan”, a budżet i zapas odejmują zaplanowane', () => {
  // Do dziś 1734,50 zł, plan 10 000 zł na 15.12: sam plan przekracza limit, więc nic nie zostaje.
  const p = prognoza([w('2026-10-01', '1734,50'), w('2026-12-15', '10000')], '2026-11-04');
  assert.equal(p.zapasGr, 1081350n - 173450n);
  assert.equal(p.wolneGr, 0n);
  assert.equal(p.budzetDziennyGr, 0n);
  assert.deepEqual(p.planPrzekroczenie, { data: '2026-12-15', termin: '2026-12-22', prognoza: true });
  assert.deepEqual(p.przekroczenie, { data: '2026-12-15', termin: '2026-12-22', prognoza: true });
  assert.equal(p.przyczynaPrzekroczenia, 'plan');
  // Plan mieści się w limicie, a przekroczenie wynika z tempa: budżet liczony od limitu minus sprzedaż do dziś i plan.
  const t = prognoza([w('2026-10-01', '1000'), w('2026-10-10', '1400'), w('2026-10-20', '2000'), w('2026-12-30', '1000')], '2026-10-22');
  assert.equal(t.przyczynaPrzekroczenia, 'tempo');
  assert.equal(t.planPrzekroczenie, null);
  assert.equal(t.wolneGr, 641350n - 100000n);
  assert.equal(t.budzetDziennyGr, (641350n - 100000n) / 71n);
  // Bez planu bez zmian.
  const bez = prognoza([w('2026-10-01', '1000')], '2026-10-22');
  assert.equal(bez.przyczynaPrzekroczenia, null);
  assert.equal(bez.wolneGr, bez.zapasGr);
});

test('włączenie pamięci łączy wpisy ze strony z zapisanymi w innej karcie, bez utraty i bez dubli', () => {
  const zapisane = [w('2026-10-01', '10'), w('2026-10-02', '20')];
  const lokalne = [zapisane[0], w('2026-10-03', '30'), w('2026-10-04', '40')];
  assert.deepEqual(polaczWpisy(zapisane, lokalne).map((x) => x.kwota), ['10', '20', '30', '40']);
  assert.deepEqual(polaczWpisy([], lokalne), lokalne, 'pusta pamięć: zostają wpisy ze strony');
});

test('stan kwartału: sprzedaż w walucie bez kursu jest policzona i oznaczona, a nie pominięta po cichu', () => {
  const p = prognoza([w('2026-10-01', '1000'), w('2026-10-05', '500', 'EUR'), w('2026-10-06', '20', 'USD'), w('2026-10-07', '10', 'EUR', '4,25')], '2026-10-22');
  assert.equal(p.bezKursu, 2);
  assert.equal(p.sumaGr, 100000n + 4250n, 'suma bez sprzedaży bez kursu');
  assert.equal(prognoza([w('2026-10-01', '1000')], '2026-10-22').bezKursu, 0);
});

// ---------------------------------------------------------------- arkusz, wydruk

test('wartości kolumn F–I jak w formułach arkusza', () => {
  const z = posortuj([w('2026-10-02', '7000'), w('2026-10-01', '1', 'EUR'), w('2026-10-03', '2000'), w('2026-10-03', '2000'), w('2028-01-01', '5')]);
  const v = wartosciArkusza(z);
  assert.deepEqual(v[0], { F: 'brak kursu', G: '', H: '', I: 'Wpisz kurs NBP w kolumnie E' });
  assert.equal(v[1].G, 700000n);
  assert.equal(v[1].I, 'W limicie');
  assert.equal(v[2].G, 1100000n, 'SUMIFS do daty włącznie: oba wpisy z 3.10');
  assert.equal(v[2].I, 'Limit przekroczony');
  assert.equal(v[4].H, 'brak limitu');
});

test('wydruk: Lp., narastająco od początku roku i w kwartale, tylko wybrany rok', () => {
  const { wiersze, sumaGr, brakiKursu } = wierszeEwidencji([
    w('2026-03-30', '100'), w('2026-04-02', '50'), w('2026-01-05', '10'), w('2026-04-03', '5', 'EUR'), w('2027-01-01', '7'),
  ], 2026);
  assert.deepEqual(wiersze.map((x) => [x.lp, x.data, x.narastajacoRokGr, x.narastajacoKwartalGr]), [
    [1, '2026-01-05', 1000n, 1000n], [2, '2026-03-30', 11000n, 11000n], [3, '2026-04-02', 16000n, 5000n], [4, '2026-04-03', 16000n, 5000n],
  ]);
  assert.equal(sumaGr, 16000n);
  assert.equal(brakiKursu, 1);
});

test('numeracja dokumentów N/RRRR: ciągła w roku, od największego numeru', () => {
  assert.equal(kolejnyNumer([], 2026), '1/2026');
  assert.equal(kolejnyNumer(['1/2026', '3/2026', '7/2025', 'x'], 2026), '4/2026');
  assert.equal(kolejnyNumer(['12/2026'], 2027), '1/2027');
});

// ---------------------------------------------------------------- import ogólny

test('import: daty w różnych formatach, nagłówek w dowolnym wierszu, błędy z numerem wiersza', () => {
  assert.equal(odczytajDate('21.10.2026'), '2026-10-21');
  assert.equal(odczytajDate('2026-10-21 00:00:00'), '2026-10-21');
  assert.equal(odczytajDate(46316), '2026-10-21');
  assert.equal(odczytajDate('31.02.2026'), null);
  const { wpisy, bledy } = wierszeNaWpisy([
    ['Ewidencja'], [], ['Lp', 'Data', 'Kwota', 'Opis', 'Waluta'],
    ['1', '01.10.2026', '100,00', 'kubek', ''], ['2', 'jutro', '5', '', ''], ['3', '2026-10-02', 'abc', '', ''], ['', '', '', '', ''],
  ]);
  assert.deepEqual(wpisy.map((x) => [x.data, x.kwota, x.opis, x.waluta]), [['2026-10-01', '100.00', 'kubek', 'PLN']]);
  assert.deepEqual(bledy, [{ wiersz: 5, powod: 'niepoprawna data' }, { wiersz: 6, powod: 'Wpisz kwotę samymi cyframi, np. 49,90.' }]);
});

test('import: kwota „1,234” albo „1.234” jest niejednoznaczna i odrzucona z błędem wiersza', () => {
  for (const t of ['1,234', '1.234', '-1,234', '999.000', '1,234 zł']) assert.ok(niejednoznacznaKwota(t), t);
  for (const t of ['1 234', '1234', '1,23', '1.2345', '1.234,50', '1,234.50', '0,500', '1234,567', '12,5']) assert.ok(!niejednoznacznaKwota(t), t);
  assert.ok(!niejednoznacznaKwota(1.234), 'komórka liczbowa arkusza jest jednoznaczna');
  const { wpisy, bledy } = wierszeNaWpisy([
    ['Data', 'Kwota'], ['2026-10-01', '1,234'], ['2026-10-02', '1.234'], ['2026-10-03', '1.234,00'], ['2026-10-04', 1.234],
  ]);
  assert.deepEqual(wpisy.map((x) => x.kwota), ['1234.00', '1.234']);
  assert.deepEqual(bledy, [
    { wiersz: 2, powod: 'kwota 1,234 jest niejednoznaczna: wpisz 1234 (bez separatora tysięcy) albo 1,23' },
    { wiersz: 3, powod: 'kwota 1.234 jest niejednoznaczna: wpisz 1234 (bez separatora tysięcy) albo 1,23' },
  ]);
});

// ---------------------------------------------------------------- CSV

const PROBKA = () => [
  w('2026-10-01', '120,50', 'PLN', '', 'Kolczyki; srebro'),
  w('2026-10-03', '35', 'EUR', '4,3712', 'Etsy "zamówienie" 1234'),
  w('2026-10-03', '-20', 'PLN', '', '=zwrot'),
  w('2026-10-05', '12', 'USD', '', 'Gumroad\nnowa linia'),
  w('2027-01-04', '1000', 'GBP', '5,1234', 'Zażółć gęślą jaźń'),
];
const bezId = (lista) => lista.map(({ id, kursData, kursTabela, ...r }) => r);

test('CSV: eksport w układzie arkusza (A–J), średnik, przecinek, BOM, ochrona przed formułami', () => {
  const csv = eksportujCsv(PROBKA());
  assert.ok(csv.startsWith('﻿Data;Opis;Kwota;Waluta;Kurs NBP;Kwota w PLN;Suma kwartału (narastająco);% limitu;Ostrzeżenie;Zwrot dotyczy sprzedaży z dnia\r\n'));
  const wiersze = parsujCsv(csv);
  assert.deepEqual(wiersze[1], ['2026-10-01', 'Kolczyki; srebro', '120,50', 'PLN', '', '120,50', '120,50', '1,1%', 'W limicie', '']);
  assert.deepEqual(wiersze[2].slice(0, 7), ['2026-10-03', 'Etsy "zamówienie" 1234', '35', 'EUR', '4,3712', '152,99', '253,49']);
  assert.equal(wiersze[3][1], "'=zwrot");
  assert.equal(wiersze[4][5], 'brak kursu');
});

test('CSV: round-trip eksport → import daje te same wpisy', () => {
  const wejscie = PROBKA();
  const { wpisy, bledy } = importujCsv(eksportujCsv(wejscie));
  assert.deepEqual(bledy, []);
  assert.deepEqual(bezId(wpisy), bezId(posortuj(wejscie)));
});

test('CSV: import z przecinkiem jako separatorem i z tabulatorem', () => {
  const przecinki = 'Data,Opis,Kwota,Waluta,Kurs NBP\n2026-10-01,"Kubek, duży","49,90",PLN,\n';
  assert.deepEqual(bezId(importujCsv(przecinki).wpisy), [{ data: '2026-10-01', opis: 'Kubek, duży', kwota: '49.90', waluta: 'PLN', kurs: '' }]);
  const tab = 'Data\tOpis\tKwota\tWaluta\tKurs NBP\r\n21.10.2026\tx\t10\tEUR\t4.36\r\n';
  assert.deepEqual(bezId(importujCsv(tab).wpisy), [{ data: '2026-10-21', opis: 'x', kwota: '10', waluta: 'EUR', kurs: '4.36' }]);
});

// ---------------------------------------------------------------- ZIP i XLSX

test('ZIP: CRC32 i zapis → odczyt', async () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  const pliki = new Map([['a.txt', 'Zażółć '.repeat(50)], ['b/c.xml', '<x/>']]);
  const z = await czytajZip(await zapiszZip(pliki));
  assert.equal(new TextDecoder().decode(z.get('a.txt')), 'Zażółć '.repeat(50));
  assert.equal(new TextDecoder().decode(z.get('b/c.xml')), '<x/>');
  await assert.rejects(czytajZip(new Uint8Array([1, 2, 3])), BladDanych);
});

test('XLSX: pusty wzór do pobrania wczytuje się bez wpisów i błędów', async () => {
  const { wpisy, bledy, arkusz } = await importujXlsx(WZOR);
  assert.equal(arkusz, 'Sprzedaż');
  assert.deepEqual(wpisy, []);
  assert.deepEqual(bledy, []);
});

test('XLSX: round-trip eksport → import, ten sam układ i formuły co wzór', async () => {
  const wejscie = PROBKA();
  const plik = await eksportujXlsx(wejscie, WZOR);
  const { wpisy, bledy } = await importujXlsx(plik);
  assert.deepEqual(bledy, []);
  // W XLSX kwoty są liczbami, więc „120,50” wraca jako „120.5”.
  const liczbowo = (l) => bezId(l).map((x) => ({ ...x, kwota: Number(x.kwota), kurs: x.kurs && Number(x.kurs) }));
  assert.deepEqual(liczbowo(wpisy), liczbowo(posortuj(wejscie)));

  const pliki = await czytajZip(plik);
  const wzor = await czytajZip(WZOR);
  assert.deepEqual([...pliki.keys()], [...wzor.keys()], 'te same części pakietu');
  const xml = new TextDecoder().decode(pliki.get('xl/worksheets/sheet1.xml'));
  const komorki = komorkiArkusza(xml, []);
  assert.deepEqual(komorki[3].slice(0, 9), ['Data', 'Opis', 'Kwota', 'Waluta', 'Kurs NBP', 'Kwota w PLN', 'Suma kwartału (narastająco)', '% limitu', 'Ostrzeżenie']);
  assert.deepEqual(komorki[4].slice(0, 9), [46296, 'Kolczyki; srebro', 120.5, 'PLN', '', 120.5, 120.5, 120.5 / 10813.5, 'W limicie']);
  assert.equal(komorki[6][1], '=zwrot', 'w XLSX opis zostaje tekstem (t="inlineStr"), bez apostrofu');
  assert.equal(komorki[7][5], 'brak kursu');
  // Formuły zostają.
  assert.match(xml, /<c r="F5" s="8"><f>IF\(C5="","",IF\(OR\(D5="",D5="PLN"\),ROUND\(C5,2\)/);
  assert.match(xml, /<c r="A5" s="5"><v>46296<\/v><\/c><c r="B5" t="inlineStr">/);
  // Pozostałe zakładki bez zmian.
  for (const n of ['xl/worksheets/sheet2.xml', 'xl/worksheets/sheet3.xml', 'xl/worksheets/sheet4.xml', 'xl/styles.xml', 'xl/workbook.xml']) {
    assert.deepEqual(pliki.get(n), wzor.get(n), n);
  }
});

test('XLSX: ponad 1000 wpisów rozszerza zakresy formuł i zachowuje wszystkie wiersze', async () => {
  const duzo = Array.from({ length: 1003 }, (_, i) => w(i % 2 ? '2026-10-02' : '2026-10-01', '1'));
  const plik = await eksportujXlsx(duzo, WZOR);
  const pliki = await czytajZip(plik);
  const s1 = new TextDecoder().decode(pliki.get('xl/worksheets/sheet1.xml'));
  const s2 = new TextDecoder().decode(pliki.get('xl/worksheets/sheet2.xml'));
  assert.ok(!/\$1004(?!\d)/.test(s1) && !/\$1004(?!\d)/.test(s2), 'brak starych zakresów');
  assert.match(s1, /\$F\$5:\$F\$1007/);
  assert.match(s2, /'Sprzeda&#380;'!\$F\$5:\$F\$1007/);
  assert.match(s1, /<c r="F1007" s="8"><f>IF\(C1007="",""/);
  assert.match(s1, /sqref="A5:A1007"/);
  const { wpisy } = await importujXlsx(plik);
  assert.equal(wpisy.length, 1003);
});

test('XLSX: odczyt pliku z tekstami współdzielonymi i datą jako tekstem (inne programy)', async () => {
  const wb = '<workbook xmlns:r="r"><sheets><sheet name="Arkusz1" sheetId="1" r:id="rId1"/></sheets></workbook>';
  const rels = '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>';
  const sst = '<sst><si><t>Data</t></si><si><t>Kwota</t></si><si><r><t>Ku</t></r><r><t xml:space="preserve">bek &amp; ko</t></r></si><si><t>21.10.2026</t></si></sst>';
  const arkusz = '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>Opis</t></is></c><c r="C1" t="s"><v>1</v></c></row>'
    + '<row r="2"><c r="A2"><v>46315</v></c><c r="B2" t="s"><v>2</v></c><c r="C2"><v>19.989999999999998</v></c></row>'
    + '<row r="3"><c r="A3" t="s"><v>3</v></c><c r="C3" t="str"><v>5,5</v></c></row></sheetData></worksheet>';
  const plik = await zapiszZip(new Map([['xl/workbook.xml', wb], ['xl/_rels/workbook.xml.rels', rels], ['xl/sharedStrings.xml', sst], ['xl/worksheets/sheet1.xml', arkusz]]));
  const { wpisy, arkusz: nazwa } = await importujXlsx(plik);
  assert.equal(nazwa, 'Arkusz1');
  assert.deepEqual(bezId(wpisy), [
    { data: '2026-10-20', opis: 'Kubek & ko', kwota: '19.99', waluta: 'PLN', kurs: '' },
    { data: '2026-10-21', opis: '', kwota: '5.5', waluta: 'PLN', kurs: '' },
  ]);
});

// ---------------------------------------------------------------- ZIP: bomba i uszkodzone wpisy

import { deflateRawSync } from 'node:zlib';
import { MAX_ROZMIAR } from '../public/js/zip.js';

/** ZIP z jednym wpisem deflate i dowolnym zadeklarowanym rozmiarem (jak spreparowany plik). */
function zipZDeklaracja(skompresowane, deklarowany, { nazwa = 'xl/workbook.xml', rozmiarSkompr = skompresowane.length } = {}) {
  const n = Buffer.from(nazwa);
  const lok = Buffer.alloc(30);
  lok.writeUInt32LE(0x04034b50, 0); lok.writeUInt16LE(20, 4); lok.writeUInt16LE(8, 8);
  lok.writeUInt32LE(rozmiarSkompr, 18); lok.writeUInt32LE(deklarowany, 22); lok.writeUInt16LE(n.length, 26);
  const cen = Buffer.alloc(46);
  cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(8, 10);
  cen.writeUInt32LE(rozmiarSkompr, 20); cen.writeUInt32LE(deklarowany, 24); cen.writeUInt16LE(n.length, 28); cen.writeUInt32LE(0, 42);
  const cd = Buffer.concat([cen, n]);
  const przes = lok.length + n.length + skompresowane.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(przes, 16);
  return new Uint8Array(Buffer.concat([lok, n, skompresowane, cd, eocd]));
}

test('ZIP: bomba (deklaruje 10 B, rozpakowuje się do 64 MB) jest przerywana szybko', async () => {
  const bomba = deflateRawSync(Buffer.alloc(64 * 1024 * 1024));
  assert.ok(bomba.length < 100 * 1024, 'mały plik wejściowy');
  const t0 = Date.now();
  await assert.rejects(czytajZip(zipZDeklaracja(bomba, 10)), (e) => e instanceof BladDanych && /większego rozmiaru/.test(e.message));
  assert.ok(Date.now() - t0 < 2000, `przerwane po ${Date.now() - t0} ms`);
  await assert.rejects(importujXlsx(zipZDeklaracja(bomba, 10)), BladDanych);
});

test('ZIP: zadeklarowany rozmiar ponad limit, rozmiar mniejszy niż deklarowany, wpis poza plikiem', async () => {
  const male = deflateRawSync(Buffer.from('<workbook/>'));
  await assert.rejects(czytajZip(zipZDeklaracja(male, MAX_ROZMIAR + 1)), /za duży/);
  await assert.rejects(czytajZip(zipZDeklaracja(male, 500)), /niezgodny/);
  await assert.rejects(czytajZip(zipZDeklaracja(male, 11, { rozmiarSkompr: 5000 })), /poza plik/);
  const dobre = await czytajZip(zipZDeklaracja(male, 11));
  assert.equal(new TextDecoder().decode(dobre.get('xl/workbook.xml')), '<workbook/>');
});

test('XLSX: encja spoza Unicode daje czytelny błąd, nie RangeError', async () => {
  const { odkodujXml } = await import('../public/js/xlsx.js');
  assert.equal(odkodujXml('&#x1F600;&amp;'), '😀&');
  assert.throws(() => odkodujXml('&#99999999;'), (e) => e instanceof BladDanych && /niepoprawny znak/.test(e.message));
});

// ---------------------------------------------------------------- zwroty a limit kwartalny

test('zwroty: przekroczenie się nie cofa, status zostaje „przekroczony od D” mimo zwrotu poniżej limitu', () => {
  // 6000 zł 5.10 i 5000 zł 20.10 (11 000 zł > 10 813,50 zł), potem zwrot 500 zł 3.11: suma 10 500 zł, czyli poniżej limitu.
  const wpisy = [w('2026-10-05', '6000'), w('2026-10-20', '5000'), w('2026-11-03', '-500')];
  const [kw] = historiaKwartalow(wpisy, '2026-11-05');
  assert.equal(kw.sumaGr, 1050000n);
  assert.deepEqual(kw.przekroczenie, { data: '2026-10-20', termin: '2026-10-27' });
  assert.equal(kw.status.przekroczony, true);
  assert.equal(kw.status.przekroczonyOd, '2026-10-20');
  assert.equal(klasaProgu(kw.status), 'poziom-100');
  assert.equal(opisProgu(kw.status), 'Limit przekroczony.');
  assert.ok(!/Mieścisz|W limicie/.test(opisProgu(kw.status)));
  const p = prognoza(wpisy, '2026-11-05');
  assert.equal(p.sumaGr, 1050000n);
  assert.equal(p.status.przekroczony, true);
  assert.equal(p.status.przekroczonyOd, '2026-10-20');
  assert.equal(p.statusNaKoniec.przekroczony, true);
  assert.deepEqual(p.przekroczenie, { data: '2026-10-20', termin: '2026-10-27', prognoza: false });
  // Zwrot po przekroczeniu niczego nie zmienia, więc nie ma ostrzeżenia o wyborze kwartału.
  assert.deepEqual(ostrzezeniaZwrotow(wpisy, '2026-11-05'), []);
  // Bez faktu przekroczenia status liczy się jak dotąd.
  assert.equal(statusKwartalu(1050000n, 1081350n).przekroczony, false);
});

test('zwroty: ostrzeżenie, gdy zwrot w kwartale obniża sumę poniżej limitu, a bez niego limit byłby przekroczony', () => {
  const wpisy = [w('2026-10-01', '6000'), w('2026-10-02', '-2000'), w('2026-10-20', '6000')];
  const [kw] = historiaKwartalow(wpisy, '2026-11-05');
  assert.equal(kw.sumaGr, 1000000n);
  assert.equal(kw.przekroczenie, null, 'z tym zwrotem limit nie jest przekroczony');
  const o = ostrzezeniaZwrotow(wpisy, '2026-11-05');
  assert.equal(o.length, 1);
  assert.equal(o[0].id, wpisy[1].id);
  assert.equal(o[0].przyczyna, 'limit');
  assert.equal(o[0].bezZwrotuPrzekroczenie, '2026-10-20');
  assert.equal(opisOstrzezeniaZwrotu(o[0]), 'Przepisy nie rozstrzygają, do którego kwartału należy ten zwrot. Bez niego limit byłby przekroczony dnia 20.10.2026. Skonsultuj to z doradcą podatkowym.');
  assert.deepEqual(kw.ostrzezenia, o, 'historia kwartału ma to samo ostrzeżenie');
  assert.deepEqual(prognoza(wpisy, '2026-11-05').ostrzezenia, o, 'stan bieżącego kwartału też');
  // Zwrot z datą po dziś (zaplanowany) nie daje ostrzeżenia.
  assert.deepEqual(ostrzezeniaZwrotow([w('2026-10-01', '11000'), w('2026-12-01', '-500')], '2026-11-05'), []);
});

test('zwroty: zwrot w I kw. 2027 dotyczący sprzedaży z IV kw. 2026 daje ostrzeżenie i niczego nie przelicza wstecz', () => {
  const zwrot = normalizujWpis({ id: 'z1', data: '2027-01-10', kwota: '-300', dotyczy: '2026-12-15', opis: 'Zwrot: obraz' });
  assert.equal(zwrot.dotyczy, '2026-12-15');
  const wpisy = [w('2026-12-15', '300'), w('2027-01-05', '1000'), zwrot];
  const o = ostrzezeniaZwrotow(wpisy, '2027-02-01');
  assert.equal(o.length, 1);
  assert.equal(o[0].przyczyna, 'inny-kwartal');
  assert.deepEqual([o[0].rok, o[0].q, o[0].dotyczy], [2027, 1, '2026-12-15']);
  assert.equal(o[0].bezZwrotuPrzekroczenie, null);
  assert.equal(opisOstrzezeniaZwrotu(o[0]), 'Przepisy nie rozstrzygają, do którego kwartału należy ten zwrot. Skonsultuj to z doradcą podatkowym.');
  // Zwrot liczy się w kwartale swojej daty, a IV kwartał 2026 zostaje bez zmian.
  const h = historiaKwartalow(wpisy, '2027-02-01');
  assert.equal(h.find((k) => k.klucz === '2027-1').sumaGr, 70000n);
  assert.equal(h.find((k) => k.klucz === '2026-4').sumaGr, 30000n);
  assert.deepEqual(h.find((k) => k.klucz === '2026-4').ostrzezenia, []);
  // Ten sam kwartał: bez ostrzeżenia.
  assert.deepEqual(ostrzezeniaZwrotow([w('2027-01-05', '1000'), normalizujWpis({ id: 'z2', data: '2027-02-01', kwota: '-100', dotyczy: '2027-01-05' })], '2027-02-01'), []);
  // Gdy bez zwrotu limit byłby przekroczony, ostrzeżenie podaje też datę.
  const duze = [w('2027-01-05', '11500'), normalizujWpis({ id: 'z3', data: '2027-01-04', kwota: '-500', dotyczy: '2026-12-20' })];
  assert.match(opisOstrzezeniaZwrotu(ostrzezeniaZwrotow(duze, '2027-02-01')[0]), /Bez niego limit byłby przekroczony dnia 05\.01\.2027\./);
});

test('zwroty: pole „dotyczy sprzedaży z dnia” tylko przy zwrocie i nie później niż data dokumentu korekty', () => {
  assert.throws(() => normalizujWpis({ id: 'a', data: '2027-01-10', kwota: '-300', dotyczy: '2027-01-11' }), /nie może być późniejsza/);
  assert.throws(() => normalizujWpis({ id: 'a', data: '2027-01-10', kwota: '-300', dotyczy: '2027-02-30' }), /dotyczy zwrot/);
  assert.equal('dotyczy' in normalizujWpis({ id: 'a', data: '2027-01-10', kwota: '300', dotyczy: '2026-12-01' }), false, 'sprzedaż: pole pomijane');
  assert.equal('dotyczy' in normalizujWpis({ id: 'a', data: '2027-01-10', kwota: '-300', dotyczy: '' }), false);
});

test('zwroty: kwartał z samymi zwrotami ma 0% i pusty pasek, a nadwyżka zwrotów nie przechodzi do innego kwartału', () => {
  const wpisy = [w('2026-07-10', '-500'), w('2026-10-01', '1000')];
  const h = historiaKwartalow(wpisy, '2026-11-05');
  const q3 = h.find((k) => k.klucz === '2026-3');
  assert.equal(q3.sumaGr, -50000n);
  assert.equal(q3.status.procent, 0);
  assert.equal(procentTekst(q3.status.procent), '0,0%');
  assert.equal(h.find((k) => k.klucz === '2026-4').sumaGr, 100000n);
  const p = prognoza([w('2026-10-02', '-500')], '2026-11-05');
  assert.equal(p.status.procent, 0);
  assert.equal(p.statusNaKoniec.procent, 0);
  assert.equal(p.tempoDzienneGr, 0n);
});

test('kwartał w przyszłości jest oznaczony (bez „0,0% limitu do dziś” w widoku)', () => {
  const h = historiaKwartalow([w('2026-10-01', '500'), w('2027-01-12', '1000')], '2026-11-04');
  assert.equal(h.find((k) => k.klucz === '2027-1').przyszly, true);
  assert.equal(h.find((k) => k.klucz === '2026-4').przyszly, false);
  assert.equal(historiaKwartalow([w('2027-01-12', '1000')])[0].przyszly, false, 'bez daty dzisiejszej nie ma przyszłości');
});

test('łączenie wpisów z tym samym id: wygrywa później zmieniona wersja, bez znaczników wersja z pamięci', () => {
  const stary = normalizujWpis({ id: 'x', data: '2026-10-01', kwota: '10', zmieniono: '2026-11-01T10:00:00.000Z' });
  const nowy = normalizujWpis({ id: 'x', data: '2026-10-01', kwota: '15', zmieniono: '2026-11-02T08:00:00.000Z' });
  assert.deepEqual(polaczWpisy([stary], [nowy]).map((x) => x.kwota), ['15'], 'lokalna zmiana nowsza');
  assert.deepEqual(polaczWpisy([nowy], [stary]).map((x) => x.kwota), ['15'], 'zapisana zmiana nowsza');
  const bezZnacznika = normalizujWpis({ id: 'x', data: '2026-10-01', kwota: '20' });
  assert.deepEqual(polaczWpisy([bezZnacznika], [{ ...bezZnacznika, kwota: '25' }]).map((x) => x.kwota), ['20'], 'bez znaczników: pamięć');
  assert.deepEqual(polaczWpisy([bezZnacznika], [stary]).map((x) => x.kwota), ['10'], 'zmieniona w formularzu wygrywa z wpisem bez znacznika');
  assert.equal(normalizujWpis({ id: 'x', data: '2026-10-01', kwota: '1', zmieniono: 'wczoraj' }).zmieniono, undefined);
});

// ---------------------------------------------------------------- przypadki brzegowe kwartału i eksportu

test('termin CEIDG na Nowy Rok: termin bez przesunięcia i dopisek z 04.01.2027', async () => {
  const { dopisekTerminu } = await import('../public/js/wspolne.js');
  const kw = historiaKwartalow([w('2026-10-10', '9000'), w('2026-12-25', '2000')], '2027-01-05').find((k) => k.klucz === '2026-4');
  assert.deepEqual(kw.przekroczenie, { data: '2026-12-25', termin: '2027-01-01' });
  const dopisek = dopisekTerminu(kw.przekroczenie.termin);
  assert.match(dopisek, /przesunąć się na 04\.01\.2027/);
  assert.match(dopisek, /do 01\.01\.2027/);
});

test('zwrot w styczniu do przekroczonego grudnia: IV kwartał zostaje przekroczony, I kwartał ma 0% i ostrzeżenie', () => {
  const wpisy = [w('2026-11-10', '6000'), w('2026-12-28', '5000'),
    normalizujWpis({ id: 'zs', data: '2027-01-04', kwota: '-500', dotyczy: '2026-12-28' })];
  const h = historiaKwartalow(wpisy, '2027-01-10');
  const iv = h.find((k) => k.klucz === '2026-4');
  const i = h.find((k) => k.klucz === '2027-1');
  assert.ok(iv.status.przekroczony);
  assert.equal(iv.status.przekroczonyOd, '2026-12-28');
  assert.equal(iv.przekroczenie.termin, '2027-01-04');
  assert.deepEqual(iv.ostrzezenia, []);
  assert.equal(i.sumaGr, -50000n);
  assert.equal(i.status.procent, 0);
  assert.equal(i.status.przekroczony, false);
  assert.equal(i.ostrzezenia.length, 1);
  assert.equal(i.ostrzezenia[0].przyczyna, 'inny-kwartal');
  assert.equal(i.ostrzezenia[0].bezZwrotuPrzekroczenie, null);
});

test('prognoza w lutym: 59 dni od początku kwartału, próg 70% 19.03.2027', () => {
  const p = prognoza([w('2027-01-15', '5900')], '2027-02-28');
  assert.equal(p.dniMinelo, 59);
  assert.equal(p.dniZostalo, 31);
  assert.equal(p.tempoDzienneGr, 10000n);
  assert.equal(p.sumaNaKoniecGr, 900000n);
  const dzien = (prog) => p.progi.find((x) => x.prog === prog).prognozaDnia;
  assert.equal(dzien('0.70'), '2027-03-19');
  for (const prog of ['0.85', '0.95', '1.00', 'przekroczenie']) assert.equal(dzien(prog), null, prog);
  assert.equal(p.pewnosc, 'mala');
});

test('zwrot po przekroczeniu do sumy równej limitowi: stan przekroczony na ekranie i w kolumnie ostrzeżenia', () => {
  const wpisy = [w('2026-10-05', '6000'), w('2026-10-20', '5000'), w('2026-11-03', '-186,50')];
  const kw = historiaKwartalow(wpisy, '2026-11-05').find((k) => k.klucz === '2026-4');
  assert.equal(kw.sumaGr, 1081350n);
  assert.equal(kw.status.przekroczonyOd, '2026-10-20');
  assert.equal(kw.przekroczenie.termin, '2026-10-27');
  assert.deepEqual(kw.ostrzezenia, []);
  const p = prognoza(wpisy, '2026-11-05');
  assert.equal(p.status.przekroczonyOd, '2026-10-20');
  assert.deepEqual(p.ostrzezenia, []);
  const v = wartosciArkusza(posortuj(wpisy));
  assert.equal(v[1].I, 'Limit przekroczony');
  assert.equal(v[2].G, 1081350n);
  assert.equal(v[2].I, 'Limit przekroczony');
});

test('kolumna ostrzeżenia: przekroczenie się nie cofa do końca kwartału, a nowy kwartał liczy się od zera', () => {
  const wpisy = [w('2026-10-05', '6000'), w('2026-10-20', '5000'), w('2026-11-03', '-3000'), w('2026-12-01', '100'),
    w('2027-01-04', '100')];
  const v = wartosciArkusza(posortuj(wpisy));
  assert.deepEqual(v.map((x) => x.I), ['W limicie', 'Limit przekroczony', 'Limit przekroczony', 'Limit przekroczony', 'W limicie']);
  const csv = parsujCsv(eksportujCsv(wpisy));
  assert.deepEqual(csv.slice(1).map((r) => r[8]), v.map((x) => x.I));
});

test('eksport: kwartał z samymi zwrotami ma 0% limitu, nie ujemny procent', () => {
  const wpisy = [w('2027-01-10', '-85')];
  const v = wartosciArkusza(wpisy);
  assert.equal(v[0].G, -8500n);
  assert.equal(v[0].H, 0);
  assert.equal(v[0].I, 'W limicie');
  assert.equal(parsujCsv(eksportujCsv(wpisy))[1][7], '0,0%');
});

test('zwrot przed przekroczeniem: suma równa limitowi bez przekroczenia, ostrzeżenie i prognoza z tempa', () => {
  const wpisy = [w('2026-10-01', '6000'), w('2026-10-02', '-186,50'), w('2026-10-20', '5000')];
  const kw = historiaKwartalow(wpisy, '2026-11-05').find((k) => k.klucz === '2026-4');
  assert.equal(kw.przekroczenie, null);
  assert.equal(kw.status.prog, '1.00');
  assert.equal(kw.status.przekroczony, false);
  assert.equal(kw.ostrzezenia.length, 1);
  assert.equal(kw.ostrzezenia[0].przyczyna, 'limit');
  assert.equal(kw.ostrzezenia[0].bezZwrotuPrzekroczenie, '2026-10-20');
  assert.equal(kw.wolneGr, 0n);
  const p = prognoza(wpisy, '2026-11-05');
  assert.equal(p.dniMinelo, 36);
  assert.equal(p.przekroczenie.data, '2026-11-06');
  assert.equal(p.przekroczenie.prognoza, true);
  assert.equal(p.przyczynaPrzekroczenia, 'tempo');
  assert.equal(wartosciArkusza(posortuj(wpisy))[2].I, 'Limit wykorzystany (100%)');
});

// ---------------------------------------------------------------- pole „dotyczy” w pliku (kolumna J)

const zwrotDotyczacy = () => normalizujWpis({ id: 'z1', data: '2027-01-15', kwota: '-300', opis: 'Zwrot: obraz', dotyczy: '2026-12-20' });
const zDotyczy = () => [w('2026-12-20', '1000', 'PLN', '', 'Obraz'), zwrotDotyczacy()];
const ostrzezeniaInnegoKwartalu = (wpisy) => ostrzezeniaZwrotow(wpisy, '2027-01-20').filter((o) => o.przyczyna === 'inny-kwartal');

test('CSV: data, której dotyczy zwrot, jest w kolumnie J i wraca przy imporcie z ostrzeżeniem', () => {
  const wiersze = parsujCsv(eksportujCsv(zDotyczy()));
  assert.equal(wiersze[0][9], 'Zwrot dotyczy sprzedaży z dnia');
  assert.deepEqual(wiersze.slice(1).map((r) => r[9]), ['', '2026-12-20']);
  const { wpisy, bledy } = importujCsv(eksportujCsv(zDotyczy()));
  assert.deepEqual(bledy, []);
  assert.deepEqual(bezId(wpisy), bezId(zDotyczy()));
  assert.equal(wpisy[1].dotyczy, '2026-12-20');
  assert.equal(ostrzezeniaInnegoKwartalu(wpisy).length, 1, 'ostrzeżenie o zwrocie z innego kwartału zostaje');
});

test('XLSX: data, której dotyczy zwrot, jest w kolumnie J (data) i wraca przy imporcie z ostrzeżeniem', async () => {
  const plik = await eksportujXlsx(zDotyczy(), WZOR);
  const xml = new TextDecoder().decode((await czytajZip(plik)).get('xl/worksheets/sheet1.xml'));
  const komorki = komorkiArkusza(xml, []);
  assert.equal(komorki[3][9], 'Zwrot dotyczy sprzedaży z dnia');
  assert.equal(komorki[4][9] ?? '', '');
  assert.equal(komorki[5][9], 46376, 'numer seryjny 2026-12-20');
  assert.match(xml, /<c r="J6" s="5"><v>46376<\/v><\/c>/, 'styl daty z wzoru');
  const { wpisy, bledy } = await importujXlsx(plik);
  assert.deepEqual(bledy, []);
  assert.equal(wpisy[1].dotyczy, '2026-12-20');
  assert.equal(ostrzezeniaInnegoKwartalu(wpisy).length, 1);
});

test('import: pliki bez kolumny J (wcześniejsze eksporty) wczytują się jak dotąd, błędna data J to błąd wiersza', async () => {
  const stary = '﻿Data;Opis;Kwota;Waluta;Kurs NBP;Kwota w PLN;Suma kwartału (narastająco);% limitu;Ostrzeżenie\r\n'
    + '2027-01-15;Zwrot;-300;PLN;;-300,00;-300,00;0,0%;W limicie\r\n';
  const { wpisy, bledy } = importujCsv(stary);
  assert.deepEqual(bledy, []);
  assert.deepEqual(bezId(wpisy), [{ data: '2027-01-15', opis: 'Zwrot', kwota: '-300', waluta: 'PLN', kurs: '' }]);
  assert.equal('dotyczy' in wpisy[0], false);
  // Bez nagłówka (układ A–E) kolumny J nie czytamy.
  assert.equal('dotyczy' in importujCsv('2027-01-15;Zwrot;-300;PLN;;;;;;2026-12-20\r\n').wpisy[0], false);
  // XLSX z innego programu, bez kolumny J.
  const wb = '<workbook xmlns:r="r"><sheets><sheet name="Sprzedaż" sheetId="1" r:id="rId1"/></sheets></workbook>';
  const rels = '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>';
  const arkusz = '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Data</t></is></c><c r="C1" t="inlineStr"><is><t>Kwota</t></is></c></row>'
    + '<row r="2"><c r="A2"><v>46402</v></c><c r="C2"><v>-300</v></c></row></sheetData></worksheet>';
  const x = await importujXlsx(await zapiszZip(new Map([['xl/workbook.xml', wb], ['xl/_rels/workbook.xml.rels', rels], ['xl/worksheets/sheet1.xml', arkusz]])));
  assert.deepEqual(x.bledy, []);
  assert.equal('dotyczy' in x.wpisy[0], false);
  // Kolumna J z błędną datą albo datą późniejszą niż zwrot: błąd wiersza, a nie cicha utrata pola.
  const naglowek = 'Data;Opis;Kwota;Waluta;Kurs NBP;Kwota w PLN;Suma kwartału (narastająco);% limitu;Ostrzeżenie;Zwrot dotyczy sprzedaży z dnia\r\n';
  const bledne = importujCsv(`${naglowek}2027-01-15;a;-300;PLN;;;;;;wczoraj\r\n2027-01-15;b;-300;PLN;;;;;;2027-01-16\r\n2027-01-15;c;-300;PLN;;;;;;20.12.2026\r\n`);
  assert.deepEqual(bledne.bledy.map((b) => b.wiersz), [2, 3]);
  assert.match(bledne.bledy[0].powod, /dotyczy zwrot/);
  assert.match(bledne.bledy[1].powod, /nie może być późniejsza/);
  assert.equal(bledne.wpisy[0].dotyczy, '2026-12-20', 'polski zapis daty też działa');
  // Przy sprzedaży (kwota dodatnia) pole jest pomijane, jak w formularzu.
  assert.equal('dotyczy' in importujCsv(`${naglowek}2027-01-15;d;300;PLN;;;;;;2026-12-20\r\n`).wpisy[0], false);
});

// ---------------------------------------------------------------- formuły wzoru XLSX (H i I jak na stronie)

const formula = (xml, adres) => {
  const m = new RegExp(`<c [^>]*r="${adres}"[^>]*><f>([^<]*)</f>`).exec(xml);
  return m ? m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#380;/g, 'ż') : null;
};

test('wzór XLSX: H nie spada poniżej 0, I pamięta przekroczenie w kwartale (zakładka „Sprzedaż”)', async () => {
  const pliki = await czytajZip(WZOR);
  const s1 = new TextDecoder().decode(pliki.get('xl/worksheets/sheet1.xml'));
  assert.equal(formula(s1, 'H5'), 'IF(NOT(ISNUMBER(G5)),"",IFERROR(MAX(0,G5/VLOOKUP(YEAR(A5),Limity!$A$5:$C$14,3,FALSE)),"brak limitu"))');
  const i5 = formula(s1, 'I5');
  assert.ok(i5.startsWith('IF(ISNUMBER(H5),IF(COUNTIFS($H$5:$H$1004,">1",$A$5:$A$1004,">="&DATE(YEAR(A5),INT((MONTH(A5)-1)/3)*3+1,1),'
    + '$A$5:$A$1004,"<="&A5)>0,"Limit przekroczony",IF(H5>1,"Limit przekroczony"'), i5);
  assert.ok(formula(s1, 'I1004').includes('COUNTIFS($H$5:$H$1004,">1",$A$5:$A$1004,">="&DATE(YEAR(A1004),'), 'każdy wiersz');
  assert.ok(!/MAXIFS|_xlfn/.test(s1), 'bez funkcji spoza Excela 2010');
  // Czerwony kolor także dla przekroczenia z wcześniejszego dnia (procent mógł spaść przez zwrot).
  assert.match(s1, /<conditionalFormatting sqref="H5:I1004"><cfRule type="expression" priority="1" dxfId="0" stopIfTrue="1"><formula>LEFT\(\$I5,18\)="Limit przekroczony"<\/formula>/);
  const komorki = komorkiArkusza(s1, []);
  assert.equal(komorki[3][9], 'Zwrot dotyczy sprzedaży z dnia');
  assert.match(/<dataValidation\b[^>]*sqref="J5:J1004"[^>]*>/.exec(s1)?.[0] ?? '', /type="date"/);
});

test('wzór XLSX: podsumowanie kwartału bez ujemnego procentu i z pamięcią przekroczenia', async () => {
  const s2 = new TextDecoder().decode((await czytajZip(WZOR)).get('xl/worksheets/sheet2.xml'));
  const warunek = 'COUNTIFS(\'Sprzedaż\'!$H$5:$H$1004,">1",\'Sprzedaż\'!$A$5:$A$1004,">="&C5,\'Sprzedaż\'!$A$5:$A$1004,"<="&D5)>0';
  assert.equal(formula(s2, 'G5'), 'IF(ISNUMBER(F5),MAX(0,E5/F5),"")');
  assert.equal(formula(s2, 'H5'), `IF(ISNUMBER(F5),IF(${warunek},0,MAX(0,F5-E5)),"")`);
  assert.ok(formula(s2, 'I5').startsWith(`IF(ISNUMBER(G5),IF(${warunek},"Limit przekroczony",`), formula(s2, 'I5'));
  assert.match(s2, /<formula>LEFT\(\$I5,18\)="Limit przekroczony"<\/formula>/);
});

test('XLSX: ponad 1000 wpisów rozszerza także zakres H w warunku przekroczenia i kolumnę J', async () => {
  const duzo = Array.from({ length: 1003 }, (_, i) => w(i % 2 ? '2026-10-02' : '2026-10-01', '1'));
  const pliki = await czytajZip(await eksportujXlsx(duzo, WZOR));
  const s1 = new TextDecoder().decode(pliki.get('xl/worksheets/sheet1.xml'));
  const s2 = new TextDecoder().decode(pliki.get('xl/worksheets/sheet2.xml'));
  assert.match(s1, /<dimension ref="A1:J1007"\/>/);
  assert.ok(formula(s1, 'I1007').includes('COUNTIFS($H$5:$H$1007,">1",$A$5:$A$1007,">="&DATE(YEAR(A1007),'), formula(s1, 'I1007'));
  assert.match(s1, /sqref="J5:J1007"/);
  assert.match(s1, /sqref="H5:I1007"/);
  assert.match(s1, /<c r="J1007" s="5"\/>/);
  assert.ok(formula(s2, 'I5').includes("COUNTIFS('Sprzedaż'!$H$5:$H$1007,\">1\""));
});

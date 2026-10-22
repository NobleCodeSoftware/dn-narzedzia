import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BladDanych } from '../public/js/logic.js';
import {
  normalizujWpis, tekstLiczby, kwotaPlnGr, historiaKwartalow, prognoza, przebiegKwartalu, wartosciArkusza,
  wierszeEwidencji, wierszeNaWpisy, odczytajDate, granicaKwartalu, kolejnyNumer, posortuj, kwotaProgu,
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

// ---------------------------------------------------------------- CSV

const PROBKA = () => [
  w('2026-10-01', '120,50', 'PLN', '', 'Kolczyki; srebro'),
  w('2026-10-03', '35', 'EUR', '4,3712', 'Etsy "zamówienie" 1234'),
  w('2026-10-03', '-20', 'PLN', '', '=zwrot'),
  w('2026-10-05', '12', 'USD', '', 'Gumroad\nnowa linia'),
  w('2027-01-04', '1000', 'GBP', '5,1234', 'Zażółć gęślą jaźń'),
];
const bezId = (lista) => lista.map(({ id, kursData, kursTabela, ...r }) => r);

test('CSV: eksport w układzie arkusza (A–I), średnik, przecinek, BOM, ochrona przed formułami', () => {
  const csv = eksportujCsv(PROBKA());
  assert.ok(csv.startsWith('﻿Data;Opis;Kwota;Waluta;Kurs NBP;Kwota w PLN;Suma kwartału (narastająco);% limitu;Ostrzeżenie\r\n'));
  const wiersze = parsujCsv(csv);
  assert.deepEqual(wiersze[1], ['2026-10-01', 'Kolczyki; srebro', '120,50', 'PLN', '', '120,50', '120,50', '1,1%', 'W limicie']);
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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wielkanoc, swieta, czyDzienRoboczy, dzienKursu } from '../public/js/kalendarz.js';
import { planZapytania, wybierzKurs, pobierzKurs, adresZapytania, API_NBP } from '../public/js/nbp.js';
import { BladDanych } from '../public/js/logic.js';

// ---------------------------------------------------------------- święta

test('Wielkanoc: znane daty (reguła gregoriańska)', () => {
  assert.equal(wielkanoc(2024), '2024-03-31');
  assert.equal(wielkanoc(2025), '2025-04-20');
  assert.equal(wielkanoc(2026), '2026-04-05');
  assert.equal(wielkanoc(2027), '2027-03-28');
  assert.equal(wielkanoc(2028), '2028-04-16');
  assert.equal(wielkanoc(2038), '2038-04-25'); // najpóźniejszy możliwy termin
});

test('święta 2026: pełna lista dni ustawowo wolnych', () => {
  assert.deepEqual([...swieta(2026).keys()], [
    '2026-01-01', '2026-01-06', '2026-04-05', '2026-04-06', '2026-05-01', '2026-05-03', '2026-05-24',
    '2026-06-04', '2026-08-15', '2026-11-01', '2026-11-11', '2026-12-24', '2026-12-25', '2026-12-26',
  ]);
});

test('święta 2027: pełna lista, ruchome od Wielkanocy 28.03', () => {
  assert.deepEqual([...swieta(2027).keys()], [
    '2027-01-01', '2027-01-06', '2027-03-28', '2027-03-29', '2027-05-01', '2027-05-03', '2027-05-16',
    '2027-05-27', '2027-08-15', '2027-11-01', '2027-11-11', '2027-12-24', '2027-12-25', '2027-12-26',
  ]);
  assert.equal(swieta(2027).get('2027-05-27'), 'Boże Ciało');
});

test('Wigilia wolna dopiero od 2025', () => {
  assert.ok(!swieta(2024).has('2024-12-24'));
  assert.ok(swieta(2025).has('2025-12-24'));
});

test('dzień roboczy: weekend i święta', () => {
  assert.ok(czyDzienRoboczy('2026-10-22')); // czwartek
  assert.ok(!czyDzienRoboczy('2026-10-24')); // sobota
  assert.ok(!czyDzienRoboczy('2026-10-25')); // niedziela
  assert.ok(!czyDzienRoboczy('2026-11-11'));
  assert.ok(!czyDzienRoboczy('2026-06-04')); // Boże Ciało
});

// ---------------------------------------------------------------- dzień kursu

test('dzień kursu: zwykły dzień → dzień poprzedni', () => {
  assert.equal(dzienKursu('2026-10-22').data, '2026-10-21');
  assert.deepEqual(dzienKursu('2026-10-22').pominiete, []);
});

test('dzień kursu: poniedziałek → piątek, z powodami pominięcia', () => {
  const k = dzienKursu('2026-10-26');
  assert.equal(k.data, '2026-10-23');
  assert.deepEqual(k.pominiete.map((p) => p.powod), ['niedziela', 'sobota']);
});

test('dzień kursu: święta i weekendy razem', () => {
  assert.equal(dzienKursu('2026-04-07').data, '2026-04-03'); // wt. po Wielkanocy → Wielki Piątek
  assert.equal(dzienKursu('2026-11-12').data, '2026-11-10'); // po 11.11
  assert.equal(dzienKursu('2026-11-02').data, '2026-10-30'); // pon. 2.11, niedziela 1.11 + weekend
  assert.equal(dzienKursu('2026-12-28').data, '2026-12-23'); // Wigilia, święta i weekend
  assert.equal(dzienKursu('2027-01-07').data, '2027-01-05'); // po Trzech Królach
  assert.equal(dzienKursu('2027-01-04').data, '2026-12-31'); // przełom roku
  assert.equal(dzienKursu('2027-05-04').data, '2027-04-30'); // 1.05 sob., 3.05 pon.
  assert.equal(dzienKursu('2027-05-28').data, '2027-05-26'); // po Bożym Ciele
  assert.equal(dzienKursu('2026-06-05').data, '2026-06-03');
  assert.throws(() => dzienKursu('2026-02-30'), BladDanych);
});

// ---------------------------------------------------------------- NBP (bez sieci)

test('adres zapytania: tylko kod waluty i daty', () => {
  const p = planZapytania('eur', '2026-10-26');
  assert.equal(p.oczekiwany, '2026-10-23');
  assert.equal(p.adres, `${API_NBP}/eur/2026-10-13/2026-10-23/?format=json`);
  assert.throws(() => adresZapytania('EU R', '2026-01-01', '2026-01-02'), BladDanych);
});

const odpowiedz = { table: 'A', code: 'EUR', rates: [
  { no: '204/A/NBP/2026', effectiveDate: '2026-10-21', mid: 4.3612 },
  { no: '205/A/NBP/2026', effectiveDate: '2026-10-22', mid: 4.3641 },
  { no: '206/A/NBP/2026', effectiveDate: '2026-10-23', mid: 4.37 },
] };

test('wybór kursu: dzień oczekiwany', () => {
  const k = wybierzKurs(odpowiedz, planZapytania('EUR', '2026-10-26'), '2026-10-26');
  assert.deepEqual(k, { stan: 'ok', kurs: '4.3700', data: '2026-10-23', tabela: '206/A/NBP/2026', oczekiwany: '2026-10-23', innyDzien: false });
});

test('wybór kursu: brak tabeli w oczekiwanym dniu w przeszłości → ostatnia wcześniejsza', () => {
  const bez = { rates: odpowiedz.rates.slice(0, 2) };
  const k = wybierzKurs(bez, planZapytania('EUR', '2026-10-26'), '2026-11-30');
  assert.equal(k.data, '2026-10-22');
  assert.ok(k.innyDzien);
});

test('wybór kursu: tabela z dziś jeszcze nieopublikowana → brak kursu, nie starszy kurs', () => {
  const bez = { rates: odpowiedz.rates.slice(0, 2) };
  const k = wybierzKurs(bez, planZapytania('EUR', '2026-10-24'), '2026-10-23');
  assert.deepEqual(k, { stan: 'niedostepny', oczekiwany: '2026-10-23' });
});

test('pobierzKurs: zapytanie bez ciasteczek i referera, obsługa 404 i błędu sieci', async () => {
  let wywolanie;
  const ok = async (url, opcje) => { wywolanie = { url, opcje }; return { ok: true, status: 200, json: async () => odpowiedz }; };
  const k = await pobierzKurs('EUR', '2026-10-23', { pobierz: ok, dzis: '2026-10-23' });
  assert.equal(k.stan, 'ok');
  assert.equal(k.kurs, '4.3641');
  assert.equal(wywolanie.opcje.credentials, 'omit');
  assert.equal(wywolanie.opcje.referrerPolicy, 'no-referrer');
  assert.match(wywolanie.url, /^https:\/\/api\.nbp\.pl\/api\/exchangerates\/rates\/a\/eur\/\d{4}-\d{2}-\d{2}\/\d{4}-\d{2}-\d{2}\/\?format=json$/);
  const brak = await pobierzKurs('EUR', '2026-10-23', { pobierz: async () => ({ ok: false, status: 404 }), dzis: '2026-10-23' });
  assert.equal(brak.stan, 'niedostepny');
  const siec = await pobierzKurs('EUR', '2026-10-23', { pobierz: async () => { throw new TypeError('x'); }, dzis: '2026-10-23' });
  assert.deepEqual(siec, { stan: 'blad', powod: 'siec' });
  assert.equal((await pobierzKurs('XYZ', '2026-10-23', { pobierz: ok, dzis: '2026-10-23' })).stan, 'brak-waluty');
  // Data daleko w przyszłości: bez zapytania.
  let zapytano = false;
  const przyszlosc = await pobierzKurs('EUR', '2027-03-01', { pobierz: async () => { zapytano = true; }, dzis: '2026-10-23' });
  assert.equal(przyszlosc.stan, 'niedostepny');
  assert.ok(!zapytano);
});

test('kursy hurtem: jedno zapytanie na walutę i okno 90 dni, wynik dla każdego wpisu', async () => {
  const { pobierzKursyHurtem } = await import('../public/js/nbp.js');
  const adresy = [];
  const tabela = { rates: [
    { no: '1', effectiveDate: '2026-10-02', mid: 4.3745 }, { no: '2', effectiveDate: '2026-10-05', mid: 4.3855 },
    { no: '3', effectiveDate: '2026-10-21', mid: 4.3612 },
  ] };
  const pobierz = async (url) => { adresy.push(url); return { ok: true, status: 200, json: async () => tabela }; };
  const w = await pobierzKursyHurtem([
    { waluta: 'EUR', data: '2026-10-06' }, { waluta: 'eur', data: '2026-10-03' }, { waluta: 'EUR', data: '2026-10-22' },
    { waluta: 'EUR', data: '2026-10-06' }, { waluta: 'XYZ', data: '2026-10-06' }, { waluta: 'USD', data: '2026-07-01' },
  ], { pobierz, dzis: '2026-10-22' });
  assert.equal(w.get('EUR|2026-10-06').kurs, '4.3855');
  assert.equal(w.get('EUR|2026-10-03').kurs, '4.3745'); // sobota → piątek 2.10
  assert.equal(w.get('EUR|2026-10-22').data, '2026-10-21');
  assert.equal(w.get('XYZ|2026-10-06').stan, 'brak-waluty');
  assert.equal(adresy.filter((a) => a.includes('/eur/')).length, 1);
  assert.equal(adresy.filter((a) => a.includes('/usd/')).length, 1);
  assert.equal(w.get('USD|2026-07-01').stan, 'niedostepny', 'brak kursu USD z 30.06 w odpowiedzi');
});

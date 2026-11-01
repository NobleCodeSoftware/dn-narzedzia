// Przejście z 2026 na 2027 z symulowanym zegarem: limit kwartału, prognoza, faktura (KSeF, numeracja, terminy),
// kalendarz świąt i dzień kursu NBP. Daty graniczne: 31.12.2026, 1.01.2027, ostatnie dni kwartałów 2027 i 1.04.2027.
// Zegar przeglądarki zastępuje mock Date z node:test; strona liczy „dziś” jako datę w Warszawie (dataWarszawa()).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  dataWarszawa, kwartal, limitDlaRoku, statusLimitu, formatujZl, PLACA_MINIMALNA, dodajDni,
} from '../public/js/logic.js';
import {
  normalizujWpis, historiaKwartalow, prognoza, granicaKwartalu, wierszeEwidencji, limitLubNull,
} from '../public/js/ewidencja-logika.js';
import {
  normalizujFakture, proponowanyNumer, regulaKsef, opisKsef, skrotKsef, terminy, dodajFaktureDoEwidencji, BladPola,
} from '../public/js/faktura-logika.js';
import { dzienKursu, nazwaSwieta } from '../public/js/kalendarz.js';
import { planZapytania, pobierzKurs, pobierzKursyHurtem, wybierzKurs } from '../public/js/nbp.js';

const LIMIT_2026 = 1_081_350n; // 10 813,50 zł = 225% płacy minimalnej (4806 zł w 2026 r.)
const LIMIT_2027 = 1_113_750n; // 11 137,50 zł = 225% płacy minimalnej (4950 zł w 2027 r.)
const spacje = (t) => t.replace(/[  ]/g, ' ');
const zl = (t) => BigInt(Math.round(Number(t) * 100));
let nr = 0;
const wpis = (data, kwota) => normalizujWpis({ id: `z${nr += 1}`, data, kwota, waluta: 'PLN' });

/** Ustawia zegar „przeglądarki” na podaną chwilę (UTC) i zwraca dzisiejszą datę w Warszawie. */
function zegar(t, chwila) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(chwila) });
  return dataWarszawa();
}

// Chwile graniczne (Warszawa: zima UTC+1, od 28.03.2027 lato UTC+2).
const CHWILE = {
  'ostatnia sekunda 2026': ['2026-12-31T22:59:59Z', '2026-12-31'],
  'północ 1.01.2027': ['2026-12-31T23:00:00Z', '2027-01-01'],
  'ostatnia sekunda I kwartału 2027': ['2027-03-31T21:59:59Z', '2027-03-31'],
  'północ 1.04.2027': ['2027-03-31T22:00:00Z', '2027-04-01'],
  'ostatnia sekunda II kwartału 2027': ['2027-06-30T21:59:59Z', '2027-06-30'],
  'ostatnia sekunda 2027': ['2027-12-31T22:59:59Z', '2027-12-31'],
};

// ---------------------------------------------------------------- zegar i kwartał

test('zegar: dzisiejsza data w Warszawie na granicy roku i kwartałów (także po zmianie czasu na letni)', (t) => {
  for (const [opis, [chwila, oczekiwana]] of Object.entries(CHWILE)) {
    assert.equal(zegar(t, chwila), oczekiwana, opis);
    t.mock.timers.reset();
  }
});

test('limit kwartału według bieżącej daty: 10 813,50 zł do 31.12.2026, 11 137,50 zł od 1.01.2027', (t) => {
  assert.equal(PLACA_MINIMALNA[2027], '4950');
  const oczekiwane = {
    'ostatnia sekunda 2026': [2026, 4, LIMIT_2026],
    'północ 1.01.2027': [2027, 1, LIMIT_2027],
    'ostatnia sekunda I kwartału 2027': [2027, 1, LIMIT_2027],
    'północ 1.04.2027': [2027, 2, LIMIT_2027],
    'ostatnia sekunda II kwartału 2027': [2027, 2, LIMIT_2027],
    'ostatnia sekunda 2027': [2027, 4, LIMIT_2027],
  };
  for (const [opis, [rok, q, limit]] of Object.entries(oczekiwane)) {
    const dzis = zegar(t, CHWILE[opis][0]);
    t.mock.timers.reset();
    assert.deepEqual(kwartal(dzis), { rok, q }, opis);
    assert.equal(limitDlaRoku(rok), limit, opis);
    assert.equal(limitLubNull(rok), limit, opis);
  }
  assert.equal(spacje(formatujZl(LIMIT_2027)), '11 137,50 zł');
});

test('licznik limitu: lista kwartałów na stronie obejmuje bieżący kwartał w każdej dacie 2026–2027', (t) => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const opcje = [...html.matchAll(/<option value="(\d{4}-\d)"/g)].map((m) => m[1]);
  for (const [opis, [chwila]] of Object.entries(CHWILE)) {
    const { rok, q } = kwartal(zegar(t, chwila));
    t.mock.timers.reset();
    assert.ok(opcje.includes(`${rok}-${q}`), `${opis}: brak opcji ${rok}-${q}`);
  }
});

test('limit 2027 dokładnie: równo limit to 100% bez przekroczenia, 1 grosz więcej to przekroczenie', () => {
  const rowno = statusLimitu(LIMIT_2027, limitDlaRoku(2027));
  assert.equal(rowno.procent, 100);
  assert.equal(rowno.przekroczony, false);
  assert.equal(rowno.prog, '1.00');
  assert.equal(statusLimitu(LIMIT_2027 + 1n, limitDlaRoku(2027)).przekroczony, true);
  // ta sama kwota w IV kwartale 2026 przekracza limit, w I kwartale 2027 nie
  assert.equal(statusLimitu(zl('11000'), limitDlaRoku(2026)).przekroczony, true);
  assert.equal(statusLimitu(zl('11000'), limitDlaRoku(2027)).przekroczony, false);
});

// ---------------------------------------------------------------- ewidencja: kwartały, prognoza, wydruk

test('granice kwartałów 2027: 90, 91, 92 i 92 dni, koniec roku 31.12', () => {
  assert.deepEqual(granicaKwartalu(2026, 4), { od: '2026-10-01', doDnia: '2026-12-31' });
  assert.deepEqual(granicaKwartalu(2027, 1), { od: '2027-01-01', doDnia: '2027-03-31' });
  assert.deepEqual(granicaKwartalu(2027, 2), { od: '2027-04-01', doDnia: '2027-06-30' });
  assert.deepEqual(granicaKwartalu(2027, 4), { od: '2027-10-01', doDnia: '2027-12-31' });
});

test('prognoza 31.12.2026: ostatni dzień kwartału, limit 2026, sprzedaż z 1.01.2027 się nie wlicza', (t) => {
  const dzis = zegar(t, CHWILE['ostatnia sekunda 2026'][0]);
  const wpisy = [wpis('2026-10-15', '4000'), wpis('2026-12-31', '2000'), wpis('2027-01-01', '9000')];
  const p = prognoza(wpisy, dzis);
  assert.equal(p.rok, 2026);
  assert.equal(p.q, 4);
  assert.equal(p.limitGr, LIMIT_2026);
  assert.equal(p.sumaGr, zl('6000'));
  assert.equal(p.dniMinelo, 92);
  assert.equal(p.dniZostalo, 0);
  assert.equal(p.przekroczenie, null, 'bez prognozy po końcu kwartału');
  assert.ok(p.progi.every((x) => x.prognozaDnia === null));
});

test('prognoza 1.01.2027: nowy kwartał od zera, limit 2027, 89 pełnych dni do końca marca', (t) => {
  const dzis = zegar(t, CHWILE['północ 1.01.2027'][0]);
  const wpisy = [wpis('2026-12-30', '10000'), wpis('2027-01-01', '1000')];
  const p = prognoza(wpisy, dzis);
  assert.equal(p.rok, 2027);
  assert.equal(p.q, 1);
  assert.equal(p.limitGr, LIMIT_2027);
  assert.equal(p.sumaGr, zl('1000'), 'grudzień 2026 nie liczy się do I kwartału 2027');
  assert.equal(p.zapasGr, LIMIT_2027 - zl('1000'));
  assert.equal(p.dniMinelo, 1);
  assert.equal(p.dniZostalo, 89);
  assert.equal(p.pewnosc, 'mala');
  // 1000 zł dziennie: 1000 + 1000·k > 11 137,50 → k = 11 → 12.01.2027
  assert.deepEqual(p.przekroczenie, { data: '2027-01-12', termin: '2027-01-19', prognoza: true });
});

test('prognoza na ostatni dzień I kwartału 2027 i na 1.04.2027', (t) => {
  const wpisy = [wpis('2027-01-10', '5000'), wpis('2027-03-31', '6000'), wpis('2027-04-01', '500')];
  const marzec = prognoza(wpisy, zegar(t, CHWILE['ostatnia sekunda I kwartału 2027'][0]));
  assert.equal(marzec.q, 1);
  assert.equal(marzec.dniMinelo, 90);
  assert.equal(marzec.dniZostalo, 0);
  assert.equal(marzec.sumaGr, zl('11000'));
  assert.equal(marzec.status.przekroczony, false, '11 000 zł mieści się w limicie 2027');
  assert.equal(marzec.przekroczenie, null);
  t.mock.timers.setTime(new Date(CHWILE['północ 1.04.2027'][0]).getTime());
  const kwiecien = prognoza(wpisy, dataWarszawa());
  assert.equal(kwiecien.q, 2);
  assert.equal(kwiecien.od, '2027-04-01');
  assert.equal(kwiecien.doDnia, '2027-06-30');
  assert.equal(kwiecien.dniMinelo, 1);
  assert.equal(kwiecien.dniZostalo, 90);
  assert.equal(kwiecien.sumaGr, zl('500'));
});

test('prognoza na ostatni dzień II kwartału 2027: bez prognozy po końcu kwartału', (t) => {
  const p = prognoza([wpis('2027-06-30', '11137.50')], zegar(t, CHWILE['ostatnia sekunda II kwartału 2027'][0]));
  assert.equal(p.q, 2);
  assert.equal(p.dniZostalo, 0);
  assert.equal(p.status.procent, 100);
  assert.equal(p.przekroczenie, null);
});

test('historia kwartałów na przełomie roku: każdy rok ze swoim limitem, termin CEIDG przechodzi na styczeń', () => {
  const wpisy = [wpis('2026-12-20', '9000'), wpis('2026-12-31', '2000'), wpis('2027-01-02', '11000')];
  const h = historiaKwartalow(wpisy);
  assert.deepEqual(h.map((k) => k.klucz), ['2027-1', '2026-4']);
  const [i2027, iv2026] = h;
  assert.equal(iv2026.limitGr, LIMIT_2026);
  assert.equal(iv2026.status.przekroczony, true);
  assert.deepEqual(iv2026.przekroczenie, { data: '2026-12-31', termin: '2027-01-07' });
  assert.equal(i2027.limitGr, LIMIT_2027);
  assert.equal(i2027.status.przekroczony, false);
  assert.equal(i2027.przekroczenie, null);
});

test('wydruk ewidencji za 2027: tylko wpisy 2027, narastająco od zera od 1 stycznia', () => {
  const wpisy = [wpis('2026-12-31', '700'), wpis('2027-01-01', '100'), wpis('2027-03-31', '200'), wpis('2027-04-01', '300')];
  const { wiersze, sumaGr } = wierszeEwidencji(wpisy, 2027);
  assert.deepEqual(wiersze.map((x) => x.data), ['2027-01-01', '2027-03-31', '2027-04-01']);
  assert.deepEqual(wiersze.map((x) => x.lp), [1, 2, 3]);
  assert.deepEqual(wiersze.map((x) => x.narastajacoRokGr), [zl('100'), zl('300'), zl('600')]);
  assert.deepEqual(wiersze.map((x) => x.narastajacoKwartalGr), [zl('100'), zl('300'), zl('300')], 'II kwartał od zera');
  assert.equal(sumaGr, zl('600'));
  assert.equal(wierszeEwidencji(wpisy, 2026).sumaGr, zl('700'));
});

// ---------------------------------------------------------------- faktura bez VAT

const NIP_OK = '1234563218';
const PESEL_OK = '95251401357';
const faktura = (zmiany = {}) => ({
  numer: '1/2027',
  dataWystawienia: '2027-01-01',
  dataSprzedazy: '2026-12-30',
  sprzedawca: { nazwa: 'Anna Nowak', adres: 'ul. Lipowa 5, 90-001 Łódź', id: PESEL_OK },
  nabywca: { rodzaj: 'konsument', nazwa: 'Jan Kowalski', adres: 'ul. Polna 3, 00-001 Warszawa', nip: '' },
  pozycje: [{ nazwa: 'Obraz olejny', ilosc: '1', jm: 'szt.', cena: '1250' }],
  podstawa: { kod: 'art113-1' },
  platnosc: '',
  ...zmiany,
});
const DO_FIRMY = { rodzaj: 'firma', nazwa: 'Firma sp. z o.o.', adres: 'ul. Długa 1, Kraków', nip: NIP_OK };
const zapisana = (numer, data, kwota, rodzaj = 'firma') => normalizujFakture(faktura({
  numer, dataWystawienia: data, dataSprzedazy: data,
  nabywca: rodzaj === 'firma' ? DO_FIRMY : { rodzaj, nazwa: 'Jan', adres: 'Łódź' },
  pozycje: [{ nazwa: 'Usługa', ilosc: '1', cena: kwota }],
}));
/** Reguła KSeF tak, jak liczy ją strona: data wystawienia i „dziś” to bieżąca data w Warszawie. */
const regulaDzis = (dzis, zmiany = {}) => regulaKsef({ dataWystawienia: dzis, dzis, rodzaj: 'firma', kwotaGr: 100n, ...zmiany });

test('KSeF według bieżącej daty: 31.12.2026 o 23:59 faktura dla firmy poza KSeF, od północy 1.01.2027 blokada', (t) => {
  const grudzien = regulaDzis(zegar(t, CHWILE['ostatnia sekunda 2026'][0]));
  assert.equal(grudzien.stan, 'poza-ksef');
  assert.equal(grudzien.powod, 'w-limicie');
  assert.equal(grudzien.miesiac, '2026-12');
  t.mock.timers.setTime(new Date(CHWILE['północ 1.01.2027'][0]).getTime());
  const styczen = regulaDzis(dataWarszawa());
  assert.equal(styczen.stan, 'blokada');
  assert.equal(styczen.powod, 'ksef-2027');
  assert.match(opisKsef(styczen), /^Od 1\.01\.2027 każdą fakturę dla firmy wystawiasz w KSeF/);
  assert.equal(skrotKsef(styczen), 'Firma: od 2027 r. faktury tylko w KSeF.');
});

test('KSeF 2027: blokada dla firmy przez cały rok, także w ostatnim dniu kwartału, 1.04 i 31.12.2027', (t) => {
  for (const opis of ['ostatnia sekunda I kwartału 2027', 'północ 1.04.2027', 'ostatnia sekunda II kwartału 2027', 'ostatnia sekunda 2027']) {
    const dzis = zegar(t, CHWILE[opis][0]);
    t.mock.timers.reset();
    assert.equal(regulaDzis(dzis, { kwotaGr: 1n }).powod, 'ksef-2027', opis);
    assert.equal(regulaKsef({ dataWystawienia: dzis, dzis, rodzaj: 'konsument', kwotaGr: zl('50000') }).stan, 'poza-ksef', opis);
  }
});

test('KSeF 1.01.2027: blokada 2027 ma pierwszeństwo przed zapamiętaną utratą prawa i przed limitem grudnia', () => {
  const grudzien = [zapisana('1/2026', '2026-12-02', '9000'), zapisana('2/2026', '2026-12-31', '1000')];
  const r = regulaDzis('2027-01-01', { utrataOd: '2026-11', faktury: grudzien, przekroczonoWczesniej: true });
  assert.equal(r.powod, 'ksef-2027');
  // 31.12.2026: grudzień 9000 + 1000 = równo 10 000 zł, każdy kolejny grosz przekracza limit
  assert.equal(regulaDzis('2026-12-31', { faktury: grudzien, numer: '2/2026', kwotaGr: zl('1000') }).stan, 'poza-ksef');
  assert.equal(regulaDzis('2026-12-31', { faktury: grudzien, kwotaGr: 1n }).powod, 'limit');
  // data wystawienia cofnięta w formularzu na 2026 r. nie zdejmuje blokady z 2027 r.
  assert.equal(regulaKsef({ dataWystawienia: '2026-12-31', dzis: '2027-01-01', rodzaj: 'firma', kwotaGr: 1n }).powod, 'ksef-2027');
});

test('numeracja 1.01.2027: nowy rok od 1/2027, numer z rokiem 2026 odrzucony', (t) => {
  const dzis = zegar(t, CHWILE['północ 1.01.2027'][0]);
  const f = [zapisana('1/2026', '2026-12-02', '100'), zapisana('2/2026', '2026-12-31', '100', 'konsument')];
  assert.equal(proponowanyNumer(f, dzis), '1/2027');
  assert.equal(proponowanyNumer(f, '2026-12-31'), '3/2026');
  assert.throws(() => normalizujFakture(faktura({ numer: '3/2026', dataWystawienia: dzis }), { dzis }),
    (e) => e instanceof BladPola && e.pole === 'numer' && /różni się od roku wystawienia \(2027\)/.test(e.message));
  const ok = normalizujFakture(faktura({ dataWystawienia: dzis }), { dzis });
  assert.equal(ok.numer, '1/2027');
  assert.equal(ok.dataSprzedazy, '2026-12-30');
  // po północy data wystawienia z poprzedniego dnia jest odrzucona, bo musi być dzisiejsza
  assert.throws(() => normalizujFakture(faktura({ numer: '3/2026', dataWystawienia: '2026-12-31' }), { dzis }),
    (e) => e instanceof BladPola && e.pole === 'dataWystawienia');
});

test('terminy faktury przez granicę roku: sprzedaż w grudniu 2026, prośba i wystawienie w 2027', () => {
  const bezProsby = terminy('2026-12-30');
  assert.equal(bezProsby.termin, '2027-01-15');
  assert.equal(bezProsby.zadanieDo, '2027-03-31');
  assert.equal(bezProsby.przepis, 'art. 106i ust. 6 pkt 1');
  const prosba = terminy('2026-12-15', '2027-01-10');
  assert.equal(prosba.termin, '2027-01-25');
  assert.equal(prosba.poTerminieZadania, false);
  assert.equal(terminy('2026-12-15', '2027-04-01').poTerminieZadania, true, 'prośba po 31.03.2027 jest po terminie');
  assert.equal(terminy('2026-12-15', '2027-03-31').poTerminieZadania, false, '31.03.2027 to ostatni dzień na prośbę');
});

test('faktura z 1.01.2027 za sprzedaż z 30.12.2026 trafia do ewidencji z datą sprzedaży (IV kwartał 2026)', () => {
  const f = normalizujFakture(faktura(), { dzis: '2027-01-01' });
  const { wpisy, stan } = dodajFaktureDoEwidencji([], f, 'nowy');
  assert.equal(stan, 'dodano');
  assert.equal(wpisy[0].data, '2026-12-30');
  assert.deepEqual(historiaKwartalow(wpisy).map((k) => k.klucz), ['2026-4']);
});

// ---------------------------------------------------------------- kalendarz i kurs NBP

test('dzień kursu NBP na przełomie 2026/2027: Wigilia, święta, Nowy Rok, Trzech Króli', () => {
  assert.equal(nazwaSwieta('2027-01-01'), 'Nowy Rok');
  assert.equal(dzienKursu('2027-01-01').data, '2026-12-31', '31.12.2026 to czwartek roboczy');
  assert.deepEqual(dzienKursu('2027-01-01').pominiete, []);
  const pon = dzienKursu('2027-01-04');
  assert.equal(pon.data, '2026-12-31');
  assert.deepEqual(pon.pominiete.map((p) => p.powod), ['niedziela', 'sobota', 'Nowy Rok']);
  assert.equal(dzienKursu('2027-01-07').data, '2027-01-05', '6.01 Trzech Króli');
  assert.equal(dzienKursu('2026-12-28').data, '2026-12-23', 'pomija weekend, oba dni świąt i Wigilię');
  assert.equal(dzienKursu('2027-01-02').data, '2026-12-31');
});

test('dzień kursu NBP na granicach kwartałów 2027 i na przełomie 2027/2028', () => {
  assert.equal(dzienKursu('2027-04-01').data, '2027-03-31');
  assert.equal(dzienKursu('2027-03-30').data, '2027-03-26', 'Poniedziałek Wielkanocny 29.03.2027');
  assert.equal(dzienKursu('2027-07-01').data, '2027-06-30');
  assert.equal(dzienKursu('2027-10-01').data, '2027-09-30');
  assert.equal(dzienKursu('2028-01-03').data, '2027-12-31', '1–2.01.2028 to weekend');
  assert.equal(dzienKursu('2027-12-27').data, '2027-12-23', 'Wigilia w piątek, święta w weekend');
});

test('zapytanie NBP przez granicę roku: zakres dat z grudnia 2026 dla sprzedaży ze stycznia 2027', () => {
  const plan = planZapytania('EUR', '2027-01-04');
  assert.equal(plan.oczekiwany, '2026-12-31');
  assert.equal(plan.od, dodajDni('2026-12-31', -10));
  assert.match(plan.adres, /\/eur\/2026-12-21\/2026-12-31\/\?format=json$/);
});

test('kurs NBP 31.12.2026 wieczorem dla sprzedaży z 1.01.2027: tabeli z 31.12 jeszcze nie ma, więc brak kursu, a nie starszy kurs', async (t) => {
  const dzis = zegar(t, '2026-12-31T08:00:00Z');
  const doDnia30 = { rates: [{ no: '251/A/NBP/2026', effectiveDate: '2026-12-30', mid: 4.21 }] };
  const k = await pobierzKurs('EUR', '2027-01-01', { pobierz: async () => ({ ok: true, status: 200, json: async () => doDnia30 }), dzis });
  assert.equal(k.stan, 'niedostepny');
  assert.equal(k.oczekiwany, '2026-12-31');
  // 4.01.2027: tabela z 31.12.2026 jest, kurs z ostatniego dnia roboczego 2026
  const zTabela = { rates: [...doDnia30.rates, { no: '252/A/NBP/2026', effectiveDate: '2026-12-31', mid: 4.22 }] };
  const plan = planZapytania('EUR', '2027-01-04');
  const w = wybierzKurs(zTabela, plan, '2027-01-04');
  assert.equal(w.stan, 'ok');
  assert.equal(w.data, '2026-12-31');
  assert.equal(w.tabela, '252/A/NBP/2026');
  assert.equal(w.innyDzien, false);
});

test('kursy dla wielu wpisów przez granicę roku: jedno zapytanie obejmuje grudzień 2026 i styczeń 2027', async () => {
  const adresy = [];
  const rates = [
    { no: '250/A/NBP/2026', effectiveDate: '2026-12-29', mid: 4.2 },
    { no: '252/A/NBP/2026', effectiveDate: '2026-12-31', mid: 4.22 },
    { no: '001/A/NBP/2027', effectiveDate: '2027-01-04', mid: 4.23 },
  ];
  const w = await pobierzKursyHurtem([{ waluta: 'EUR', data: '2026-12-30' }, { waluta: 'EUR', data: '2027-01-05' }], {
    pobierz: async (adres) => { adresy.push(adres); return { ok: true, status: 200, json: async () => ({ rates }) }; },
    dzis: '2027-01-10',
  });
  assert.equal(adresy.length, 1);
  assert.match(adresy[0], /\/eur\/2026-12-19\/2027-01-04\//);
  assert.equal(w.get('EUR|2026-12-30').data, '2026-12-29');
  assert.equal(w.get('EUR|2027-01-05').data, '2027-01-04');
  assert.equal(w.get('EUR|2027-01-05').tabela, '001/A/NBP/2027');
});

// ---------------------------------------------------------------- karta otwarta przed północą

test('karta otwarta przed północą: po powrocie ewidencja i licznik liczą się od nowego dnia', () => {
  const ewidencja = readFileSync(new URL('../public/js/ewidencja-widok.js', import.meta.url), 'utf8');
  assert.match(ewidencja, /addEventListener\('visibilitychange', \(\) => \{\s*if \(document\.hidden \|\| dzis\(\) === dzienWidoku\) return;\s*dzienWidoku = dzis\(\);\s*odswiez\(\);/);
  const licznik = readFileSync(new URL('../public/js/limit.js', import.meta.url), 'utf8');
  assert.match(licznik, /addEventListener\('visibilitychange', \(\) => \{\s*if \(document\.hidden \|\| kwartalRecznie\) return;[\s\S]*?ustawBiezacyKwartal\(\);/);
  assert.match(licznik, /wyborKwartalu\.addEventListener\('change', \(\) => \{ kwartalRecznie = true; \}\);/, 'kwartał wybrany ręcznie zostaje');
});

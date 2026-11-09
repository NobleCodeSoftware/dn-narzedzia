// Pamięć przeglądarki: dane osobowe tylko za wyraźną zgodą (przełącznik „Zapamiętaj moje dane i dane klientów do faktur”).
// Przy samym „Pamiętaj wpisy ewidencji” faktury są zapisywane w skrócie, bez danych osobowych. Usuwanie kluczy po
// wyłączeniu i jednorazowy wybór po przejściu z danych zapisanych przez wcześniejszą wersję strony.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as magazyn from '../public/js/magazyn.js';
import { normalizujFakture, proponowanyNumer, regulaKsef, nadajIdFakturom, bezFaktury } from '../public/js/faktura-logika.js';

const K = magazyn.KLUCZE;

/** Uruchamia fn z atrapą localStorage (Map) i przywraca stan globalny. */
function zPamiecia(fn, poczatek = {}) {
  const opis = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const dane = new Map(Object.entries(poczatek).map(([k, v]) => [k, JSON.stringify(v)]));
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (k) => dane.get(k) ?? null, setItem: (k, v) => dane.set(k, String(v)), removeItem: (k) => dane.delete(k) } });
  try { return fn(dane); } finally {
    if (opis) Object.defineProperty(globalThis, 'localStorage', opis);
    else delete globalThis.localStorage;
  }
}
const json = (dane, k) => JSON.parse(dane.get(k));
const PESEL = '95251401357';
const NIP = '1234563218';
const SPRZEDAWCA = { nazwa: 'Anna Nowak', adres: 'ul. Lipowa 5, Łódź', rodzajId: 'PESEL', id: PESEL };
const KLIENT = { rodzaj: 'konsument', nazwa: 'Jan Kowalski', adres: 'Warszawa', nip: '' };

/** Pełna faktura jak z formularza (z identyfikatorem nadanym przy wystawieniu). */
const faktura = (id, numer, data, kwota, rodzaj = 'firma') => ({
  ...normalizujFakture({
    numer, dataWystawienia: data, dataSprzedazy: data, sprzedawca: { nazwa: 'Anna Nowak', adres: 'Łódź', id: PESEL },
    nabywca: rodzaj === 'firma' ? { rodzaj, nazwa: 'Firma Kowalski', adres: 'Kraków', nip: NIP } : { rodzaj, nazwa: 'Jan Kowalski', adres: 'Łódź' },
    pozycje: [{ nazwa: 'Usługa', ilosc: '1', cena: kwota }], podstawa: { kod: 'art113-1' },
  }),
  id,
});
/** Czy zapisany tekst ma dane osobowe sprzedawcy albo klienta. */
const maDaneOsobowe = (t) => /95251401357|1234563218|Kowalski|Anna Nowak|Lipowa|Kraków|Łódź/.test(t);

test('domyślnie dn-faktury-v1 nie ma PESEL ani nazwy klienta, tylko rekordy skrócone', () => zPamiecia((dane) => {
  assert.equal(magazyn.pamiecWlaczona(), true);
  assert.equal(magazyn.pamiecDanychWlaczona(), false);
  assert.deepEqual(magazyn.stanPamieciDanych(), { wlaczona: false, czekaNaWybor: false });
  assert.equal(magazyn.zapiszDaneFaktur({ sprzedawca: SPRZEDAWCA, nabywcy: [KLIENT] }), false);
  assert.equal(dane.has(K.dane), false, 'PESEL, adres i klienci nie trafiają do pamięci');
  const f = [faktura('fa', '1/2026', '2026-10-05', '6000'), faktura('fb', '2/2026', '2026-10-06', '300', 'konsument')];
  assert.equal(magazyn.zapiszFaktury({ faktury: f, utrataOd: null }), true);
  const zapis = dane.get(K.faktury);
  assert.ok(!maDaneOsobowe(zapis), `dane osobowe w ${K.faktury}: ${zapis}`);
  assert.deepEqual(json(dane, K.faktury).faktury, [
    { id: 'fa', numer: '1/2026', dataWystawienia: '2026-10-05', dataSprzedazy: '2026-10-05', suma: '6000.00', nabywca: { rodzaj: 'firma' } },
    { id: 'fb', numer: '2/2026', dataWystawienia: '2026-10-06', dataSprzedazy: '2026-10-06', suma: '300.00', nabywca: { rodzaj: 'konsument' } },
  ]);
  assert.equal(magazyn.fakturaZDanymi(json(dane, K.faktury).faktury[0]), false);
}));

test('numeracja, usuwanie i limit KSeF działają na rekordach skróconych', () => zPamiecia(() => {
  magazyn.zapiszFaktury({ faktury: [faktura('fa', '1/2026', '2026-10-05', '6000'), faktura('fb', '2/2026', '2026-10-06', '300', 'konsument')] });
  const skrocone = nadajIdFakturom(magazyn.wczytajFaktury().faktury);
  assert.equal(proponowanyNumer(skrocone, '2026-10-22'), '3/2026');
  const r = regulaKsef({ dataWystawienia: '2026-10-22', dzis: '2026-10-22', rodzaj: 'firma', kwotaGr: 400000n, faktury: skrocone });
  assert.deepEqual([r.stan, r.wczesniejGr, r.poGr], ['poza-ksef', 600000n, 1000000n], 'faktura dla osoby prywatnej się nie wlicza');
  assert.equal(regulaKsef({ dataWystawienia: '2026-10-22', dzis: '2026-10-22', rodzaj: 'firma', kwotaGr: 400001n, faktury: skrocone }).powod, 'limit');
  assert.deepEqual(bezFaktury(skrocone, 'fa').map((f) => f.numer), ['2/2026']);
}));

test('po włączeniu drugiego przełącznika zapisują się pełne faktury i dane do faktur; wyłączenie usuwa je też z faktur', () => zPamiecia((dane) => {
  magazyn.zmienUstawienia({ pamietaj: true, osoba: 'Anna Nowak' });
  assert.equal(magazyn.pamiecDanychWlaczona(), false);
  magazyn.zachowajDaneFaktur();
  assert.equal(magazyn.pamiecDanychWlaczona(), true);
  assert.equal(magazyn.zapiszDaneFaktur({ sprzedawca: SPRZEDAWCA, nabywcy: [KLIENT] }), true);
  magazyn.zapiszFaktury({ faktury: [faktura('fa', '1/2026', '2026-10-05', '6000')], utrataOd: '2026-10' });
  assert.ok(maDaneOsobowe(dane.get(K.faktury)), 'pełna faktura do ponownego wydruku');
  assert.deepEqual(magazyn.wczytajDaneFaktur(), { sprzedawca: SPRZEDAWCA, nabywcy: [KLIENT] });
  // Wyłączenie: znikają dane do faktur, imię do wydruku i dane osobowe z faktur; numer, daty, kwota i utrata zostają.
  magazyn.usunDaneFaktur();
  assert.equal(dane.has(K.dane), false);
  assert.ok(!maDaneOsobowe(dane.get(K.faktury)), dane.get(K.faktury));
  assert.deepEqual(json(dane, K.faktury).faktury, [{ id: 'fa', numer: '1/2026', dataWystawienia: '2026-10-05', dataSprzedazy: '2026-10-05', suma: '6000.00', nabywca: { rodzaj: 'firma' } }]);
  assert.equal(json(dane, K.faktury).utrataOd, '2026-10');
  assert.deepEqual(json(dane, K.ustawienia), { pamietaj: true, pamietajDane: false });
}));

test('zmiana ustawienia zostawia pozostałe ustawienia', () => zPamiecia((dane) => {
  magazyn.zmienUstawienia({ pamietaj: true, osoba: 'Anna' });
  magazyn.zmienUstawienia({ pamietajDane: true });
  assert.deepEqual(json(dane, K.ustawienia), { pamietaj: true, osoba: 'Anna', pamietajDane: true });
  magazyn.zmienUstawienia({ osoba: undefined });
  assert.deepEqual(json(dane, K.ustawienia), { pamietaj: true, pamietajDane: true });
}));

test('wyłączenie przełącznika usuwa jego klucze i zostawia tylko ustawienie', () => zPamiecia((dane) => {
  magazyn.zmienUstawienia({ pamietaj: true, pamietajDane: true });
  magazyn.zapisz([{ id: 'w1', data: '2026-10-01', kwota: '10' }]);
  magazyn.zapiszFaktury({ faktury: [faktura('fa', '1/2026', '2026-10-05', '100')], utrataOd: '2026-10' });
  magazyn.zapiszDaneFaktur({ sprzedawca: SPRZEDAWCA, nabywcy: [KLIENT] });
  magazyn.usunDaneFaktur();
  assert.deepEqual([...dane.keys()].sort(), [K.ewidencja, K.faktury, K.ustawienia].sort());
  magazyn.usunWpisy();
  assert.deepEqual([...dane.keys()], [K.ustawienia], 'zostaje tylko ustawienie');
  assert.deepEqual(json(dane, K.ustawienia), { pamietaj: false, pamietajDane: false });
  magazyn.wyczysc();
  assert.equal(dane.size, 0);
}));

test('wyłączenie pamięci wpisów nie usuwa danych do faktur, gdy ich przełącznik jest włączony', () => zPamiecia((dane) => {
  magazyn.zachowajDaneFaktur();
  magazyn.zapiszDaneFaktur({ sprzedawca: SPRZEDAWCA, nabywcy: [] });
  magazyn.zapiszFaktury({ faktury: [faktura('fa', '1/2026', '2026-10-05', '100')] });
  magazyn.usunWpisy();
  assert.deepEqual([...dane.keys()].sort(), [K.dane, K.ustawienia].sort());
  assert.deepEqual(magazyn.wczytajDaneFaktur().sprzedawca, SPRZEDAWCA);
}));

// Przejście z wersji 0.4.1: dane sprzedawcy, klienci i pełne faktury były w dn-faktury-v1 pod jednym przełącznikiem.
// Drugi przełącznik nie startuje włączony: strona pokazuje jednorazowy wybór „Zachowaj moje dane” albo „Usuń”.
// Do wyboru stare dane zostają nietknięte, nowe nie są zapisywane, a pamiecDanychWlaczona() zwraca false.
const pelna041 = () => ({ ...faktura('x', '1/2026', '2026-11-01', '100', 'konsument'), id: undefined });
const STARY_ZAPIS = () => ({
  [K.faktury]: { wersja: 1, zapisano: '2026-11-01T10:00:00.000Z', faktury: [JSON.parse(JSON.stringify(pelna041()))], sprzedawca: SPRZEDAWCA, nabywcy: [KLIENT], utrataOd: null },
  [K.ustawienia]: { pamietaj: true, osoba: 'Anna Nowak' },
});

test('migracja: do wyboru stare dane zostają nietknięte, nowe nie są zapisywane, przełącznik wyłączony', () => zPamiecia((dane) => {
  const przed = dane.get(K.faktury);
  assert.deepEqual(magazyn.stanPamieciDanych(), { wlaczona: false, czekaNaWybor: true });
  assert.equal(magazyn.pamiecDanychWlaczona(), false);
  assert.deepEqual(magazyn.wczytajDaneFaktur(), { sprzedawca: null, nabywcy: [] }, 'formularz nie korzysta z nich bez zgody');
  assert.equal(magazyn.zapiszDaneFaktur({ sprzedawca: { ...SPRZEDAWCA, nazwa: 'Nowa' }, nabywcy: [] }), false);
  assert.equal(dane.has(K.dane), false, 'nic nie jest dopisywane do dn-dane-faktur-v1');
  // Nowa faktura: zapisana w skrócie, stara pełna i stare pola bez zmian.
  const stare = nadajIdFakturom(magazyn.wczytajFaktury().faktury);
  magazyn.zapiszFaktury({ faktury: [...stare, faktura('nowa', '2/2026', '2026-11-05', '50', 'konsument')] });
  const po = json(dane, K.faktury);
  const { id: _id, ...staraBezId } = po.faktury[0];
  assert.deepEqual(staraBezId, JSON.parse(przed).faktury[0], 'stara faktura nietknięta');
  assert.deepEqual([po.sprzedawca, po.nabywcy], [SPRZEDAWCA, [KLIENT]], 'stare dane sprzedawcy i klientów nietknięte');
  assert.ok(!maDaneOsobowe(JSON.stringify(po.faktury[1])), 'nowa faktura bez danych osobowych');
  assert.equal(json(dane, K.ustawienia).osoba, 'Anna Nowak');
  assert.equal(magazyn.stanPamieciDanych().czekaNaWybor, true, 'wybór nadal czeka');
}, STARY_ZAPIS()));

test('migracja: „Zachowaj moje dane” zapisuje zgodę i przenosi dane; wybór znika', () => zPamiecia((dane) => {
  magazyn.zachowajDaneFaktur();
  assert.deepEqual(magazyn.stanPamieciDanych(), { wlaczona: true, czekaNaWybor: false });
  assert.equal(json(dane, K.ustawienia).pamietajDane, true);
  assert.deepEqual(json(dane, K.dane).sprzedawca, SPRZEDAWCA);
  assert.equal('sprzedawca' in json(dane, K.faktury), false);
  assert.deepEqual(magazyn.wczytajDaneFaktur(), { sprzedawca: SPRZEDAWCA, nabywcy: [KLIENT] });
  assert.ok(magazyn.fakturaZDanymi(json(dane, K.faktury).faktury[0]), 'pełna faktura zostaje');
}, STARY_ZAPIS()));

test('migracja: „Usuń” usuwa dane do faktur, imię do wydruku i dane osobowe z faktur; wybór znika', () => zPamiecia((dane) => {
  magazyn.usunDaneFaktur();
  assert.deepEqual(magazyn.stanPamieciDanych(), { wlaczona: false, czekaNaWybor: false });
  assert.ok(!maDaneOsobowe(dane.get(K.faktury)), dane.get(K.faktury));
  assert.equal(dane.has(K.dane), false);
  assert.deepEqual(json(dane, K.ustawienia), { pamietaj: true, pamietajDane: false });
  assert.deepEqual(magazyn.wczytajFaktury().faktury.map((f) => f.numer), ['1/2026'], 'numeracja zna fakturę');
}, STARY_ZAPIS()));

test('migracja: wyłączenie pamięci wpisów przed wyborem nie usuwa po cichu danych sprzedawcy i klientów', () => zPamiecia((dane) => {
  magazyn.usunWpisy();
  assert.equal(dane.has(K.faktury), false);
  assert.deepEqual(json(dane, K.dane).sprzedawca, SPRZEDAWCA);
  assert.equal(magazyn.stanPamieciDanych().czekaNaWybor, true, 'decyzja o nich nadal należy do użytkownika');
  magazyn.usunDaneFaktur();
  assert.deepEqual([...dane.keys()], [K.ustawienia]);
}, STARY_ZAPIS()));

// Pamięć wyłączona w innej karcie: karta z otwartym oknem może jeszcze mieć stan „włączona”. Zapis wpisów i faktur
// czyta ustawienie w chwili zapisu, więc klucze usunięte przy wyłączeniu nie wracają.
test('po wyłączeniu pamięci wpisów (także w innej karcie) zapisz i zapiszFaktury nic nie zapisują', () => zPamiecia((dane) => {
  assert.equal(magazyn.zapisz([{ id: 'w1', data: '2026-10-01', kwota: '10' }]), true);
  assert.equal(magazyn.zapiszFaktury({ faktury: [faktura('fa', '1/2026', '2026-10-05', '100')] }), true);
  magazyn.usunWpisy(); // druga karta: „Wyłącz i usuń”
  assert.equal(magazyn.zapisz([{ id: 'w2', data: '2026-10-02', kwota: '20' }]), false);
  assert.equal(magazyn.zapiszFaktury({ faktury: [faktura('fb', '2/2026', '2026-10-06', '200')], utrataOd: '2026-10' }), false);
  assert.deepEqual([...dane.keys()], [K.ustawienia], 'klucze wpisów i faktur nie wracają');
  // To samo przy włączonym drugim przełączniku: pełne faktury nie wracają mimo zgody na dane osobowe.
  magazyn.zmienUstawienia({ pamietajDane: true });
  assert.equal(magazyn.zapiszFaktury({ faktury: [faktura('fc', '3/2026', '2026-10-07', '300')] }), false);
  assert.equal(dane.has(K.faktury), false);
  // Po ponownym włączeniu zapis działa.
  magazyn.zmienUstawienia({ pamietaj: true });
  assert.equal(magazyn.zapisz([{ id: 'w3', data: '2026-10-03', kwota: '30' }]), true);
  assert.equal(json(dane, K.ewidencja).wpisy[0].id, 'w3');
}));

test('zostajaDaneFaktur: tylko przy włączonym zapamiętywaniu danych albo danych z wcześniejszej wersji przed wyborem', () => {
  assert.equal(zPamiecia(() => magazyn.zostajaDaneFaktur()), false, 'domyślnie: nic do zachowania');
  assert.equal(zPamiecia(() => magazyn.zostajaDaneFaktur(), { [K.ustawienia]: { pamietajDane: false } }), false);
  assert.equal(zPamiecia(() => magazyn.zostajaDaneFaktur(), { [K.ustawienia]: { pamietajDane: true } }), true);
  assert.equal(zPamiecia(() => magazyn.zostajaDaneFaktur(), STARY_ZAPIS()), true, 'dane 0.4.1 czekają na wybór');
});

test('zostajaDaneFaktur: same pełne faktury z wcześniejszej wersji znikają razem z wpisami, więc nic nie zostaje', () => {
  const tylkoFaktury = () => ({
    [K.faktury]: { wersja: 1, zapisano: '2026-11-01T10:00:00.000Z', faktury: [JSON.parse(JSON.stringify(pelna041()))], utrataOd: null },
    [K.ustawienia]: { pamietaj: true },
  });
  zPamiecia((dane) => {
    assert.deepEqual(magazyn.stanPamieciDanych(), { wlaczona: false, czekaNaWybor: true });
    assert.equal(magazyn.zostajaDaneFaktur(), false, 'okno nie może obiecywać, że dane do faktur zostaną');
    magazyn.usunWpisy();
    assert.deepEqual([...dane.keys()], [K.ustawienia], 'po usunięciu wpisów rzeczywiście nic nie zostaje');
  }, tylkoFaktury());
  // Imię do wydruku albo dane w osobnym kluczu zostają po usunięciu wpisów.
  const zImieniem = tylkoFaktury();
  zImieniem[K.ustawienia].osoba = 'Anna Nowak';
  assert.equal(zPamiecia(() => magazyn.zostajaDaneFaktur(), zImieniem), true);
  const zKluczemDanych = { ...tylkoFaktury(), [K.dane]: { wersja: 1, sprzedawca: SPRZEDAWCA, nabywcy: [] } };
  assert.equal(zPamiecia(() => magazyn.zostajaDaneFaktur(), zKluczemDanych), true);
});

// Klucze zapisywane przez opublikowane wersje strony: pierwsza wersja (kopia robocza ewidencji, domyślnie wyłączona),
// od 0.3 wpisy i ustawienia (pamietaj, osoba), od 0.4 faktury z danymi sprzedawcy i klientów, od 0.4.2 osobny klucz
// danych i ustawienie pamietajDane. Żadna wersja przed 0.4.2 nie zapisywała pamietajDane, więc stare ustawienia nie są
// uznawane za zgodę na dane osobowe.
test('dane starszych wersji: ustawienia 0.4.1 nie są zgodą, „Wyczyść dane” usuwa też kopię roboczą pierwszej wersji', () => zPamiecia((dane) => {
  assert.deepEqual(magazyn.stanPamieciDanych(), { wlaczona: false, czekaNaWybor: true }, 'osoba z 0.4.1 to dana osobowa: wybór');
  assert.equal(magazyn.pamiecDanychWlaczona(), false);
  assert.equal(magazyn.pamiecWlaczona(), true);
  magazyn.wyczysc();
  assert.equal(dane.size, 0, [...dane.keys()].join(', '));
}, {
  [K.ewidencja]: { wersja: 1, zapisano: '2026-11-01T10:00:00.000Z', wpisy: [] },
  [K.ustawienia]: { pamietaj: true, osoba: 'Anna Nowak' },
  [magazyn.KLUCZE_NAJSTARSZEJ_WERSJI[0]]: { wiersze: [['2026-10-19', 'Sesja – Jan Kowalski', '300']], nazwa: 'ewidencja.csv' },
  [magazyn.KLUCZE_NAJSTARSZEJ_WERSJI[1]]: '1',
}));

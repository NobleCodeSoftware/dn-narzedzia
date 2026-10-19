// Logika narzędzi DN: limit kwartalny, ewidencja sprzedaży, kurs NBP, import CSV.
// Czysty moduł ES bez DOM i bez zależności: używa go przeglądarka i testy (node:test).
// Kwoty liczymy w groszach na BigInt, bez liczb zmiennoprzecinkowych.

export const POLA = ['lp', 'data', 'kanal', 'id_transakcji', 'opis', 'kwota', 'waluta',
  'kurs_nbp', 'data_kursu', 'kwota_pln', 'korekta_do'];

// Minimalne wynagrodzenie (zł brutto miesięcznie) według roku.
// 2026: 4806 zł; 2027: 4950 zł (rozporządzenie RM z 14.09.2026, Dz.U. 2026 poz. 1213).
export const PLACA_MINIMALNA = { 2026: '4806', 2027: '4950' };
export const MNOZNIK_LIMITU_PROC = 225n; // limit kwartalny = 225% minimalnego wynagrodzenia
export const PROGI = ['0.70', '0.85', '0.95', '1.00'];

export const NBP_API = 'https://api.nbp.pl/api';

export class BladDanych extends Error {}

// ------------------------------------------------------------ liczby dziesiętne

const RE_LICZBA = /^([+-])?(\d+)(?:[.,](\d+))?$/;

/** Parsuje "1 234,56" / "-3.5" do {v: BigInt, s: skala}. Rzuca BladDanych. */
export function parsujDziesietna(tekst, pole = 'kwota') {
  const czysty = String(tekst ?? '').trim().replace(/[\s ]/g, '');
  const m = RE_LICZBA.exec(czysty);
  if (!m) throw new BladDanych(`${pole}: niepoprawna liczba ${JSON.stringify(String(tekst ?? ''))}`);
  const ulamek = m[3] || '';
  let v = BigInt(m[2] + ulamek);
  if (m[1] === '-') v = -v;
  return { v, s: ulamek.length };
}

/** Dzielenie z zaokrągleniem połówkowym od zera (jak Decimal ROUND_HALF_UP w Pythonie). */
function dzielZaokr(licznik, mianownik) {
  if (mianownik < 0n) { licznik = -licznik; mianownik = -mianownik; }
  const ujemny = licznik < 0n;
  const a = ujemny ? -licznik : licznik;
  let q = a / mianownik;
  if ((a % mianownik) * 2n >= mianownik) q += 1n;
  return ujemny ? -q : q;
}

function potega10(n) { return 10n ** BigInt(n); }

/** Liczba dziesiętna (tekst) → grosze (BigInt), zaokrąglenie połówkowe od zera. */
export function naGrosze(tekst, pole = 'kwota') {
  const { v, s } = parsujDziesietna(tekst, pole);
  return s <= 2 ? v * potega10(2 - s) : dzielZaokr(v, potega10(s - 2));
}

/** kwota × kurs → grosze (BigInt), jak (k * kurs).quantize(GROSZ, ROUND_HALF_UP). */
export function iloczynWGroszach(kwota, kurs) {
  const a = parsujDziesietna(kwota, 'kwota');
  const b = parsujDziesietna(kurs, 'kurs_nbp');
  const skala = a.s + b.s;
  const iloczyn = a.v * b.v;
  return skala <= 2 ? iloczyn * potega10(2 - skala) : dzielZaokr(iloczyn, potega10(skala - 2));
}

/** Grosze → "1234.56" (format pliku, kropka dziesiętna). */
export function groszeNaTekst(g) {
  const ujemny = g < 0n;
  const a = ujemny ? -g : g;
  const zl = a / 100n;
  const gr = String(a % 100n).padStart(2, '0');
  return `${ujemny ? '-' : ''}${zl}.${gr}`;
}

/** Grosze → "10 813,50 zł" (format polski, twarde spacje). */
export function formatujZl(g) {
  const [zl, gr] = groszeNaTekst(g).split('.');
  const ujemny = zl.startsWith('-');
  const cyfry = ujemny ? zl.slice(1) : zl;
  const grupy = cyfry.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${ujemny ? '−' : ''}${grupy},${gr} zł`;
}

/** Normalizuje zapis liczby do formatu pliku ("12,5" → "12.5"). */
export function normalizujLiczbe(tekst, pole = 'kwota') {
  const { v, s } = parsujDziesietna(tekst, pole);
  if (s === 0) return String(v);
  const ujemny = v < 0n;
  const a = String(ujemny ? -v : v).padStart(s + 1, '0');
  return `${ujemny ? '-' : ''}${a.slice(0, -s)}.${a.slice(-s)}`;
}

// ------------------------------------------------------------ daty

const RE_DATA = /^(\d{4})-(\d{2})-(\d{2})$/;

export function poprawnaData(tekst) {
  const m = RE_DATA.exec(String(tekst ?? ''));
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

export function dodajDni(data, dni) {
  if (!poprawnaData(data)) throw new BladDanych(`niepoprawna data ${JSON.stringify(data)}`);
  const [r, m, d] = data.split('-').map(Number);
  return new Date(Date.UTC(r, m - 1, d + dni)).toISOString().slice(0, 10);
}

/** Data kalendarzowa w Warszawie dla chwili (Date lub tekst ISO 8601 ze strefą). */
export function dataWarszawa(chwila = new Date()) {
  const d = chwila instanceof Date ? chwila : new Date(chwila);
  if (Number.isNaN(d.getTime())) throw new BladDanych(`niepoprawny czas ${JSON.stringify(String(chwila))}`);
  // Locale sv-SE daje format RRRR-MM-DD.
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

export function kwartal(data) {
  if (!poprawnaData(data)) throw new BladDanych(`niepoprawna data ${JSON.stringify(data)}`);
  const rok = Number(data.slice(0, 4));
  const miesiac = Number(data.slice(5, 7));
  return { rok, q: Math.floor((miesiac - 1) / 3) + 1 };
}

export function etykietaKwartalu({ rok, q }) { return `${rok}-Q${q}`; }

// ------------------------------------------------------------ limit

/** Limit kwartalny w groszach: 225% minimalnego wynagrodzenia (tekst w zł). */
export function limitKwartalny(placaMinimalna) {
  const placa = naGrosze(placaMinimalna, 'płaca minimalna');
  if (placa <= 0n) throw new BladDanych('płaca minimalna musi być większa od zera');
  return dzielZaokr(placa * MNOZNIK_LIMITU_PROC, 100n);
}

export function limitDlaRoku(rok, placaMinimalna) {
  const placa = placaMinimalna ?? PLACA_MINIMALNA[rok];
  if (placa === undefined) throw new BladDanych(`brak płacy minimalnej dla roku ${rok} — podaj ją ręcznie`);
  return limitKwartalny(placa);
}

/** Status limitu z progami 70/85/95/100%. */
export function statusLimitu(przychodGr, limitGr, progi = PROGI) {
  if (limitGr <= 0n) throw new BladDanych('limit musi być większy od zera');
  const promile = dzielZaokr(przychodGr * 1000n, limitGr); // procent z jednym miejscem po przecinku
  const przekroczone = progi.filter((p) => {
    const { v, s } = parsujDziesietna(p);
    return przychodGr * potega10(s) >= limitGr * v;
  });
  return {
    przychodGr,
    limitGr,
    pozostaloGr: limitGr - przychodGr,
    procent: Number(promile) / 10,
    prog: przekroczone.length ? przekroczone[przekroczone.length - 1] : null,
    przekroczony: przychodGr > limitGr,
  };
}

/** Suma kwota_pln (grosze) w kwartale zawierającym podaną datę. Korekty (ujemne) pomniejszają. */
export function przychodKwartalu(wiersze, data) {
  const { rok, q } = kwartal(data);
  let suma = 0n;
  for (const w of wiersze) {
    const k = kwartal(w.data);
    if (k.rok === rok && k.q === q) suma += naGrosze(w.kwota_pln, 'kwota_pln');
  }
  return suma;
}

// ------------------------------------------------------------ kurs NBP

/** Okno zapytania: 10 dni przed dniem przychodu, bez tego dnia. */
export function oknoKursu(dataPrzychodu) {
  return { od: dodajDni(dataPrzychodu, -10), do: dodajDni(dataPrzychodu, -1) };
}

export function adresKursuNbp(waluta, dataPrzychodu, api = NBP_API) {
  const kod = String(waluta).trim().toLowerCase();
  if (!/^[a-z]{3}$/.test(kod)) throw new BladDanych(`waluta: niepoprawny kod ${JSON.stringify(waluta)}`);
  const { od, do: koniec } = oknoKursu(dataPrzychodu);
  return `${api}/exchangerates/rates/a/${kod}/${od}/${koniec}/?format=json`;
}

/** Z odpowiedzi NBP (tabela A) wybiera ostatni kurs sprzed dnia przychodu. */
export function wybierzKurs(odpowiedz, dataPrzychodu) {
  const kursy = (odpowiedz && Array.isArray(odpowiedz.rates)) ? odpowiedz.rates : [];
  const wczesniejsze = kursy.filter((r) => r && typeof r.effectiveDate === 'string' && r.effectiveDate < dataPrzychodu
    && Number.isFinite(r.mid));
  if (!wczesniejsze.length) throw new BladDanych(`brak kursu NBP sprzed ${dataPrzychodu}`);
  wczesniejsze.sort((a, b) => (a.effectiveDate < b.effectiveDate ? -1 : 1));
  const ostatni = wczesniejsze[wczesniejsze.length - 1];
  return { kurs: String(ostatni.mid), dataKursu: ostatni.effectiveDate, tabela: ostatni.no || '' };
}

/**
 * Pobiera kurs średni NBP z ostatniego dnia roboczego przed dniem przychodu.
 * fetchFn wstrzykiwany (testy). Bez ciasteczek i bez Referer.
 */
export async function pobierzKursNbp(waluta, dataPrzychodu, fetchFn = globalThis.fetch, api = NBP_API) {
  if (String(waluta).toUpperCase() === 'PLN') return { kurs: '1', dataKursu: '', tabela: '' };
  const url = adresKursuNbp(waluta, dataPrzychodu, api);
  let odp;
  try {
    odp = await fetchFn(url, { headers: { Accept: 'application/json' }, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' });
  } catch (e) {
    throw new BladDanych(`nie udało się połączyć z API NBP (${e && e.message ? e.message : e})`);
  }
  if (odp.status === 404) throw new BladDanych(`NBP nie publikuje kursu ${String(waluta).toUpperCase()} w tabeli A albo brak notowań przed ${dataPrzychodu}`);
  if (!odp.ok) throw new BladDanych(`API NBP odpowiedziało kodem ${odp.status}`);
  return wybierzKurs(await odp.json(), dataPrzychodu);
}

// ------------------------------------------------------------ CSV

function wykryjSeparator(tekst) {
  let przecinki = 0; let sredniki = 0; let wCudzyslowie = false;
  for (const z of tekst) {
    if (z === '"') wCudzyslowie = !wCudzyslowie;
    else if (!wCudzyslowie && (z === '\n' || z === '\r')) break;
    else if (!wCudzyslowie && z === ',') przecinki += 1;
    else if (!wCudzyslowie && z === ';') sredniki += 1;
  }
  return sredniki > przecinki ? ';' : ',';
}

/** Parser CSV (RFC 4180): cudzysłowy, nowe linie w polach, BOM, separator , lub ;. */
export function parsujCsv(tekst) {
  let t = String(tekst ?? '');
  if (t.charCodeAt(0) === 0xfeff) t = t.slice(1);
  const sep = wykryjSeparator(t);
  const wiersze = [];
  let wiersz = []; let pole = ''; let wCudzyslowie = false; let i = 0;
  while (i < t.length) {
    const z = t[i];
    if (wCudzyslowie) {
      if (z === '"') {
        if (t[i + 1] === '"') { pole += '"'; i += 2; continue; }
        wCudzyslowie = false; i += 1; continue;
      }
      pole += z; i += 1; continue;
    }
    if (z === '"') { wCudzyslowie = true; i += 1; continue; }
    if (z === sep) { wiersz.push(pole); pole = ''; i += 1; continue; }
    if (z === '\r' || z === '\n') {
      wiersz.push(pole); wiersze.push(wiersz); wiersz = []; pole = '';
      i += (z === '\r' && t[i + 1] === '\n') ? 2 : 1; continue;
    }
    pole += z; i += 1;
  }
  if (wCudzyslowie) throw new BladDanych('CSV: niezamknięty cudzysłów');
  if (pole !== '' || wiersz.length) { wiersz.push(pole); wiersze.push(wiersz); }
  return wiersze.filter((w) => !(w.length === 1 && w[0] === ''));
}

function poleCsv(wartosc) {
  const s = String(wartosc ?? '');
  return /[",\r\n;]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function doCsv(wiersze) {
  return wiersze.map((w) => w.map(poleCsv).join(',')).join('\r\n') + '\r\n';
}

/** Chroni przed wstrzyknięciem formuły po otwarciu pliku w arkuszu (pola tekstowe). */
export function zneutralizujFormule(tekst) {
  const s = String(tekst ?? '');
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

/** Wiersze CSV z nagłówkiem → obiekty. */
export function naObiekty(wiersze) {
  if (!wiersze.length) return { naglowek: [], rekordy: [] };
  const naglowek = wiersze[0].map((h) => h.trim());
  const rekordy = wiersze.slice(1).map((w) => Object.fromEntries(naglowek.map((h, i) => [h, (w[i] ?? '').trim()])));
  return { naglowek, rekordy };
}

// ------------------------------------------------------------ ewidencja

/** Wczytuje plik ewidencji (CSV z nagłówkiem POLA). Pusty plik → []. */
export function wczytajEwidencje(tekst) {
  const surowe = parsujCsv(tekst);
  if (!surowe.length) return [];
  const { naglowek, rekordy } = naObiekty(surowe);
  if (naglowek.join(',') !== POLA.join(',')) {
    throw new BladDanych(`nagłówek pliku to ${naglowek.join(',')} zamiast ${POLA.join(',')}`);
  }
  return rekordy;
}

export function zapiszEwidencje(wiersze) {
  return doCsv([POLA, ...wiersze.map((w) => POLA.map((p) => w[p] ?? ''))]);
}

/** Walidacja pliku ewidencji. Zwraca listę błędów (pusta = OK). */
export function sprawdzEwidencje(wiersze) {
  const bledy = [];
  const klucze = new Set();
  wiersze.forEach((w, idx) => {
    const i = idx + 1;
    const miejsce = `lp ${w.lp}`;
    try {
      if (w.lp !== String(i)) bledy.push(`${miejsce}: lp powinno wynosić ${i}`);
      if (!poprawnaData(w.data)) throw new BladDanych(`niepoprawna data ${JSON.stringify(w.data)}`);
      if (w.data_kursu && !poprawnaData(w.data_kursu)) throw new BladDanych(`niepoprawna data_kursu ${JSON.stringify(w.data_kursu)}`);
      const k = parsujDziesietna(w.kwota, 'kwota');
      const kurs = parsujDziesietna(w.kurs_nbp, 'kurs_nbp');
      const pln = naGrosze(w.kwota_pln, 'kwota_pln');
      if (parsujDziesietna(w.kwota_pln, 'kwota_pln').s > 2) bledy.push(`${miejsce}: kwota_pln może mieć najwyżej 2 miejsca po przecinku`);
      if (!/^[A-Z]{3}$/.test(w.waluta)) bledy.push(`${miejsce}: waluta musi być kodem ISO, np. PLN`);
      if (w.waluta === 'PLN' && kurs.v !== potega10(kurs.s)) bledy.push(`${miejsce}: dla PLN kurs musi wynosić 1`);
      if (iloczynWGroszach(w.kwota, w.kurs_nbp) !== pln) bledy.push(`${miejsce}: kwota_pln ≠ kwota × kurs`);
      if (w.korekta_do && (!/^\d+$/.test(w.korekta_do) || Number(w.korekta_do) >= i)) {
        bledy.push(`${miejsce}: korekta_do musi wskazywać wcześniejszy wpis`);
      }
      if (k.v < 0n && !w.korekta_do) bledy.push(`${miejsce}: kwota ujemna (zwrot, korekta) wymaga korekta_do`);
      if (!w.kanal || !w.id_transakcji) {
        bledy.push(`${miejsce}: kanal i id_transakcji są wymagane`);
      } else {
        const klucz = `${w.kanal}\u0000${w.id_transakcji}`;
        if (klucze.has(klucz)) bledy.push(`${miejsce}: duplikat transakcji (${w.kanal}, ${w.id_transakcji})`);
        klucze.add(klucz);
      }
    } catch (e) {
      if (!(e instanceof BladDanych)) throw e;
      bledy.push(`${miejsce}: ${e.message}`);
    }
  });
  return bledy;
}

export function znajdzDuplikat(wiersze, kanal, idTransakcji) {
  return wiersze.find((w) => w.kanal === kanal && w.id_transakcji === idTransakcji) || null;
}

/**
 * Buduje nowy wpis. Kurs podaje wywołujący (np. z pobierzKursNbp).
 * Zwraca nową tablicę wierszy. Rzuca BladDanych przy błędzie lub duplikacie.
 */
export function dodajWpis(wiersze, { data, kanal, idTransakcji, opis = '', kwota, waluta, kurs, dataKursu = '', korektaDo = '' }) {
  const kanalCzysty = zneutralizujFormule(String(kanal ?? '').trim());
  const idCzyste = zneutralizujFormule(String(idTransakcji ?? '').trim());
  const dup = znajdzDuplikat(wiersze, kanalCzysty, idCzyste);
  if (dup) throw new BladDanych(`transakcja już jest w ewidencji (lp ${dup.lp})`);
  const kod = String(waluta ?? '').trim().toUpperCase();
  let kursTekst; let dataK;
  if (kod === 'PLN') { kursTekst = '1'; dataK = ''; } else {
    if (kurs === undefined || kurs === '') throw new BladDanych('podaj kurs NBP albo pobierz go z API');
    if (!dataKursu) throw new BladDanych('przy kursie podaj też datę kursu');
    kursTekst = normalizujLiczbe(kurs, 'kurs_nbp'); dataK = dataKursu;
  }
  const kwotaTekst = normalizujLiczbe(kwota, 'kwota');
  if (korektaDo && !wiersze.some((w) => w.lp === String(korektaDo))) throw new BladDanych(`korekta_do: brak wpisu lp ${korektaDo}`);
  const nowy = {
    lp: String(wiersze.length + 1), data, kanal: kanalCzysty, id_transakcji: idCzyste,
    opis: zneutralizujFormule(String(opis ?? '').trim()), kwota: kwotaTekst, waluta: kod,
    kurs_nbp: kursTekst, data_kursu: dataK,
    kwota_pln: groszeNaTekst(iloczynWGroszach(kwotaTekst, kursTekst)), korekta_do: korektaDo ? String(korektaDo) : '',
  };
  const wynik = [...wiersze, nowy];
  const bledy = sprawdzEwidencje(wynik);
  if (bledy.length) throw new BladDanych(bledy.join('; '));
  return wynik;
}

/** Usuwa ostatni wpis (tylko ostatni, żeby nie przenumerowywać lp i odwołań korekt). */
export function usunOstatni(wiersze) {
  if (!wiersze.length) return wiersze;
  // Korekta zawsze wskazuje wcześniejszy wpis, więc do ostatniego nic się nie odwołuje.
  return wiersze.slice(0, -1);
}

/** Widok ustawowy: przychód z dnia i narastająco od początku miesiąca. */
export function raportMiesiaca(wiersze, miesiac) {
  if (!/^\d{4}-\d{2}$/.test(miesiac)) throw new BladDanych('miesiąc w formacie RRRR-MM');
  const dni = new Map();
  for (const w of wiersze) {
    if (w.data.startsWith(`${miesiac}-`)) dni.set(w.data, (dni.get(w.data) || 0n) + naGrosze(w.kwota_pln, 'kwota_pln'));
  }
  let narastajaco = 0n;
  return [...dni.keys()].sort().map((dzien, i) => {
    narastajaco += dni.get(dzien);
    return { lp: i + 1, data: dzien, kwotaGr: dni.get(dzien), narastajacoGr: narastajaco };
  });
}

// ------------------------------------------------------------ import Gumroad / Polar

const SYMBOLE_WALUT = { $: 'USD', '€': 'EUR', '£': 'GBP' };

export function wykryjFormat(naglowek) {
  const h = new Set(naglowek);
  if (POLA.every((p) => h.has(p)) && naglowek.length === POLA.length) return 'ewidencja';
  if (h.has('Purchase ID') && h.has('Purchase Date') && naglowek.some((x) => /^Sale Price \(.+\)$/.test(x))) return 'gumroad';
  if (h.has('Created At') && h.has('Currency') && (h.has('Net Amount') || h.has('Total')) && h.has('Product')) return 'polar';
  return null;
}

function prawda(x) { return /^(1|true|yes|tak)$/i.test(String(x ?? '').trim()); }

function czasNaIso(tekst) {
  // Gumroad: "2022-10-27 14:19:23 +0000"; Polar: "2024-05-01T14:30:00+02:00" lub ze spacją.
  const s = String(tekst ?? '').trim();
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)\s*(Z|[+-]\d{2}:?\d{2})?$/.exec(s);
  if (!m) return null;
  let strefa = m[3] || 'Z';
  if (/^[+-]\d{4}$/.test(strefa)) strefa = `${strefa.slice(0, 3)}:${strefa.slice(3)}`;
  return `${m[1]}T${m[2]}${strefa}`;
}

/**
 * Import eksportu sprzedaży Gumroad (nagłówki z kodu źródłowego Gumroad, antiwork/gumroad).
 * Kwota = „Sale Price” (cena zapłacona przez kupującego, wariant konserwatywny).
 * Dane osobowe kupujących (e-mail, imię, adres) są pomijane.
 */
export function importujGumroad(rekordy, naglowek) {
  const kolumnaCeny = naglowek.find((x) => /^Sale Price \(.+\)$/.test(x));
  const symbol = /^Sale Price \((.+)\)$/.exec(kolumnaCeny)[1];
  const waluta = SYMBOLE_WALUT[symbol] || (/^[A-Z]{3}$/.test(symbol) ? symbol : null);
  if (!waluta) throw new BladDanych(`Gumroad: nieznana waluta kolumny ${kolumnaCeny}`);
  const pozycje = []; const uwagi = [];
  for (const r of rekordy) {
    const id = r['Purchase ID'];
    if (!id || !poprawnaData(r['Purchase Date'])) continue; // np. wiersz „Totals”
    const iso = czasNaIso(r['Purchase Time (UTC timezone)']);
    const data = iso ? dataWarszawa(iso) : r['Purchase Date'];
    let kwota;
    try { kwota = normalizujLiczbe(r[kolumnaCeny], kolumnaCeny); } catch (e) { uwagi.push(`Gumroad ${id}: ${e.message}`); continue; }
    if (parsujDziesietna(kwota).v === 0n) { uwagi.push(`Gumroad ${id}: kwota 0 — pominięto`); continue; }
    if (prawda(r['Fully Refunded?']) || naGrosze(r[`Partial Refund (${symbol})`] || '0') !== 0n || prawda(r['Refunded?'])) {
      uwagi.push(`Gumroad ${id}: zwrot w eksporcie — dodaj korektę ręcznie z datą zwrotu`);
    }
    if (prawda(r['Disputed?'])) uwagi.push(`Gumroad ${id}: spór (chargeback) — sprawdź i ewentualnie dodaj korektę`);
    pozycje.push({ data, kanal: 'gumroad', idTransakcji: id, opis: r['Item Name'] || '', kwota, waluta });
  }
  return { pozycje, uwagi };
}

/**
 * Import eksportu zamówień Polar (kolumny z kodu Polar: server/polar/order/export.py).
 * Kwota = „Total” (z podatkiem), a gdy jej brak — „Net Amount” z ostrzeżeniem.
 * Pomija e-mail i dane rozliczeniowe kupujących.
 */
export function importujPolar(rekordy, naglowek) {
  const maTotal = naglowek.includes('Total');
  const pozycje = []; const uwagi = [];
  if (!maTotal) uwagi.push('Polar: brak kolumny „Total” — użyto „Net Amount” (bez podatku). Wariant konserwatywny wymaga kwoty brutto: wyeksportuj z kolumną Total.');
  for (const r of rekordy) {
    const iso = czasNaIso(r['Created At']);
    if (!iso) { if (Object.values(r).some(Boolean)) uwagi.push(`Polar: pominięto wiersz z niepoprawną datą ${JSON.stringify(r['Created At'] || '')}`); continue; }
    const status = String(r.Status || '').toLowerCase();
    const kwotaSurowa = maTotal ? r.Total : r['Net Amount'];
    const id = r['Invoice number'] || `${r['Created At']}|${r.Product}|${kwotaSurowa}`;
    if (status === 'pending' || status === 'void') { uwagi.push(`Polar ${id}: status ${status} — pominięto`); continue; }
    let kwota;
    try { kwota = normalizujLiczbe(kwotaSurowa, 'kwota'); } catch (e) { uwagi.push(`Polar ${id}: ${e.message}`); continue; }
    if (parsujDziesietna(kwota).v === 0n) { uwagi.push(`Polar ${id}: kwota 0 — pominięto`); continue; }
    if (status.includes('refund') || (r['Refunded Amount'] && naGrosze(r['Refunded Amount']) !== 0n)) {
      uwagi.push(`Polar ${id}: zwrot w eksporcie — dodaj korektę ręcznie z datą zwrotu`);
    }
    if (!r['Invoice number']) uwagi.push(`Polar ${id}: brak numeru faktury — identyfikator złożony z daty, produktu i kwoty`);
    pozycje.push({ data: dataWarszawa(iso), kanal: 'polar', idTransakcji: id, opis: r.Product || '', kwota, waluta: String(r.Currency || '').toUpperCase() });
  }
  return { pozycje, uwagi };
}

/** Rozpoznaje i importuje plik platformy. Zwraca {format, pozycje, uwagi}. */
export function importujPlik(tekst) {
  const { naglowek, rekordy } = naObiekty(parsujCsv(tekst));
  const format = wykryjFormat(naglowek);
  if (format === 'gumroad') return { format, ...importujGumroad(rekordy, naglowek) };
  if (format === 'polar') return { format, ...importujPolar(rekordy, naglowek) };
  if (format === 'ewidencja') throw new BladDanych('to plik ewidencji — użyj „Otwórz plik ewidencji”');
  throw new BladDanych('nie rozpoznano formatu (obsługiwane: eksport sprzedaży Gumroad, eksport zamówień Polar)');
}

/**
 * Dopisuje pozycje z importu: pomija duplikaty, pobiera kursy (pamięć podręczna na waluta+data).
 * Zwraca {wiersze, dodane, pominiete, bledy}.
 */
export async function dopiszImport(wiersze, pozycje, pobierzKurs) {
  const pamiec = new Map();
  let wynik = wiersze; let dodane = 0; const pominiete = []; const bledy = [];
  const posortowane = [...pozycje].sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));
  for (const p of posortowane) {
    if (znajdzDuplikat(wynik, p.kanal, zneutralizujFormule(p.idTransakcji))) { pominiete.push(p.idTransakcji); continue; }
    try {
      let kurs = { kurs: '1', dataKursu: '' };
      if (p.waluta !== 'PLN') {
        const klucz = `${p.waluta}|${p.data}`;
        if (!pamiec.has(klucz)) pamiec.set(klucz, await pobierzKurs(p.waluta, p.data));
        kurs = pamiec.get(klucz);
      }
      wynik = dodajWpis(wynik, { ...p, kurs: kurs.kurs, dataKursu: kurs.dataKursu });
      dodane += 1;
    } catch (e) {
      bledy.push(`${p.kanal} ${p.idTransakcji}: ${e.message}`);
    }
  }
  return { wiersze: wynik, dodane, pominiete, bledy };
}

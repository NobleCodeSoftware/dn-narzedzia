// Logika licznika limitu działalności nierejestrowanej (kwartał, progi 70/85/95/100%).
// Czysty moduł ES bez DOM i bez zależności: używa go przeglądarka i testy (node:test).
// Kwoty liczymy w groszach na BigInt, bez liczb zmiennoprzecinkowych.

// Minimalne wynagrodzenie (zł brutto miesięcznie) według roku.
// 2026: 4806 zł; 2027: 4950 zł (rozporządzenie RM z 14.09.2026, Dz.U. 2026 poz. 1213).
export const PLACA_MINIMALNA = { 2026: '4806', 2027: '4950' };
export const MNOZNIK_LIMITU_PROC = 225n; // limit kwartalny = 225% minimalnego wynagrodzenia
export const PROGI = ['0.70', '0.85', '0.95', '1.00'];

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

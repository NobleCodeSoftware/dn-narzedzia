// Logika ewidencji sprzedaży: wpisy, kwoty w PLN, sumy kwartałów, progi, prognoza, przekroczenie,
// wartości kolumn arkusza i wiersze wydruku. Czysty moduł ES bez DOM (testy: node:test).
// Kwoty liczymy w groszach na BigInt, bez liczb zmiennoprzecinkowych.

import {
  BladDanych, parsujDziesietna, naGrosze, poprawnaData, dodajDni, kwartal, PLACA_MINIMALNA, limitDlaRoku,
  statusLimitu, PROGI,
} from './logic.js';

export const NAGLOWKI_ARKUSZA = ['Data', 'Opis', 'Kwota', 'Waluta', 'Kurs NBP', 'Kwota w PLN',
  'Suma kwartału (narastająco)', '% limitu', 'Ostrzeżenie'];
export const DNI_NA_WNIOSEK_CEIDG = 7;
export const MAX_OPIS = 200;

// ------------------------------------------------------------ pomocnicze

function dzielZaokr(licznik, mianownik) {
  if (mianownik < 0n) { licznik = -licznik; mianownik = -mianownik; }
  const ujemny = licznik < 0n;
  const a = ujemny ? -licznik : licznik;
  let q = a / mianownik;
  if ((a % mianownik) * 2n >= mianownik) q += 1n;
  return ujemny ? -q : q;
}
const dzielWGore = (a, b) => (a <= 0n ? 0n : (a + b - 1n) / b); // tylko a ≥ 0, b > 0

/** Liczba dni od a do b (b − a), obie daty 'RRRR-MM-DD'. */
export function roznicaDni(a, b) {
  const t = (d) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
  return Math.round((t(b) - t(a)) / 86400000);
}

export function granicaKwartalu(rok, q) {
  const m = (q - 1) * 3 + 1;
  const od = `${rok}-${String(m).padStart(2, '0')}-01`;
  const doDnia = dodajDni(`${q === 4 ? rok + 1 : rok}-${String(q === 4 ? 1 : m + 3).padStart(2, '0')}-01`, -1);
  return { od, doDnia };
}

export const kluczKwartalu = (rok, q) => `${rok}-${q}`;
export const RZYMSKIE = ['I', 'II', 'III', 'IV'];
export const etykietaKwartalu = (rok, q) => `${RZYMSKIE[q - 1]} kwartał ${rok}`;

/** Limit kwartalny w groszach albo null, gdy nie znamy płacy minimalnej (np. 2028) albo rok sprzed 2026. */
export function limitLubNull(rok) {
  if (rok < 2026 || PLACA_MINIMALNA[rok] === undefined) return null;
  return limitDlaRoku(rok);
}

// ------------------------------------------------------------ wpisy

/**
 * Normalizuje wpis. Rzuca BladDanych z komunikatem dla użytkownika.
 * Wpis: { id, data, opis, kwota, waluta, kurs, kursData, kursTabela } (kwoty jako tekst z kropką).
 */
export function normalizujWpis(w) {
  const data = String(w?.data ?? '').trim();
  if (!poprawnaData(data)) throw new BladDanych('Podaj datę sprzedaży.');
  const opis = String(w?.opis ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, MAX_OPIS);
  let kwota;
  try { kwota = tekstLiczby(w?.kwota); } catch { throw new BladDanych('Wpisz kwotę samymi cyframi, np. 49,90.'); }
  if (/^-?0*(\.0*)?$/.test(kwota)) throw new BladDanych('Kwota nie może być zerem.');
  const waluta = String(w?.waluta ?? 'PLN').trim().toUpperCase() || 'PLN';
  if (!/^[A-Z]{3}$/.test(waluta)) throw new BladDanych('Waluta to trzyliterowy kod, np. EUR.');
  let kurs = '';
  if (waluta !== 'PLN' && String(w?.kurs ?? '').trim() !== '') {
    try { kurs = tekstLiczby(w.kurs); } catch { throw new BladDanych('Kurs to liczba, np. 4,3641.'); }
    if (kurs.startsWith('-') || /^0*(\.0*)?$/.test(kurs)) throw new BladDanych('Kurs musi być większy od zera.');
  }
  const kursData = waluta !== 'PLN' && kurs && poprawnaData(w?.kursData) ? w.kursData : '';
  const kursTabela = kursData ? String(w?.kursTabela ?? '').slice(0, 40) : '';
  return { id: String(w?.id ?? ''), data, opis, kwota, waluta, kurs, kursData, kursTabela };
}

/** Tekst liczby w formacie pliku ("1234.5"): przyjmuje "1 234,50", "1.234,50", "1,234.50", liczby JS. */
export function tekstLiczby(wartosc) {
  if (typeof wartosc === 'number') {
    if (!Number.isFinite(wartosc)) throw new BladDanych('liczba');
    // Liczby z arkusza (np. 49.900000000000006) obcinamy do 8 miejsc po przecinku.
    const t = wartosc.toFixed(8).replace(/\.?0+$/, '');
    return t === '-0' ? '0' : t;
  }
  let t = String(wartosc ?? '').trim().replace(/[\s  ]/g, '').replace(/(zł|pln)$/i, '').replace(/^\+/, '');
  t = t.replace(/^−/, '-');
  const przecinek = t.lastIndexOf(',');
  const kropka = t.lastIndexOf('.');
  if (przecinek >= 0 && kropka >= 0) {
    const dziesietny = przecinek > kropka ? ',' : '.';
    const tysiace = dziesietny === ',' ? '.' : ',';
    t = t.split(tysiace).join('').replace(dziesietny, '.');
  } else if (przecinek >= 0) {
    t = (t.match(/,/g).length > 1 ? t.split(',').join('') : t.replace(',', '.'));
  } else if (kropka >= 0 && t.match(/\./g).length > 1) {
    t = t.split('.').join('');
  }
  const { v, s } = parsujDziesietna(t);
  const znak = v < 0n ? '-' : '';
  const a = (v < 0n ? -v : v).toString().padStart(s + 1, '0');
  return s ? `${znak}${a.slice(0, -s)}.${a.slice(-s)}` : `${znak}${a}`;
}

/** Kwota w PLN (grosze) albo null, gdy sprzedaż w walucie nie ma kursu. Zaokrąglenie jak ROUND(C*E,2). */
export function kwotaPlnGr(w) {
  if (w.waluta === 'PLN') return naGrosze(w.kwota);
  if (!w.kurs) return null;
  const k = parsujDziesietna(w.kwota);
  const r = parsujDziesietna(w.kurs);
  const skala = k.s + r.s;
  const iloczyn = k.v * r.v;
  return skala >= 2 ? dzielZaokr(iloczyn, 10n ** BigInt(skala - 2)) : iloczyn * 10n ** BigInt(2 - skala);
}

/** Sortuje po dacie; w obrębie dnia zachowuje kolejność dodania. */
export function posortuj(wpisy) {
  return wpisy.map((w, i) => [w, i]).sort((a, b) => (a[0].data < b[0].data ? -1 : a[0].data > b[0].data ? 1 : a[1] - b[1]))
    .map(([w]) => w);
}

// ------------------------------------------------------------ kwartały

/** Narastająca suma kwartału dzień po dniu: [{ data, dzienGr, sumaGr }] (tylko dni z wpisami z kwotą PLN). */
export function przebiegKwartalu(wpisy, rok, q) {
  const { od, doDnia } = granicaKwartalu(rok, q);
  const dni = new Map();
  for (const w of wpisy) {
    if (w.data < od || w.data > doDnia) continue;
    const gr = kwotaPlnGr(w);
    if (gr === null) continue;
    dni.set(w.data, (dni.get(w.data) ?? 0n) + gr);
  }
  let suma = 0n;
  return [...dni.keys()].sort().map((data) => { suma += dni.get(data); return { data, dzienGr: dni.get(data), sumaGr: suma }; });
}

/** Pierwszy dzień, w którym suma narastająco osiągnęła próg (procent jako '0.70' itd.); dla 'przekroczenie' ściśle powyżej limitu. */
export function dzienOsiagnieciaProgu(przebieg, limitGr, prog) {
  for (const p of przebieg) {
    if (prog === 'przekroczenie' ? p.sumaGr > limitGr : osiagniety(p.sumaGr, limitGr, prog)) return p.data;
  }
  return null;
}

function osiagniety(sumaGr, limitGr, prog) {
  const { v, s } = parsujDziesietna(prog);
  return sumaGr * 10n ** BigInt(s) >= limitGr * v;
}

/** Kwota progu w groszach (np. 70% limitu), zaokrąglona połówkowo. */
export function kwotaProgu(limitGr, prog) {
  const { v, s } = parsujDziesietna(prog);
  return dzielZaokr(limitGr * v, 10n ** BigInt(s));
}

/**
 * Historia kwartałów: wszystkie kwartały z wpisami, od najnowszego.
 * [{ rok, q, klucz, sumaGr, liczba, bezKursu, limitGr, status, przekroczenie: { data, termin } | null }]
 */
export function historiaKwartalow(wpisy) {
  const grupy = new Map();
  for (const w of wpisy) {
    const { rok, q } = kwartal(w.data);
    const k = kluczKwartalu(rok, q);
    if (!grupy.has(k)) grupy.set(k, { rok, q, klucz: k, sumaGr: 0n, liczba: 0, bezKursu: 0 });
    const g = grupy.get(k);
    g.liczba += 1;
    const gr = kwotaPlnGr(w);
    if (gr === null) g.bezKursu += 1; else g.sumaGr += gr;
  }
  return [...grupy.values()]
    .sort((a, b) => (b.rok - a.rok) || (b.q - a.q))
    .map((g) => {
      const limitGr = limitLubNull(g.rok);
      const status = limitGr === null ? null : statusLimitu(g.sumaGr, limitGr);
      let przekroczenie = null;
      if (limitGr !== null) {
        const data = dzienOsiagnieciaProgu(przebiegKwartalu(wpisy, g.rok, g.q), limitGr, 'przekroczenie');
        if (data) przekroczenie = { data, termin: dodajDni(data, DNI_NA_WNIOSEK_CEIDG) };
      }
      return { ...g, limitGr, status, przekroczenie };
    });
}

// ------------------------------------------------------------ prognoza

/**
 * Prognoza dla kwartału, w którym jest `dzis`.
 * Metoda: średnia dzienna sprzedaż od początku kwartału do dziś (włącznie) × pozostałe dni kwartału.
 * Zwraca null, gdy brak limitu dla roku.
 */
export function prognoza(wpisy, dzis) {
  const { rok, q } = kwartal(dzis);
  const limitGr = limitLubNull(rok);
  if (limitGr === null) return null;
  const { od, doDnia } = granicaKwartalu(rok, q);
  const przebieg = przebiegKwartalu(wpisy, rok, q);
  const sumaGr = przebieg.length ? przebieg[przebieg.length - 1].sumaGr : 0n;
  const doDzis = przebieg.filter((p) => p.data <= dzis);
  const sumaDoDzisGr = doDzis.length ? doDzis[doDzis.length - 1].sumaGr : 0n;
  const dniMinelo = roznicaDni(od, dzis) + 1;
  const dniZostalo = roznicaDni(dzis, doDnia); // pełne dni po dzisiejszym
  const liczbaWpisow = wpisy.filter((w) => w.data >= od && w.data <= dzis).length;
  const zapasGr = limitGr - sumaGr;
  const tempo = sumaDoDzisGr > 0n ? sumaDoDzisGr : 0n; // tempo = tempo / dniMinelo na dzień

  // k dni po dziś, w którym prognozowana suma osiągnie próg (null, gdy po końcu kwartału albo brak tempa).
  const dzienProgu = (prog) => {
    let k;
    if (prog === 'przekroczenie') {
      if (zapasGr < 0n) return null;
      if (tempo === 0n) return null;
      k = (zapasGr * BigInt(dniMinelo)) / tempo + 1n;
    } else {
      const { v, s } = parsujDziesietna(prog);
      const brak = limitGr * v - sumaGr * 10n ** BigInt(s); // w jednostkach 10^-s grosza
      if (brak <= 0n) return null;
      if (tempo === 0n) return null;
      k = dzielWGore(brak * BigInt(dniMinelo), tempo * 10n ** BigInt(s));
    }
    if (k > BigInt(dniZostalo)) return null;
    return dodajDni(dzis, Number(k));
  };

  const progi = [...PROGI, 'przekroczenie'].map((prog) => {
    const osiagnietyDnia = dzienOsiagnieciaProgu(przebieg, limitGr, prog);
    return {
      prog,
      kwotaGr: prog === 'przekroczenie' ? limitGr : kwotaProgu(limitGr, prog),
      osiagnietyDnia,
      prognozaDnia: osiagnietyDnia ? null : dzienProgu(prog),
    };
  });
  const sumaNaKoniecGr = sumaGr + (tempo * BigInt(dniZostalo)) / BigInt(dniMinelo);
  const przekr = progi.find((p) => p.prog === 'przekroczenie');
  return {
    rok, q, od, doDnia, limitGr, sumaGr, zapasGr, dniMinelo, dniZostalo, liczbaWpisow,
    status: statusLimitu(sumaGr, limitGr),
    tempoDzienneGr: dzielZaokr(tempo, BigInt(dniMinelo)),
    sumaNaKoniecGr,
    statusNaKoniec: statusLimitu(sumaNaKoniecGr, limitGr),
    budzetDziennyGr: zapasGr > 0n ? zapasGr / BigInt(dniZostalo + 1) : 0n,
    progi,
    przekroczenie: przekr.osiagnietyDnia
      ? { data: przekr.osiagnietyDnia, termin: dodajDni(przekr.osiagnietyDnia, DNI_NA_WNIOSEK_CEIDG), prognoza: false }
      : (przekr.prognozaDnia ? { data: przekr.prognozaDnia, termin: dodajDni(przekr.prognozaDnia, DNI_NA_WNIOSEK_CEIDG), prognoza: true } : null),
    pewnosc: dniMinelo < 14 || liczbaWpisow < 3 ? 'mala' : 'zwykla',
  };
}

// ------------------------------------------------------------ arkusz i wydruk

function drabinka(sumaGr, limitGr) {
  if (sumaGr > limitGr) return 'Limit przekroczony';
  if (sumaGr === limitGr) return 'Limit wykorzystany (100%)';
  if (osiagniety(sumaGr, limitGr, '0.95')) return 'Co najmniej 95% limitu';
  if (osiagniety(sumaGr, limitGr, '0.85')) return 'Co najmniej 85% limitu';
  if (osiagniety(sumaGr, limitGr, '0.70')) return 'Co najmniej 70% limitu';
  return 'W limicie';
}

/**
 * Wartości kolumn F–I arkusza dla posortowanych wpisów, tak jak liczą je formuły arkusza:
 * F kwota w PLN albo „brak kursu”, G suma kwartału do tej daty włącznie, H ułamek limitu, I ostrzeżenie.
 */
export function wartosciArkusza(posortowane) {
  const pln = posortowane.map(kwotaPlnGr);
  return posortowane.map((w, i) => {
    if (pln[i] === null) return { F: 'brak kursu', G: '', H: '', I: 'Wpisz kurs NBP w kolumnie E' };
    const { rok, q } = kwartal(w.data);
    const { od } = granicaKwartalu(rok, q);
    let G = 0n;
    posortowane.forEach((x, j) => { if (pln[j] !== null && x.data >= od && x.data <= w.data) G += pln[j]; });
    const limitGr = PLACA_MINIMALNA[rok] === undefined ? null : limitDlaRoku(rok);
    if (limitGr === null) return { F: pln[i], G, H: 'brak limitu', I: 'Wpisz płacę minimalną na ten rok w zakładce Limity' };
    return { F: pln[i], G, H: Number(G) / Number(limitGr), I: drabinka(G, limitGr) };
  });
}

/**
 * Wiersze uproszczonej ewidencji sprzedaży za rok (wzór z biznes.gov.pl: Lp., data sprzedaży, kwota sprzedaży,
 * kwota narastająco od początku roku), z dodatkowymi kolumnami: opis, waluta i kurs, narastająco w kwartale.
 */
export function wierszeEwidencji(wpisy, rok) {
  const z = posortuj(wpisy.filter((w) => w.data.startsWith(`${rok}-`)));
  let rokGr = 0n;
  let kwKlucz = '';
  let kwGr = 0n;
  let brakiKursu = 0;
  const wiersze = z.map((w, i) => {
    const { q } = kwartal(w.data);
    if (kluczKwartalu(rok, q) !== kwKlucz) { kwKlucz = kluczKwartalu(rok, q); kwGr = 0n; }
    const gr = kwotaPlnGr(w);
    if (gr === null) brakiKursu += 1; else { rokGr += gr; kwGr += gr; }
    return { lp: i + 1, data: w.data, opis: w.opis, kwota: w.kwota, waluta: w.waluta, kurs: w.kurs, kursData: w.kursData,
      plnGr: gr, narastajacoRokGr: rokGr, narastajacoKwartalGr: kwGr, q };
  });
  return { wiersze, sumaGr: rokGr, brakiKursu };
}

// ------------------------------------------------------------ import

const RE_ISO = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/;
const RE_PL = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/;

/** Data z arkusza: 'RRRR-MM-DD', 'DD.MM.RRRR', 'DD-MM-RRRR', 'DD/MM/RRRR' albo numer seryjny Excela. */
export function odczytajDate(wartosc) {
  if (typeof wartosc === 'number') return dataZSeryjnej(wartosc);
  const t = String(wartosc ?? '').trim();
  let r; let m; let d;
  let x = RE_ISO.exec(t);
  if (x) [r, m, d] = [x[1], x[2], x[3]];
  else if ((x = RE_PL.exec(t))) [r, m, d] = [x[3], x[2], x[1]];
  else if (/^\d{5}(\.\d+)?$/.test(t)) return dataZSeryjnej(Number(t));
  else return null;
  const iso = `${r}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  return poprawnaData(iso) ? iso : null;
}

/** Numer seryjny daty Excela (system 1900; 1904, gdy plik tak deklaruje). */
export function dataZSeryjnej(n, system1904 = false) {
  if (!Number.isFinite(n) || n < 1) return null;
  const dni = Math.floor(n) + (system1904 ? 1462 : 0);
  return new Date(Date.UTC(1899, 11, 30) + dni * 86400000).toISOString().slice(0, 10);
}

export function seryjnaZDaty(data) {
  return roznicaDni('1899-12-30', data);
}

const norm = (t) => String(t ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Wiersze z pliku (tablice wartości: tekst albo liczba) → wpisy.
 * Szuka wiersza nagłówka („Data” … „Kwota”) w pierwszych 30 wierszach; bez nagłówka przyjmuje układ A–E.
 * Zwraca { wpisy, bledy: [{ wiersz, powod }] }; numer wiersza jak w arkuszu (od 1).
 */
export function wierszeNaWpisy(wiersze, { pierwszyNumer = 1 } = {}) {
  let kol = { data: 0, opis: 1, kwota: 2, waluta: 3, kurs: 4 };
  let start = 0;
  for (let i = 0; i < Math.min(wiersze.length, 30); i += 1) {
    const h = (wiersze[i] ?? []).map(norm);
    const iData = h.indexOf('data');
    const iKwota = h.findIndex((x) => x === 'kwota' || x === 'kwota sprzedaży');
    if (iData >= 0 && iKwota >= 0) {
      const znajdz = (...nazwy) => h.findIndex((x) => nazwy.includes(x));
      kol = { data: iData, opis: znajdz('opis'), kwota: iKwota, waluta: znajdz('waluta'), kurs: znajdz('kurs nbp', 'kurs') };
      start = i + 1;
      break;
    }
  }
  const wpisy = [];
  const bledy = [];
  for (let i = start; i < wiersze.length; i += 1) {
    const w = wiersze[i] ?? [];
    const komorka = (k) => (k >= 0 && w[k] !== undefined && w[k] !== null ? w[k] : '');
    const surowaData = komorka(kol.data);
    const surowaKwota = komorka(kol.kwota);
    if (String(surowaData).trim() === '' && String(surowaKwota).trim() === '') continue;
    const numer = i + pierwszyNumer;
    const data = odczytajDate(surowaData);
    if (!data) { bledy.push({ wiersz: numer, powod: 'niepoprawna data' }); continue; }
    let opis = String(komorka(kol.opis));
    if (/^'[=+\-@]/.test(opis)) opis = opis.slice(1); // ochrona przed formułami z naszego eksportu CSV
    try {
      wpisy.push(normalizujWpis({
        id: `i${wpisy.length + 1}`, data, opis, kwota: surowaKwota, waluta: String(komorka(kol.waluta)) || 'PLN', kurs: komorka(kol.kurs),
      }));
    } catch (e) {
      if (!(e instanceof BladDanych)) throw e;
      bledy.push({ wiersz: numer, powod: e.message });
    }
  }
  return { wpisy, bledy };
}

// ------------------------------------------------------------ numeracja dokumentów

/**
 * Kolejny numer dokumentu w roku w formacie „N/RRRR”. Numeracja ciągła w roku kalendarzowym,
 * liczona od największego istniejącego numeru z tego roku (luki nie są wypełniane).
 */
export function kolejnyNumer(numery, rok) {
  let max = 0;
  for (const n of numery) {
    const m = /^(\d+)\/(\d{4})$/.exec(String(n).trim());
    if (m && Number(m[2]) === rok) max = Math.max(max, Number(m[1]));
  }
  return `${max + 1}/${rok}`;
}

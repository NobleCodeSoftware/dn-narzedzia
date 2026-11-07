// Logika ewidencji sprzedaży: wpisy, kwoty w PLN, sumy kwartałów, progi, prognoza, przekroczenie,
// wartości kolumn arkusza i wiersze wydruku. Czysty moduł ES bez DOM (testy: node:test).
// Kwoty liczymy w groszach na BigInt, bez liczb zmiennoprzecinkowych.

import {
  BladDanych, parsujDziesietna, naGrosze, poprawnaData, dodajDni, kwartal, PLACA_MINIMALNA, limitDlaRoku,
  statusLimitu, PROGI,
} from './logic.js';

export const NAGLOWKI_ARKUSZA = ['Data', 'Opis', 'Kwota', 'Waluta', 'Kurs NBP', 'Kwota w PLN',
  'Suma kwartału (narastająco)', '% limitu', 'Ostrzeżenie', 'Zwrot dotyczy sprzedaży z dnia'];
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
 * Pola nieobowiązkowe (są w wyniku tylko wtedy, gdy mają wartość):
 * - dotyczy: przy zwrocie (kwota ujemna) data sprzedaży, której zwrot dotyczy. Służy tylko do ostrzeżenia
 *   (ostrzezeniaZwrotow) i niczego nie przelicza: zwrot liczy się w kwartale swojej daty, czyli daty dokumentu korekty;
 * - zmieniono: chwila ostatniej zmiany wpisu w formularzu (ISO 8601, UTC), do łączenia wersji (polaczWpisy).
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
  const wynik = { id: String(w?.id ?? ''), data, opis, kwota, waluta, kurs, kursData, kursTabela };
  const dotyczy = String(w?.dotyczy ?? '').trim();
  if (kwota.startsWith('-') && dotyczy) {
    if (!poprawnaData(dotyczy)) throw new BladDanych('Podaj poprawną datę sprzedaży, której dotyczy zwrot.');
    if (dotyczy > data) throw new BladDanych('Sprzedaż, której dotyczy zwrot, nie może być późniejsza niż data dokumentu korekty.');
    wynik.dotyczy = dotyczy;
  }
  if (typeof w?.zmieniono === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(w.zmieniono)) wynik.zmieniono = w.zmieniono;
  return wynik;
}

/** Tekst liczby w formacie pliku ("1234.5"): przyjmuje "1 234,50", "1.234,50", "1,234.50", liczby JS. */
export function tekstLiczby(wartosc) {
  if (typeof wartosc === 'number') {
    if (!Number.isFinite(wartosc)) throw new BladDanych('liczba');
    // Liczby z arkusza (np. 49.900000000000006) zaokrąglamy do 8 miejsc po przecinku.
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

/**
 * Czy tekst kwoty jest niejednoznaczny: jeden separator i dokładnie trzy cyfry po nim („1,234”, „1.234”).
 * Może to być 1234 zł z separatorem tysięcy albo 1,234 zł, więc takiej kwoty nie zgadujemy.
 * Liczby (np. komórki liczbowe arkusza) i zapisy z dwoma separatorami („1.234,50”) są jednoznaczne.
 */
export function niejednoznacznaKwota(wartosc) {
  if (typeof wartosc !== 'string') return false;
  const t = wartosc.trim().replace(/[\s  ]/g, '').replace(/(zł|pln)$/i, '').replace(/^[+\-−]/, '');
  return /^[1-9]\d{0,2}[.,]\d{3}$/.test(t);
}

/** Komunikat dla niejednoznacznej kwoty, np. „1,234”: podaje oba możliwe odczyty. */
export function opisNiejednoznacznejKwoty(wartosc) {
  const t = String(wartosc).trim();
  const [calosc, ulamek] = t.replace(/[\s  ]/g, '').replace(/(zł|pln)$/i, '').split(/[.,]/);
  return `kwota ${t} jest niejednoznaczna: wpisz ${calosc}${ulamek} (bez separatora tysięcy) albo ${calosc},${ulamek.slice(0, 2)}`;
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

/**
 * Narastająca suma kwartału dzień po dniu: [{ data, dzienGr, sumaGr }] (tylko dni z wpisami z kwotą PLN).
 * dzis (opcjonalnie): pomija sprzedaż z datą późniejszą, czyli zaplanowaną, której jeszcze nie było.
 */
export function przebiegKwartalu(wpisy, rok, q, dzis = null) {
  const { od, doDnia } = granicaKwartalu(rok, q);
  const dni = new Map();
  for (const w of wpisy) {
    if (w.data < od || w.data > doDnia || (dzis && w.data > dzis)) continue;
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

/**
 * Status kwartału z uwzględnieniem faktu przekroczenia. Przekroczenie się nie cofa (art. 5 ust. 3 ustawy Prawo
 * przedsiębiorców: działalność staje się gospodarczą od dnia przekroczenia): gdy suma narastająco przekroczyła limit
 * dnia D, kwartał do końca ma stan „przekroczony od D”, także gdy późniejsze zwroty obniżą sumę poniżej limitu.
 */
export function statusKwartalu(sumaGr, limitGr, przekroczenie = null) {
  const s = statusLimitu(sumaGr, limitGr);
  return przekroczenie ? { ...s, przekroczony: true, przekroczonyOd: przekroczenie.data } : s;
}

/** Kwota progu w groszach (np. 70% limitu), zaokrąglona połówkowo. */
export function kwotaProgu(limitGr, prog) {
  const { v, s } = parsujDziesietna(prog);
  return dzielZaokr(limitGr * v, 10n ** BigInt(s));
}

/**
 * Historia kwartałów: wszystkie kwartały z wpisami, od najnowszego.
 * [{ rok, q, klucz, sumaGr, liczba, bezKursu, zaplanowaneGr, zaplanowane, limitGr, status, przekroczenie: { data, termin } | null,
 *    statusZPlanem, wolneGr, prognozaPrzekroczenia: { data, termin, prognoza: true } | null, przyszly, ostrzezenia }]
 * Status po przekroczeniu zostaje „przekroczony” (statusKwartalu), nawet gdy zwroty obniżą sumę poniżej limitu.
 * przyszly: kwartał zaczyna się po dziś (cała jego sprzedaż jest zaplanowana). ostrzezenia: ostrzeżenia o zwrotach
 * z datą w tym kwartale (ostrzezeniaZwrotow). Suma kwartału może być ujemna (same zwroty), ale procent nie spada poniżej 0,
 * a nadwyżka zwrotów nie przechodzi do innych kwartałów.
 * dzis (opcjonalnie): sprzedaż z późniejszą datą nie wchodzi do sumy, stanu ani daty przekroczenia,
 * tylko do zaplanowaneGr i zaplanowane (liczba wpisów). Bez dzis liczy wszystkie wpisy, jak arkusz.
 * Z planem (prognoza): statusZPlanem (sprzedaż do dziś i zaplanowana), wolneGr (limit minus jedno i drugie, co najmniej 0)
 * i prognozaPrzekroczenia, gdy limit przekroczy dopiero zaplanowana sprzedaż.
 */
export function historiaKwartalow(wpisy, dzis = null) {
  const grupy = new Map();
  for (const w of wpisy) {
    const { rok, q } = kwartal(w.data);
    const k = kluczKwartalu(rok, q);
    if (!grupy.has(k)) grupy.set(k, { rok, q, klucz: k, sumaGr: 0n, liczba: 0, bezKursu: 0, zaplanowaneGr: 0n, zaplanowane: 0 });
    const g = grupy.get(k);
    g.liczba += 1;
    const gr = kwotaPlnGr(w);
    if (dzis && w.data > dzis) {
      g.zaplanowane += 1;
      if (gr !== null) g.zaplanowaneGr += gr;
    } else if (gr === null) g.bezKursu += 1; else g.sumaGr += gr;
  }
  const ostrzezenia = ostrzezeniaZwrotow(wpisy, dzis);
  return [...grupy.values()]
    .sort((a, b) => (b.rok - a.rok) || (b.q - a.q))
    .map((g) => {
      const limitGr = limitLubNull(g.rok);
      let przekroczenie = null;
      if (limitGr !== null) {
        const data = dzienOsiagnieciaProgu(przebiegKwartalu(wpisy, g.rok, g.q, dzis), limitGr, 'przekroczenie');
        if (data) przekroczenie = { data, termin: dodajDni(data, DNI_NA_WNIOSEK_CEIDG) };
      }
      const status = limitGr === null ? null : statusKwartalu(g.sumaGr, limitGr, przekroczenie);
      const statusZPlanem = limitGr === null ? null : statusKwartalu(g.sumaGr + g.zaplanowaneGr, limitGr, przekroczenie);
      const wolne = limitGr === null ? null : limitGr - g.sumaGr - g.zaplanowaneGr;
      const wolneGr = wolne === null ? null : (wolne > 0n ? wolne : 0n);
      let prognozaPrzekroczenia = null;
      if (limitGr !== null && !przekroczenie && g.zaplanowane) {
        const data = dzienOsiagnieciaProgu(przebiegKwartalu(wpisy, g.rok, g.q), limitGr, 'przekroczenie');
        if (data) prognozaPrzekroczenia = { data, termin: dodajDni(data, DNI_NA_WNIOSEK_CEIDG), prognoza: true };
      }
      const przyszly = Boolean(dzis) && granicaKwartalu(g.rok, g.q).od > dzis;
      return {
        ...g, limitGr, status, przekroczenie, statusZPlanem, wolneGr, prognozaPrzekroczenia, przyszly,
        ostrzezenia: ostrzezenia.filter((o) => o.rok === g.rok && o.q === g.q),
      };
    });
}

// ------------------------------------------------------------ zwroty

/**
 * Ostrzeżenia o zwrotach, przy których wynik zależy od wyboru kwartału. Zwrot liczymy w kwartale jego daty (daty dokumentu
 * korekty, por. art. 14 ust. 1m ustawy o PIT), ale przepisy o limicie tego nie rozstrzygają. Ostrzegamy, gdy:
 * - bez tego zwrotu limit jego kwartału byłby przekroczony (albo przekroczony wcześniej), przyczyna 'limit';
 * - zwrot oznaczono jako dotyczący sprzedaży z wcześniejszego kwartału (pole dotyczy), przyczyna 'inny-kwartal'.
 * Niczego nie przeliczamy wstecz. dzis (opcjonalnie): zwroty z późniejszą datą (zaplanowane) pomijamy.
 * [{ id, data, rok, q, przyczyna, bezZwrotuPrzekroczenie: 'RRRR-MM-DD' | null, dotyczy: 'RRRR-MM-DD' | '' }]
 */
export function ostrzezeniaZwrotow(wpisy, dzis = null) {
  const wynik = [];
  for (const z of wpisy) {
    const gr = kwotaPlnGr(z);
    if (gr === null || gr >= 0n || (dzis && z.data > dzis)) continue;
    const { rok, q } = kwartal(z.data);
    const limitGr = limitLubNull(rok);
    let bezZwrotuPrzekroczenie = null;
    if (limitGr !== null) {
      const zNim = dzienOsiagnieciaProgu(przebiegKwartalu(wpisy, rok, q, dzis), limitGr, 'przekroczenie');
      const bezNiego = dzienOsiagnieciaProgu(przebiegKwartalu(wpisy.filter((x) => x !== z), rok, q, dzis), limitGr, 'przekroczenie');
      if (bezNiego && (!zNim || bezNiego < zNim)) bezZwrotuPrzekroczenie = bezNiego;
    }
    const dotyczy = z.dotyczy && poprawnaData(z.dotyczy) ? z.dotyczy : '';
    const kwDotyczy = dotyczy ? kwartal(dotyczy) : null;
    const innyKwartal = Boolean(kwDotyczy) && (kwDotyczy.rok < rok || (kwDotyczy.rok === rok && kwDotyczy.q < q));
    if (!innyKwartal && !bezZwrotuPrzekroczenie) continue;
    wynik.push({ id: z.id, data: z.data, rok, q, przyczyna: innyKwartal ? 'inny-kwartal' : 'limit', bezZwrotuPrzekroczenie, dotyczy });
  }
  return wynik;
}

const dataPl = (d) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;

/** Treść ostrzeżenia o zwrocie (ostrzezeniaZwrotow). Zdanie o limicie tylko wtedy, gdy bez zwrotu byłby przekroczony. */
export function opisOstrzezeniaZwrotu(o) {
  const limit = o.bezZwrotuPrzekroczenie ? ` Bez niego limit byłby przekroczony dnia ${dataPl(o.bezZwrotuPrzekroczenie)}.` : '';
  return `Przepisy nie rozstrzygają, do którego kwartału należy ten zwrot.${limit} Skonsultuj to z doradcą podatkowym.`;
}

// ------------------------------------------------------------ prognoza

/**
 * Prognoza dla kwartału, w którym jest `dzis`.
 * Stan (suma, zapas, status, dni osiągnięcia progów) liczymy tylko ze sprzedaży do dziś włącznie.
 * Prognoza: średnia dzienna sprzedaż od początku kwartału do dziś × kolejne dni. Sprzedaż z datą po dziś
 * (zaplanowana) wchodzi tylko do prognozy: w danym dniu prognozowana suma to sprzedaż do dziś plus większa
 * z dwóch kwot: wynik tempa albo zaplanowana sprzedaż do tego dnia. Tak tej samej sprzedaży nie liczymy dwa razy.
 * Zwraca null, gdy brak limitu dla roku.
 */
export function prognoza(wpisy, dzis) {
  const { rok, q } = kwartal(dzis);
  const limitGr = limitLubNull(rok);
  if (limitGr === null) return null;
  const { od, doDnia } = granicaKwartalu(rok, q);
  const przebieg = przebiegKwartalu(wpisy, rok, q, dzis);
  const sumaGr = przebieg.length ? przebieg[przebieg.length - 1].sumaGr : 0n;
  const dniMinelo = roznicaDni(od, dzis) + 1;
  const dniZostalo = roznicaDni(dzis, doDnia); // pełne dni po dzisiejszym
  const wKwartale = wpisy.filter((w) => w.data >= od && w.data <= doDnia);
  const liczbaWpisow = wKwartale.filter((w) => w.data <= dzis).length;
  // Sprzedaż w walucie bez kursu nie ma kwoty w PLN: nie wchodzi do sumy, więc suma może być zaniżona.
  const bezKursu = wKwartale.filter((w) => w.data <= dzis && kwotaPlnGr(w) === null).length;
  const zaplanowane = posortuj(wKwartale.filter((w) => w.data > dzis));
  const zaplanowaneGr = zaplanowane.reduce((s, w) => s + (kwotaPlnGr(w) ?? 0n), 0n);
  const zapasGr = limitGr - sumaGr;
  const tempo = sumaGr > 0n ? sumaGr : 0n; // tempo / dniMinelo na dzień
  const D = BigInt(dniMinelo);

  // Prognozowana suma k dni po dziś, pomnożona przez dniMinelo (bez dzielenia, więc bez zaokrągleń).
  const sumaPoDniach = (k) => {
    const data = dodajDni(dzis, k);
    const planGr = zaplanowane.reduce((s, w) => (w.data <= data ? s + (kwotaPlnGr(w) ?? 0n) : s), 0n);
    const zTempa = tempo * BigInt(k);
    const zPlanu = planGr * D;
    return sumaGr * D + (zTempa > zPlanu ? zTempa : zPlanu);
  };
  // Pierwszy dzień po dziś, w którym prognozowana suma osiągnie próg (null, gdy nie w tym kwartale).
  const dzienProgu = (prog) => {
    for (let k = 1; k <= dniZostalo; k += 1) {
      const suma = sumaPoDniach(k);
      if (prog === 'przekroczenie' ? suma > limitGr * D : osiagniety(suma, limitGr * D, prog)) return dodajDni(dzis, k);
    }
    return null;
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
  // Sama sprzedaż do dziś i zaplanowana (bez tempa): kiedy przekroczy limit i ile zostaje po niej.
  const dzienPlanu = zaplanowane.length ? dzienOsiagnieciaProgu(przebiegKwartalu(wpisy, rok, q), limitGr, 'przekroczenie') : null;
  const fakt = progi.find((p) => p.prog === 'przekroczenie').osiagnietyDnia;
  const faktPrzekroczenia = fakt ? { data: fakt } : null;
  const planPrzekroczenie = !fakt && dzienPlanu
    ? { data: dzienPlanu, termin: dodajDni(dzienPlanu, DNI_NA_WNIOSEK_CEIDG), prognoza: true } : null;
  const wolne = zapasGr - zaplanowaneGr;
  const wolneGr = wolne > 0n ? wolne : 0n;
  const naKoniecZTempa = (tempo * BigInt(dniZostalo)) / D;
  const sumaNaKoniecGr = sumaGr + (naKoniecZTempa > zaplanowaneGr ? naKoniecZTempa : zaplanowaneGr);
  const przekr = progi.find((p) => p.prog === 'przekroczenie');
  const wynik = {
    rok, q, od, doDnia, limitGr, sumaGr, zapasGr, wolneGr, dniMinelo, dniZostalo, liczbaWpisow, bezKursu,
    zaplanowaneGr, liczbaZaplanowanych: zaplanowane.length, planPrzekroczenie,
    // Po przekroczeniu stan zostaje „przekroczony”, także gdy zwroty obniżą sumę (statusKwartalu).
    status: statusKwartalu(sumaGr, limitGr, faktPrzekroczenia),
    tempoDzienneGr: dzielZaokr(tempo, D),
    sumaNaKoniecGr,
    statusNaKoniec: statusKwartalu(sumaNaKoniecGr, limitGr, faktPrzekroczenia),
    // Ile średnio dziennie można jeszcze sprzedać, żeby zmieścić się w limicie razem ze sprzedażą zaplanowaną.
    budzetDziennyGr: wolneGr / BigInt(dniZostalo + 1),
    progi,
    przekroczenie: przekr.osiagnietyDnia
      ? { data: przekr.osiagnietyDnia, termin: dodajDni(przekr.osiagnietyDnia, DNI_NA_WNIOSEK_CEIDG), prognoza: false }
      : (przekr.prognozaDnia ? { data: przekr.prognozaDnia, termin: dodajDni(przekr.prognozaDnia, DNI_NA_WNIOSEK_CEIDG), prognoza: true } : null),
    pewnosc: dniMinelo < 14 || liczbaWpisow < 3 ? 'mala' : 'zwykla',
    ostrzezenia: ostrzezeniaZwrotow(wpisy, dzis).filter((o) => o.rok === rok && o.q === q),
  };
  // Przyczyna prognozowanego przekroczenia: sama zaplanowana sprzedaż ('plan') albo obecne tempo ('tempo').
  if (wynik.przekroczenie?.prognoza) {
    wynik.przyczynaPrzekroczenia = planPrzekroczenie && planPrzekroczenie.data === wynik.przekroczenie.data ? 'plan' : 'tempo';
  } else wynik.przyczynaPrzekroczenia = null;
  return wynik;
}

/**
 * Wpisy z pamięci przeglądarki połączone z wpisami, które były tylko na stronie (np. przy wyłączonej pamięci):
 * najpierw zapisane, potem lokalne o innym id. Żaden wpis nie znika i żaden się nie dubluje.
 * Ten sam id w obu listach: wygrywa wersja zmieniona później (pole zmieniono). Gdy znaczników brak albo są równe,
 * zostaje wersja z pamięci przeglądarki.
 */
export function polaczWpisy(zapisane, lokalne) {
  const lokalnePoId = new Map(lokalne.map((w) => [w.id, w]));
  const ids = new Set(zapisane.map((w) => w.id));
  const wybierz = (z) => {
    const l = lokalnePoId.get(z.id);
    return l && (l.zmieniono ?? '') > (z.zmieniono ?? '') ? l : z;
  };
  return [...zapisane.map(wybierz), ...lokalne.filter((w) => !ids.has(w.id))];
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
 * Wartości kolumn F–I arkusza dla posortowanych wpisów (eksport CSV i XLSX):
 * F kwota w PLN albo „brak kursu”, G suma kwartału do tej daty włącznie, H ułamek limitu (nie mniej niż 0, jak procent
 * na ekranie), I ostrzeżenie. Przekroczenie się nie cofa (statusKwartalu): gdy suma kwartału do którejś wcześniejszej
 * daty przekroczyła limit, I = „Limit przekroczony” do końca kwartału, także gdy zwroty obniżą sumę.
 */
export function wartosciArkusza(posortowane) {
  const pln = posortowane.map(kwotaPlnGr);
  const sumy = posortowane.map((w, i) => {
    if (pln[i] === null) return null;
    const { rok, q } = kwartal(w.data);
    const { od } = granicaKwartalu(rok, q);
    let G = 0n;
    posortowane.forEach((x, j) => { if (pln[j] !== null && x.data >= od && x.data <= w.data) G += pln[j]; });
    return { od, rok, G };
  });
  return posortowane.map((w, i) => {
    if (sumy[i] === null) return { F: 'brak kursu', G: '', H: '', I: 'Wpisz kurs NBP w kolumnie E' };
    const { od, rok, G } = sumy[i];
    const limitGr = PLACA_MINIMALNA[rok] === undefined ? null : limitDlaRoku(rok);
    if (limitGr === null) return { F: pln[i], G, H: 'brak limitu', I: 'Wpisz płacę minimalną na ten rok w zakładce Limity' };
    const przekroczonyWczesniej = sumy.some((s, j) => s !== null && s.od === od && posortowane[j].data <= w.data && s.G > limitGr);
    return { F: pln[i], G, H: G > 0n ? Number(G) / Number(limitGr) : 0, I: przekroczonyWczesniej ? 'Limit przekroczony' : drabinka(G, limitGr) };
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
export function odczytajDate(wartosc, system1904 = false) {
  if (typeof wartosc === 'number') return dataZSeryjnej(wartosc, system1904);
  const t = String(wartosc ?? '').trim();
  let r; let m; let d;
  let x = RE_ISO.exec(t);
  if (x) [r, m, d] = [x[1], x[2], x[3]];
  else if ((x = RE_PL.exec(t))) [r, m, d] = [x[3], x[2], x[1]];
  else if (/^\d{5}(\.\d+)?$/.test(t)) return dataZSeryjnej(Number(t), system1904);
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
 * Kolumna „Zwrot dotyczy sprzedaży z dnia” (od wersji 0.4.4 kolumna J) jest nieobowiązkowa: pliki bez niej
 * (wcześniejsze eksporty, inne programy) wczytują się jak dotąd, a wpisy nie mają pola dotyczy.
 * Opcja system1904: numery seryjne dat w kolumnie „dotyczy” liczone od 1904 (XLSX, który tak deklaruje).
 * Zwraca { wpisy, bledy: [{ wiersz, powod }] }; numer wiersza jak w arkuszu (od 1).
 */
export function wierszeNaWpisy(wiersze, { pierwszyNumer = 1, system1904 = false } = {}) {
  let kol = { data: 0, opis: 1, kwota: 2, waluta: 3, kurs: 4, dotyczy: -1 };
  let start = 0;
  for (let i = 0; i < Math.min(wiersze.length, 30); i += 1) {
    const h = (wiersze[i] ?? []).map(norm);
    const iData = h.indexOf('data');
    const iKwota = h.findIndex((x) => x === 'kwota' || x === 'kwota sprzedaży');
    if (iData >= 0 && iKwota >= 0) {
      const znajdz = (...nazwy) => h.findIndex((x) => nazwy.includes(x));
      kol = { data: iData, opis: znajdz('opis'), kwota: iKwota, waluta: znajdz('waluta'), kurs: znajdz('kurs nbp', 'kurs'),
        dotyczy: h.findIndex((x) => (x ?? '').startsWith('zwrot dotyczy') || x === 'dotyczy') };
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
    if (niejednoznacznaKwota(surowaKwota)) { bledy.push({ wiersz: numer, powod: opisNiejednoznacznejKwoty(surowaKwota) }); continue; }
    // Data, której dotyczy zwrot: nieczytelną przekazujemy dalej, żeby normalizujWpis zgłosił błąd wiersza.
    const surowaDotyczy = komorka(kol.dotyczy);
    const dotyczy = String(surowaDotyczy).trim() === '' ? '' : (odczytajDate(surowaDotyczy, system1904) ?? String(surowaDotyczy));
    try {
      wpisy.push(normalizujWpis({
        id: `i${wpisy.length + 1}`, data, opis, kwota: surowaKwota, waluta: String(komorka(kol.waluta)) || 'PLN', kurs: komorka(kol.kurs),
        dotyczy,
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

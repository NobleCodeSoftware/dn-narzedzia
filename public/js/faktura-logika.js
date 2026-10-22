// Faktura bez VAT (zwolnienie) dla sprzedawcy zwolnionego z VAT, np. w działalności nierejestrowanej.
// Czysty moduł ES bez DOM (testy: node:test). Kwoty liczymy w groszach na BigInt.
//
// Źródła (sprawdzone 22.10.2026 u źródła):
// - ustawa o VAT, t.j. Dz.U. 2026 poz. 1263 (api.sejm.gov.pl, ELI DU/2026/1263):
//   art. 106b ust. 2 i ust. 3 pkt 2 (zwolniony z art. 113 wystawia fakturę na żądanie nabywcy zgłoszone w ciągu 3 miesięcy
//   od końca miesiąca sprzedaży), art. 106e ust. 1 (elementy faktury), ust. 1 pkt 19 (podstawa zwolnienia),
//   ust. 4 pkt 3 (bez stawki, sumy według stawek i kwoty podatku), ust. 11 (zaokrąglenie do grosza),
//   art. 106ga ust. 1 i ust. 2 pkt 4 (KSeF; poza obowiązkiem faktury dla osób fizycznych nieprowadzących działalności),
//   art. 106i ust. 1, 6 i 7 (terminy), art. 113 ust. 1 i 9 (zwolnienie podmiotowe),
//   art. 145l (do 31.03.2026 poza KSeF), art. 145m (od 1.04 do 31.12.2026 poza KSeF, gdy faktury wystawione w miesiącu
//   ≤ 10 000 zł brutto; prawo traci się od faktury, którą przekroczono kwotę);
// - ksef.podatki.gov.pl „Poniżej 10 000 zł” (FAQ, zmodyfikowano 20.11.2025): do limitu tylko faktury, które obowiązkowo
//   idą do KSeF (nie konsumenckie), miesiąc według daty wystawienia, po przekroczeniu także wszystkie kolejne faktury w KSeF;
// - ksef.podatki.gov.pl „Konsumenci i osoby fizyczne” (FAQ, zmodyfikowano 30.10.2025): faktury B2C w KSeF dobrowolnie;
// - biznes.gov.pl „Działalność nierejestrowana” (biznes.gov.pl/pl/portal/00115): fakturę na żądanie klienta; faktura w KSeF
//   wymaga NIP wystawcy. Adres sprzedawcy jest obowiązkowy, bo wymaga go art. 106e ust. 1 pkt 3 ustawy o VAT (przy
//   sprzeczności ze wskazówką biznes.gov.pl przyjmujemy brzmienie ustawy).
// - art. 28b (miejsce świadczenia usług dla podatnika): sprzedaż dla firmy z zagranicy nie jest sprzedażą zwolnioną z art. 113,
//   a faktura wymaga innych oznaczeń (art. 106e ust. 1 pkt 18 i 24), więc przyjmujemy tylko polski NIP nabywcy.

import { BladDanych, parsujDziesietna, poprawnaData, dodajDni, formatujZl, groszeNaTekst, naGrosze } from './logic.js';
import { kolejnyNumer, MAX_OPIS } from './ewidencja-logika.js';

export const LIMIT_POZA_KSEF_GR = 1_000_000n; // 10 000,00 zł brutto w miesiącu (art. 145m ust. 1)
export const KSEF_LIMIT_OD = '2026-04-01'; // wcześniej poza KSeF bez limitu (art. 145l)
export const KSEF_LIMIT_DO = '2026-12-31'; // ostatni dzień wyjątku z art. 145m
export const MAX_POZYCJI = 10;
export const MAX_KWOTA_GR = 99_999_999_999n; // 999 999 999,99 zł
const USTAWA = 'ustawy z dnia 11 marca 2004 r. o podatku od towarów i usług';
export const PODSTAWY = {
  'art113-1': `art. 113 ust. 1 ${USTAWA}`,
  'art113-9': `art. 113 ust. 9 ${USTAWA}`,
};

/** Błąd danych z nazwą pola, które trzeba poprawić (widok ustawia na nim fokus). */
export class BladPola extends BladDanych {
  constructor(pole, komunikat) { super(komunikat); this.pole = pole; }
}

// ------------------------------------------------------------ pomocnicze

function dzielZaokr(licznik, mianownik) {
  const ujemny = licznik < 0n;
  const a = ujemny ? -licznik : licznik;
  let q = a / mianownik;
  if ((a % mianownik) * 2n >= mianownik) q += 1n;
  return ujemny ? -q : q;
}

const tekst = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/** 2026-10-21 → 21.10.2026 */
export const dataPl = (d) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : '');

/** Ostatni dzień miesiąca dla daty 'RRRR-MM-DD'. */
export function koniecMiesiaca(data) {
  const r = Number(data.slice(0, 4));
  const m = Number(data.slice(5, 7));
  return new Date(Date.UTC(r, m, 0)).toISOString().slice(0, 10);
}

/** Ostatni dzień miesiąca przesuniętego o n miesięcy. */
function koniecMiesiacaPo(data, n) {
  const r = Number(data.slice(0, 4));
  const m = Number(data.slice(5, 7));
  return new Date(Date.UTC(r, m + n, 0)).toISOString().slice(0, 10);
}

const MIESIACE_MIEJSCOWNIK = ['styczniu', 'lutym', 'marcu', 'kwietniu', 'maju', 'czerwcu', 'lipcu', 'sierpniu', 'wrześniu',
  'październiku', 'listopadzie', 'grudniu'];
const MIESIACE_DOPELNIACZ = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września',
  'października', 'listopada', 'grudnia'];
/** '2026-10' → 'października 2026 r.' */
export const miesiacDopelniacz = (rrrrMm) => `${MIESIACE_DOPELNIACZ[Number(rrrrMm.slice(5, 7)) - 1]} ${rrrrMm.slice(0, 4)}\u00a0r.`;

/** '2026-10' → 'w październiku 2026' */
export const wMiesiacu = (rrrrMm) => `w ${MIESIACE_MIEJSCOWNIK[Number(rrrrMm.slice(5, 7)) - 1]} ${rrrrMm.slice(0, 4)}`;

/** Kwota bez „zł” do tabeli: „1 234,50”. */
export const kwotaBezZl = (gr) => formatujZl(gr).replace(/\s*zł$/, '');

// ------------------------------------------------------------ NIP

const WAGI_NIP = [6, 5, 7, 2, 3, 4, 5, 6, 7];
export const BLAD_ZAGRANICZNY = 'Faktury dla firmy z zagranicy tu nie przygotujesz: taka usługa zwykle nie jest sprzedażą zwolnioną z art. 113, a faktura wymaga innych oznaczeń (art. 28b i art. 106e ust. 1 pkt 18 i 24 ustawy o VAT).';

/**
 * Sprawdza numer identyfikacji podatkowej.
 * { stan: 'pusto' } · { stan: 'ok', nip: '1234563218' } · { stan: 'zagraniczny', nip: 'DE123456789' } · { stan: 'blad', blad }
 * Polski NIP: 10 cyfr z sumą kontrolną (wagi 6,5,7,2,3,4,5,6,7, reszta z dzielenia przez 11), może mieć prefiks PL i kreski.
 * Numer z innym dwuliterowym prefiksem kraju przyjmujemy bez sprawdzania sumy (np. nabywca z UE).
 */
export function sprawdzNip(wartosc, { zagraniczny = true } = {}) {
  const t = String(wartosc ?? '').toUpperCase().replace(/[\s\-.]/g, '');
  if (t === '') return { stan: 'pusto' };
  const kraj = /^([A-Z]{2})([0-9A-Z+*]{2,13})$/.exec(t);
  if (kraj && kraj[1] !== 'PL') {
    return zagraniczny ? { stan: 'zagraniczny', nip: t } : { stan: 'blad', blad: BLAD_ZAGRANICZNY };
  }
  const cyfry = t.replace(/^PL/, '');
  if (!/^\d{10}$/.test(cyfry)) return { stan: 'blad', blad: 'NIP to 10 cyfr, np. 123-456-32-18.' };
  if (/^0+$/.test(cyfry)) return { stan: 'blad', blad: 'NIP nie może składać się z samych zer.' };
  const suma = WAGI_NIP.reduce((s, w, i) => s + w * Number(cyfry[i]), 0) % 11;
  if (suma === 10 || suma !== Number(cyfry[9])) return { stan: 'blad', blad: 'Ten NIP ma błędną cyfrę kontrolną. Sprawdź, czy nie ma literówki.' };
  return { stan: 'ok', nip: cyfry };
}

// ------------------------------------------------------------ PESEL i identyfikator sprzedawcy

const WAGI_PESEL = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3];

/** PESEL: 11 cyfr, cyfra kontrolna (wagi 1-3-7-9) i poprawna data urodzenia (miesiąc z przesunięciem stulecia). */
export function poprawnyPesel(t) {
  if (!/^\d{11}$/.test(t)) return false;
  const suma = WAGI_PESEL.reduce((s, w, i) => s + w * Number(t[i]), 0);
  if ((10 - (suma % 10)) % 10 !== Number(t[10])) return false;
  let m = Number(t.slice(2, 4));
  const stulecie = [[80, 1800], [60, 2200], [40, 2100], [20, 2000], [0, 1900]].find(([od]) => m > od);
  if (!stulecie) return false;
  m -= stulecie[0];
  const rok = stulecie[1] + Number(t.slice(0, 2));
  return poprawnaData(`${rok}-${String(m).padStart(2, '0')}-${t.slice(4, 6)}`);
}

/**
 * Identyfikator podatkowy sprzedawcy (art. 106e ust. 1 pkt 4 ustawy o VAT): NIP albo PESEL.
 * W działalności nierejestrowanej identyfikatorem jest PESEL, a NIP, gdy osoba jest zarejestrowanym podatnikiem VAT albo
 * ma kasę rejestrującą (ustawa o zasadach ewidencji i identyfikacji podatników i płatników, t.j. Dz.U. 2026 poz. 151,
 * art. 3 ust. 1 pkt 1 lit. b i ust. 1a).
 * { stan: 'pusto' } · { stan: 'ok', rodzajId: 'NIP' | 'PESEL', id } · { stan: 'blad', blad }
 */
export function sprawdzIdSprzedawcy(wartosc) {
  const t = String(wartosc ?? '').toUpperCase().replace(/[\s\-.]/g, '');
  if (t === '') return { stan: 'pusto' };
  if (/^\d{11}$/.test(t)) {
    return poprawnyPesel(t) ? { stan: 'ok', rodzajId: 'PESEL', id: t } : { stan: 'blad', blad: 'Ten PESEL jest niepoprawny (cyfra kontrolna albo data). Sprawdź, czy nie ma literówki.' };
  }
  const n = sprawdzNip(t, { zagraniczny: false });
  if (n.stan === 'ok') return { stan: 'ok', rodzajId: 'NIP', id: n.nip };
  return { stan: 'blad', blad: /^(PL)?\d{10}$/.test(t) ? n.blad : 'Wpisz NIP (10 cyfr) albo PESEL (11 cyfr).' };
}

/** 1234563218 → 123-456-32-18 */
export const nipZKreskami = (nip) => (/^\d{10}$/.test(nip) ? `${nip.slice(0, 3)}-${nip.slice(3, 6)}-${nip.slice(6, 8)}-${nip.slice(8)}` : nip);

// ------------------------------------------------------------ kwoty

/** Wartość pozycji: ilość × cena jednostkowa, zaokrąglona do grosza (art. 106e ust. 11: od 0,5 grosza w górę). */
export function wartoscPozycjiGr(ilosc, cena) {
  const i = parsujDziesietna(ilosc, 'ilość');
  const c = parsujDziesietna(cena, 'cena');
  const skala = i.s + c.s;
  const iloczyn = i.v * c.v;
  return skala >= 2 ? dzielZaokr(iloczyn, 10n ** BigInt(skala - 2)) : iloczyn * 10n ** BigInt(2 - skala);
}

/** Tekst liczby wpisanej przez użytkownika („1 234,5”, „2”) → „1234.5”; null, gdy to nie liczba. */
function liczbaZPola(v) {
  const t = String(v ?? '').trim().replace(/[\s ]/g, '').replace(/(zł|pln)$/i, '').replace(',', '.');
  return /^\d+(\.\d+)?$/.test(t) ? t : null;
}

// ------------------------------------------------------------ słownie

const JEDNOSCI = ['', 'jeden', 'dwa', 'trzy', 'cztery', 'pięć', 'sześć', 'siedem', 'osiem', 'dziewięć'];
const NASTKI = ['dziesięć', 'jedenaście', 'dwanaście', 'trzynaście', 'czternaście', 'piętnaście', 'szesnaście', 'siedemnaście',
  'osiemnaście', 'dziewiętnaście'];
const DZIESIATKI = ['', '', 'dwadzieścia', 'trzydzieści', 'czterdzieści', 'pięćdziesiąt', 'sześćdziesiąt', 'siedemdziesiąt',
  'osiemdziesiąt', 'dziewięćdziesiąt'];
const SETKI = ['', 'sto', 'dwieście', 'trzysta', 'czterysta', 'pięćset', 'sześćset', 'siedemset', 'osiemset', 'dziewięćset'];
const RZEDY = [['', '', ''], ['tysiąc', 'tysiące', 'tysięcy'], ['milion', 'miliony', 'milionów']];

/** Forma rzeczownika po liczebniku: 1 → [0], 2–4 (bez 12–14) → [1], reszta → [2]. */
export function forma(n, formy) {
  if (n === 1) return formy[0];
  const d = n % 10;
  const s = n % 100;
  return d >= 2 && d <= 4 && (s < 12 || s > 14) ? formy[1] : formy[2];
}

function trojka(n) {
  const s = Math.floor(n / 100);
  const r = n % 100;
  const slowa = [SETKI[s]];
  if (r >= 10 && r < 20) slowa.push(NASTKI[r - 10]);
  else slowa.push(DZIESIATKI[Math.floor(r / 10)], JEDNOSCI[r % 10]);
  return slowa.filter(Boolean).join(' ');
}

/** Kwota słownie: 250050n → „dwa tysiące pięćset złotych 50/100”. */
export function slownie(gr) {
  if (gr < 0n || gr > MAX_KWOTA_GR) throw new BladDanych('kwota poza zakresem');
  const zl = Number(gr / 100n);
  const grosze = String(gr % 100n).padStart(2, '0');
  if (zl === 0) return `zero złotych ${grosze}/100`;
  const czesci = [];
  let reszta = zl;
  for (let rzad = 0; reszta > 0; rzad += 1) {
    const t = reszta % 1000;
    reszta = Math.floor(reszta / 1000);
    if (t === 0) continue;
    if (rzad === 0) czesci.unshift(trojka(t));
    else if (t === 1) czesci.unshift(RZEDY[rzad][0]);
    else czesci.unshift(`${trojka(t)} ${forma(t, RZEDY[rzad])}`);
  }
  const zlote = forma(zl, ['złoty', 'złote', 'złotych']);
  // 1 000 zł, 1 000 000 zł: forma liczona od całej kwoty daje „złotych” (n % 10 === 0), jak trzeba.
  return `${czesci.join(' ')} ${zlote} ${grosze}/100`;
}

// ------------------------------------------------------------ terminy

/**
 * Terminy z ustawy o VAT dla faktury na żądanie (sprzedaż zwolniona z art. 113):
 * - żądanie w ciągu 3 miesięcy od końca miesiąca sprzedaży (art. 106b ust. 3);
 * - wystawienie do 15. dnia następnego miesiąca, gdy żądanie przyszło w miesiącu sprzedaży, a później do 15. dnia
 *   od żądania (art. 106i ust. 6);
 * - nie wcześniej niż 60 dni przed sprzedażą (art. 106i ust. 7).
 * Zwraca { zadanieDo, termin, przepis, poTerminieZadania } (termin null, gdy nie ma daty żądania po miesiącu sprzedaży).
 */
export function terminy(dataSprzedazy, dataZadania = '') {
  if (!poprawnaData(dataSprzedazy)) throw new BladDanych('Podaj datę sprzedaży.');
  const koniec = koniecMiesiaca(dataSprzedazy);
  const zadanieDo = koniecMiesiacaPo(dataSprzedazy, 3);
  const pietnastyNastepnego = dodajDni(koniec, 15);
  if (!poprawnaData(dataZadania) || dataZadania <= koniec) {
    return { zadanieDo, termin: pietnastyNastepnego, przepis: 'art. 106i ust. 6 pkt 1', poTerminieZadania: false, najwczesniej: dodajDni(dataSprzedazy, -60) };
  }
  return {
    zadanieDo,
    termin: dodajDni(dataZadania, 15),
    przepis: 'art. 106i ust. 6 pkt 2',
    poTerminieZadania: dataZadania > zadanieDo,
    najwczesniej: dodajDni(dataSprzedazy, -60),
  };
}

// ------------------------------------------------------------ faktura

/**
 * Normalizuje i sprawdza fakturę. Rzuca BladPola z nazwą pola dla użytkownika.
 * Wejście (wartości z formularza jako tekst):
 * { numer, dataWystawienia, dataSprzedazy, dataZadania, sprzedawca: { nazwa, adres, nip },
 *   nabywca: { rodzaj: 'firma'|'konsument', nazwa, adres, nip }, pozycje: [{ nazwa, ilosc, jm, cena }],
 *   podstawa: { kod, tekst }, platnosc }
 * Wynik: te same pola po normalizacji, a pozycje z { wartosc } i faktura z { suma } (tekst „1234.50”).
 * Opcja { dzis }: data wystawienia musi być równa dziś (art. 106e ust. 1 pkt 1). Reguła KSeF liczy się od daty wystawienia,
 * więc data wstecz omijałaby blokadę 2027, a data w przód limit miesięczny. Przy odczycie zapisanych faktur
 * dzis nie podajemy.
 */
export function normalizujFakture(f, { dzis = '' } = {}) {
  const dataWystawienia = String(f?.dataWystawienia ?? '').trim();
  if (!poprawnaData(dataWystawienia)) throw new BladPola('dataWystawienia', 'Podaj datę wystawienia faktury.');
  const dataSprzedazy = String(f?.dataSprzedazy ?? '').trim() || dataWystawienia;
  if (!poprawnaData(dataSprzedazy)) throw new BladPola('dataSprzedazy', 'Podaj datę sprzedaży.');
  if (dataWystawienia < dodajDni(dataSprzedazy, -60)) {
    throw new BladPola('dataWystawienia', 'Faktury nie wystawia się wcześniej niż 60 dni przed sprzedażą (art. 106i ust. 7 ustawy o VAT).');
  }
  const dataZadania = poprawnaData(String(f?.dataZadania ?? '').trim()) ? String(f.dataZadania).trim() : '';

  const rok = Number(dataWystawienia.slice(0, 4));
  const numer = String(f?.numer ?? '').replace(/\s+/g, '');
  const m = /^(\d{1,6})\/(\d{4})$/.exec(numer);
  if (!m || Number(m[1]) < 1) throw new BladPola('numer', `Numer ma postać kolejny numer/rok, np. 1/${rok}.`);
  if (Number(m[2]) !== rok) throw new BladPola('numer', `Rok w numerze (${m[2]}) różni się od roku wystawienia (${rok}).`);

  const sNazwa = tekst(f?.sprzedawca?.nazwa, 120);
  if (!sNazwa) throw new BladPola('sprzedawcaNazwa', 'Wpisz swoje imię i nazwisko (sprzedawca).');
  // Pole może przyjść jako id albo nip (zapis z wcześniejszej wersji strony).
  const sId = sprawdzIdSprzedawcy(f?.sprzedawca?.id ?? f?.sprzedawca?.nip);
  if (sId.stan === 'pusto') throw new BladPola('sprzedawcaId', 'Wpisz swój NIP albo PESEL (art. 106e ust. 1 pkt 4 ustawy o VAT).');
  if (sId.stan === 'blad') throw new BladPola('sprzedawcaId', `Twój NIP albo PESEL: ${sId.blad}`);
  const sAdres = tekst(f?.sprzedawca?.adres, 200);
  if (!sAdres) throw new BladPola('sprzedawcaAdres', 'Wpisz swój adres (art. 106e ust. 1 pkt 3 ustawy o VAT).');
  const sprzedawca = { nazwa: sNazwa, adres: sAdres, rodzajId: sId.rodzajId, id: sId.id };

  const rodzaj = f?.nabywca?.rodzaj === 'firma' ? 'firma' : f?.nabywca?.rodzaj === 'konsument' ? 'konsument' : '';
  if (!rodzaj) throw new BladPola('rodzaj', 'Wybierz, kto kupuje: osoba prywatna czy firma.');
  // Datą wystawienia jest dzień wystawienia (art. 106e ust. 1 pkt 1): ani wcześniej, ani później. Dla firmy data w przód
  // omijałaby limit miesięczny z art. 145m, a dla osoby prywatnej antydatowanie też nie jest dozwolone.
  if (dzis && dataWystawienia !== dzis) {
    throw new BladPola('dataWystawienia', 'Datą wystawienia jest dzień, w którym wystawiasz fakturę, czyli dziś (art. 106e ust. 1 pkt 1 ustawy o VAT).');
  }
  const nNazwa = tekst(f?.nabywca?.nazwa, 160);
  if (!nNazwa) throw new BladPola('nabywcaNazwa', rodzaj === 'firma' ? 'Wpisz nazwę firmy klienta.' : 'Wpisz imię i nazwisko klienta.');
  const nAdres = tekst(f?.nabywca?.adres, 200);
  if (!nAdres) throw new BladPola('nabywcaAdres', 'Wpisz adres klienta (art. 106e ust. 1 pkt 3 ustawy o VAT).');
  let nNip = '';
  if (rodzaj === 'firma') {
    const s = sprawdzNip(f?.nabywca?.nip, { zagraniczny: false });
    if (s.stan === 'pusto') throw new BladPola('nabywcaNip', 'Wpisz NIP firmy klienta.');
    if (s.stan === 'blad') throw new BladPola('nabywcaNip', `NIP klienta: ${s.blad}`);
    nNip = s.nip;
  }
  const nabywca = { rodzaj, nazwa: nNazwa, adres: nAdres, nip: nNip };

  const surowe = Array.isArray(f?.pozycje) ? f.pozycje : [];
  const niepuste = surowe.filter((p) => [p?.nazwa, p?.ilosc, p?.cena].some((x) => String(x ?? '').trim() !== ''));
  if (!niepuste.length) throw new BladPola('pozycja-0-nazwa', 'Wpisz, co sprzedajesz, i cenę.');
  if (niepuste.length > MAX_POZYCJI) throw new BladPola('pozycje', `Najwyżej ${MAX_POZYCJI} pozycji na fakturze.`);
  let sumaGr = 0n;
  const pozycje = niepuste.map((p) => {
    const i = surowe.indexOf(p);
    const nazwa = tekst(p.nazwa, MAX_OPIS);
    if (!nazwa) throw new BladPola(`pozycja-${i}-nazwa`, `Pozycja ${i + 1}: wpisz nazwę towaru lub usługi.`);
    const ilosc = liczbaZPola(String(p.ilosc ?? '').trim() || '1');
    if (ilosc === null || /^0*(\.0*)?$/.test(ilosc) || (ilosc.split('.')[1] ?? '').length > 4) {
      throw new BladPola(`pozycja-${i}-ilosc`, `Pozycja ${i + 1}: ilość to liczba większa od zera, np. 1 albo 2,5.`);
    }
    const cena = liczbaZPola(p.cena);
    if (cena === null || (cena.split('.')[1] ?? '').length > 2) {
      throw new BladPola(`pozycja-${i}-cena`, `Pozycja ${i + 1}: cena to kwota w złotych, np. 150 albo 49,90.`);
    }
    const wartoscGr = wartoscPozycjiGr(ilosc, cena);
    sumaGr += wartoscGr;
    return { nazwa, ilosc, jm: tekst(p.jm, 12) || 'szt.', cena, wartosc: groszeNaTekst(wartoscGr) };
  });
  if (sumaGr <= 0n) throw new BladPola('pozycja-0-cena', 'Kwota faktury musi być większa od zera.');
  if (sumaGr > MAX_KWOTA_GR) throw new BladPola('pozycja-0-cena', 'Kwota faktury jest za duża.');

  const kod = f?.podstawa?.kod === 'inna' || PODSTAWY[f?.podstawa?.kod] ? f.podstawa.kod : 'art113-1';
  const podstawaTekst = kod === 'inna' ? tekst(f?.podstawa?.tekst, 200) : PODSTAWY[kod];
  if (!podstawaTekst) throw new BladPola('podstawaTekst', 'Wpisz podstawę prawną zwolnienia, np. art. 43 ust. 1 pkt … ustawy o VAT.');

  return {
    numer, dataWystawienia, dataSprzedazy, dataZadania, sprzedawca, nabywca, pozycje,
    podstawa: { kod, tekst: podstawaTekst }, platnosc: tekst(f?.platnosc, 200), suma: groszeNaTekst(sumaGr),
  };
}

export const sumaGr = (faktura) => naGrosze(faktura.suma);

/** Proponowany numer: kolejny w roku wystawienia (numeracja ciągła w roku, od największego numeru). */
export function proponowanyNumer(faktury, dataWystawienia) {
  const rok = Number(String(dataWystawienia).slice(0, 4));
  return kolejnyNumer(faktury.map((f) => f.numer), rok);
}

/** Czy numer jest już zajęty (inna zapisana faktura). */
export const numerZajety = (faktury, numer) => faktury.some((f) => f.numer === numer);

/**
 * Luka w numeracji: numer ręczny większy niż kolejny wolny w roku (np. 7/2026 po 2/2026).
 * Zwraca oczekiwany numer albo null, gdy luki nie ma.
 */
export function lukaWNumeracji(faktury, numer) {
  const m = /^(\d+)\/(\d{4})$/.exec(String(numer).trim());
  if (!m) return null;
  const oczekiwany = kolejnyNumer(faktury.map((f) => f.numer), Number(m[2]));
  return Number(m[1]) > Number(oczekiwany.split('/')[0]) ? oczekiwany : null;
}

/** Usunąć można tylko ostatnią fakturę roku, żeby numeracja została ciągła. */
export function moznaUsunac(faktury, numer) {
  const m = /^(\d+)\/(\d{4})$/.exec(numer);
  if (!m) return false;
  return kolejnyNumer(faktury.map((f) => f.numer), Number(m[2])) === `${Number(m[1]) + 1}/${m[2]}`;
}

// ------------------------------------------------------------ KSeF

/** Suma brutto faktur dla firm z danego miesiąca (według daty wystawienia), z pominięciem faktury o numerze `pomin`. */
export function sumaFirmWMiesiacu(faktury, rrrrMm, pomin = '') {
  return faktury
    .filter((f) => f.nabywca?.rodzaj === 'firma' && String(f.dataWystawienia).startsWith(rrrrMm) && f.numer !== pomin)
    .reduce((s, f) => s + naGrosze(f.suma), 0n);
}

/** Czy w którymś miesiącu od kwietnia 2026 przed miesiącem `rrrrMm` faktury dla firm w narzędziu przekroczyły limit. */
export function przekroczonoWNarzedziu(faktury, rrrrMm, pomin = '') {
  const miesiace = new Set(faktury.filter((f) => f.nabywca?.rodzaj === 'firma').map((f) => String(f.dataWystawienia).slice(0, 7)));
  return [...miesiace].some((mm) => mm >= KSEF_LIMIT_OD.slice(0, 7) && mm < rrrrMm && sumaFirmWMiesiacu(faktury, mm, pomin) > LIMIT_POZA_KSEF_GR);
}

/**
 * Data, według której liczymy regułę KSeF dla faktury dla firmy: data z formularza, ale nie wcześniejsza niż dziś.
 * Datą wystawienia jest dzień wystawienia, więc cofnięcie daty w formularzu nie omija blokady 2027
 * ani nie wraca do miesiąca sprzed utraty prawa.
 */
export const dataReguly = (dataWystawienia, dzis) => (dzis && dzis > dataWystawienia ? dzis : dataWystawienia);

/** Miesiąc utraty prawa do faktur poza KSeF (art. 145m ust. 2): wcześniejszy z dwóch, null gdy brak. */
export function polaczUtrate(a, b) {
  const x = [a, b].filter((m) => /^\d{4}-\d{2}$/.test(String(m ?? '')));
  return x.length ? x.sort()[0] : null;
}

/**
 * Czy fakturę można wystawić poza KSeF (tu, w PDF), czy trzeba w KSeF.
 * Wejście: { dataWystawienia, dzis (dzisiejsza data w Warszawie; dla firmy reguła liczy się od niej, gdy data z formularza
 *   jest wcześniejsza), rodzaj, kwotaGr, faktury (zapisane), numer (tej faktury, pomijany w sumie),
 *   inneGr (faktury dla firm wystawione poza KSeF w tym miesiącu gdzie indziej), przekroczonoWczesniej (deklaracja użytkownika),
 *   utrataOd ('RRRR-MM' zapamiętany miesiąc utraty prawa) }.
 * Wynik: { stan: 'poza-ksef' | 'blokada', powod, miesiac, wczesniejGr, poGr, zapasGr, limitGr }.
 * Powody: 'konsument' (B2C poza obowiązkiem KSeF), 'przed-limitem' (data przed 1.04.2026), 'w-limicie',
 * 'limit' (ta faktura przekracza 10 000 zł), 'utrata' (limit przekroczony wcześniej w 2026), 'ksef-2027' (od 1.01.2027).
 */
export function regulaKsef({
  dataWystawienia, dzis = '', rodzaj, kwotaGr = 0n, faktury = [], numer = '', inneGr = 0n, przekroczonoWczesniej = false, utrataOd = null,
}) {
  const data = rodzaj === 'firma' ? dataReguly(String(dataWystawienia), dzis) : String(dataWystawienia);
  const miesiac = data.slice(0, 7);
  const baza = { miesiac, limitGr: LIMIT_POZA_KSEF_GR, wczesniejGr: 0n, poGr: 0n, zapasGr: LIMIT_POZA_KSEF_GR };
  if (rodzaj !== 'firma') return { ...baza, stan: 'poza-ksef', powod: 'konsument' };
  if (data > KSEF_LIMIT_DO) return { ...baza, stan: 'blokada', powod: 'ksef-2027' };
  if (data < KSEF_LIMIT_OD) return { ...baza, stan: 'poza-ksef', powod: 'przed-limitem' };
  if (utrataOd && miesiac >= utrataOd) return { ...baza, stan: 'blokada', powod: 'utrata' };
  const wczesniejGr = sumaFirmWMiesiacu(faktury, miesiac, numer) + (inneGr > 0n ? inneGr : 0n);
  const poGr = wczesniejGr + kwotaGr;
  const wynik = { ...baza, wczesniejGr, poGr, zapasGr: LIMIT_POZA_KSEF_GR - poGr };
  if (przekroczonoWczesniej || przekroczonoWNarzedziu(faktury, miesiac, numer) || wczesniejGr > LIMIT_POZA_KSEF_GR) {
    return { ...wynik, stan: 'blokada', powod: 'utrata' };
  }
  if (poGr > LIMIT_POZA_KSEF_GR) return { ...wynik, stan: 'blokada', powod: 'limit' };
  return { ...wynik, stan: 'poza-ksef', powod: 'w-limicie' };
}

/** Jedno-dwa zdania o stanie KSeF dla tej faktury (do ramki na stronie i do ogłoszenia). */
export function opisKsef(r) {
  const limit = formatujZl(r.limitGr);
  switch (r.powod) {
    case 'konsument': return 'Faktura dla osoby prywatnej może być poza KSeF, także od 2027 r. Do limitu 10 000 zł się nie wlicza.';
    case 'przed-limitem': return 'Do 31.03.2026 faktury mogły być poza KSeF bez limitu kwoty.';
    case 'w-limicie': return `Faktury dla firm poza KSeF ${wMiesiacu(r.miesiac)} z tą fakturą: ${formatujZl(r.poGr)} z ${limit}. Zostaje ${formatujZl(r.zapasGr)}.`;
    case 'limit': return `Ta faktura przekracza limit: faktury dla firm ${wMiesiacu(r.miesiac)} dałyby ${formatujZl(r.poGr)}, a poza KSeF wolno do ${limit}. Tę i każdą kolejną fakturę dla firmy w 2026 r. wystawiasz w KSeF.`;
    case 'utrata': return 'Limit 10 000 zł poza KSeF został już w 2026 r. przekroczony. Od tamtej faktury każdą fakturę dla firmy wystawiasz w KSeF.';
    case 'ksef-2027': return 'Od 1.01.2027 każdą fakturę dla firmy wystawiasz w KSeF. Tutaj jej nie wystawisz.';
    default: return '';
  }
}

/** Krótki stan KSeF dla firmy, pod wyborem „Kto kupuje”: o blokadzie użytkownik wie przed wypełnieniem formularza. */
export function skrotKsef(r) {
  switch (r.powod) {
    case 'przed-limitem': return 'Firma: do 31.03.2026 faktury poza KSeF bez limitu.';
    case 'w-limicie': return `Firma: ${wMiesiacu(r.miesiac)} ${formatujZl(r.poGr)} z ${formatujZl(r.limitGr)} poza KSeF.`;
    case 'limit': return `Firma: ${wMiesiacu(r.miesiac)} ponad ${formatujZl(r.limitGr)}, ta faktura tylko w KSeF.`;
    case 'utrata': return 'Firma: limit w 2026 r. już przekroczony, faktury tylko w KSeF.';
    case 'ksef-2027': return 'Firma: od 2027 r. faktury tylko w KSeF.';
    default: return '';
  }
}

// ------------------------------------------------------------ teksty okien (akapity po najwyżej 2 zdania)

const NBSP = '\u00a0';
export const KOMUNIKAT_PO_OKNIE_LIMITU = 'Sprawdź kwotę albo wystaw tę fakturę w KSeF.';
export const TEKSTY_OKIEN = {
  /** Faktura przekracza limit 10 000 zł (art. 145m ust. 2). */
  limit: (miesiac) => [
    `Gdy wystawisz ją w KSeF, każdą kolejną fakturę dla firmy do końca 2026${NBSP}r. też wystawiasz w KSeF. Zapamiętamy to od ${miesiacDopelniacz(miesiac)}`,
    'Pomyłkę cofniesz przyciskiem „To była pomyłka: cofnij” w części „Faktury dla firm wystawione gdzie indziej”.',
  ],
  /** Zaznaczenie „W 2026 r. już przekroczyłem limit”. */
  zaznacz: [
    `Od teraz każdą fakturę dla firmy do końca 2026${NBSP}r. wystawisz w KSeF, a tutaj tylko faktury dla osób prywatnych.`,
    'Pomyłkę cofniesz przyciskiem „To była pomyłka: cofnij”.',
  ],
  /** Cofnięcie zapamiętanej utraty prawa: tylko przy pomyłce (art. 145m). */
  cofnij: [
    `Zrób to tylko, jeśli zaznaczyłeś to przez pomyłkę, czyli w żadnym miesiącu od kwietnia 2026${NBSP}r. faktury dla firm nie przekroczyły razem 10${NBSP}000${NBSP}zł brutto.`,
    `Strona znów pozwoli wystawiać tu faktury dla firm do 10${NBSP}000${NBSP}zł w miesiącu, a za zgodność z przepisami odpowiadasz Ty.`,
  ],
};

// ------------------------------------------------------------ wydruk

const liczbaPl = (t) => String(t).replace('.', ',');

/**
 * Dane wydruku jako same teksty (bez null i undefined), w kolejności dokumentu.
 * Elementy według art. 106e ust. 1 pkt 1–3, 4 (jeśli jest NIP), 5 (NIP nabywcy-firmy), 6 (data sprzedaży, gdy inna),
 * 7–9, 11, 15 i 19; bez pkt 12–14 (art. 106e ust. 4 pkt 3).
 */
export function dokumentFaktury(f) {
  const identyfikator = (osoba) => {
    if (osoba.rodzajId === 'PESEL' && osoba.id) return `PESEL: ${osoba.id}`;
    const nip = osoba.rodzajId === 'NIP' ? osoba.id : osoba.nip; // starsze zapisy sprzedawcy i nabywca mają pole nip
    return nip ? `NIP: ${nipZKreskami(nip)}` : '';
  };
  const linie = (osoba, zId) => [osoba.nazwa, osoba.adres, zId ? identyfikator(osoba) : ''].filter((x) => x);
  const daty = [['Data wystawienia', dataPl(f.dataWystawienia)]];
  if (f.dataSprzedazy !== f.dataWystawienia) daty.push(['Data sprzedaży', dataPl(f.dataSprzedazy)]);
  const suma = naGrosze(f.suma);
  return {
    tytul: `Faktura nr ${f.numer}`,
    podtytul: 'Sprzedaż zwolniona z VAT',
    daty,
    sprzedawca: { naglowek: 'Sprzedawca', linie: linie(f.sprzedawca, true) },
    nabywca: { naglowek: 'Nabywca', linie: linie(f.nabywca, f.nabywca.rodzaj === 'firma') },
    naglowkiPozycji: ['Lp.', 'Nazwa towaru lub usługi', 'Ilość', 'J.m.', 'Cena jedn. (zł)', 'Wartość (zł)'],
    pozycje: f.pozycje.map((p, i) => [String(i + 1), p.nazwa, liczbaPl(p.ilosc), p.jm, kwotaBezZl(naGrosze(p.cena)), kwotaBezZl(naGrosze(p.wartosc))]),
    razem: `Razem do zapłaty: ${formatujZl(suma)}`,
    slownie: `Słownie: ${slownie(suma)}`,
    zwolnienie: `Podstawa zwolnienia z VAT: ${f.podstawa.tekst}.`,
    platnosc: f.platnosc ? `Zapłata: ${f.platnosc}` : '',
    stopka: 'Przygotowano w Narzędziowniku DN (dn.noblecode.pl).',
  };
}

// ------------------------------------------------------------ ewidencja

const RE_ZNACZNIK = /^Faktura \d+\/\d{4}(?::|$)/;
const znacznik = (numer) => `Faktura ${numer}`;

/** Wpis ewidencji z faktury: data sprzedaży, kwota brutto w PLN, opis „Faktura N/RRRR: pierwsza pozycja”. */
export function wpisZFaktury(f, id) {
  const reszta = f.pozycje.length > 1 ? ` i ${f.pozycje.length - 1} inne` : '';
  return { id, data: f.dataSprzedazy, opis: `${znacznik(f.numer)}: ${f.pozycje[0].nazwa}${reszta}`.slice(0, MAX_OPIS), kwota: f.suma, waluta: 'PLN', kurs: '', kursData: '', kursTabela: '' };
}

/**
 * Dodaje sprzedaż z faktury do ewidencji bez dublowania:
 * - wpis z opisem „Faktura N/RRRR…” już jest → aktualizuje datę i kwotę ('zaktualizowano' albo 'bez-zmian');
 * - jest wpis bez numeru faktury z tą samą datą i kwotą w PLN → dopisuje numer do jego opisu ('polaczono');
 * - inaczej dodaje nowy wpis ('dodano').
 * Zwraca { wpisy, stan, wpis }.
 */
export function dodajFaktureDoEwidencji(wpisy, f, noweId) {
  const tag = znacznik(f.numer);
  const kwota = naGrosze(f.suma);
  const zTagiem = wpisy.find((w) => w.opis === tag || w.opis.startsWith(`${tag}:`));
  if (zTagiem) {
    if (zTagiem.data === f.dataSprzedazy && zTagiem.waluta === 'PLN' && naGrosze(zTagiem.kwota) === kwota) {
      return { wpisy, stan: 'bez-zmian', wpis: zTagiem };
    }
    const nowy = { ...zTagiem, data: f.dataSprzedazy, kwota: f.suma, waluta: 'PLN', kurs: '', kursData: '', kursTabela: '' };
    return { wpisy: wpisy.map((w) => (w === zTagiem ? nowy : w)), stan: 'zaktualizowano', wpis: nowy };
  }
  const taSama = wpisy.find((w) => w.data === f.dataSprzedazy && w.waluta === 'PLN' && naGrosze(w.kwota) === kwota && !RE_ZNACZNIK.test(w.opis));
  if (taSama) {
    const nowy = { ...taSama, opis: `${tag}: ${taSama.opis || f.pozycje[0].nazwa}`.slice(0, MAX_OPIS) };
    return { wpisy: wpisy.map((w) => (w === taSama ? nowy : w)), stan: 'polaczono', wpis: nowy };
  }
  const nowy = wpisZFaktury(f, noweId);
  return { wpisy: [...wpisy, nowy], stan: 'dodano', wpis: nowy };
}

/** Zapisani klienci: najnowszy na początku, bez powtórzeń (po NIP, a bez NIP po nazwie i adresie), najwyżej 50. */
export function dopiszNabywce(nabywcy, n) {
  const klucz = (x) => (x.nip ? `nip:${x.nip}` : `${x.rodzaj}:${x.nazwa.toLowerCase()}|${x.adres.toLowerCase()}`);
  const k = klucz(n);
  return [{ rodzaj: n.rodzaj, nazwa: n.nazwa, adres: n.adres, nip: n.nip }, ...nabywcy.filter((x) => klucz(x) !== k)].slice(0, 50);
}

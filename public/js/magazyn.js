// Kopia robocza ewidencji i faktur w pamięci tej przeglądarki (localStorage), tylko dla wygody.
// Każdy dostęp w try/catch: w trybie prywatnym albo przy zablokowanej pamięci strona działa bez zapisu.
// Źródłem danych jest plik (eksport XLSX/CSV), nie ta pamięć.
//
// Dwa osobne przełączniki (ustawienia w KLUCZ_USTAWIENIA):
// - pamietaj: „Pamiętaj wpisy ewidencji”, domyślnie włączony. Obejmuje wpisy (KLUCZ), wystawione faktury w skrócie
//   (numer, daty, kwota i rodzaj nabywcy, bez danych osobowych) i miesiąc utraty prawa do faktur poza KSeF (KLUCZ_FAKTURY);
// - pamietajDane: „Zapamiętaj moje dane i dane klientów do faktur”, domyślnie wyłączony. Dane osobowe są w pamięci
//   tylko po jego włączeniu: dane sprzedawcy (imię i nazwisko, NIP albo PESEL, adres) i lista klientów (KLUCZ_DANE),
//   pełne faktury (strony i pozycje, do ponownego wydruku) oraz imię do wydruku ewidencji (osoba w ustawieniach).

const KLUCZ = 'dn-ewidencja-v1';
const KLUCZ_USTAWIENIA = 'dn-ewidencja-ustawienia-v1';
const KLUCZ_FAKTURY = 'dn-faktury-v1'; // wystawione faktury i miesiąc utraty prawa (przełącznik „Pamiętaj wpisy ewidencji”)
const KLUCZ_DANE = 'dn-dane-faktur-v1'; // dane sprzedawcy i zapisani klienci (przełącznik „Zapamiętaj moje dane…”)
export const KLUCZE = { ewidencja: KLUCZ, ustawienia: KLUCZ_USTAWIENIA, faktury: KLUCZ_FAKTURY, dane: KLUCZ_DANE };
// Kopia robocza z pierwszej wersji strony (wiersze ewidencji, domyślnie wyłączona). Obecna wersja jej nie czyta,
// ale „Wyczyść dane” usuwa także ją, żeby w przeglądarce nie zostało nic, co strona kiedyś zapisała.
export const KLUCZE_NAJSTARSZEJ_WERSJI = ['dn-narzedzia.ewidencja.bufor', 'dn-narzedzia.ewidencja.bufor-wlaczony'];

function magazyn() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

function czytajJson(klucz) {
  try {
    const t = magazyn()?.getItem(klucz);
    return t ? JSON.parse(t) : null;
  } catch { return null; }
}

/** { wpisy, zapisano } albo null, gdy brak danych lub pamięć niedostępna. */
export function wczytaj() {
  const d = czytajJson(KLUCZ);
  return Array.isArray(d?.wpisy) ? d : null;
}

/**
 * true, gdy zapis się udał. Przy wyłączonym „Pamiętaj wpisy ewidencji” nic nie zapisuje i zwraca false: ustawienie
 * jest czytane z pamięci w chwili zapisu, bo mogło zostać wyłączone w innej karcie.
 */
export function zapisz(wpisy) {
  if (!pamiecWlaczona()) return false;
  try {
    magazyn()?.setItem(KLUCZ, JSON.stringify({ wersja: 1, zapisano: new Date().toISOString(), wpisy }));
    return Boolean(magazyn());
  } catch { return false; }
}

export function wczytajUstawienia() {
  const u = czytajJson(KLUCZ_USTAWIENIA);
  return u && typeof u === 'object' && !Array.isArray(u) ? u : {};
}

export function zapiszUstawienia(u) {
  try { magazyn()?.setItem(KLUCZ_USTAWIENIA, JSON.stringify(u)); } catch { /* bez zapisu */ }
}

/** Zmienia wybrane ustawienia i zostawia pozostałe (np. włączenie jednego przełącznika nie rusza drugiego). */
export function zmienUstawienia(zmiany) {
  const u = { ...wczytajUstawienia(), ...zmiany };
  for (const k of Object.keys(u)) if (u[k] === undefined) delete u[k];
  zapiszUstawienia(u);
}

/** Czy pamięć przeglądarki działa (zapis i odczyt próbnego klucza); w trybie prywatnym albo przy blokadzie: false. */
export function dostepny() {
  try {
    const m = magazyn();
    if (!m) return false;
    m.setItem('dn-test', '1');
    const ok = m.getItem('dn-test') === '1';
    m.removeItem('dn-test');
    return ok;
  } catch { return false; }
}

/** Czy użytkownik zgodził się na pamięć wpisów i faktur (domyślnie tak; przełącznik „Pamiętaj wpisy ewidencji”). */
export function pamiecWlaczona() {
  return wczytajUstawienia().pamietaj !== false;
}

// ------------------------------------------------------------ dane do faktur (drugi przełącznik)

const maDane = (d) => Boolean(d && ((d.sprzedawca && typeof d.sprzedawca === 'object') || (Array.isArray(d.nabywcy) && d.nabywcy.length)));

/** Czy zapisana faktura ma dane osobowe (pełny rekord), a nie tylko rekord skrócony. */
export const fakturaZDanymi = (f) => Boolean(f && (Array.isArray(f.pozycje) || f.sprzedawca || f.nabywca?.nazwa || f.nabywca?.adres || f.nabywca?.nip));

/**
 * Rekord skrócony faktury: tylko to, czego potrzebują numeracja i limit KSeF, bez danych osobowych
 * (bez sprzedawcy, nazwy, adresu i NIP nabywcy oraz pozycji).
 */
export function skrocFakture(f) {
  const r = {
    id: f?.id, numer: f?.numer, dataWystawienia: f?.dataWystawienia, dataSprzedazy: f?.dataSprzedazy, suma: f?.suma,
    nabywca: { rodzaj: f?.nabywca?.rodzaj === 'firma' ? 'firma' : 'konsument' },
  };
  for (const k of Object.keys(r)) if (r[k] === undefined) delete r[k];
  return r;
}

/** Czy w pamięci są dane osobowe zapisane przez wcześniejszą wersję strony (przed wyborem w drugim przełączniku). */
function daneZWczesniejszejWersji() {
  const f = czytajJson(KLUCZ_FAKTURY);
  const osoba = wczytajUstawienia().osoba;
  return maDane(czytajJson(KLUCZ_DANE)) || maDane(f) || (Array.isArray(f?.faktury) && f.faktury.some(fakturaZDanymi))
    || (typeof osoba === 'string' && osoba !== '');
}

/**
 * Stan przełącznika „Zapamiętaj moje dane i dane klientów do faktur”: { wlaczona, czekaNaWybor }.
 * Włączony tylko po wyraźnym wyborze użytkownika (ustawienie pamietajDane === true). Przejście ze starszej wersji:
 * gdy użytkownik jeszcze nie wybrał, a w pamięci są dane osobowe zapisane wcześniej, czekaNaWybor: true. Strona pyta
 * wtedy „Zachowaj moje dane” albo „Usuń”. Do wyboru stare dane zostają nietknięte, ale nowe nie są zapisywane.
 */
export function stanPamieciDanych() {
  const u = wczytajUstawienia().pamietajDane;
  if (typeof u === 'boolean') return { wlaczona: u, czekaNaWybor: false };
  return { wlaczona: false, czekaNaWybor: daneZWczesniejszejWersji() };
}

/**
 * Czy w przeglądarce mogą być dane do faktur (sprzedawca, klienci), które zostają po wyłączeniu pamięci wpisów:
 * zapamiętywanie danych włączone albo dane z wcześniejszej wersji czekają na wybór.
 */
export function zostajaDaneFaktur() {
  const s = stanPamieciDanych();
  return s.wlaczona || s.czekaNaWybor;
}

/** Czy wolno zapisywać dane osobowe do faktur: tylko po włączeniu przez użytkownika. */
export function pamiecDanychWlaczona() {
  return stanPamieciDanych().wlaczona;
}

/**
 * Przenosi dane sprzedawcy i klientów zapisane przez wcześniejszą wersję w kluczu faktur (KLUCZ_FAKTURY) do osobnego
 * klucza (KLUCZ_DANE), bez usuwania: gdy klucz danych już ma dane, stare pola tylko znikają z klucza faktur.
 * Gdy użytkownik wyłączył zapamiętywanie danych, nie przenosi ich, tylko usuwa z klucza faktur.
 */
export function przeniesDaneZWczesniejszejWersji() {
  try {
    const f = czytajJson(KLUCZ_FAKTURY);
    if (!f || !('sprzedawca' in f || 'nabywcy' in f)) return;
    const { sprzedawca = null, nabywcy = [], ...reszta } = f;
    if (maDane(f) && !maDane(czytajJson(KLUCZ_DANE)) && wczytajUstawienia().pamietajDane !== false) {
      magazyn()?.setItem(KLUCZ_DANE, JSON.stringify({ wersja: 1, zapisano: f.zapisano ?? new Date().toISOString(), sprzedawca, nabywcy }));
    }
    magazyn()?.setItem(KLUCZ_FAKTURY, JSON.stringify(reszta));
  } catch { /* bez zapisu */ }
}

/** Wybór „Zachowaj moje dane” (albo włączenie przełącznika): zgoda zapisana, dane z wcześniejszej wersji w swoim kluczu. */
export function zachowajDaneFaktur() {
  zmienUstawienia({ pamietajDane: true });
  przeniesDaneZWczesniejszejWersji();
}

/** { sprzedawca, nabywcy } — puste, gdy brak danych, pamięć niedostępna albo przełącznik wyłączony. */
export function wczytajDaneFaktur() {
  const puste = { sprzedawca: null, nabywcy: [] };
  if (!pamiecDanychWlaczona()) return puste;
  const d = maDane(czytajJson(KLUCZ_DANE)) ? czytajJson(KLUCZ_DANE) : czytajJson(KLUCZ_FAKTURY); // drugi: zapis starszej wersji
  if (!d) return puste;
  return {
    sprzedawca: d.sprzedawca && typeof d.sprzedawca === 'object' ? d.sprzedawca : null,
    nabywcy: Array.isArray(d.nabywcy) ? d.nabywcy : [],
  };
}

/** Zapisuje dane sprzedawcy i klientów tylko przy włączonym przełączniku. true, gdy zapis się udał. */
export function zapiszDaneFaktur({ sprzedawca, nabywcy }) {
  if (!pamiecDanychWlaczona()) return false;
  try {
    magazyn()?.setItem(KLUCZ_DANE, JSON.stringify({ wersja: 1, zapisano: new Date().toISOString(), sprzedawca, nabywcy }));
    return Boolean(magazyn());
  } catch { return false; }
}

// ------------------------------------------------------------ faktury

/** { faktury, utrataOd } — puste, gdy brak danych albo pamięć niedostępna. Faktury pełne albo skrócone (skrocFakture). */
export function wczytajFaktury() {
  const puste = { faktury: [], utrataOd: null };
  const d = czytajJson(KLUCZ_FAKTURY);
  if (!d) return puste;
  return {
    faktury: Array.isArray(d?.faktury) ? d.faktury : [],
    utrataOd: /^\d{4}-\d{2}$/.test(String(d?.utrataOd ?? '')) ? d.utrataOd : null, // art. 145m ust. 2: utrata prawa od miesiąca
  };
}

const kluczFaktury = (f) => `${f?.numer}|${f?.dataWystawienia}|${f?.suma}`;

/**
 * Zapisuje wystawione faktury i miesiąc utraty prawa (przełącznik „Pamiętaj wpisy ewidencji”). Pełne faktury tylko
 * przy włączonym „Zapamiętaj moje dane…”; bez niego rekordy skrócone, bez danych osobowych. Przed wyborem po przejściu
 * ze starszej wersji pełne faktury i dane zapisane wcześniej zostają bez zmian, a nowe faktury są zapisywane w skrócie.
 * true, gdy zapis się udał. Przy wyłączonym „Pamiętaj wpisy ewidencji” (także w innej karcie) nic nie zapisuje.
 */
export function zapiszFaktury({ faktury, utrataOd = null }) {
  if (!pamiecWlaczona()) return false;
  try {
    const stan = stanPamieciDanych();
    let lista;
    let stare = {};
    if (stan.wlaczona) {
      przeniesDaneZWczesniejszejWersji(); // stare pola sprzedawcy i klientów nie mogą zniknąć przy nadpisaniu klucza
      lista = faktury;
    } else if (stan.czekaNaWybor) {
      const zapisane = czytajJson(KLUCZ_FAKTURY) ?? {};
      const pelne = new Set((Array.isArray(zapisane.faktury) ? zapisane.faktury : []).filter(fakturaZDanymi).map(kluczFaktury));
      lista = faktury.map((f) => (pelne.has(kluczFaktury(f)) ? f : skrocFakture(f)));
      if ('sprzedawca' in zapisane) stare.sprzedawca = zapisane.sprzedawca;
      if ('nabywcy' in zapisane) stare.nabywcy = zapisane.nabywcy;
    } else {
      lista = faktury.map(skrocFakture);
    }
    magazyn()?.setItem(KLUCZ_FAKTURY, JSON.stringify({ wersja: 2, zapisano: new Date().toISOString(), faktury: lista, utrataOd, ...stare }));
    return Boolean(magazyn());
  } catch { return false; }
}

// ------------------------------------------------------------ usuwanie (widok zawsze pyta wcześniej o potwierdzenie)

function usun(klucze) {
  try {
    for (const k of klucze) magazyn()?.removeItem(k);
    return true;
  } catch { return false; }
}

/**
 * Wyłączenie „Pamiętaj wpisy ewidencji”: usuwa wpisy, faktury i utratę prawa, zostawia ustawienia. Dane sprzedawcy
 * i klientów zapisane przez starszą wersję w kluczu faktur najpierw przenosi do ich klucza (decyduje o nich drugi
 * przełącznik albo wybór po przejściu ze starszej wersji).
 */
export function usunWpisy() {
  przeniesDaneZWczesniejszejWersji();
  const ok = usun([KLUCZ, KLUCZ_FAKTURY]);
  zmienUstawienia({ pamietaj: false });
  return ok;
}

/**
 * Wyłączenie „Zapamiętaj moje dane i dane klientów do faktur” (i wybór „Usuń” po przejściu ze starszej wersji):
 * usuwa dane sprzedawcy i klientów (KLUCZ_DANE) oraz imię do wydruku, a zapisane faktury skraca do rekordów bez danych
 * osobowych. Zostają wpisy, numery, daty i kwoty faktur oraz ustawienia.
 */
export function usunDaneFaktur() {
  let ok = usun([KLUCZ_DANE]);
  try {
    const f = czytajJson(KLUCZ_FAKTURY);
    if (f) {
      magazyn()?.setItem(KLUCZ_FAKTURY, JSON.stringify({
        wersja: 2, zapisano: f.zapisano ?? new Date().toISOString(),
        faktury: (Array.isArray(f.faktury) ? f.faktury : []).map(skrocFakture), utrataOd: f.utrataOd ?? null,
      }));
    }
  } catch { ok = false; }
  zmienUstawienia({ pamietajDane: false, osoba: undefined });
  return ok;
}

/**
 * Usuwa wszystko, co strona zapisała w tej przeglądarce (ewidencja, faktury, dane do faktur, ustawienia,
 * kopia robocza z pierwszej wersji strony).
 */
export function wyczysc() {
  return usun([KLUCZ, KLUCZ_USTAWIENIA, KLUCZ_FAKTURY, KLUCZ_DANE, ...KLUCZE_NAJSTARSZEJ_WERSJI]);
}

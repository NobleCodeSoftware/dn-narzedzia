// Kopia robocza ewidencji w pamięci tej przeglądarki (localStorage), tylko dla wygody.
// Każdy dostęp w try/catch: w trybie prywatnym albo przy zablokowanej pamięci strona działa bez zapisu.
// Źródłem danych jest plik (eksport XLSX/CSV), nie ta pamięć.

const KLUCZ = 'dn-ewidencja-v1';
const KLUCZ_USTAWIENIA = 'dn-ewidencja-ustawienia-v1';
const KLUCZ_FAKTURY = 'dn-faktury-v1'; // wystawione faktury, dane sprzedawcy i zapisani klienci (ta sama zgoda „Pamiętaj wpisy”)

function magazyn() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

/** { wpisy, zapisano } albo null, gdy brak danych lub pamięć niedostępna. */
export function wczytaj() {
  try {
    const t = magazyn()?.getItem(KLUCZ);
    if (!t) return null;
    const d = JSON.parse(t);
    return Array.isArray(d?.wpisy) ? d : null;
  } catch { return null; }
}

/** true, gdy zapis się udał. */
export function zapisz(wpisy) {
  try {
    magazyn()?.setItem(KLUCZ, JSON.stringify({ wersja: 1, zapisano: new Date().toISOString(), wpisy }));
    return Boolean(magazyn());
  } catch { return false; }
}

export function wczytajUstawienia() {
  try { return JSON.parse(magazyn()?.getItem(KLUCZ_USTAWIENIA) ?? '{}') ?? {}; } catch { return {}; }
}

export function zapiszUstawienia(u) {
  try { magazyn()?.setItem(KLUCZ_USTAWIENIA, JSON.stringify(u)); } catch { /* bez zapisu */ }
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

/** Czy użytkownik zgodził się na pamięć przeglądarki (domyślnie tak; przełącznik „Pamiętaj wpisy”). */
export function pamiecWlaczona() {
  return wczytajUstawienia().pamietaj !== false;
}

/** { faktury, sprzedawca, nabywcy, utrataOd } — puste, gdy brak danych albo pamięć niedostępna. */
export function wczytajFaktury() {
  const puste = { faktury: [], sprzedawca: null, nabywcy: [], utrataOd: null };
  try {
    const t = magazyn()?.getItem(KLUCZ_FAKTURY);
    if (!t) return puste;
    const d = JSON.parse(t);
    return {
      faktury: Array.isArray(d?.faktury) ? d.faktury : [],
      sprzedawca: d?.sprzedawca && typeof d.sprzedawca === 'object' ? d.sprzedawca : null,
      nabywcy: Array.isArray(d?.nabywcy) ? d.nabywcy : [],
      utrataOd: /^\d{4}-\d{2}$/.test(String(d?.utrataOd ?? '')) ? d.utrataOd : null, // art. 145m ust. 2: utrata prawa od miesiąca
    };
  } catch { return puste; }
}

/** true, gdy zapis się udał. */
export function zapiszFaktury({ faktury, sprzedawca, nabywcy, utrataOd = null }) {
  try {
    magazyn()?.setItem(KLUCZ_FAKTURY, JSON.stringify({ wersja: 1, zapisano: new Date().toISOString(), faktury, sprzedawca, nabywcy, utrataOd }));
    return Boolean(magazyn());
  } catch { return false; }
}

/** Usuwa wszystko, co strona zapisała w tej przeglądarce (ewidencja, faktury, klienci, ustawienia). */
export function wyczysc() {
  try {
    for (const k of [KLUCZ, KLUCZ_USTAWIENIA, KLUCZ_FAKTURY]) magazyn()?.removeItem(k);
    return true;
  } catch { return false; }
}

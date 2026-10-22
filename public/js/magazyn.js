// Kopia robocza ewidencji w pamięci tej przeglądarki (localStorage), tylko dla wygody.
// Każdy dostęp w try/catch: w trybie prywatnym albo przy zablokowanej pamięci strona działa bez zapisu.
// Źródłem danych jest plik (eksport XLSX/CSV), nie ta pamięć.

const KLUCZ = 'dn-ewidencja-v1';
const KLUCZ_USTAWIENIA = 'dn-ewidencja-ustawienia-v1';

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

/** Usuwa wszystko, co strona zapisała w tej przeglądarce. */
export function wyczysc() {
  try { magazyn()?.removeItem(KLUCZ); magazyn()?.removeItem(KLUCZ_USTAWIENIA); return true; } catch { return false; }
}

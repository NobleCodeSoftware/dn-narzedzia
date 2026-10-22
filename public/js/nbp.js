// Kurs średni NBP (tabela A) z ostatniego dnia roboczego przed datą sprzedaży.
// Do NBP trafia tylko kod waluty i zakres dat. Bez ciasteczek, bez nagłówka Referer
// (nagłówek Origin z adresem strony przeglądarka wysyła zawsze przy zapytaniu CORS).
// Funkcja pobierająca (fetch) jest wstrzykiwana, więc logikę testujemy bez sieci.

import { BladDanych, poprawnaData, dodajDni } from './logic.js';
import { dzienKursu } from './kalendarz.js';

export const API_NBP = 'https://api.nbp.pl/api/exchangerates/rates/a';

// Waluty z tabeli A, które podpowiadamy w formularzu (pełna tabela ma ich ok. 30).
export const WALUTY = ['EUR', 'USD', 'GBP', 'CHF', 'CZK', 'SEK', 'NOK', 'DKK', 'CAD', 'AUD', 'JPY', 'HUF', 'UAH'];
export const WALUTY_TABELI_A = new Set([
  'THB', 'USD', 'AUD', 'HKD', 'CAD', 'NZD', 'SGD', 'EUR', 'HUF', 'CHF', 'GBP', 'UAH', 'JPY', 'CZK', 'DKK',
  'ISK', 'NOK', 'SEK', 'RON', 'TRY', 'ILS', 'CLP', 'PHP', 'MXN', 'ZAR', 'BRL', 'MYR', 'IDR', 'INR', 'KRW',
  'CNY', 'XDR',
]);

/** Adres zapytania o kursy z zakresu dat (NBP zwraca tylko dni, w które opublikował tabelę). */
export function adresZapytania(waluta, od, doDnia) {
  const kod = String(waluta).toUpperCase();
  if (!/^[A-Z]{3}$/.test(kod)) throw new BladDanych(`niepoprawny kod waluty ${JSON.stringify(waluta)}`);
  if (!poprawnaData(od) || !poprawnaData(doDnia)) throw new BladDanych('niepoprawna data zapytania');
  return `${API_NBP}/${kod.toLowerCase()}/${od}/${doDnia}/?format=json`;
}

/**
 * Plan zapytania dla daty sprzedaży: oczekiwany dzień kursu (z kalendarza świąt) i zakres 10 dni
 * kończący się na nim. Zakres chroni przed dniem bez tabeli, którego nie ma w naszym kalendarzu.
 */
export function planZapytania(waluta, dataSprzedazy) {
  const { data: oczekiwany, pominiete } = dzienKursu(dataSprzedazy);
  const od = dodajDni(oczekiwany, -10);
  return { oczekiwany, pominiete, od, doDnia: oczekiwany, adres: adresZapytania(waluta, od, oczekiwany) };
}

/**
 * Wybiera kurs z odpowiedzi NBP: ostatni dzień z tabelą, nie późniejszy niż oczekiwany dzień kursu.
 * dzis: dzisiejsza data w Warszawie. Gdy oczekiwany dzień to dziś albo przyszłość, a tabeli z tego dnia
 * jeszcze nie ma, nie zwracamy starszego kursu (byłby błędny), tylko stan „niedostepny”.
 */
export function wybierzKurs(odpowiedz, plan, dzis) {
  const kursy = Array.isArray(odpowiedz?.rates) ? odpowiedz.rates : [];
  const pasujace = kursy
    .filter((r) => poprawnaData(r?.effectiveDate) && r.effectiveDate <= plan.oczekiwany && Number.isFinite(r?.mid) && r.mid > 0)
    .sort((a, b) => (a.effectiveDate < b.effectiveDate ? -1 : 1));
  const ostatni = pasujace[pasujace.length - 1];
  if (!ostatni || (ostatni.effectiveDate < plan.oczekiwany && plan.oczekiwany >= dzis)) {
    return { stan: 'niedostepny', oczekiwany: plan.oczekiwany };
  }
  return {
    stan: 'ok',
    kurs: kursNaTekst(ostatni.mid),
    data: ostatni.effectiveDate,
    tabela: String(ostatni.no ?? ''),
    oczekiwany: plan.oczekiwany,
    innyDzien: ostatni.effectiveDate !== plan.oczekiwany,
  };
}

/** 4.3641 → "4.3641" (NBP podaje kurs średni z 4 miejscami po przecinku). */
export function kursNaTekst(mid) {
  return Number(mid).toFixed(4);
}

/**
 * Pobiera kurs. pobierz: funkcja jak fetch (w przeglądarce window.fetch).
 * Zwraca { stan: 'ok' | 'niedostepny' | 'brak-waluty' | 'blad', … }.
 */
export async function pobierzKurs(waluta, dataSprzedazy, { pobierz, dzis }) {
  const kod = String(waluta).toUpperCase();
  if (!WALUTY_TABELI_A.has(kod)) return { stan: 'brak-waluty', waluta: kod };
  if (!poprawnaData(dataSprzedazy)) return { stan: 'blad', powod: 'data' };
  const plan = planZapytania(kod, dataSprzedazy);
  if (plan.od > dzis) return { stan: 'niedostepny', oczekiwany: plan.oczekiwany };
  let odp;
  try {
    odp = await pobierz(plan.adres, {
      credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'default', headers: { Accept: 'application/json' },
    });
  } catch {
    return { stan: 'blad', powod: 'siec' };
  }
  if (odp.status === 404) return { stan: 'niedostepny', oczekiwany: plan.oczekiwany };
  if (!odp.ok) return { stan: 'blad', powod: `http ${odp.status}` };
  let dane;
  try { dane = await odp.json(); } catch { return { stan: 'blad', powod: 'odpowiedz' }; }
  return { ...wybierzKurs(dane, plan, dzis), pominiete: plan.pominiete };
}

/**
 * Kursy dla wielu sprzedaży naraz (np. po wczytaniu arkusza): jedno zapytanie na walutę i okno do 90 dni,
 * zamiast osobnego zapytania na każdy wpis. potrzeby: [{ waluta, data }].
 * Zwraca Map 'WALUTA|RRRR-MM-DD' → wynik jak z pobierzKurs.
 */
export async function pobierzKursyHurtem(potrzeby, { pobierz, dzis }) {
  const wyniki = new Map();
  const wgWaluty = new Map();
  for (const { waluta, data } of potrzeby) {
    const kod = String(waluta).toUpperCase();
    const klucz = `${kod}|${data}`;
    if (wyniki.has(klucz)) continue;
    if (!WALUTY_TABELI_A.has(kod)) { wyniki.set(klucz, { stan: 'brak-waluty', waluta: kod }); continue; }
    if (!poprawnaData(data)) { wyniki.set(klucz, { stan: 'blad', powod: 'data' }); continue; }
    const plan = planZapytania(kod, data);
    if (plan.od > dzis) { wyniki.set(klucz, { stan: 'niedostepny', oczekiwany: plan.oczekiwany }); continue; }
    wyniki.set(klucz, null);
    if (!wgWaluty.has(kod)) wgWaluty.set(kod, []);
    wgWaluty.get(kod).push({ klucz, plan });
  }
  for (const [kod, plany] of wgWaluty) {
    plany.sort((a, b) => (a.plan.oczekiwany < b.plan.oczekiwany ? -1 : 1));
    let i = 0;
    while (i < plany.length) {
      const od = plany[i].plan.od;
      const limit = dodajDni(od, 90); // NBP przyjmuje zakres do 93 dni
      let j = i;
      while (j + 1 < plany.length && plany[j + 1].plan.oczekiwany <= limit) j += 1;
      const okno = plany.slice(i, j + 1);
      const doDnia = okno[okno.length - 1].plan.oczekiwany;
      let wynikOkna;
      try {
        const odp = await pobierz(adresZapytania(kod, od, doDnia), { credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'default' });
        if (odp.status === 404) wynikOkna = { rates: [] };
        else if (!odp.ok) wynikOkna = { blad: `http ${odp.status}` };
        else wynikOkna = await odp.json();
      } catch {
        wynikOkna = { blad: 'siec' };
      }
      for (const { klucz, plan } of okno) {
        wyniki.set(klucz, wynikOkna.blad
          ? { stan: 'blad', powod: wynikOkna.blad }
          : { ...wybierzKurs(wynikOkna, plan, dzis), pominiete: plan.pominiete });
      }
      i = j + 1;
    }
  }
  return wyniki;
}

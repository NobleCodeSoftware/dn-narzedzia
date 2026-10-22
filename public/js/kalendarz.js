// Dni wolne od pracy w Polsce i wybór dnia kursu NBP.
// Czysty moduł ES bez DOM: używa go przeglądarka i testy (node:test).
//
// Kurs do przeliczenia przychodu w walucie obcej to kurs średni NBP z ostatniego dnia roboczego
// przed dniem uzyskania przychodu (art. 11a ust. 1 ustawy o PIT). NBP nie publikuje tabel
// w soboty, niedziele i dni ustawowo wolne od pracy.

import { BladDanych, poprawnaData, dodajDni } from './logic.js';

/** Niedziela Wielkanocna (kalendarz gregoriański, algorytm Meeusa/Jonesa/Butchera). */
export function wielkanoc(rok) {
  const a = rok % 19;
  const b = Math.floor(rok / 100);
  const c = rok % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const miesiac = Math.floor((h + l - 7 * m + 114) / 31);
  const dzien = ((h + l - 7 * m + 114) % 31) + 1;
  return `${rok}-${String(miesiac).padStart(2, '0')}-${String(dzien).padStart(2, '0')}`;
}

/**
 * Dni ustawowo wolne od pracy (ustawa z 18.01.1951 o dniach wolnych od pracy).
 * Wigilia (24 grudnia) jest dniem wolnym od 2025 r. (ustawa z 6.12.2024, Dz.U. 2024 poz. 1965).
 * Zwraca mapę 'RRRR-MM-DD' → nazwa.
 */
export function swieta(rok) {
  if (!Number.isInteger(rok) || rok < 2000 || rok > 2100) throw new BladDanych(`nieobsługiwany rok ${rok}`);
  const w = wielkanoc(rok);
  const d = (mmdd) => `${rok}-${mmdd}`;
  const lista = [
    [d('01-01'), 'Nowy Rok'],
    [d('01-06'), 'Trzech Króli'],
    [w, 'Wielkanoc'],
    [dodajDni(w, 1), 'Poniedziałek Wielkanocny'],
    [d('05-01'), 'Święto Pracy'],
    [d('05-03'), 'Święto Konstytucji 3 Maja'],
    [dodajDni(w, 49), 'Zielone Świątki'],
    [dodajDni(w, 60), 'Boże Ciało'],
    [d('08-15'), 'Wniebowzięcie NMP'],
    [d('11-01'), 'Wszystkich Świętych'],
    [d('11-11'), 'Święto Niepodległości'],
    [d('12-25'), 'Boże Narodzenie (pierwszy dzień)'],
    [d('12-26'), 'Boże Narodzenie (drugi dzień)'],
  ];
  if (rok >= 2025) lista.push([d('12-24'), 'Wigilia']);
  return new Map(lista.sort((x, y) => (x[0] < y[0] ? -1 : 1)));
}

const pamiecSwiat = new Map();
function swietaZPamieci(rok) {
  if (!pamiecSwiat.has(rok)) pamiecSwiat.set(rok, swieta(rok));
  return pamiecSwiat.get(rok);
}

/** Dzień tygodnia: 0 = niedziela … 6 = sobota. */
export function dzienTygodnia(data) {
  if (!poprawnaData(data)) throw new BladDanych(`niepoprawna data ${JSON.stringify(data)}`);
  const [r, m, d] = data.split('-').map(Number);
  return new Date(Date.UTC(r, m - 1, d)).getUTCDay();
}

/** Nazwa święta albo null. */
export function nazwaSwieta(data) {
  return swietaZPamieci(Number(data.slice(0, 4))).get(data) ?? null;
}

export function czyDzienRoboczy(data) {
  const dt = dzienTygodnia(data);
  return dt !== 0 && dt !== 6 && nazwaSwieta(data) === null;
}

/**
 * Ostatni dzień roboczy przed datą sprzedaży, czyli dzień, z którego bierzemy kurs średni NBP.
 * Cofa się przez weekendy i święta. Zwraca też listę pominiętych dni z powodem (do objaśnienia w UI).
 */
export function dzienKursu(dataSprzedazy) {
  if (!poprawnaData(dataSprzedazy)) throw new BladDanych(`niepoprawna data ${JSON.stringify(dataSprzedazy)}`);
  const pominiete = [];
  let d = dodajDni(dataSprzedazy, -1);
  for (let i = 0; i < 14; i += 1) {
    if (czyDzienRoboczy(d)) return { data: d, pominiete };
    const dt = dzienTygodnia(d);
    pominiete.push({ data: d, powod: nazwaSwieta(d) ?? (dt === 0 ? 'niedziela' : 'sobota') });
    d = dodajDni(d, -1);
  }
  throw new BladDanych('nie znaleziono dnia roboczego'); // niemożliwe przy polskim kalendarzu
}

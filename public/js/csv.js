// CSV ewidencji: ten sam układ kolumn co zakładka „Sprzedaż” arkusza (A–I).
// Zapis dla polskiego Excela: średnik, przecinek dziesiętny, UTF-8 z BOM, CRLF.
// Odczyt: średnik, przecinek albo tabulator (wykrywane z nagłówka), cudzysłowy według RFC 4180.

import { groszeNaTekst } from './logic.js';
import { NAGLOWKI_ARKUSZA, posortuj, wartosciArkusza, wierszeNaWpisy } from './ewidencja-logika.js';

const liczbaPl = (t) => String(t).replace('.', ',');

/** Tekst komórki odporny na wstrzyknięcie formuły (=, +, -, @ na początku dostają apostrof). */
function bezpiecznyTekst(t) {
  const s = String(t ?? '');
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

function pole(t) {
  const s = String(t);
  return /[";\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

function procentPl(h) {
  if (typeof h !== 'number') return h;
  return `${(Math.round(h * 1000) / 10).toFixed(1).replace('.', ',')}%`;
}

/** Wpisy → tekst CSV (z BOM). */
export function eksportujCsv(wpisy) {
  const z = posortuj(wpisy);
  const wart = wartosciArkusza(z);
  const linie = [NAGLOWKI_ARKUSZA.map(pole).join(';')];
  z.forEach((w, i) => {
    const { F, G, H, I } = wart[i];
    linie.push([
      w.data,
      bezpiecznyTekst(w.opis),
      liczbaPl(w.kwota),
      w.waluta,
      w.kurs ? liczbaPl(w.kurs) : '',
      typeof F === 'bigint' ? liczbaPl(groszeNaTekst(F)) : F,
      typeof G === 'bigint' ? liczbaPl(groszeNaTekst(G)) : G,
      procentPl(H),
      I,
    ].map(pole).join(';'));
  });
  return `﻿${linie.join('\r\n')}\r\n`;
}

/** Wykrywa separator z pierwszej niepustej linii. */
export function wykryjSeparator(tekst) {
  const linia = tekst.split(/\r?\n/).find((l) => l.trim() !== '') ?? '';
  const ile = (z) => linia.split(z).length - 1;
  const kandydaci = [[';', ile(';')], ['\t', ile('\t')], [',', ile(',')]];
  kandydaci.sort((a, b) => b[1] - a[1]);
  return kandydaci[0][1] > 0 ? kandydaci[0][0] : ';';
}

/** Tekst CSV → tablica wierszy (tablic tekstów). */
export function parsujCsv(tekst, separator = wykryjSeparator(tekst)) {
  const t = tekst.replace(/^﻿/, '');
  const wiersze = [];
  let wiersz = [];
  let pole = '';
  let wCudzyslowie = false;
  for (let i = 0; i < t.length; i += 1) {
    const c = t[i];
    if (wCudzyslowie) {
      if (c === '"') {
        if (t[i + 1] === '"') { pole += '"'; i += 1; } else wCudzyslowie = false;
      } else pole += c;
    } else if (c === '"' && pole === '') wCudzyslowie = true;
    else if (c === separator) { wiersz.push(pole); pole = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i += 1;
      wiersz.push(pole); wiersze.push(wiersz); wiersz = []; pole = '';
    } else pole += c;
  }
  if (pole !== '' || wiersz.length) { wiersz.push(pole); wiersze.push(wiersz); }
  return wiersze;
}

/** Tekst CSV → { wpisy, bledy }. */
export function importujCsv(tekst) {
  return wierszeNaWpisy(parsujCsv(tekst));
}

// Minimalny odczyt i zapis ZIP (format XLSX) bez bibliotek: metody 0 (bez kompresji) i 8 (deflate).
// Kompresję robią wbudowane strumienie przeglądarki (CompressionStream 'deflate-raw'), które ma też Node 21+.
// Bez ZIP64, szyfrowania i archiwów wieloczęściowych: pliki XLSX z arkuszy kalkulacyjnych ich nie używają.

import { BladDanych } from './logic.js';

// Ochrona przed „bombą ZIP”: suma zadeklarowanych rozmiarów ≤ MAX_ROZMIAR, a każdy wpis rozpakowujemy
// z licznikiem faktycznych bajtów i przerywamy, gdy przekroczy zadeklarowany rozmiar.
export const MAX_ROZMIAR = 50 * 1024 * 1024;

const TABLICA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bajty) {
  let c = 0xffffffff;
  for (let i = 0; i < bajty.length; i += 1) c = TABLICA_CRC[(c ^ bajty[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function przezStrumien(bajty, strumien) {
  const odp = new Response(new Blob([bajty]).stream().pipeThrough(strumien));
  return new Uint8Array(await odp.arrayBuffer());
}

/** Rozpakowuje deflate, ale najwyżej `limit` bajtów: po przekroczeniu przerywa strumień i rzuca BladDanych. */
export async function rozpakujZLimitem(bajty, limit) {
  const czytnik = new Blob([bajty]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const czesci = [];
  let razem = 0;
  try {
    for (;;) {
      const { done, value } = await czytnik.read();
      if (done) break;
      razem += value.length;
      if (razem > limit) {
        await czytnik.cancel().catch(() => {});
        throw new BladDanych('Uszkodzony albo podejrzany plik XLSX (rozpakowuje się do większego rozmiaru niż deklaruje).');
      }
      czesci.push(value);
    }
  } catch (e) {
    if (e instanceof BladDanych) throw e;
    throw new BladDanych('Uszkodzony plik XLSX (błąd rozpakowania).');
  }
  const wynik = new Uint8Array(razem);
  let o = 0;
  for (const c of czesci) { wynik.set(c, o); o += c.length; }
  return wynik;
}
const spakuj = (b) => przezStrumien(b, new CompressionStream('deflate-raw'));

/** ZIP (Uint8Array) → Map nazwa → Uint8Array. */
export async function czytajZip(dane) {
  const b = dane instanceof Uint8Array ? dane : new Uint8Array(dane);
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i -= 1) {
    if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new BladDanych('To nie jest plik XLSX (brak struktury ZIP).');
  const liczba = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const dekoder = new TextDecoder();
  const pliki = new Map();
  let razem = 0;
  for (let n = 0; n < liczba; n += 1) {
    if (p + 46 > b.length || v.getUint32(p, true) !== 0x02014b50) throw new BladDanych('Uszkodzony plik XLSX.');
    const flagi = v.getUint16(p + 8, true);
    const metoda = v.getUint16(p + 10, true);
    const rozmiarSkompr = v.getUint32(p + 20, true);
    const rozmiar = v.getUint32(p + 24, true);
    const dlNazwy = v.getUint16(p + 28, true);
    const dlExtra = v.getUint16(p + 30, true);
    const dlKom = v.getUint16(p + 32, true);
    const lokalny = v.getUint32(p + 42, true);
    const nazwa = dekoder.decode(b.subarray(p + 46, p + 46 + dlNazwy));
    p += 46 + dlNazwy + dlExtra + dlKom;
    if (flagi & 1) throw new BladDanych('Plik jest zaszyfrowany.');
    if (nazwa.endsWith('/')) continue;
    if (lokalny + 30 > b.length || v.getUint32(lokalny, true) !== 0x04034b50) throw new BladDanych('Uszkodzony plik XLSX.');
    const start = lokalny + 30 + v.getUint16(lokalny + 26, true) + v.getUint16(lokalny + 28, true);
    if (start + rozmiarSkompr > b.length) throw new BladDanych('Uszkodzony plik XLSX (wpis wychodzi poza plik).');
    const surowe = b.subarray(start, start + rozmiarSkompr);
    razem += rozmiar;
    if (razem > MAX_ROZMIAR) throw new BladDanych('Plik jest za duży.');
    let tresc;
    if (metoda === 0) tresc = surowe;
    else if (metoda === 8) tresc = await rozpakujZLimitem(surowe, rozmiar);
    else throw new BladDanych(`Nieobsługiwana kompresja w pliku (${metoda}).`);
    if (tresc.length !== rozmiar) throw new BladDanych('Uszkodzony plik XLSX (rozmiar niezgodny z deklarowanym).');
    pliki.set(nazwa, tresc);
  }
  return pliki;
}

/** Map nazwa → Uint8Array|string → ZIP (Uint8Array). Kolejność plików jak w mapie. */
export async function zapiszZip(pliki, { kompresja = true, data = new Date(Date.UTC(2026, 9, 21)) } = {}) {
  const koder = new TextEncoder();
  const czas = ((data.getUTCHours() << 11) | (data.getUTCMinutes() << 5) | (data.getUTCSeconds() >> 1)) & 0xffff;
  const dzien = (((data.getUTCFullYear() - 1980) << 9) | ((data.getUTCMonth() + 1) << 5) | data.getUTCDate()) & 0xffff;
  const czesci = [];
  const centralny = [];
  let przesuniecie = 0;
  for (const [nazwa, tresc] of pliki) {
    const surowe = typeof tresc === 'string' ? koder.encode(tresc) : tresc;
    const bNazwa = koder.encode(nazwa);
    let metoda = 0;
    let dane = surowe;
    if (kompresja && surowe.length > 64) {
      const s = await spakuj(surowe);
      if (s.length < surowe.length) { metoda = 8; dane = s; }
    }
    const crc = crc32(surowe);
    const lok = new DataView(new ArrayBuffer(30));
    lok.setUint32(0, 0x04034b50, true);
    lok.setUint16(4, 20, true);
    lok.setUint16(6, 0x0800, true); // nazwy w UTF-8
    lok.setUint16(8, metoda, true);
    lok.setUint16(10, czas, true);
    lok.setUint16(12, dzien, true);
    lok.setUint32(14, crc, true);
    lok.setUint32(18, dane.length, true);
    lok.setUint32(22, surowe.length, true);
    lok.setUint16(26, bNazwa.length, true);
    lok.setUint16(28, 0, true);
    czesci.push(new Uint8Array(lok.buffer), bNazwa, dane);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true);
    cen.setUint16(4, 20, true);
    cen.setUint16(6, 20, true);
    cen.setUint16(8, 0x0800, true);
    cen.setUint16(10, metoda, true);
    cen.setUint16(12, czas, true);
    cen.setUint16(14, dzien, true);
    cen.setUint32(16, crc, true);
    cen.setUint32(20, dane.length, true);
    cen.setUint32(24, surowe.length, true);
    cen.setUint16(28, bNazwa.length, true);
    cen.setUint32(42, przesuniecie, true);
    centralny.push(new Uint8Array(cen.buffer), bNazwa);
    przesuniecie += 30 + bNazwa.length + dane.length;
  }
  const rozmiarCen = centralny.reduce((s, c) => s + c.length, 0);
  const koniec = new DataView(new ArrayBuffer(22));
  koniec.setUint32(0, 0x06054b50, true);
  koniec.setUint16(8, pliki.size, true);
  koniec.setUint16(10, pliki.size, true);
  koniec.setUint32(12, rozmiarCen, true);
  koniec.setUint32(16, przesuniecie, true);
  const wszystko = [...czesci, ...centralny, new Uint8Array(koniec.buffer)];
  const wynik = new Uint8Array(wszystko.reduce((s, c) => s + c.length, 0));
  let o = 0;
  for (const c of wszystko) { wynik.set(c, o); o += c.length; }
  return wynik;
}

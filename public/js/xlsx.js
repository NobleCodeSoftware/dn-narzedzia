// Odczyt i zapis XLSX bez bibliotek, tylko w zakresie potrzebnym ewidencji.
// Odczyt: zakładka „Sprzedaż” (albo pierwsza), wartości komórek (liczby, teksty współdzielone i wbudowane).
// Zapis: wypełnia kolumny A–E naszego arkusza-wzoru (/pobierz/arkusz-limit-dn.xlsx) i zapisuje wyliczone
// wartości formuł F–I, więc plik wygląda tak samo jak pobrany arkusz, z tymi samymi formułami i kolorami.

import { BladDanych, groszeNaTekst } from './logic.js';
import { czytajZip, zapiszZip } from './zip.js';
import { posortuj, wartosciArkusza, wierszeNaWpisy, seryjnaZDaty, dataZSeryjnej } from './ewidencja-logika.js';

export const ARKUSZ_SPRZEDAZ = 'Sprzedaż';
export const PIERWSZY_WIERSZ = 5;
export const OSTATNI_WIERSZ_WZORU = 1004;

const dekoder = new TextDecoder();
const koder = new TextEncoder();

export function odkodujXml(t) {
  return t.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e) => {
    if (e[0] === '#') {
      const kod = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      if (!(kod >= 0 && kod <= 0x10ffff)) throw new BladDanych('Uszkodzony plik XLSX (niepoprawny znak w tekście).');
      return String.fromCodePoint(kod);
    }
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e.toLowerCase()];
  });
}

export function zakodujXml(t) {
  return String(t)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const atrybuty = (t) => Object.fromEntries([...t.matchAll(/([\w:]+)="([^"]*)"/g)].map((m) => [m[1], odkodujXml(m[2])]));
const tekstyT = (xml) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)].map((m) => odkodujXml(m[1] ?? '')).join('');

/** Kolumna z adresu komórki: "AB12" → 27 (od 0). */
export function indeksKolumny(adres) {
  const litery = /^([A-Z]+)/.exec(adres)[1];
  let n = 0;
  for (const c of litery) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

/** Ścieżka arkusza o nazwie `nazwa` (albo pierwszego) z workbook.xml i relacji. */
function sciezkaArkusza(pliki, nazwa) {
  const wb = pliki.get('xl/workbook.xml');
  if (!wb) throw new BladDanych('To nie jest plik XLSX (brak skoroszytu).');
  const xml = dekoder.decode(wb);
  const arkusze = [...xml.matchAll(/<sheet\b([^>]*)\/?>/g)].map((m) => atrybuty(m[1]));
  if (!arkusze.length) throw new BladDanych('Plik nie ma żadnej zakładki.');
  const wybrany = arkusze.find((a) => a.name === nazwa) ?? arkusze[0];
  const rid = wybrany['r:id'] ?? Object.entries(wybrany).find(([k]) => k.endsWith(':id'))?.[1];
  const rels = dekoder.decode(pliki.get('xl/_rels/workbook.xml.rels') ?? new Uint8Array());
  const rel = [...rels.matchAll(/<Relationship\b([^>]*)\/?>/g)].map((m) => atrybuty(m[1])).find((r) => r.Id === rid);
  if (!rel) throw new BladDanych('Uszkodzony plik XLSX (brak relacji arkusza).');
  const cel = rel.Target.startsWith('/') ? rel.Target.slice(1) : `xl/${rel.Target.replace(/^\.\//, '')}`;
  return { sciezka: cel, nazwa: wybrany.name, system1904: /<workbookPr\b[^>]*date1904="(1|true)"/.test(xml) };
}

/** Komórki arkusza jako tablica wierszy (wartości: liczba, tekst albo ''). */
export function komorkiArkusza(xmlArkusza, wspolne, maxWierszy = 100000) {
  const wiersze = [];
  for (const mw of xmlArkusza.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const r = Number(atrybuty(mw[1]).r);
    if (!r || r > maxWierszy) continue;
    const komorki = [];
    let poz = 0;
    for (const mc of (mw[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const a = atrybuty(mc[1]);
      const k = a.r ? indeksKolumny(a.r) : poz;
      poz = k + 1;
      const wnetrze = mc[2] ?? '';
      const v = /<v>([\s\S]*?)<\/v>/.exec(wnetrze)?.[1];
      let wartosc = '';
      if (a.t === 's') wartosc = v === undefined ? '' : (wspolne[Number(v)] ?? '');
      else if (a.t === 'inlineStr') wartosc = tekstyT(/<is>([\s\S]*?)<\/is>/.exec(wnetrze)?.[1] ?? '');
      else if (a.t === 'str' || a.t === 'e') wartosc = v === undefined ? '' : odkodujXml(v);
      else if (a.t === 'b') wartosc = v === '1' ? 'PRAWDA' : 'FAŁSZ';
      else if (v !== undefined && v !== '') wartosc = Number(v);
      komorki[k] = wartosc;
    }
    wiersze[r - 1] = komorki;
  }
  return Array.from(wiersze, (w) => w ?? []);
}

/** XLSX (ArrayBuffer/Uint8Array) → { wpisy, bledy, arkusz }. */
export async function importujXlsx(dane) {
  const pliki = await czytajZip(dane);
  const { sciezka, nazwa, system1904 } = sciezkaArkusza(pliki, ARKUSZ_SPRZEDAZ);
  const xml = pliki.get(sciezka);
  if (!xml) throw new BladDanych('Uszkodzony plik XLSX (brak arkusza).');
  const sst = pliki.get('xl/sharedStrings.xml');
  const wspolne = sst ? [...dekoder.decode(sst).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => tekstyT(m[1])) : [];
  const wiersze = komorkiArkusza(dekoder.decode(xml), wspolne);
  // Kolumna z datą: liczby to numery seryjne Excela (z uwzględnieniem systemu 1904).
  const przeliczone = wiersze.map((w) => w.map((v, i) => (i === 0 && typeof v === 'number' && v > 59 ? dataZSeryjnej(v, system1904) : v)));
  return { ...wierszeNaWpisy(przeliczone), arkusz: nazwa };
}

// ------------------------------------------------------------ zapis

function komorkaWartosci(adres, styl, wartosc) {
  const s = styl ? ` s="${styl}"` : '';
  if (wartosc === '' || wartosc === null || wartosc === undefined) return `<c r="${adres}"${s}/>`;
  if (typeof wartosc === 'number') return `<c r="${adres}"${s}><v>${wartosc}</v></c>`;
  return `<c r="${adres}"${s} t="inlineStr"><is><t xml:space="preserve">${zakodujXml(wartosc)}</t></is></c>`;
}

/** Ustawia zapisaną wartość komórki z formułą (bez zmiany formuły). */
function wartoscFormuly(xmlKomorki, wartosc) {
  const m = /^(<c\b[^>]*>)([\s\S]*)<\/c>$/.exec(xmlKomorki);
  if (!m) return xmlKomorki;
  let otwarcie = m[1].replace(/\st="[^"]*"/, '');
  if (typeof wartosc === 'string' && wartosc !== '') otwarcie = otwarcie.replace(/^<c\b/, '<c t="str"');
  const wnetrze = m[2].replace(/<v>[\s\S]*?<\/v>|<v\/>/g, '');
  const v = wartosc === '' ? '' : `<v>${typeof wartosc === 'number' ? wartosc : zakodujXml(wartosc)}</v>`;
  return `${otwarcie}${wnetrze}${v}</c>`;
}

/** Podmienia komórki A–I w wierszu wzoru. */
function wypelnijWiersz(xmlWiersza, nr, wpis, wart) {
  const komorki = new Map();
  for (const m of xmlWiersza.matchAll(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g)) {
    const a = atrybuty(/^<c\b([^>]*?)\/?>/.exec(m[0])[1]);
    komorki.set(indeksKolumny(a.r), { xml: m[0], styl: a.s });
  }
  const styl = (k) => komorki.get(k)?.styl;
  const liczba = (t) => Number(t);
  const nowe = new Map(komorki);
  nowe.set(0, { xml: komorkaWartosci(`A${nr}`, styl(0), seryjnaZDaty(wpis.data)) });
  nowe.set(1, { xml: komorkaWartosci(`B${nr}`, styl(1), wpis.opis) });
  nowe.set(2, { xml: komorkaWartosci(`C${nr}`, styl(2), liczba(wpis.kwota)) });
  nowe.set(3, { xml: komorkaWartosci(`D${nr}`, styl(3), wpis.waluta) });
  nowe.set(4, { xml: komorkaWartosci(`E${nr}`, styl(4), wpis.kurs ? liczba(wpis.kurs) : '') });
  const wartosci = [
    typeof wart.F === 'bigint' ? Number(groszeNaTekst(wart.F)) : wart.F,
    typeof wart.G === 'bigint' ? Number(groszeNaTekst(wart.G)) : wart.G,
    wart.H,
    wart.I,
  ];
  wartosci.forEach((w, i) => {
    const k = 5 + i;
    if (komorki.has(k) && /<f>/.test(komorki.get(k).xml)) nowe.set(k, { xml: wartoscFormuly(komorki.get(k).xml, w) });
  });
  const tresc = [...nowe.entries()].sort((a, b) => a[0] - b[0]).map(([, c]) => c.xml).join('');
  return xmlWiersza.replace(/^(<row\b[^>]*>)[\s\S]*(<\/row>)$/, (_, a, b) => `${a}${tresc}${b}`);
}

/**
 * Rozszerza wzór o wiersze ponad 1004 (gdy wpisów jest więcej niż 1000): zakresy $5:$1004 dostają nowy
 * koniec we wszystkich arkuszach, a wiersz 1004 jest kopiowany z przesuniętymi odwołaniami.
 */
function rozszerzWzor(xmlSprzedaz, xmlInne, ostatni) {
  const zakresy = (x) => x
    .replace(/\$1004(?!\d)/g, () => `$${ostatni}`)
    .replace(/([A-I]\$?)5:(\$?[A-I]\$?)1004(?!\d)/g, (_, a, b) => `${a}5:${b}${ostatni}`)
    .replace(/<dimension ref="A1:I1004"\/>/, () => `<dimension ref="A1:I${ostatni}"/>`);
  let s = zakresy(xmlSprzedaz);
  const m = /<row r="1004"[\s\S]*?<\/row>/.exec(s);
  if (!m) throw new BladDanych('Nieoczekiwany układ arkusza-wzoru.');
  const dodatkowe = [];
  for (let r = 1005; r <= ostatni; r += 1) dodatkowe.push(m[0].replace(/(?<![\d$])1004(?!\d)/g, () => String(r)));
  s = s.replace(m[0], () => m[0] + dodatkowe.join(''));
  return { sprzedaz: s, inne: xmlInne.map(([n, x]) => [n, zakresy(x)]) };
}

/**
 * Wpisy → XLSX na podstawie wzoru (Uint8Array pliku /pobierz/arkusz-limit-dn.xlsx).
 * Zwraca Uint8Array gotowy do zapisania.
 */
export async function eksportujXlsx(wpisy, wzor) {
  const pliki = await czytajZip(wzor);
  const { sciezka } = sciezkaArkusza(pliki, ARKUSZ_SPRZEDAZ);
  const z = posortuj(wpisy);
  const wart = wartosciArkusza(z);
  let xml = dekoder.decode(pliki.get(sciezka));
  const ostatni = PIERWSZY_WIERSZ + z.length - 1;
  if (ostatni > OSTATNI_WIERSZ_WZORU) {
    const inne = [...pliki.keys()].filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n) && n !== sciezka)
      .map((n) => [n, dekoder.decode(pliki.get(n))]);
    const r = rozszerzWzor(xml, inne, ostatni);
    xml = r.sprzedaz;
    for (const [n, x] of r.inne) pliki.set(n, koder.encode(x));
  }
  xml = xml.replace(/<row r="(\d+)"[^>]*>[\s\S]*?<\/row>/g, (wiersz, nr) => {
    const i = Number(nr) - PIERWSZY_WIERSZ;
    return i >= 0 && i < z.length ? wypelnijWiersz(wiersz, Number(nr), z[i], wart[i]) : wiersz;
  });
  pliki.set(sciezka, koder.encode(xml));
  return zapiszZip(pliki);
}

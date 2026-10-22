// Higiena stron: noindex, ścisły CSP, stopka, brak zewnętrznych skryptów,
// brak skryptów i stylów inline, brak ciasteczek.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));

function pliki(katalog, rozszerzenie) {
  return readdirSync(katalog).flatMap((n) => {
    const p = join(katalog, n);
    if (statSync(p).isDirectory()) return pliki(p, rozszerzenie);
    return p.endsWith(rozszerzenie) ? [p] : [];
  });
}

const HTML = pliki(PUBLIC, '.html');
const JS = pliki(PUBLIC, '.js');
const STOPKA = 'Eksperyment NobleCode, prowadzony z udziałem AI · Nie stanowi doradztwa podatkowego';
const naglowki = readFileSync(join(PUBLIC, '_headers'), 'utf8');
const cspNaglowek = /Content-Security-Policy: (.+)/.exec(naglowki)[1].trim();

test('są wszystkie strony', () => {
  const sciezki = HTML.map((p) => relative(PUBLIC, p).replaceAll('\\', '/')).sort();
  assert.deepEqual(sciezki, ['faktura/index.html', 'index.html', 'o-nas/index.html', 'prywatnosc/index.html', 'regulamin/index.html']);
});

// Ewidencja działa w przeglądarce, ale pamięć przeglądarki ma tylko magazyn.js, a zapytania sieciowe tylko widok ewidencji
// (wzór arkusza z /pobierz/ i kurs NBP przez nbp.js).
test('bez linków do usuniętych podstron, pamięć i sieć tylko w wyznaczonych modułach', () => {
  for (const plik of [...HTML, ...JS]) {
    const tresc = readFileSync(plik, 'utf8');
    const nazwa = relative(PUBLIC, plik).replaceAll('\\', '/');
    assert.ok(!/ewidencja-sprzedazy|\/limit-dzialalnosc-nierejestrowana\/|\/ksef-2027-dzialalnosc/.test(tresc), `${plik}: odwołanie do usuniętej strony`);
    assert.ok(!/sessionStorage|indexedDB|XMLHttpRequest|WebSocket|sendBeacon/.test(tresc), `${plik}: niedozwolone API`);
    if (nazwa !== 'js/magazyn.js' && plik.endsWith('.js')) assert.ok(!/localStorage/.test(tresc), `${plik}: localStorage poza magazyn.js`);
    if (nazwa !== 'js/ewidencja-widok.js') assert.ok(!/\bfetch\(/.test(tresc), `${plik}: fetch poza widokiem ewidencji`);
  }
  const widok = readFileSync(join(PUBLIC, 'js/ewidencja-widok.js'), 'utf8');
  for (const [, cel] of widok.matchAll(/fetch\(([^,)]+)/g)) assert.ok(["'/pobierz/arkusz-limit-dn.xlsx'", '...a'].includes(cel.trim()), `fetch do ${cel}`);
});

// Stroną główną jest ewidencja, licznik to drugorzędne „Szybkie sprawdzenie” niżej.
test('strona główna: ewidencja na górze, licznik niżej, sekcja KSeF ze źródłami, jedna akcja „Pobierz arkusz”', () => {
  const html = readFileSync(join(PUBLIC, 'index.html'), 'utf8');
  assert.match(html, /<h1>Ewidencja sprzedaży i limit działalności nierejestrowanej<\/h1>/);
  assert.ok(html.indexOf('id="stan"') < html.indexOf('id="wpis-form"'), 'stan kwartału przed formularzem');
  assert.ok(html.indexOf('id="pliki"') < html.indexOf('id="licznik"'), 'licznik pod ewidencją');
  assert.match(html, /<h2 id="licznik-tytul">Szybkie sprawdzenie bez ewidencji<\/h2>/);
  const nav = /<nav class="nawigacja"[^>]*>([\s\S]*?)<\/nav>/.exec(html)[1];
  assert.match(nav, /Ewidencja/);
  assert.ok(!/Licznik/.test(nav), 'licznik nie jest w nawigacji');
  // nawigacja „Ewidencja, Faktura” na każdej stronie
  for (const plik of HTML) {
    const n = /<nav class="nawigacja"[^>]*>([\s\S]*?)<\/nav>/.exec(readFileSync(plik, 'utf8'))[1];
    assert.deepEqual([...n.matchAll(/<a href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map((m) => [m[1], m[2]]), [['/', 'Ewidencja'], ['/faktura/', 'Faktura']], plik);
  }
  assert.match(html, /10&nbsp;813,50/);
  assert.match(html, /11&nbsp;137,50/);
  assert.match(html, /<h2 id="ksef-tytul">KSeF od 2027 w działalności nierejestrowanej<\/h2>/);
  assert.match(html, /href="https:\/\/ksef\.podatki\.gov\.pl\//);
  assert.match(html, /href="https:\/\/www\.biznes\.gov\.pl\//);
  const licznik = html.slice(html.indexOf('<form id="limit-form"'), html.indexOf('</form>', html.indexOf('<form id="limit-form"')));
  assert.equal([...licznik.matchAll(/<button\b/g)].length, 1, 'jeden przycisk w liczniku');
  const pobierz = [...html.matchAll(/href="(\/pobierz\/[^"]+)" download/g)].map((m) => m[1]);
  assert.deepEqual(pobierz, ['/pobierz/arkusz-limit-dn.xlsx']);
  const ksef = html.slice(html.indexOf('id="ksef"'), html.indexOf('</section>', html.indexOf('id="ksef"')));
  const slowa = ksef.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').split(/\s+/).filter((w) => /[\p{L}\d]/u.test(w));
  assert.ok(slowa.length <= 150, `sekcja KSeF ma ${slowa.length} słów`);
});

test('arkusz XLSX: jest, to ZIP, bez makr i łączy zewnętrznych', () => {
  const plik = readFileSync(join(PUBLIC, 'pobierz/arkusz-limit-dn.xlsx'));
  assert.equal(plik.subarray(0, 2).toString('latin1'), 'PK');
  const nazwy = plik.toString('latin1'); // nazwy plików w ZIP nie są kompresowane
  assert.ok(nazwy.includes('xl/workbook.xml'));
  for (const zakazane of ['vbaProject', 'externalLink', 'activeX', 'connections.xml', 'queryTable']) {
    assert.ok(!nazwy.includes(zakazane), `arkusz zawiera ${zakazane}`);
  }
});

test('_redirects: tylko stałe przekierowania usuniętych podstron na stronę główną', () => {
  const linie = readFileSync(join(PUBLIC, '_redirects'), 'utf8').split('\n').filter((l) => l.trim() && !l.startsWith('#'));
  assert.ok(linie.length > 0);
  for (const l of linie) assert.match(l, /^\/[a-z0-9-]+\/? \/(#[a-z]+)? 301$/, l);
});

for (const plik of HTML) {
  const nazwa = relative(PUBLIC, plik);
  const html = readFileSync(plik, 'utf8');
  test(`${nazwa}: noindex, CSP, stopka, bez inline i zewnętrznych skryptów`, () => {
    assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
    const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html);
    assert.ok(csp, 'brak meta CSP');
    assert.equal(`${csp[1]}; frame-ancestors 'none'`, cspNaglowek, 'meta CSP różni się od _headers');
    assert.ok(!/unsafe-inline|unsafe-eval|\*/.test(csp[1]), 'CSP nie może zawierać unsafe-* ani *');
    assert.ok(html.includes(STOPKA), 'brak stopki');
    assert.ok(!/<script(?![^>]*\ssrc=")[^>]*>/.test(html), 'skrypt inline');
    assert.ok(!/\sstyle="/.test(html) && !/<style/.test(html), 'styl inline');
    assert.ok(!/\son[a-z]+="/.test(html), 'obsługa zdarzeń inline');
    for (const [, src] of html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)) assert.match(src, /^\/js\//);
    for (const [, href] of html.matchAll(/<link[^>]*\shref="([^"]+)"/g)) assert.match(href, /^\//);
    assert.match(html, /<html lang="pl">/);
    assert.match(html, /<meta name="viewport"/);
  });
}

test('_headers: noindex, nosniff, frame-ancestors', () => {
  assert.match(naglowki, /X-Robots-Tag: noindex, nofollow/);
  assert.match(naglowki, /X-Content-Type-Options: nosniff/);
  assert.match(cspNaglowek, /frame-ancestors 'none'/);
  assert.match(cspNaglowek, /^default-src 'none';/);
  // Jedyny zewnętrzny serwer to API NBP (kurs średni; API odpowiada nagłówkiem Access-Control-Allow-Origin: *).
  assert.match(cspNaglowek, /; connect-src 'self' https:\/\/api\.nbp\.pl; /);
  assert.equal([...cspNaglowek.matchAll(/https?:\/\//g)].length, 1, 'jeden zewnętrzny adres w CSP');
});

test('JS: brak ciasteczek, eval i zewnętrznych adresów', () => {
  for (const plik of JS) {
    const kod = readFileSync(plik, 'utf8');
    assert.ok(!/document\.cookie/.test(kod), `${plik}: document.cookie`);
    assert.ok(!/\beval\(|new Function\(/.test(kod), `${plik}: eval`);
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML/.test(kod), `${plik}: wstrzykiwanie HTML`);
    const adresy = [...kod.matchAll(/https?:\/\/[^\s'"`]+/g)].map((m) => m[0]);
    const dozwolone = plik.endsWith('nbp.js') ? ['https://api.nbp.pl/api/exchangerates/rates/a'] : [];
    assert.deepEqual(adresy, dozwolone, `${plik}: zewnętrzny adres`);
  }
});

// Jedyny dopuszczalny adres e-mail w HTML to adres kontaktowy. Każdy inny adres,
// np. prywatny, ma wywołać błąd.
const EMAIL_KONTAKTOWY = 'kontakt@noblecode.pl';
const ADRES_EMAIL = /[A-Za-z0-9._%+-]+(?:@|%40|&#0*64;|&#x0*40;|&commat;)[A-Za-z0-9.-]+\.[A-Za-z]{2,}/gi;

test('strony prawne: dane usługodawcy, w HTML tylko adres kontaktowy', () => {
  const onas = readFileSync(join(PUBLIC, 'o-nas/index.html'), 'utf8');
  assert.ok(onas.includes('<strong>Usługodawca:</strong> NobleCode Krzysztof Mizgała<br>'), 'nazwa usługodawcy');
  assert.ok(onas.includes(`<strong>E-mail:</strong> <a href="mailto:${EMAIL_KONTAKTOWY}">${EMAIL_KONTAKTOWY}</a>`), 'pole e-mail');
  for (const plik of HTML) {
    const html = readFileSync(plik, 'utf8');
    assert.ok(html.includes(`<a href="mailto:${EMAIL_KONTAKTOWY}">${EMAIL_KONTAKTOWY}</a>`), `${plik}: brak adresu kontaktowego`);
    for (const [adres] of html.matchAll(ADRES_EMAIL)) {
      assert.equal(adres.replace(/^mailto:/i, ''), EMAIL_KONTAKTOWY, `${plik}: niedozwolony adres e-mail ${adres}`);
    }
    for (const [, href] of html.matchAll(/href="mailto:([^"]*)"/gi)) {
      assert.equal(href, EMAIL_KONTAKTOWY, `${plik}: mailto na inny adres`);
    }
  }
});

test('wykrywanie adresów e-mail: dopuszcza tylko adres kontaktowy', () => {
  const znajdz = (t) => [...t.matchAll(ADRES_EMAIL)].map((m) => m[0]).filter((a) => a.replace(/^mailto:/i, '') !== EMAIL_KONTAKTOWY);
  assert.deepEqual(znajdz(`<a href="mailto:${EMAIL_KONTAKTOWY}">${EMAIL_KONTAKTOWY}</a>`), []);
  for (const inny of ['jan.kowalski@example.com', 'prywatny@example.pl', 'Kontakt@NobleCode.PL', 'inny@noblecode.pl',
    'kontakt@noblecode.pl.evil.com', 'xkontakt@noblecode.pl', 'jan&#64;example.com', 'jan%40example.com']) {
    assert.ok(znajdz(`<p>${inny}</p>`).length, `nie wykryto: ${inny}`);
  }
});

// Czytelność: krótkie akapity, rozwinięte skróty, link do sekcji o przekroczeniu, kontrast AA.
test('strona główna: najwyżej 2 zdania w akapicie, skróty rozwinięte, kwota limitu pod tytułem', () => {
  const html = readFileSync(join(PUBLIC, 'index.html'), 'utf8');
  const main = html.slice(html.indexOf('<main'), html.indexOf('</main>'));
  for (const [, blok] of main.matchAll(/<(?:p|dd|li)\b[^>]*>([\s\S]*?)<\/(?:p|dd|li)>/g)) {
    const tekst = blok.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    const zdania = 1 + [...tekst.matchAll(/[.!?]\s+(?=[A-ZĄĆĘŁŃÓŚŹŻ])/g)].length;
    assert.ok(zdania <= 2, `${zdania} zdania: ${tekst}`);
  }
  const lead = /<p class="lead">([\s\S]*?)<\/p>/.exec(html)[1];
  assert.match(lead, /10&nbsp;813,50/);
  assert.match(lead, /11&nbsp;137,50/);
  assert.match(main, /KSeF \(Krajowy System e-Faktur\)/);
  assert.match(main, /CEIDG \(Centralnej Ewidencji i Informacji\s+o Działalności Gospodarczej\)/);
  assert.match(main, /<section id="przekroczenie"/);
  assert.match(main, /<a href="#przekroczenie">/);
});

test('regulamin: faza testowa tylko w pkt 8, opis kursu NBP', () => {
  const reg = readFileSync(join(PUBLIC, 'regulamin/index.html'), 'utf8');
  const pkt8 = reg.indexOf('<h2>8.');
  assert.ok(pkt8 > 0);
  assert.ok([...reg.matchAll(/fazie testowej/g)].every((m) => m.index > pkt8), 'faza testowa poza pkt 8');
  assert.match(reg, /może go zmienić albo wpisać sam/);
});

function luminancja(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const kontrast = (a, b) => { const [x, y] = [luminancja(a), luminancja(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

test('CSS: kontrast progów ≥ 4,5:1 i obramowania pól ≥ 3:1 w obu motywach', () => {
  const css = readFileSync(join(PUBLIC, 'css/style.css'), 'utf8');
  const motyw = (blok) => Object.fromEntries([...blok.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]));
  const jasny = motyw(css.slice(0, css.indexOf('@media (prefers-color-scheme: dark)')));
  const ciemny = { ...jasny, ...motyw(css.slice(css.indexOf(':root[data-theme="dark"]'), css.indexOf('* {'))) };
  for (const [nazwa, v] of [['jasny', jasny], ['ciemny', ciemny]]) {
    for (const k of ['text', 'muted', 'accent', 'ok', 'p70', 'p85', 'p95', 'p100']) {
      for (const tlo of ['surface', 'bg']) assert.ok(kontrast(v[k], v[tlo]) >= 4.5, `${nazwa}: --${k} na --${tlo} = ${kontrast(v[k], v[tlo]).toFixed(2)}`);
    }
    for (const tlo of ['surface', 'bg']) assert.ok(kontrast(v['field-border'], v[tlo]) >= 3, `${nazwa}: obramowanie pól na --${tlo}`);
    for (const k of ['ok', 'p70', 'p85', 'p95', 'p100']) assert.ok(kontrast(v[k], v.track) >= 3, `${nazwa}: pasek --${k} na torze`);
  }
});

test('strona główna: wynik bez aria-live, ogłoszenia tylko przez osobny region', () => {
  const html = readFileSync(join(PUBLIC, 'index.html'), 'utf8');
  assert.match(html, /<div id="wynik" class="wynik" hidden>/);
  assert.equal([...html.matchAll(/aria-live=/g)].length, 1, 'jeden region aria-live');
  assert.match(html, /<p id="ogloszenie" class="sr-only" aria-live="polite" aria-atomic="true"><\/p>/);
});

// Oznaczenie usługodawcy: ta sama nazwa w stopce każdej strony, w regulaminie i w polityce prywatności.
test('usługodawca: ta sama nazwa w stopce, w regulaminie i w polityce prywatności', () => {
  for (const plik of HTML) {
    assert.ok(readFileSync(plik, 'utf8').includes('Usługodawca: NobleCode Krzysztof Mizgała · '), `${plik}: stopka bez nazwy usługodawcy`);
  }
  for (const s of ['regulamin', 'prywatnosc']) {
    const t = readFileSync(join(PUBLIC, `${s}/index.html`), 'utf8');
    assert.match(t, /Wersja:? 0\.5, obowiązuje od dnia publikacji na stronie\./, `${s}: wersja 0.5`);
    assert.ok(t.includes('NobleCode Krzysztof Mizgała, e-mail:'), `${s}: nazwa w treści`);
  }
});

// ---------------------------------------------------------------- ewidencja i proporcje stron

const tekstMain = (html) => html.slice(html.indexOf('<main'), html.indexOf('</main>'));
const PUSTE = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

/**
 * Widoczny tekst <main>, tak jak widzi go użytkownik: bez elementów z atrybutem hidden, <dialog>, .sr-only, .tylko-druk
 * (oraz script, style, template). Prosty skaner znaczników ze stosem zagnieżdżeń.
 */
export function widocznyTekst(html) {
  const main = tekstMain(html);
  let wynik = '';
  let pomijaj = 0; // głębokość wewnątrz pomijanego elementu
  let ostatni = 0;
  for (const m of main.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*)>/g)) {
    if (!pomijaj) wynik += main.slice(ostatni, m.index);
    ostatni = m.index + m[0].length;
    const [, zamykajacy, tag, atr] = m;
    const nazwa = tag.toLowerCase();
    if (PUSTE.has(nazwa) || atr.endsWith('/')) { if (!pomijaj) wynik += ' '; continue; }
    if (zamykajacy) { if (pomijaj) pomijaj -= 1; else wynik += ' '; continue; }
    const klasy = (/\sclass="([^"]*)"/.exec(atr)?.[1] ?? '').split(/\s+/);
    const ukryty = /\shidden(?:[\s=]|$)/.test(atr) || ['dialog', 'script', 'style', 'template'].includes(nazwa)
      || klasy.includes('sr-only') || klasy.includes('tylko-druk');
    if (pomijaj || ukryty) pomijaj += 1; else wynik += ' ';
  }
  if (!pomijaj) wynik += main.slice(ostatni);
  return wynik.replace(/&nbsp;/g, ' ');
}
const slowa = (html) => widocznyTekst(html).split(/\s+/).filter((w) => /[\p{L}\d]/u.test(w)).length;

test('_redirects: stary adres /ewidencja/ prowadzi na stronę główną, katalogu nie ma (bez pętli)', () => {
  const r = readFileSync(join(PUBLIC, '_redirects'), 'utf8');
  assert.match(r, /^\/ewidencja\/ \/ 301$/m);
  assert.ok(!HTML.some((p) => relative(PUBLIC, p).startsWith('ewidencja')), 'katalog ewidencja/ nie istnieje');
  for (const p of HTML) assert.ok(!/href="\/ewidencja\//.test(readFileSync(p, 'utf8')), `${p}: link do /ewidencja/`);
});

test('widok ewidencji: replaceChildren tylko przez zastap() (bez „null” na stronie i w wydruku)', () => {
  const kod = readFileSync(join(PUBLIC, 'js/ewidencja-widok.js'), 'utf8');
  const wywolania = [...kod.matchAll(/\.replaceChildren\(/g)];
  assert.equal(wywolania.length, 1, 'jedno wywołanie, w zastap()');
  assert.match(kod, /function zastap\(rodzic, \.\.\.dzieci\) \{\n {2}rodzic\.replaceChildren\(\.\.\.dzieci\.flat\(\)\.filter\(\(d\) => d !== null && d !== undefined && d !== false\)\);/);
  assert.match(kod, /zastap\(\$\('wydruk'\),/);
});

test('ewidencja: najwyżej 2 zdania w akapicie, etykiety pól, jeden region aria-live, wydruk w osobnym CSS', () => {
  const html = readFileSync(join(PUBLIC, 'index.html'), 'utf8');
  for (const [, blok] of tekstMain(html).matchAll(/<(?:p|dd|li)\b[^>]*>([\s\S]*?)<\/(?:p|dd|li)>/g)) {
    const tekst = blok.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    const zdania = 1 + [...tekst.matchAll(/[.!?]\s+(?=[A-ZĄĆĘŁŃÓŚŹŻ])/g)].length;
    assert.ok(zdania <= 2, `${zdania} zdania: ${tekst}`);
  }
  for (const [, id] of html.matchAll(/<(?:input|select)\b[^>]*\sid="([^"]+)"/g)) {
    if (id === 'plik') continue; // ukryte pole pliku, otwierane przyciskami „Wczytaj”
    assert.match(html, new RegExp(`<label for="${id}"`), `pole ${id} bez etykiety`);
  }
  assert.equal([...html.matchAll(/aria-live=/g)].length, 1, 'jeden region aria-live');
  assert.match(html, /<link rel="stylesheet" href="\/css\/druk\.css" media="print">/);
  for (const [, typ] of html.matchAll(/<button\b([^>]*)>/g)) assert.match(typ, /type="(button|submit)"/, 'przycisk bez type');
});

test('ewidencja: sekcja po przekroczeniu z 7 dniami, linkami do biznes.gov.pl i ZUS, bez liczenia podatku', () => {
  const html = readFileSync(join(PUBLIC, 'index.html'), 'utf8');
  const s = html.slice(html.indexOf('id="przekroczenie"'), html.indexOf('</section>', html.indexOf('id="przekroczenie"')));
  assert.match(s, /7 dni/);
  assert.match(s, /href="https:\/\/www\.biznes\.gov\.pl\//);
  assert.match(s, /href="https:\/\/www\.zus\.pl\//);
  assert.match(s, /Podatku tu nie liczymy/);
  assert.match(s, /sprawdzone \d{2}\.\d{2}\.\d{4}/);
});

test('strony prawne krótkie w porównaniu ze stronami funkcji (najwyżej 1,5× słów)', () => {
  const funkcje = ['index.html', 'faktura/index.html'].reduce((s, p) => s + slowa(readFileSync(join(PUBLIC, p), 'utf8')), 0);
  const prawne = ['regulamin/index.html', 'prywatnosc/index.html', 'o-nas/index.html'].reduce((s, p) => s + slowa(readFileSync(join(PUBLIC, p), 'utf8')), 0);
  assert.ok(prawne <= 1.5 * funkcje, `prawne ${prawne} słów, funkcje ${funkcje} słów (${(prawne / funkcje).toFixed(2)}×)`);
});

test('polityka prywatności opisuje pamięć przeglądarki i zapytanie do NBP (tylko waluta i data)', () => {
  const pol = readFileSync(join(PUBLIC, 'prywatnosc/index.html'), 'utf8');
  assert.match(pol, /<h2>Pamięć przeglądarki<\/h2>/);
  assert.match(pol, /localStorage/);
  assert.match(pol, /Wyczyść dane/);
  assert.match(pol, /<h2>Kurs NBP<\/h2>/);
  assert.match(pol, /tylko kod waluty i zakres dat/);
});

// ---------------------------------------------------------------- faktura bez VAT (zwolnienie)

test('faktura: najwyżej 2 zdania w akapicie, etykiety pól, jeden region aria-live, jedna główna akcja, wydruk w osobnym CSS', () => {
  const html = readFileSync(join(PUBLIC, 'faktura/index.html'), 'utf8');
  for (const [, blok] of tekstMain(html).matchAll(/<(?:p|dd|li)\b[^>]*>([\s\S]*?)<\/(?:p|dd|li)>/g)) {
    const tekst = blok.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    const zdania = 1 + [...tekst.matchAll(/[.!?]\s+(?=[A-ZĄĆĘŁŃÓŚŹŻ])/g)].length;
    assert.ok(zdania <= 2, `${zdania} zdania: ${tekst}`);
  }
  for (const [, id] of html.matchAll(/<(?:input|select)\b[^>]*\sid="([^"]+)"/g)) {
    assert.match(html, new RegExp(`<label for="${id}"`), `pole ${id} bez etykiety`);
  }
  assert.equal([...html.matchAll(/aria-live=/g)].length, 1, 'jeden region aria-live');
  assert.equal([...html.matchAll(/class="glowny"/g)].length, 1, 'jeden przycisk główny');
  assert.match(html, /<button type="submit" class="glowny" id="wystaw">Wystaw i drukuj fakturę<\/button>/);
  assert.match(html, /<link rel="stylesheet" href="\/css\/druk\.css" media="print">/);
  assert.match(html, /<section id="wydruk" class="tylko-druk"/);
  for (const [, typ] of html.matchAll(/<button\b([^>]*)>/g)) assert.match(typ, /type="(button|submit)"/, 'przycisk bez type');
  assert.match(html, /<h1>Faktura bez VAT \(zwolnienie\)<\/h1>/);
});

test('faktura: blokada KSeF z odesłaniem do ksef.podatki.gov.pl i źródła z datą (art. 106e, 145m)', () => {
  const html = readFileSync(join(PUBLIC, 'faktura/index.html'), 'utf8');
  const blokada = html.slice(html.indexOf('id="ksef-blokada"'), html.indexOf('</div>', html.indexOf('id="ksef-blokada"')));
  assert.match(blokada, /class="ramka alarm"/);
  assert.match(blokada, /href="https:\/\/ksef\.podatki\.gov\.pl\/"/);
  const zasady = html.slice(html.indexOf('id="zasady"'), html.indexOf('</section>', html.indexOf('id="zasady"')));
  assert.match(zasady, /sprawdzone \d{2}\.\d{2}\.\d{4}/);
  assert.match(zasady, /href="https:\/\/api\.sejm\.gov\.pl\/eli\/acts\/DU\/2026\/1263\/text\.pdf"/);
  assert.match(zasady, /href="https:\/\/ksef\.podatki\.gov\.pl\/ponizej-10-000-zl\/"/);
  assert.match(zasady, /href="https:\/\/www\.biznes\.gov\.pl\//);
  assert.match(zasady, /145m/);
});

test('widok faktury: replaceChildren tylko przez zastap(), bez sieci, localStorage tylko przez magazyn.js', () => {
  const kod = readFileSync(join(PUBLIC, 'js/faktura-widok.js'), 'utf8');
  assert.equal([...kod.matchAll(/\.replaceChildren\(/g)].length, 1, 'jedno wywołanie, w zastap()');
  assert.match(kod, /function zastap\(rodzic, \.\.\.dzieci\) \{\n {2}rodzic\.replaceChildren\(\.\.\.dzieci\.flat\(\)\.filter\(\(d\) => d !== null && d !== undefined && d !== false\)\);/);
  assert.match(kod, /zastap\(\$\('wydruk'\),/);
  assert.ok(!/\bfetch\(|localStorage/.test(kod));
  assert.match(kod, /window\.print\(\)/);
});

test('polityka i regulamin opisują fakturę i dane klientów w pamięci przeglądarki', () => {
  const pol = readFileSync(join(PUBLIC, 'prywatnosc/index.html'), 'utf8').replace(/\s+/g, ' ');
  const reg = readFileSync(join(PUBLIC, 'regulamin/index.html'), 'utf8').replace(/\s+/g, ' ');
  assert.match(pol, /wystawione faktury, Twoje dane z faktury, dane klientów/);
  assert.match(pol, /Licznik, ewidencja i faktura działają w Twojej przeglądarce/);
  assert.match(reg, /generator faktury bez VAT do wydruku/);
  assert.match(reg, /nie wysyła faktur ani do KSeF, ani do klienta/);
});

test('widok faktury liczy regułę od dzisiejszej daty, pamięta utratę prawa i mówi o liczniku bez pamięci', () => {
  const kod = readFileSync(join(PUBLIC, 'js/faktura-widok.js'), 'utf8');
  assert.match(kod, /normalizujFakture\(wartosciFormularza\(\), \{ dzis: dzis\(\) \}\)/);
  assert.match(kod, /dataWystawienia: dzis\(\), \/\/ datą wystawienia jest zawsze dziś/);
  assert.match(kod, /\$\('data-wystawienia'\)\.textContent = `dziś, \$\{dataPl\(dzis\(\)\)\}`;/);
  assert.match(kod, /ev\.preventDefault\(\);\n\s+odswiezDateWystawienia\(\);/, 'odświeżenie przy wystawieniu');
  assert.match(kod, /addEventListener\('visibilitychange', \(\) => \{ if \(!document\.hidden\) \{ odswiezDateWystawienia\(\);/, 'odświeżenie po powrocie na kartę');
  assert.ok(!/f-data-wystawienia/.test(kod), 'data wystawienia bez pola formularza');
  assert.match(readFileSync(join(PUBLIC, 'regulamin/index.html'), 'utf8').replace(/\s+/g, ' '), /opierają się na zegarze i danych tej przeglądarki/);
  assert.match(kod, /utrataOd: stan\.utrataOd/);
  assert.match(kod, /stan\.utrataOd = polaczUtrate\(stan\.utrataOd, r\.miesiac\)/);
  const html = readFileSync(join(PUBLIC, 'faktura/index.html'), 'utf8');
  assert.match(html, /<p id="ksef-pamiec"[^>]*hidden>Bez pamięci przeglądarki licznik zna tylko faktury z tej wizyty\./);
});

test('adres sprzedawcy obowiązkowy, tylko firma z Polski, opis utraty prawa do końca 2026 r.', () => {
  const html = readFileSync(join(PUBLIC, 'faktura/index.html'), 'utf8');
  assert.match(html, /<label for="f-sprzedawca-adres">Twój adres<\/label>/);
  assert.match(html, /Ustawa o VAT wymaga na fakturze adresu sprzedawcy i nabywcy \(art\. 106e ust\. 1 pkt 3\)\./);
  assert.match(html, /<label for="rodzaj-firma">Firma lub instytucja z Polski \(ma NIP\)<\/label>/);
  assert.match(html.replace(/\s+/g, ' '), /i każdą kolejną fakturę dla firmy do końca 2026 r\. wystawiasz w KSeF/);
  assert.match(html, /\(art\. 106b ust\. 3 pkt 2\)/);
  assert.match(html, /href="https:\/\/ksef\.podatki\.gov\.pl\/konsumenci-i-osoby-fizyczne\/"/);
  const widok = readFileSync(join(PUBLIC, 'js/faktura-widok.js'), 'utf8');
  assert.ok(!/VIES/.test(widok));
  assert.match(widok, /sprawdzNip\(\$\('f-nabywca-nip'\)\.value, \{ zagraniczny: false \}\)/);
});

test('stan KSeF pod „Kto kupuje”, potwierdzenie znika po zmianie formularza, nazwa nabywcy bez pola NIP na pełną szerokość', () => {
  const html = readFileSync(join(PUBLIC, 'faktura/index.html'), 'utf8');
  const kto = html.slice(html.indexOf('<fieldset class="grupa" id="rodzaj">'), html.indexOf('</fieldset>'));
  assert.match(kto, /<p id="ksef-skrot" class="podpowiedz status-tekst"><\/p>/);
  const kod = readFileSync(join(PUBLIC, 'js/faktura-widok.js'), 'utf8');
  assert.match(kod, /const schowajPotwierdzenie = \(\) => \{\n\s+\$\('potwierdzenie'\)\.hidden = true;/);
  assert.match(kod, /addEventListener\('input', schowajPotwierdzenie\)/);
  assert.match(kod, /classList\.toggle\('jedna', !firma\)/);
  assert.match(readFileSync(join(PUBLIC, 'css/style.css'), 'utf8'), /\.siatka\.jedna \{ grid-template-columns: 1fr; \}/);
});

test('etykieta „Twój NIP albo PESEL” z podpowiedzią źródłową, „Wrócę do formularza”', () => {
  const html = readFileSync(join(PUBLIC, 'faktura/index.html'), 'utf8');
  assert.match(html, /<label for="f-sprzedawca-nip">Twój NIP albo PESEL<\/label>/);
  // podpowiedź bez żargonu i bez numerów przepisów; źródło jest w sekcji źródeł strony
  assert.match(html, /<p id="id-info" class="podpowiedz">W działalności nierejestrowanej wpisz PESEL\. NIP wpisz tylko wtedy, gdy jesteś zarejestrowany do VAT albo masz kasę fiskalną\.<\/p>/);
  assert.match(html, /href="https:\/\/api\.sejm\.gov\.pl\/eli\/acts\/DU\/2026\/151\/text\.pdf"/);
  const kod = readFileSync(join(PUBLIC, 'js/faktura-widok.js'), 'utf8');
  assert.match(kod, /tekst: 'Wrócę do formularza'/);
});

test('błąd znika przy zmianie pola, fokus po oknie limitu na cenie, utratę prawa można cofnąć z potwierdzeniem', () => {
  const kod = readFileSync(join(PUBLIC, 'js/faktura-widok.js'), 'utf8');
  const schowaj = kod.slice(kod.indexOf('const schowajPotwierdzenie'), kod.indexOf('};', kod.indexOf('const schowajPotwierdzenie')));
  assert.match(schowaj, /\$\('form-blad'\)\.hidden = true;/);
  assert.match(schowaj, /removeAttribute\('aria-invalid'\)/);
  assert.match(kod, /const pole = \$\(`pozycja-\$\{ostatnia\}-cena`\);\n\s+pole\.focus/);
  assert.match(kod, /tekst: TEKSTY_OKIEN\.limit\(r\.miesiac\),/);
  assert.match(kod, /tekst: TEKSTY_OKIEN\.cofnij,/);
  assert.match(kod, /tekst: TEKSTY_OKIEN\.zaznacz,/);
  assert.match(kod, /zastap\(\$\('dialog-tekst'\), \.\.\.\[tekst\]\.flat\(\)\.map\(\(t\) => el\('p', \{ tekst: t \}\)\)\);/);
  assert.match(kod, /async function zaznaczUtrate\(\) \{[\s\S]*?await zapytaj\(/);
  assert.match(kod, /async function cofnijUtrate\(\) \{[\s\S]*?await zapytaj\([\s\S]*?stan\.utrataOd = null;/);
  const html = readFileSync(join(PUBLIC, 'faktura/index.html'), 'utf8');
  assert.match(html, /<button type="button" id="cofnij-utrate" class="drugorzedny maly" hidden>To była pomyłka: cofnij<\/button>/);
});

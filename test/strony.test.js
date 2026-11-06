// Higiena stron: robots (noindex tylko na 404), ścisły CSP, stopka, brak zewnętrznych skryptów,
// brak skryptów i stylów inline, brak ciasteczek.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));

// Pliki tekstowe czytamy z końcami wierszy LF, żeby testy dawały ten sam wynik także w kopii z CRLF
// (np. po pobraniu repozytorium na Windows z core.autocrlf=true).
const czytaj = (plik) => readFileSync(plik, 'utf8').replace(/\r\n/g, '\n');

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
const naglowki = czytaj(join(PUBLIC, '_headers'));
const cspNaglowek = /Content-Security-Policy: (.+)/.exec(naglowki)[1].trim();

test('są wszystkie strony', () => {
  const sciezki = HTML.map((p) => relative(PUBLIC, p).replaceAll('\\', '/')).sort();
  assert.deepEqual(sciezki, ['404.html', 'faktura/index.html', 'index.html', 'o-nas/index.html', 'prywatnosc/index.html', 'regulamin/index.html']);
});

// Ewidencja działa w przeglądarce, ale pamięć przeglądarki ma tylko magazyn.js, a zapytania sieciowe tylko widok ewidencji
// (wzór arkusza z /pobierz/ i kurs NBP przez nbp.js).
test('bez linków do usuniętych podstron, pamięć i sieć tylko w wyznaczonych modułach', () => {
  for (const plik of [...HTML, ...JS]) {
    const tresc = czytaj(plik);
    const nazwa = relative(PUBLIC, plik).replaceAll('\\', '/');
    assert.ok(!/ewidencja-sprzedazy|\/limit-dzialalnosc-nierejestrowana\/|\/ksef-2027-dzialalnosc/.test(tresc), `${plik}: odwołanie do usuniętej strony`);
    assert.ok(!/sessionStorage|indexedDB|XMLHttpRequest|WebSocket|sendBeacon/.test(tresc), `${plik}: niedozwolone API`);
    if (nazwa !== 'js/magazyn.js' && plik.endsWith('.js')) assert.ok(!/localStorage/.test(tresc), `${plik}: localStorage poza magazyn.js`);
    if (nazwa !== 'js/ewidencja-widok.js') assert.ok(!/\bfetch\(/.test(tresc), `${plik}: fetch poza widokiem ewidencji`);
  }
  const widok = czytaj(join(PUBLIC, 'js/ewidencja-widok.js'));
  for (const [, cel] of widok.matchAll(/fetch\(([^,)]+)/g)) assert.ok(["'/pobierz/arkusz-limit-dn.xlsx'", '...a'].includes(cel.trim()), `fetch do ${cel}`);
});

// Stroną główną jest ewidencja, licznik to drugorzędne „Szybkie sprawdzenie” niżej.
test('strona główna: ewidencja na górze, licznik niżej, sekcja KSeF ze źródłami, jedna akcja „Pobierz arkusz”', () => {
  const html = czytaj(join(PUBLIC, 'index.html'));
  assert.match(html, /<h1>Ewidencja sprzedaży i limit działalności nierejestrowanej<\/h1>/);
  assert.ok(html.indexOf('id="stan"') < html.indexOf('id="wpis-form"'), 'stan kwartału przed formularzem');
  assert.ok(html.indexOf('id="pliki"') < html.indexOf('id="licznik"'), 'licznik pod ewidencją');
  assert.match(html, /<h2 id="licznik-tytul">Szybkie sprawdzenie bez ewidencji<\/h2>/);
  const nav = /<nav class="nawigacja"[^>]*>([\s\S]*?)<\/nav>/.exec(html)[1];
  assert.match(nav, /Ewidencja/);
  assert.ok(!/Licznik/.test(nav), 'licznik nie jest w nawigacji');
  // nawigacja „Ewidencja, Faktura” na każdej stronie
  for (const plik of HTML) {
    const n = /<nav class="nawigacja"[^>]*>([\s\S]*?)<\/nav>/.exec(czytaj(plik))[1];
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
  const linie = czytaj(join(PUBLIC, '_redirects')).split('\n').filter((l) => l.trim() && !l.startsWith('#'));
  assert.ok(linie.length > 0);
  for (const l of linie) assert.match(l, /^\/[a-z0-9-]+\/? \/(#[a-z]+)? 301$/, l);
});

for (const plik of HTML) {
  const nazwa = relative(PUBLIC, plik);
  const html = czytaj(plik);
  test(`${nazwa}: robots, CSP, stopka, bez inline i zewnętrznych skryptów`, () => {
    // Strony z treścią są indeksowane; noindex ma tylko strona 404.
    if (nazwa === '404.html') assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
    else assert.ok(!/<meta name="robots"[^>]*noindex/i.test(html), 'noindex na stronie indeksowanej');
    const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html);
    assert.ok(csp, 'brak meta CSP');
    assert.equal(`${csp[1]}; frame-ancestors 'none'`, cspNaglowek, 'meta CSP różni się od _headers');
    assert.ok(!/unsafe-inline|unsafe-eval|\*/.test(csp[1]), 'CSP nie może zawierać unsafe-* ani *');
    assert.ok(html.includes(STOPKA), 'brak stopki');
    // Jedyny dopuszczalny blok bez src to dane strukturalne (application/ld+json): przeglądarka go nie wykonuje.
    for (const [tag] of html.matchAll(/<script(?![^>]*\ssrc=")[^>]*>/g)) assert.equal(tag, '<script type="application/ld+json">', 'skrypt inline');
    assert.ok(!/\sstyle="/.test(html) && !/<style/.test(html), 'styl inline');
    assert.ok(!/\son[a-z]+="/.test(html), 'obsługa zdarzeń inline');
    for (const [, src] of html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)) assert.match(src, /^\/js\//);
    for (const [tag, href] of html.matchAll(/<link[^>]*\shref="([^"]+)"/g)) {
      if (/rel="canonical"/.test(tag)) assert.match(href, /^https:\/\/dn\.noblecode\.pl\//);
      else assert.match(href, /^\//);
    }
    assert.match(html, /<html lang="pl">/);
    assert.match(html, /<meta name="viewport"/);
  });
}

const blokiNaglowkow = naglowki.split(/\n(?=\S)/).filter((b) => !b.startsWith('#'));
const blokNaglowkow = (sciezka) => blokiNaglowkow.find((b) => b.split('\n')[0].trim() === sciezka) ?? '';

test('_headers: strony indeksowane, noindex dla pliku XLSX i adresów pages.dev, nosniff, frame-ancestors', () => {
  // Cloudflare łączy nagłówki z kilku pasujących reguł, więc reguła /* nie może mieć X-Robots-Tag.
  assert.ok(!/X-Robots-Tag/.test(blokNaglowkow('/*')), 'reguła /* bez X-Robots-Tag');
  assert.match(blokNaglowkow('/pobierz/*'), /X-Robots-Tag: noindex/);
  assert.match(blokNaglowkow('https://:project.pages.dev/*'), /X-Robots-Tag: noindex/);
  assert.match(blokNaglowkow('https://:version.:project.pages.dev/*'), /X-Robots-Tag: noindex/);
  assert.match(blokNaglowkow('/*'), /Content-Security-Policy: /);
  assert.match(naglowki, /X-Content-Type-Options: nosniff/);
  assert.match(cspNaglowek, /frame-ancestors 'none'/);
  assert.match(cspNaglowek, /^default-src 'none';/);
  // Jedyny zewnętrzny serwer to API NBP (kurs średni; API odpowiada nagłówkiem Access-Control-Allow-Origin: *).
  assert.match(cspNaglowek, /; connect-src 'self' https:\/\/api\.nbp\.pl; /);
  assert.equal([...cspNaglowek.matchAll(/https?:\/\//g)].length, 1, 'jeden zewnętrzny adres w CSP');
});

test('JS: brak ciasteczek, eval i zewnętrznych adresów', () => {
  for (const plik of JS) {
    const kod = czytaj(plik);
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
  const onas = czytaj(join(PUBLIC, 'o-nas/index.html'));
  assert.ok(onas.includes('<strong>Usługodawca:</strong> NobleCode Krzysztof Mizgała<br>'), 'nazwa usługodawcy');
  assert.ok(onas.includes(`<strong>E-mail:</strong> <a href="mailto:${EMAIL_KONTAKTOWY}">${EMAIL_KONTAKTOWY}</a>`), 'pole e-mail');
  for (const plik of HTML) {
    const html = czytaj(plik);
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
  const html = czytaj(join(PUBLIC, 'index.html'));
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

test('regulamin: pkt 8 o zmianach bez zdania o fazie testowej, opis kursu NBP', () => {
  const reg = czytaj(join(PUBLIC, 'regulamin/index.html'));
  const pkt8 = reg.indexOf('<h2>8.');
  assert.ok(pkt8 > 0);
  assert.ok(!/fazie testowej|wersja testowa/i.test(reg), 'strona jest indeksowana, bez fazy testowej');
  assert.match(reg.slice(pkt8).replace(/\s+/g, ' '), /<h2>8\. Zmiany Regulaminu<\/h2> <p>O zakończeniu usługi i zmianach niekorzystnych dla użytkownika/);
  assert.match(reg, /może go zmienić albo wpisać sam/);
});

function luminancja(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const kontrast = (a, b) => { const [x, y] = [luminancja(a), luminancja(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

test('CSS: kontrast progów ≥ 4,5:1 i obramowania pól ≥ 3:1 w obu motywach', () => {
  const css = czytaj(join(PUBLIC, 'css/style.css'));
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
  const html = czytaj(join(PUBLIC, 'index.html'));
  assert.match(html, /<div id="wynik" class="wynik" hidden>/);
  assert.equal([...html.matchAll(/aria-live=/g)].length, 1, 'jeden region aria-live');
  assert.match(html, /<p id="ogloszenie" class="sr-only" aria-live="polite" aria-atomic="true"><\/p>/);
});

// Oznaczenie usługodawcy: ta sama nazwa w stopce każdej strony, w regulaminie i w polityce prywatności.
test('usługodawca: ta sama nazwa w stopce, w regulaminie i w polityce prywatności', () => {
  for (const plik of HTML) {
    assert.ok(czytaj(plik).includes('Usługodawca: NobleCode Krzysztof Mizgała · '), `${plik}: stopka bez nazwy usługodawcy`);
  }
  for (const [s, wersja] of [['regulamin', '0\\.6'], ['prywatnosc', '0\\.6']]) {
    const t = czytaj(join(PUBLIC, `${s}/index.html`));
    assert.match(t, new RegExp(`Wersja:? ${wersja}, obowiązuje od dnia publikacji na stronie\\.`), `${s}: wersja`);
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
  const r = czytaj(join(PUBLIC, '_redirects'));
  assert.match(r, /^\/ewidencja\/ \/ 301$/m);
  assert.ok(!HTML.some((p) => relative(PUBLIC, p).startsWith('ewidencja')), 'katalog ewidencja/ nie istnieje');
  for (const p of HTML) assert.ok(!/href="\/ewidencja\//.test(czytaj(p)), `${p}: link do /ewidencja/`);
});

test('widok ewidencji: replaceChildren tylko przez zastap() (bez „null” na stronie i w wydruku)', () => {
  const kod = czytaj(join(PUBLIC, 'js/ewidencja-widok.js'));
  const wywolania = [...kod.matchAll(/\.replaceChildren\(/g)];
  assert.equal(wywolania.length, 1, 'jedno wywołanie, w zastap()');
  assert.match(kod, /function zastap\(rodzic, \.\.\.dzieci\) \{\n {2}rodzic\.replaceChildren\(\.\.\.dzieci\.flat\(\)\.filter\(\(d\) => d !== null && d !== undefined && d !== false\)\);/);
  assert.match(kod, /zastap\(\$\('wydruk'\),/);
});

test('ewidencja: najwyżej 2 zdania w akapicie, etykiety pól, jeden region aria-live, wydruk w osobnym CSS', () => {
  const html = czytaj(join(PUBLIC, 'index.html'));
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
  const html = czytaj(join(PUBLIC, 'index.html'));
  const s = html.slice(html.indexOf('id="przekroczenie"'), html.indexOf('</section>', html.indexOf('id="przekroczenie"')));
  assert.match(s, /7 dni/);
  assert.match(s, /href="https:\/\/www\.biznes\.gov\.pl\//);
  assert.match(s, /href="https:\/\/www\.zus\.pl\//);
  assert.match(s, /Podatku tu nie liczymy/);
  assert.match(s, /sprawdzone \d{2}\.\d{2}\.\d{4}/);
});

test('strony prawne krótkie w porównaniu ze stronami funkcji (najwyżej 1,5× słów)', () => {
  const funkcje = ['index.html', 'faktura/index.html'].reduce((s, p) => s + slowa(czytaj(join(PUBLIC, p))), 0);
  const prawne = ['regulamin/index.html', 'prywatnosc/index.html', 'o-nas/index.html'].reduce((s, p) => s + slowa(czytaj(join(PUBLIC, p))), 0);
  assert.ok(prawne <= 1.5 * funkcje, `prawne ${prawne} słów, funkcje ${funkcje} słów (${(prawne / funkcje).toFixed(2)}×)`);
});

test('polityka prywatności opisuje pamięć przeglądarki i zapytanie do NBP (tylko waluta i data)', () => {
  const pol = czytaj(join(PUBLIC, 'prywatnosc/index.html'));
  assert.match(pol, /<h2>Pamięć przeglądarki<\/h2>/);
  assert.match(pol, /localStorage/);
  assert.match(pol, /Wyczyść dane/);
  assert.match(pol, /<h2>Kurs NBP<\/h2>/);
  assert.match(pol, /tylko kod waluty i zakres dat/);
});

// ---------------------------------------------------------------- faktura bez VAT (zwolnienie)

test('faktura: najwyżej 2 zdania w akapicie, etykiety pól, jeden region aria-live, jedna główna akcja, wydruk w osobnym CSS', () => {
  const html = czytaj(join(PUBLIC, 'faktura/index.html'));
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
  const html = czytaj(join(PUBLIC, 'faktura/index.html'));
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
  const kod = czytaj(join(PUBLIC, 'js/faktura-widok.js'));
  assert.equal([...kod.matchAll(/\.replaceChildren\(/g)].length, 1, 'jedno wywołanie, w zastap()');
  assert.match(kod, /function zastap\(rodzic, \.\.\.dzieci\) \{\n {2}rodzic\.replaceChildren\(\.\.\.dzieci\.flat\(\)\.filter\(\(d\) => d !== null && d !== undefined && d !== false\)\);/);
  assert.match(kod, /zastap\(\$\('wydruk'\),/);
  assert.ok(!/\bfetch\(|localStorage/.test(kod));
  assert.match(kod, /window\.print\(\)/);
});

test('polityka i regulamin opisują fakturę i dane klientów w pamięci przeglądarki', () => {
  const pol = czytaj(join(PUBLIC, 'prywatnosc/index.html')).replace(/\s+/g, ' ');
  const reg = czytaj(join(PUBLIC, 'regulamin/index.html')).replace(/\s+/g, ' ');
  for (const fraza of ['Wpisy ewidencji (dn-ewidencja-v1)',
    'Wystawione faktury w skrócie: numer, daty, kwota i to, czy klient jest firmą, oraz datę utraty prawa do faktur poza KSeF (dn-faktury-v1)',
    'Dane osobowe zapisują się tylko po włączeniu opcji „Zapamiętaj moje dane i dane klientów do faktur”',
    'w tym PESEL lub NIP, oraz dane klientów (dn-dane-faktur-v1)', 'Pełne faktury z danymi Twoimi i klientów', 'znacznik czasu zapisu',
    'Nieobowiązkowe imię do wydruku ewidencji (dn-ewidencja-ustawienia-v1)', 'Nie mamy do nich dostępu, więc nie możemy ich odzyskać ani usunąć',
    'art. 399 ust. 3 pkt 2 ustawy Prawo komunikacji elektronicznej', 'przetwarzasz je jako ich administrator i odpowiadasz za ich ochronę',
    'Na wspólnym komputerze albo we wspólnym profilu przeglądarki nie włączaj opcji', '„Wyczyść dane”', 'w ustawieniach przeglądarki',
    'Zostają ustawienia oraz Twoje dane i dane klientów (dn-dane-faktur-v1), jeśli je zapamiętujesz',
    'usuwa dn-dane-faktur-v1, imię do wydruku i dane osobowe z zapisanych faktur',
    'strona zapyta, czy je zachować', 'dopóki nie usuniesz ich Ty albo przeglądarka']) {
    assert.ok(pol.includes(fraza), `polityka: ${fraza}`);
  }
  assert.match(pol, /Licznik, ewidencja i faktura działają w Twojej przeglądarce/);
  assert.match(reg, /generator faktury bez VAT do wydruku/);
  assert.match(reg, /nie wysyła faktur ani do KSeF, ani do klienta/);
});

test('widok faktury liczy regułę od dzisiejszej daty, pamięta utratę prawa i mówi o liczniku bez pamięci', () => {
  const kod = czytaj(join(PUBLIC, 'js/faktura-widok.js'));
  assert.match(kod, /normalizujFakture\(wartosciFormularza\(\), \{ dzis: dzis\(\) \}\)/);
  assert.match(kod, /dataWystawienia: dzis\(\), \/\/ datą wystawienia jest zawsze dziś/);
  assert.match(kod, /\$\('data-wystawienia'\)\.textContent = `dziś, \$\{dataPl\(dzis\(\)\)\}`;/);
  assert.match(kod, /ev\.preventDefault\(\);\n\s+odswiezDateWystawienia\(\);/, 'odświeżenie przy wystawieniu');
  assert.match(kod, /addEventListener\('visibilitychange', \(\) => \{ if \(!document\.hidden\) \{ odswiezDateWystawienia\(\);/, 'odświeżenie po powrocie na kartę');
  assert.ok(!/f-data-wystawienia/.test(kod), 'data wystawienia bez pola formularza');
  assert.match(czytaj(join(PUBLIC, 'regulamin/index.html')).replace(/\s+/g, ' '), /opierają się na zegarze i danych tej przeglądarki/);
  assert.match(kod, /utrataOd: stan\.utrataOd/);
  assert.match(kod, /stan\.utrataOd = polaczUtrate\(stan\.utrataOd, r\.miesiac\)/);
  const html = czytaj(join(PUBLIC, 'faktura/index.html'));
  assert.match(html, /<p id="ksef-pamiec"[^>]*hidden>Bez pamięci przeglądarki licznik zna tylko faktury z tej wizyty\./);
});

test('adres sprzedawcy obowiązkowy, tylko firma z Polski, opis utraty prawa do końca 2026 r.', () => {
  const html = czytaj(join(PUBLIC, 'faktura/index.html'));
  assert.match(html, /<label for="f-sprzedawca-adres">Twój adres<\/label>/);
  assert.match(html, /Ustawa o VAT wymaga na fakturze adresu sprzedawcy i nabywcy \(art\. 106e ust\. 1 pkt 3\)\./);
  assert.match(html, /<label for="rodzaj-firma">Firma lub instytucja z Polski \(ma NIP\)<\/label>/);
  assert.match(html.replace(/\s+/g, ' '), /i każdą kolejną fakturę dla firmy do końca 2026 r\. wystawiasz w KSeF/);
  assert.match(html, /\(art\. 106b ust\. 3 pkt 2\)/);
  assert.match(html, /href="https:\/\/ksef\.podatki\.gov\.pl\/konsumenci-i-osoby-fizyczne\/"/);
  const widok = czytaj(join(PUBLIC, 'js/faktura-widok.js'));
  assert.ok(!/VIES/.test(widok));
  assert.match(widok, /sprawdzNip\(\$\('f-nabywca-nip'\)\.value, \{ zagraniczny: false \}\)/);
});

test('stan KSeF pod „Kto kupuje”, potwierdzenie znika po zmianie formularza, nazwa nabywcy bez pola NIP na pełną szerokość', () => {
  const html = czytaj(join(PUBLIC, 'faktura/index.html'));
  const kto = html.slice(html.indexOf('<fieldset class="grupa" id="rodzaj">'), html.indexOf('</fieldset>'));
  assert.match(kto, /<p id="ksef-skrot" class="podpowiedz status-tekst"><\/p>/);
  const kod = czytaj(join(PUBLIC, 'js/faktura-widok.js'));
  assert.match(kod, /const schowajPotwierdzenie = \(\) => \{\n\s+\$\('potwierdzenie'\)\.hidden = true;/);
  assert.match(kod, /addEventListener\('input', schowajPotwierdzenie\)/);
  assert.match(kod, /classList\.toggle\('jedna', !firma\)/);
  assert.match(czytaj(join(PUBLIC, 'css/style.css')), /\.siatka\.jedna \{ grid-template-columns: 1fr; \}/);
});

test('etykieta „Twój NIP albo PESEL” z podpowiedzią źródłową, „Wrócę do formularza”', () => {
  const html = czytaj(join(PUBLIC, 'faktura/index.html'));
  assert.match(html, /<label for="f-sprzedawca-nip">Twój NIP albo PESEL<\/label>/);
  // podpowiedź bez żargonu i bez numerów przepisów; źródło jest w sekcji źródeł strony
  assert.match(html, /<p id="id-info" class="podpowiedz">W działalności nierejestrowanej wpisz PESEL\. NIP wpisz tylko wtedy, gdy jesteś zarejestrowany do VAT albo masz kasę fiskalną\.<\/p>/);
  assert.match(html, /href="https:\/\/api\.sejm\.gov\.pl\/eli\/acts\/DU\/2026\/151\/text\.pdf"/);
  const kod = czytaj(join(PUBLIC, 'js/faktura-widok.js'));
  assert.match(kod, /tekst: 'Wrócę do formularza'/);
});

test('błąd znika przy zmianie pola, fokus po oknie limitu na cenie, utratę prawa można cofnąć z potwierdzeniem', () => {
  const kod = czytaj(join(PUBLIC, 'js/faktura-widok.js'));
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
  const html = czytaj(join(PUBLIC, 'faktura/index.html'));
  assert.match(html, /<button type="button" id="cofnij-utrate" class="drugorzedny maly" hidden>To była pomyłka: cofnij<\/button>/);
});

// Wyłączenie pamięci usuwa także faktury, klientów i zapamiętaną utratę prawa do faktur poza KSeF,
// więc na obu stronach jest okno potwierdzenia, a po anulowaniu przełącznik wraca do zaznaczonego.
test('ewidencja i faktura: wyłączenie każdego przełącznika pamięci pyta o potwierdzenie przed usunięciem danych', () => {
  for (const plik of ['js/ewidencja-widok.js', 'js/faktura-widok.js']) {
    const kod = czytaj(join(PUBLIC, plik));
    for (const [nazwa, usun, pole, tytul] of [
      ['zmienPamiec', 'magazyn.usunWpisy()', 'pamietaj', /tytul: 'Wyłączyć pamięć przeglądarki\?'/],
      ['zmienPamiecDanych', 'magazyn.usunDaneFaktur()', 'pamietaj-dane', /tytul: 'Nie pamiętać danych do faktur\?'/],
    ]) {
      const fn = kod.slice(kod.indexOf(`async function ${nazwa}()`), kod.indexOf('\n}\n', kod.indexOf(`async function ${nazwa}()`)));
      assert.ok(fn.length > 0, `${plik}: ${nazwa} jest asynchroniczna`);
      assert.ok(fn.indexOf('await zapytaj(') >= 0 && fn.indexOf('await zapytaj(') < fn.indexOf(usun), `${plik}: pytanie przed ${usun}`);
      assert.match(fn, tytul);
      assert.ok(fn.includes(`if (!odp) { $('${pole}').checked = true; return; }`), `${plik}: anulowanie przywraca przełącznik ${pole}`);
      assert.ok(!fn.includes('magazyn.wyczysc()'), `${plik}: ${nazwa} nie usuwa danych drugiego przełącznika`);
    }
  }
  for (const strona of ['index.html', 'faktura/index.html']) {
    const html = czytaj(join(PUBLIC, strona));
    assert.match(html, /<input type="checkbox" id="pamietaj" checked aria-describedby="pamietaj-info">\n\s+<label for="pamietaj">Pamiętaj wpisy ewidencji<\/label>/, strona);
    assert.match(html, /<input type="checkbox" id="pamietaj-dane" aria-describedby="pamietaj-dane-zakres pamietaj-dane-info">\n\s+<label for="pamietaj-dane">Zapamiętaj moje dane i dane klientów do faktur<\/label>/, `${strona}: drugi przełącznik domyślnie wyłączony`);
    assert.match(html, /<p id="pamietaj-dane-info" class="podpowiedz">Dane zostaną tylko w tej przeglądarce\. Na wspólnym komputerze zobaczy je każdy użytkownik\.<\/p>/, strona);
    assert.match(html, /<p id="pamietaj-info" class="podpowiedz">[^<]*wystawione faktury, ale bez danych osobowych/, `${strona}: faktury domyślnie bez danych osobowych`);
    // Dane z wcześniejszej wersji: jednorazowy wybór z dwoma przyciskami.
    assert.match(html, /<div id="pamietaj-dane-migracja" class="ramka uwaga-ramka" hidden>/, strona);
    assert.match(html, /<button type="button" class="drugorzedny maly" id="migracja-zachowaj">Zachowaj moje dane<\/button>/, strona);
    assert.match(html, /<button type="button" class="niebezpieczny maly" id="migracja-usun">Usuń<\/button>/, strona);
  }
});

test('ewidencja: okno „Wyczyść dane” wymienia wszystko, co usuwa', () => {
  const kod = czytaj(join(PUBLIC, 'js/ewidencja-widok.js'));
  const fn = kod.slice(kod.indexOf('async function wyczysc()'), kod.indexOf('magazyn.wyczysc()', kod.indexOf('async function wyczysc()')));
  assert.match(fn, /tytul: 'Wyczyścić dane\?'/);
  for (const co of ['wpisy ewidencji', 'wystawione faktury', 'dane klientów', 'zapamiętane przekroczenie limitu KSeF']) assert.ok(fn.includes(co), co);
});

test('ewidencja: niedostępna pamięć wyłącza przełącznik, nieudany zapis pokazuje komunikat i ostrzega przed zamknięciem', () => {
  const kod = czytaj(join(PUBLIC, 'js/ewidencja-widok.js'));
  assert.match(kod, /stan\.dostepna = magazyn\.dostepny\(\);\n\s+\$\('pamietaj'\)\.disabled = !stan\.dostepna;/);
  assert.match(kod, /if \(!stan\.dostepna\) \$\('pamietaj-info'\)\.textContent = 'Pamięć przeglądarki jest niedostępna/);
  assert.match(kod, /stan\.pamietaj = stan\.dostepna && u\.pamietaj !== false;/);
  const utrwal = kod.slice(kod.indexOf('function utrwal()'), kod.indexOf('\n}\n', kod.indexOf('function utrwal()')));
  assert.match(utrwal, /stan\.zapisNieudany = !magazyn\.zapisz\(stan\.wpisy\);/);
  assert.match(utrwal, /pokazStanPliku\(TEKST_NIEUDANEGO_ZAPISU\);/);
  assert.match(utrwal, /\$\('pliki-stan'\)\.textContent === TEKST_NIEUDANEGO_ZAPISU\) \{\n\s+pokazStanPliku\(''\);/, 'komunikat znika po udanym zapisie');
  assert.match(kod, /addEventListener\('beforeunload', \(ev\) => \{\n\s+if \(\(!stan\.pamietaj \|\| stan\.zapisNieudany\) &&/);
});

test('ewidencja i faktura: zmiana danych w innej karcie przeładowuje stan i widok', () => {
  for (const plik of ['js/ewidencja-widok.js', 'js/faktura-widok.js']) {
    const kod = czytaj(join(PUBLIC, plik));
    assert.match(kod, /window\.addEventListener\('storage', poZmianieWInnejKarcie\);/, plik);
    const fn = kod.slice(kod.indexOf('function poZmianieWInnejKarcie(ev)'), kod.indexOf('\n}\n', kod.indexOf('function poZmianieWInnejKarcie(ev)')));
    assert.match(fn, /ev\.key !== null && \(!ev\.key\.startsWith\('dn-'\) \|\| ev\.key === 'dn-test'\)/, plik);
    assert.match(fn, /wczytajZMagazynu\(\);/, plik);
    assert.match(fn, /odswiez\(\);/, plik);
    // Dane tylko na tej stronie (pamięć wyłączona) nigdy nie są zastępowane danymi z innej karty.
    const straz = fn.search(/if \(!stan\.pamietaj[^)]*\) return;/);
    assert.ok(straz > 0 && straz < fn.indexOf('wczytajZMagazynu();'), `${plik}: przy wyłączonej pamięci zmiana z innej karty jest pomijana`);
    assert.ok(fn.indexOf("if ($('dialog').open)") < straz, `${plik}: przy otwartym oknie zmiana czeka na jego zamknięcie`);
    // Włączenie pamięci łączy dane ze strony z zapisanymi, zanim je zapisze.
    const zm = kod.slice(kod.indexOf('async function zmienPamiec()'), kod.indexOf('utrwal();', kod.indexOf('async function zmienPamiec()')));
    assert.match(zm, /stan\.(wpisy|faktury) = polacz(Wpisy|Faktury)\(stan\.(wpisy|faktury), lokalne(\.faktury)?\);/, plik);
  }
  const ew = czytaj(join(PUBLIC, 'js/ewidencja-widok.js'));
  assert.match(ew, /if \(!stan\.pamietaj \|\| stan\.zapisNieudany \|\| stan\.przyklad\) return;/);
  // Faktura: przed numerem i regułą KSeF lista faktur jest wczytywana ponownie z pamięci przeglądarki.
  const kod = czytaj(join(PUBLIC, 'js/faktura-widok.js'));
  const wystaw = kod.slice(kod.indexOf('async function wystaw(ev)'), kod.indexOf('\n}\n', kod.indexOf('async function wystaw(ev)')));
  const wczytanie = wystaw.indexOf('wczytajZMagazynu();');
  assert.ok(wczytanie > 0, 'wczytanie w wystaw()');
  for (const dalej of ['normalizujFakture(', 'numerZajety(stan.faktury, f.numer)', 'regula(f,', 'stan.faktury = [...stan.faktury, f];']) {
    assert.ok(wczytanie < wystaw.indexOf(dalej), `wczytanie przed ${dalej}`);
  }
});

test('ewidencja: stan kwartału mówi o sprzedaży bez kursu i o sprzedaży zaplanowanej', () => {
  const html = czytaj(join(PUBLIC, 'index.html'));
  assert.match(html, /<p id="stan-bez-kursu" class="podpowiedz ostrzezenie-tekst" hidden><\/p>/);
  const kod = czytaj(join(PUBLIC, 'js/ewidencja-widok.js'));
  assert.match(kod, /\$\('stan-bez-kursu'\)\.hidden = p\.bezKursu === 0;/);
  assert.match(kod, /suma kwartału może być zaniżona/);
  assert.match(kod, /w tym zaplanowane: \$\{formatujZl\(p\.zaplanowaneGr\)\}/);
  assert.match(kod, /historiaKwartalow\(stan\.wpisy, dzis\(\)\)/);
  assert.ok(!/historiaKwartalow\(stan\.wpisy\)/.test(kod), 'historia w widoku zawsze z dzisiejszą datą');
});

test('ewidencja: przekroczenie z zaplanowanych sprzedaży opisane jako plan, nie jako tempo, także w przyszłych kwartałach', () => {
  const kod = czytaj(join(PUBLIC, 'js/ewidencja-widok.js'));
  assert.match(kod, /według zaplanowanych sprzedaży przekroczysz limit \$\{dataPl\(przekroczenie\.data\)\}/);
  assert.match(kod, /przekroczysz limit według zaplanowanych sprzedaży, dnia \$\{dataPl\(k\.prognozaPrzekroczenia\.data\)\}/);
  assert.match(kod, /Według zaplanowanych sprzedaży przekroczysz limit \$\{dataPl\(kw\.prognozaPrzekroczenia\.data\)\}/);
  assert.match(kod, /Według zaplanowanych sprzedaży limit zostanie przekroczony \$\{dataPl\(planowane\.prognozaPrzekroczenia\.data\)\}/);
  assert.match(kod, /zostało \$\{formatujZl\(kw\.wolneGr\)\}/, 'potwierdzenie: zostało po odjęciu planu');
  assert.match(kod, /\$\('stan-budzet'\)\.textContent = p\.wolneGr > 0n/);
  assert.match(kod, /Do limitu zostało \$\{formatujZl\(p\.wolneGr\)\}/);
  assert.ok(!/kw\.status\.pozostaloGr/.test(kod));
  assert.match(kod, /if \(!p\) \{\n\s+\$\('stan-bez-kursu'\)\.hidden = true;/, 'bez limitu na rok: bez komunikatu o kursach');
});

test('ewidencja: niejednoznaczna kwota w formularzu („1,234”) daje komunikat zamiast zgadywania', () => {
  const kod = czytaj(join(PUBLIC, 'js/ewidencja-widok.js'));
  const fn = kod.slice(kod.indexOf('function zapiszFormularz(ev)'), kod.indexOf('normalizujWpis(', kod.indexOf('function zapiszFormularz(ev)')));
  assert.match(fn, /if \(niejednoznacznaKwota\(v\.kwota\)\) \{/);
  assert.match(fn, /pokazBladFormularza\(.*'f-kwota'\);/);
});

test('strona główna: limit 10 000 zł dla faktur poza KSeF nie odnawia się po przekroczeniu', () => {
  const html = czytaj(join(PUBLIC, 'index.html')).replace(/&nbsp;/g, ' ');
  const ksef = html.slice(html.indexOf('id="ksef"'), html.indexOf('</section>', html.indexOf('id="ksef"')));
  assert.match(ksef, /dopóki faktury dla firm wystawione w miesiącu mają razem najwyżej 10 000 zł brutto\./);
  assert.match(ksef, /każdą kolejną fakturę dla firmy do końca 2026 r\. wystawia się w KSeF/);
  assert.ok(!/nie przekracza 10 000 zł brutto w miesiącu/.test(ksef));
});

test('arkusz: kolumna kursu NBP pokazuje pełny kurs (więcej niż 4 miejsca po przecinku)', () => {
  const skrypt = czytaj(fileURLToPath(new URL('../scripts/arkusz.py', import.meta.url)));
  assert.match(skrypt, /ws\[f"E\{r\}"\]\.number_format = "0\.0000####"/);
});

test('SECURITY.md: aktywnie wykorzystywana podatność poprawiana priorytetowo, bez obietnic terminów zgłoszeń', () => {
  const sec = czytaj(fileURLToPath(new URL('../SECURITY.md', import.meta.url)));
  assert.match(sec, /Aktywnie wykorzystywaną podatność poprawiamy priorytetowo, bez zbędnej zwłoki\./);
  assert.ok(!/CRA|24 h/.test(sec));
});

// ---------------------------------------------------------------- metadane wyszukiwarek i pliki do włączenia indeksowania

const BAZA = 'https://dn.noblecode.pl';
const METADANE = {
  'index.html': ['/', 'Ewidencja sprzedaży i limit działalności nierejestrowanej 2026'],
  'faktura/index.html': ['/faktura/', 'Faktura bez VAT w działalności nierejestrowanej – online, PDF'],
  'o-nas/index.html': ['/o-nas/', 'O narzędziach i usługodawcy – Narzędziownik DN'],
  'regulamin/index.html': ['/regulamin/', 'Regulamin – Narzędziownik DN'],
  'prywatnosc/index.html': ['/prywatnosc/', 'Polityka prywatności – Narzędziownik DN'],
};
const meta = (html, wzor) => { const m = wzor.exec(html); return m ? m[1] : null; };
const odkoduj = (t) => t.replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const jsonLd = (html) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]);

test('metadane wyszukiwarek: tytuł, opis, canonical i Open Graph na każdej stronie', () => {
  // 404.html nie ma adresu kanonicznego ani opisu: sprawdza ją osobny test.
  assert.deepEqual(Object.keys(METADANE).sort(), HTML.map((p) => relative(PUBLIC, p).replaceAll('\\', '/')).filter((p) => p !== '404.html').sort());
  for (const [plik, [sciezka, tytul]] of Object.entries(METADANE)) {
    const html = czytaj(join(PUBLIC, plik));
    const t = meta(html, /<title>([^<]*)<\/title>/);
    assert.equal(t, tytul, plik);
    assert.ok(t.length <= 65, `${plik}: tytuł ma ${t.length} znaków`);
    const opis = meta(html, /<meta name="description" content="([^"]*)">/);
    assert.ok(opis && opis.length >= 70 && opis.length <= 160, `${plik}: opis ma ${opis?.length} znaków`);
    assert.equal([...html.matchAll(/<link rel="canonical"/g)].length, 1, `${plik}: jeden canonical`);
    const kanon = meta(html, /<link rel="canonical" href="([^"]+)">/);
    assert.equal(kanon, BAZA + sciezka, plik);
    assert.equal(meta(html, /<meta property="og:url" content="([^"]+)">/), kanon, `${plik}: og:url = canonical`);
    assert.equal(odkoduj(meta(html, /<meta property="og:title" content="([^"]+)">/)), t, `${plik}: og:title = title`);
    assert.equal(meta(html, /<meta property="og:description" content="([^"]+)">/), opis, `${plik}: og:description = description`);
    assert.equal(meta(html, /<meta property="og:type" content="([^"]+)">/), 'website');
    assert.equal(meta(html, /<meta property="og:locale" content="([^"]+)">/), 'pl_PL');
    assert.equal(meta(html, /<meta property="og:site_name" content="([^"]+)">/), 'Narzędziownik DN');
    assert.ok(!/og:image|twitter:/.test(html), `${plik}: bez og:image i twitter:*`);
    assert.ok(html.indexOf('rel="canonical"') < html.indexOf('rel="stylesheet"'), `${plik}: canonical przed CSS`);
    assert.ok(!/noindex/i.test(html), `${plik}: strona indeksowana, bez noindex`);
  }
});

test('dane strukturalne: JSON-LD tylko na stronie głównej i stronie faktury, poprawny JSON, bez ocen i recenzji', () => {
  for (const plik of Object.keys(METADANE)) {
    const bloki = jsonLd(czytaj(join(PUBLIC, plik)));
    assert.equal(bloki.length, ['index.html', 'faktura/index.html'].includes(plik) ? 1 : 0, plik);
    for (const b of bloki) {
      const dane = JSON.parse(b);
      assert.equal(dane['@context'], 'https://schema.org');
      assert.ok(!/aggregateRating|"review"|"author"|"publisher"/.test(b), `${plik}: pola pominięte celowo`);
      const wezly = dane['@graph'] ?? [dane];
      for (const w of wezly) {
        assert.ok(w.url.startsWith(BAZA), w.url);
        if (w['@type'] === 'WebApplication') {
          assert.equal(w.isAccessibleForFree, true);
          assert.deepEqual(w.offers, { '@type': 'Offer', price: '0', priceCurrency: 'PLN' });
          assert.deepEqual(w.isPartOf, { '@id': `${BAZA}/#witryna` });
          assert.ok(Array.isArray(w.featureList) && w.featureList.length >= 3);
        }
      }
    }
  }
  const glowna = JSON.parse(jsonLd(czytaj(join(PUBLIC, 'index.html')))[0]);
  const witryna = glowna['@graph'].find((w) => w['@type'] === 'WebSite');
  assert.deepEqual(witryna, { '@type': 'WebSite', '@id': `${BAZA}/#witryna`, url: `${BAZA}/`, name: 'Narzędziownik DN', alternateName: 'dn.noblecode.pl', inLanguage: 'pl-PL' });
  assert.ok(glowna['@graph'].some((w) => w['@type'] === 'WebApplication' && w.url === `${BAZA}/`));
  const faktura = JSON.parse(jsonLd(czytaj(join(PUBLIC, 'faktura/index.html')))[0]);
  assert.equal(faktura['@type'], 'WebApplication');
  assert.equal(faktura.url, `${BAZA}/faktura/`);
});

test('mapa strony i robots.txt: każdy adres kanoniczny w mapie, aktualne lastmod, robots wskazuje mapę', () => {
  const mapa = czytaj(join(PUBLIC, 'sitemap.xml'));
  assert.match(mapa, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  const wpisy = [...mapa.matchAll(/<url><loc>([^<]+)<\/loc><lastmod>([^<]+)<\/lastmod><\/url>/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(wpisy.map(([l]) => l).sort(), Object.values(METADANE).map(([s]) => BAZA + s).sort(), 'każda strona z treścią w mapie, z takim samym canonical');
  // Dzisiejsza data w Warszawie, nie w UTC: zmiana zapisana tuż po północy ma już nową datę.
  const dzis = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw' }).format(new Date());
  for (const [loc, d] of wpisy) {
    assert.match(d, /^\d{4}-\d{2}-\d{2}$/, loc);
    assert.ok(d >= '2026-10-23' && d <= dzis, `${loc}: lastmod ${d}`);
  }
  assert.ok(!/404/.test(mapa), 'bez strony 404');
  const robots = czytaj(join(PUBLIC, 'robots.txt'));
  assert.match(robots, /^User-agent: \*$/m);
  assert.match(robots, /^Allow: \/$/m);
  assert.ok(!/Disallow/.test(robots), 'roboty widzą /js/, /css/ i noindex pliku XLSX');
  assert.match(robots, /^Sitemap: https:\/\/dn\.noblecode\.pl\/sitemap\.xml$/m);
});

// ---------------------------------------------------------------- strona 404

test('404.html: noindex, ten sam CSP, nawigacja i stopka, link do ewidencji, bez canonical, Open Graph i JSON-LD', () => {
  const html = czytaj(join(PUBLIC, '404.html'));
  // Bez 404.html Cloudflare Pages zwraca na każdy nieistniejący adres stronę główną z kodem 200.
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
  assert.equal(`${/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html)[1]}; frame-ancestors 'none'`, cspNaglowek);
  assert.match(html, /<title>Nie ma takiej strony – Narzędziownik DN<\/title>/);
  assert.match(html, /<h1>Nie ma takiej strony<\/h1>/);
  assert.match(tekstMain(html), /<a class="przycisk" href="\/">Przejdź do ewidencji<\/a>/);
  assert.ok(!/rel="canonical"|og:|application\/ld\+json|<script/.test(html), 'bez canonical, Open Graph, JSON-LD i skryptów');
  for (const [, blok] of tekstMain(html).matchAll(/<(?:p|dd|li)\b[^>]*>([\s\S]*?)<\/(?:p|dd|li)>/g)) {
    const tekst = blok.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    assert.ok(1 + [...tekst.matchAll(/[.!?]\s+(?=[A-ZĄĆĘŁŃÓŚŹŻ])/g)].length <= 2, tekst);
  }
  const instrukcja = czytaj(fileURLToPath(new URL('../README.md', import.meta.url)));
  assert.match(instrukcja, /curl -I https:\/\/dn\.noblecode\.pl\/nie-istnieje/);
});

test('faktura: miejsce na stan KSeF pod „Kto kupuje” zarezerwowane w CSS (bez przesunięcia układu po wypełnieniu przez skrypt)', () => {
  const html = czytaj(join(PUBLIC, 'faktura/index.html'));
  assert.match(html, /<p id="ksef-skrot" class="podpowiedz status-tekst"><\/p>/, 'tekst wstawia skrypt');
  const css = czytaj(join(PUBLIC, 'css/style.css'));
  assert.match(css, /#ksef-skrot \{[^}]*min-height: 2lh;/, 'telefon: 2 linie');
  assert.match(css, /@media \(max-width: 359px\) \{ #ksef-skrot \{[^}]*min-height: 3lh;/, 'bardzo wąski ekran: 3 linie');
  assert.match(css, /@media \(min-width: 720px\) \{ #ksef-skrot \{[^}]*min-height: 1lh;/, 'szerszy ekran: 1 linia');
  // zapas w em: wysokość linii to 1,55 rozmiaru czcionki
  assert.match(css, /#ksef-skrot \{[^}]*min-height: 3\.1em; min-height: 2lh;/);
  assert.match(css, /@media \(max-width: 359px\) \{ #ksef-skrot \{ min-height: 4\.65em; min-height: 3lh; \} \}/);
  assert.match(css, /@media \(min-width: 720px\) \{ #ksef-skrot \{ min-height: 1\.55em; min-height: 1lh; \} \}/);
  assert.match(css, /body \{[^}]*font: 17px\/1\.55 /, 'wysokość linii 1,55, z której liczony jest zapas w em');
});

test('ewidencja: miejsce na okres kwartału zarezerwowane w CSS (bez przesunięcia stanu kwartału po wypełnieniu przez skrypt)', () => {
  const html = czytaj(join(PUBLIC, 'index.html'));
  assert.match(html, /<p id="stan-okres" class="podtytul"><\/p>/, 'tekst wstawia skrypt');
  const css = czytaj(join(PUBLIC, 'css/style.css'));
  assert.match(css, /#stan-okres \{ min-height: 3\.1em; min-height: 2lh; \}/, 'wąski ekran: 2 linie');
  assert.match(css, /@media \(min-width: 414px\) \{ #stan-okres \{ min-height: 1\.55em; min-height: 1lh; \} \}/, 'od 414 px: 1 linia');
});

test('faktura: pierwsza pozycja w HTML ma ten sam układ co wiersz renderowany przez skrypt (bez przesunięcia układu)', () => {
  const html = czytaj(join(PUBLIC, 'faktura/index.html'));
  const lista = /<ol id="pozycje" class="pozycje">([\s\S]*?)<\/ol>/.exec(html)[1];
  assert.equal([...lista.matchAll(/<li class="pozycja" data-i="0">/g)].length, 1);
  for (const [id, etykieta] of [['nazwa', 'Pozycja 1: towar lub usługa'], ['ilosc', 'Ilość'], ['jm', 'Jednostka'], ['cena', 'Cena (zł)']]) {
    assert.ok(lista.includes(`<label for="pozycja-0-${id}">${etykieta}</label><input id="pozycja-0-${id}"`), id);
  }
  assert.match(lista, /id="pozycja-0-ilosc" inputmode="decimal" autocomplete="off" value="1"/);
  assert.match(lista, /id="pozycja-0-jm" maxlength="12" autocomplete="off" value="szt\."/);
  const kod = czytaj(join(PUBLIC, 'js/faktura-widok.js'));
  for (const t of ["tekst: `Pozycja ${i + 1}: towar lub usługa`", "tekst: 'Ilość'", "tekst: 'Jednostka'", "tekst: 'Cena (zł)'", "placeholder: i === 0 ? 'np. projekt logo' : null", "value: 'szt.'"]) {
    assert.ok(kod.includes(t), `skrypt renderuje: ${t}`);
  }
});

// ---------------------------------------------------------------- zwroty, terminy, faktury z KSeF w limicie

test('ewidencja: przy zwrocie podpowiedź o dacie dokumentu korekty i pole „dotyczy sprzedaży z dnia”', () => {
  const html = czytaj(join(PUBLIC, 'index.html'));
  assert.match(html, /<p id="f-data-zwrot" class="podpowiedz" hidden>Podaj datę dokumentu korekty \(faktury korygującej albo innego dokumentu, np\. potwierdzenia zwrotu pieniędzy\), a nie datę sprzedaży\.<\/p>/);
  assert.match(html, /<input id="f-data"[^>]*aria-describedby="f-data-zwrot">/);
  assert.match(html, /<label for="f-dotyczy">Zwrot dotyczy sprzedaży z dnia/);
  assert.match(html, /<p id="stan-zwroty" class="podpowiedz ostrzezenie-tekst" hidden><\/p>/);
  const kod = czytaj(join(PUBLIC, 'js/ewidencja-widok.js'));
  assert.match(kod, /dotyczy: zwrotWFormularzu\(\) \? \$\('f-dotyczy'\)\.value : ''/);
  assert.match(html, /Ta data służy tylko do ostrzeżenia i nie trafia do pliku CSV ani XLSX\./);
  assert.match(kod, /akapitDopisku\(h\.przekroczenie\.termin\)/, 'dopisek o dniu wolnym przy terminie CEIDG');
  // Fakt przekroczenia nie ukrywa prognozy z planu (ramka składa części zamiast wybierać jedną).
  const fn = kod.slice(kod.indexOf('function renderujPrzekroczenie()'), kod.indexOf('\n}\n', kod.indexOf('function renderujPrzekroczenie()')));
  assert.match(fn, /if \(h\) \{\n\s+czesci\.push\(/);
  assert.match(fn, /\n {2}if \(p\?\.przekroczenie\?\.prognoza && p\.przyczynaPrzekroczenia === 'plan'\) \{/, 'prognoza sprawdzana także po fakcie');
});

test('faktura: daty wpłat z podpowiedzią, opis pola innych faktur (także z KSeF), komunikat o KSeF i NIP od 2027 r.', () => {
  const html = czytaj(join(PUBLIC, 'faktura/index.html'));
  assert.match(html, /<legend>Kiedy klient zapłacił <span class="opcjonalne">\(nieobowiązkowe\)<\/span><\/legend>/);
  assert.match(html, /<p id="zaplaty-info" class="podpowiedz">Jeśli klient zapłacił później niż w miesiącu sprzedaży, podaj datę zapłaty, bo termin na żądanie może być dłuższy\.<\/p>/);
  assert.match(html, /<label for="f-inne">Faktury dla firm wystawione w tym miesiącu gdzie indziej, w KSeF i poza nim <span class="opcjonalne">\(zł\)<\/span><\/label>/);
  assert.match(html, /<p id="inne-zakres" class="podpowiedz">Bez faktur z kasy fiskalnej i bez faktur dla osób prywatnych\.<\/p>/);
  assert.match(html, /<p id="inne-info" class="podpowiedz">Przepis mówi o fakturach wystawionych poza KSeF\. Liczymy też faktury z KSeF, żeby nie zaniżyć sumy\.<\/p>/);
  const blokada = html.slice(html.indexOf('id="ksef-blokada"'), html.indexOf('</div>', html.indexOf('id="ksef-blokada"')));
  assert.match(blokada, /Faktura w KSeF wymaga Twojego NIP\./, 'ramka blokady (także ksef-2027) mówi o NIP');
  const kod = czytaj(join(PUBLIC, 'js/faktura-widok.js'));
  assert.match(kod, /terminy\(ds, \$\('f-data-zadania'\)\.value, zaplaty\)/);
  assert.match(kod, /stan\.faktury = bezFaktury\(stan\.faktury, f\.id\)/, 'usuwanie po identyfikatorze');
  assert.ok(!/x\.numer !== f\.numer/.test(kod));
  const utrwal = kod.slice(kod.indexOf('function utrwal()'), kod.indexOf('\n}\n', kod.indexOf('function utrwal()')));
  assert.match(utrwal, /if \(stan\.pamietajDane\) magazyn\.zapiszDaneFaktur\(/, 'dane sprzedawcy i klientów tylko po włączeniu');
});

test('CSP: \'self\' w connect-src zostaje, bo eksport XLSX pobiera wzór arkusza z tej samej strony', () => {
  assert.match(czytaj(join(PUBLIC, 'js/ewidencja-widok.js')), /fetch\('\/pobierz\/arkusz-limit-dn\.xlsx'/);
  assert.match(cspNaglowek, /; connect-src 'self' https:\/\/api\.nbp\.pl; /);
});

test('test dostępności: serwer zamykany w finally i po SIGINT/SIGTERM, wymóg Node 22.12, skan stanów poziom-* ewidencji', () => {
  const skrypt = czytaj(fileURLToPath(new URL('../scripts/sprawdz-dostepnosc.mjs', import.meta.url)));
  assert.match(skrypt, /for \(const \[sygnal, kod\] of \[\['SIGINT', 130\], \['SIGTERM', 143\]\]\) \{\n\s+process\.on\(sygnal, /);
  assert.match(skrypt, /\} finally \{\n\s+await zamknij\(\);/);
  assert.ok(skrypt.indexOf('chromium.launch(') > skrypt.indexOf('try {'), 'start przeglądarki w try');
  for (const k of ['poziom-ok', 'poziom-70', 'poziom-85', 'poziom-95', 'poziom-100']) assert.ok(skrypt.includes(`'${k}'`), k);
  const readme = czytaj(fileURLToPath(new URL('../README.md', import.meta.url)));
  assert.match(readme, /Node ≥ 22\.12/);
});

test('dane osobowe tylko za zgodą: „Drukuj” tylko dla pełnej faktury, wybór po migracji, imię do wydruku pod drugim przełącznikiem', () => {
  const kod = czytaj(join(PUBLIC, 'js/faktura-widok.js'));
  assert.match(kod, /pelnaFaktura\(f\) \? el\('button', \{ type: 'button', klasa: 'drugorzedny maly', tekst: 'Drukuj'/);
  assert.ok(!/Array\.isArray\(f\.pozycje\); \} catch/.test(kod), 'wczytanie przyjmuje rekord skrócony');
  for (const plik of ['js/faktura-widok.js', 'js/ewidencja-widok.js']) {
    const k = czytaj(join(PUBLIC, plik));
    assert.match(k, /\$\('pamietaj-dane-migracja'\)\.hidden = !\(stan\.dostepna && d(ane)?\.czekaNaWybor\);/, plik);
    assert.match(k, /addEventListener\('click', (zachowajDaneZWczesniejszej|\(\) => \{\n\s+magazyn\.zachowajDaneFaktur\(\);)/, plik);
    const fn = k.slice(k.indexOf('async function usunDaneZWczesniejszej()'), k.indexOf('\n}\n', k.indexOf('async function usunDaneZWczesniejszej()')));
    assert.ok(fn.indexOf('await zapytaj(') >= 0 && fn.indexOf('await zapytaj(') < fn.indexOf('magazyn.usunDaneFaktur()'), `${plik}: „Usuń” z potwierdzeniem`);
  }
  const ew = czytaj(join(PUBLIC, 'js/ewidencja-widok.js'));
  assert.match(ew, /if \(stan\.dostepna && magazyn\.pamiecDanychWlaczona\(\)\) magazyn\.zmienUstawienia\(\{ osoba:/);
  assert.ok(!/zmienUstawienia\(\{ pamietaj: true, osoba/.test(ew), 'imię do wydruku nie zapisuje się pod pierwszym przełącznikiem');
});

test('faktura: błędna kwota innych faktur to błąd pola i blokada wystawienia, nie 0 zł', () => {
  const html = czytaj(join(PUBLIC, 'faktura/index.html'));
  assert.match(html, /<input id="f-inne"[^>]*aria-describedby="inne-blad inne-zakres inne-info">/);
  assert.match(html, /<p id="inne-blad" class="podpowiedz ostrzezenie-tekst" hidden><\/p>/);
  const kod = czytaj(join(PUBLIC, 'js/faktura-widok.js'));
  const fn = kod.slice(kod.indexOf('function inne()'), kod.indexOf('\n}\n', kod.indexOf('function inne()')));
  assert.match(fn, /kwotaInnychGr\(\$\('f-inne'\)\.value\)/);
  assert.ok(!/naGrosze\(\$\('f-inne'\)/.test(kod), 'bez własnego odczytu pola');
  const wyst = kod.slice(kod.indexOf('async function wystaw('), kod.indexOf('\n}\n', kod.indexOf('async function wystaw(')));
  assert.match(wyst, /if \(bladInnych && f\.nabywca\.rodzaj === 'firma' && r\.powod === 'w-limicie'\) \{\n\s+pokazBlad\(bladInnych, 'inne'\);\n\s+return;/);
  assert.match(kod, /inne: 'f-inne'/);
});

test('faktura: wpis ewidencji z faktury bez nazwy pozycji, gdy pamięć danych do faktur jest wyłączona', () => {
  const kod = czytaj(join(PUBLIC, 'js/faktura-widok.js'));
  assert.match(kod, /dodajFaktureDoEwidencji\(wpisy, f, noweId\(\), \{ zNazwa: magazyn\.pamiecDanychWlaczona\(\) \}\)/);
});

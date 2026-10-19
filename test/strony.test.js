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
  assert.deepEqual(sciezki, [
    'ewidencja-sprzedazy-dzialalnosc-nierejestrowana/index.html', 'index.html',
    'ksef-2027-dzialalnosc-nierejestrowana/index.html', 'limit-dzialalnosc-nierejestrowana/index.html',
    'o-nas/index.html', 'prywatnosc/index.html', 'regulamin/index.html',
  ]);
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
  assert.match(cspNaglowek, /connect-src https:\/\/api\.nbp\.pl;/);
});

test('JS: brak ciasteczek, eval i zewnętrznych adresów poza API NBP', () => {
  for (const plik of JS) {
    const kod = readFileSync(plik, 'utf8');
    assert.ok(!/document\.cookie/.test(kod), `${plik}: document.cookie`);
    assert.ok(!/\beval\(|new Function\(/.test(kod), `${plik}: eval`);
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML/.test(kod), `${plik}: wstrzykiwanie HTML`);
    for (const [url] of kod.matchAll(/https?:\/\/[^\s'"`)]+/g)) assert.match(url, /^https:\/\/api\.nbp\.pl\//, `${plik}: ${url}`);
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

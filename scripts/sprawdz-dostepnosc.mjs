// Test dostępności (axe-core, WCAG 2.2 AA) lokalnej kopii public/. Uruchom: npm run test:a11y
//
// - Strona serwowana jak w `npm run serve` (python3 http.server), tylko na 127.0.0.1, na wolnym porcie.
// - Skanowane są wszystkie adresy z public/sitemap.xml, strona 404.html, licznik limitu w każdym stanie
//   (poniżej progu, 70, 85, 95, 100% i po przekroczeniu, błąd danych), ewidencja z przykładowymi danymi
//   i ewidencja w każdym stanie poziom-* (dane testowe w pamięci przeglądarki, zegar strony ustawiony na 31.12.2026)
//   oraz wybór po przejściu z danych zapisanych przez wcześniejszą wersję (ewidencja i faktura).
// - Wymaga Node ≥ 22.12. Serwer i przeglądarka są zamykane także po błędzie i po SIGINT/SIGTERM (Ctrl+C).
// - Przeglądarka z PLAYWRIGHT_BROWSERS_PATH (bez `playwright install`). Inną binarkę Chromium można wskazać
//   w CHROMIUM_PATH.
// - Każde żądanie poza 127.0.0.1 jest blokowane i kończy test błędem. axe działa z `preload: false`,
//   więc nie pobiera arkuszy CSS samodzielnie.
// - Kod wyjścia 1 przy każdym naruszeniu WCAG, zablokowanym żądaniu albo nieoczekiwanym stanie licznika.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import AxeBuilder from '@axe-core/playwright';
import { limitDlaRoku, groszeNaTekst } from '../public/js/logic.js';

const [wersjaGlowna, wersjaPoboczna] = process.versions.node.split('.').map(Number);
if (wersjaGlowna < 22 || (wersjaGlowna === 22 && wersjaPoboczna < 12)) {
  console.error(`npm run test:a11y wymaga Node ≥ 22.12 (jest ${process.versions.node}).`);
  process.exit(1);
}

const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const TAGI = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

// Adresy z mapy strony (ścieżki) i strona błędu 404.
const mapa = readFileSync(new URL('sitemap.xml', `file://${PUBLIC}`), 'utf8');
const STRONY = [...mapa.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
if (!STRONY.length) throw new Error('sitemap.xml: brak adresów <loc>');
STRONY.push('/404.html');

// Serwer i przeglądarka: zamykane zawsze (finally) i po przerwaniu, żeby lokalny serwer nie zostawał osierocony.
let serwer = null;
let browser = null;
let zamykanie = null;
let przerwano = null; // kod wyjścia po SIGINT/SIGTERM
/** Zamyka serwer (od razu, synchronicznie) i przeglądarkę; kolejne wywołania czekają na to samo zamknięcie. */
function zamknij() {
  if (!zamykanie) {
    serwer?.kill();
    zamykanie = (async () => { try { await browser?.close(); } catch { /* przeglądarka już zamknięta */ } })();
  }
  return zamykanie;
}
for (const [sygnal, kod] of [['SIGINT', 130], ['SIGTERM', 143]]) {
  process.on(sygnal, () => {
    przerwano = kod;
    console.error(`\nPrzerwano (${sygnal}): zamykam przeglądarkę i serwer.`);
    zamknij().finally(() => process.exit(kod));
  });
}

function uruchomSerwer() {
  return new Promise((resolve, reject) => {
    const proc = spawn('python3', ['-u', '-m', 'http.server', '0', '--bind', '127.0.0.1', '--directory', PUBLIC], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    serwer = proc;
    let bufor = '';
    const czas = setTimeout(() => { proc.kill(); reject(new Error('serwer HTTP nie wystartował w 10 s')); }, 10_000);
    proc.stdout.on('data', (d) => {
      bufor += d;
      const m = /port (\d+)/.exec(bufor);
      if (m) { clearTimeout(czas); resolve({ proc, baza: `http://127.0.0.1:${m[1]}` }); }
    });
    proc.stderr.resume();
    proc.on('error', (e) => { clearTimeout(czas); reject(e); });
    proc.on('exit', (kod) => { clearTimeout(czas); reject(new Error(`serwer HTTP zakończył się (kod ${kod})`)); });
  });
}

let bledy = 0;
try {
  const { baza: BAZA } = await uruchomSerwer();
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined });
  const ctx = await browser.newContext({ locale: 'pl-PL', serviceWorkers: 'block' });
  const zablokowane = [];
  await ctx.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith(`${BAZA}/`)) return route.continue();
    zablokowane.push(url);
    return route.abort('blockedbyclient');
  });
  const page = await ctx.newPage();
  const konsola = [];
  page.on('console', (m) => { if (m.type() === 'error') konsola.push(`${page.url()}: ${m.text()}`); });
  page.on('pageerror', (e) => konsola.push(`${page.url()}: ${e.message}`));

  let skany = 0;
  async function skan(nazwa) {
    const w = await new AxeBuilder({ page }).withTags(TAGI).options({ preload: false }).analyze();
    skany += 1;
    const n = w.violations.length;
    console.log(`${n ? 'BŁĄD' : 'ok  '} ${nazwa}: naruszenia ${n}, zaliczone reguły ${w.passes.length}, do ręcznej oceny ${w.incomplete.length}`);
    for (const v of w.violations) {
      bledy += 1;
      console.log(`     - ${v.id} (${v.impact}): ${v.help} [${v.helpUrl}]`);
      for (const node of v.nodes.slice(0, 10)) console.log(`         ${node.target.join(' ')}`);
    }
  }

  for (const s of STRONY) {
    const odp = await page.goto(BAZA + s, { waitUntil: 'load' });
    if (!odp || !odp.ok()) { bledy += 1; console.log(`BŁĄD ${s}: HTTP ${odp?.status()}`); continue; }
    await skan(s);
  }

  // Licznik limitu: kwoty liczone od limitu wybranego kwartału, po jednej na każdy stan.
  await page.goto(`${BAZA}/`, { waitUntil: 'load' });
  const kwartal = await page.locator('#kwartal').inputValue();
  const limit = limitDlaRoku(Number(kwartal.split('-')[0]));
  const kwota = (proc) => groszeNaTekst((limit * BigInt(proc)) / 1000n);
  const STANY = [
    [kwota(500), 'poziom-ok'],
    [kwota(750), 'poziom-70'],
    [kwota(900), 'poziom-85'],
    [kwota(970), 'poziom-95'],
    [groszeNaTekst(limit), 'poziom-100'],
    [kwota(1050), 'poziom-100'],
  ];
  for (const [wartosc, klasa] of STANY) {
    await page.goto(`${BAZA}/`, { waitUntil: 'load' });
    await page.selectOption('#kwartal', kwartal);
    await page.fill('#przychod', wartosc);
    await page.locator('#przychod').press('Enter');
    try {
      await page.waitForFunction((k) => document.getElementById('wynik-status')?.classList.contains(k), klasa, { timeout: 5000 });
    } catch {
      bledy += 1;
      const jest = await page.locator('#wynik-status').getAttribute('class');
      console.log(`BŁĄD licznik ${wartosc} zł: oczekiwany stan ${klasa}, jest „${jest}”`);
      continue;
    }
    await skan(`/ licznik ${wartosc} zł (${klasa})`);
  }
  // Licznik: błędne dane (komunikat o błędzie).
  await page.goto(`${BAZA}/`, { waitUntil: 'load' });
  await page.fill('#przychod', 'abc');
  await page.locator('#przychod').press('Enter');
  try {
    await page.locator('#blad').waitFor({ state: 'visible', timeout: 5000 });
    await skan('/ licznik: błędne dane');
  } catch {
    bledy += 1;
    console.log('BŁĄD licznik: po błędnych danych nie pojawił się komunikat #blad');
  }

  // Ewidencja z przykładowymi danymi.
  await page.goto(`${BAZA}/`, { waitUntil: 'load' });
  await page.click('#pokaz-przyklad');
  try {
    await page.locator('#przyklad-koniec').waitFor({ state: 'visible', timeout: 5000 });
    await skan('/ ewidencja: przykładowe dane');
  } catch {
    bledy += 1;
    console.log('BŁĄD ewidencja: po „Pokaż przykład” nie pojawiły się przykładowe dane');
  }

  // Ewidencja w każdym stanie poziom-*: dane testowe w pamięci przeglądarki, zegar strony na ostatnim dniu kwartału
  // (31.12.2026), więc prognoza nie dolicza tempa i stan zależy tylko od sumy. Po przekroczeniu także ze zwrotem
  // (stan zostaje „przekroczony”) i ze zwrotem, od którego zależy przekroczenie (ostrzeżenie).
  await page.clock.setFixedTime(new Date('2026-12-31T12:00:00+01:00'));
  const L = limitDlaRoku(2026);
  const zl = (promile) => groszeNaTekst((L * BigInt(promile)) / 1000n);
  const wpisy = (...lista) => lista.map(([data, promile], i) => ({
    id: `a11y${i}`, data, opis: `Test ${i + 1}`, kwota: zl(promile), waluta: 'PLN', kurs: '', kursData: '', kursTabela: '',
  }));
  const STANY_EWIDENCJI = [
    ['50% limitu', wpisy(['2026-12-31', 500]), 'poziom-ok'],
    ['75% limitu', wpisy(['2026-12-31', 750]), 'poziom-70'],
    ['90% limitu', wpisy(['2026-12-31', 900]), 'poziom-85'],
    ['97% limitu', wpisy(['2026-12-31', 970]), 'poziom-95'],
    ['100% limitu', wpisy(['2026-12-31', 1000]), 'poziom-100'],
    ['po przekroczeniu', wpisy(['2026-12-31', 1050]), 'poziom-100'],
    ['po przekroczeniu i zwrocie', wpisy(['2026-12-30', 1050], ['2026-12-31', -100]), 'poziom-100'],
    ['zwrot z ostrzeżeniem', wpisy(['2026-10-01', 600], ['2026-10-02', -200], ['2026-12-31', 560]), 'poziom-95', '#stan-zwroty'],
  ];
  for (const [nazwa, lista, klasa, widoczny] of STANY_EWIDENCJI) {
    await page.goto(`${BAZA}/`, { waitUntil: 'load' });
    await page.evaluate((dane) => { localStorage.clear(); localStorage.setItem('dn-ewidencja-v1', dane); },
      JSON.stringify({ wersja: 1, zapisano: '2026-12-31T11:00:00.000Z', wpisy: lista }));
    await page.reload({ waitUntil: 'load' });
    try {
      await page.waitForFunction((k) => document.getElementById('stan-status')?.classList.contains(k), klasa, { timeout: 5000 });
      if (widoczny) await page.locator(widoczny).waitFor({ state: 'visible', timeout: 5000 });
    } catch {
      bledy += 1;
      const jest = await page.locator('#stan-status').getAttribute('class');
      console.log(`BŁĄD ewidencja ${nazwa}: oczekiwany stan ${klasa}${widoczny ? ` i ${widoczny}` : ''}, jest „${jest}”`);
      continue;
    }
    await skan(`/ ewidencja: ${nazwa} (${klasa})`);
  }
  // Dane zapisane przez wcześniejszą wersję (0.4.1): na obu stronach jednorazowy wybór „Zachowaj moje dane” albo „Usuń”.
  const STARE_DANE = JSON.stringify({ wersja: 1, faktury: [], sprzedawca: { nazwa: 'Test', adres: 'Test', rodzajId: 'PESEL', id: '95251401357' }, nabywcy: [], utrataOd: null });
  for (const strona of ['/', '/faktura/']) {
    await page.goto(`${BAZA}${strona}`, { waitUntil: 'load' });
    await page.evaluate((dane) => { localStorage.clear(); localStorage.setItem('dn-faktury-v1', dane); }, STARE_DANE);
    await page.reload({ waitUntil: 'load' });
    try {
      await page.locator('#pamietaj-dane-migracja').waitFor({ state: 'visible', timeout: 5000 });
      await skan(`${strona} wybór po przejściu z wcześniejszej wersji`);
    } catch {
      bledy += 1;
      console.log(`BŁĄD ${strona}: przy danych z wcześniejszej wersji nie pojawił się wybór #pamietaj-dane-migracja`);
    }
  }
  await page.evaluate(() => localStorage.clear());

  for (const u of zablokowane) { bledy += 1; console.log(`BŁĄD żądanie poza 127.0.0.1 (zablokowane): ${u}`); }
  for (const k of konsola) console.log(`uwaga, konsola: ${k}`);
  console.log(`\nSkany: ${skany}, naruszenia i błędy: ${bledy}, żądania poza 127.0.0.1: ${zablokowane.length}.`);
} catch (e) {
  if (przerwano === null) throw e; // po przerwaniu błąd zamkniętej przeglądarki jest oczekiwany
} finally {
  await zamknij();
}
if (przerwano !== null) process.exit(przerwano);
if (bledy) {
  console.error('Test dostępności nie przeszedł.');
  process.exit(1);
}
console.log('OK: brak naruszeń WCAG 2.2 AA (automatyczny skan nie zastępuje przeglądu ręcznego).');

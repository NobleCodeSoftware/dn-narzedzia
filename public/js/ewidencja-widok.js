// Ewidencja sprzedaży w przeglądarce: formularz, lista, stan kwartału, historia, pliki, wydruk.
// Cała logika liczenia jest w modułach bez DOM (ewidencja-logika.js, nbp.js, csv.js, xlsx.js), tu tylko widok.
// Bez wstawiania HTML z tekstu: elementy budujemy przez createElement i textContent.

import { BladDanych, dataWarszawa, formatujZl, kwartal, statusLimitu } from './logic.js';
import { procentTekst, opisProgu, klasaProgu, dopisekTerminu, tekstWylaczeniaPamieci } from './wspolne.js';
import {
  normalizujWpis, kwotaPlnGr, posortuj, historiaKwartalow, prognoza, wierszeEwidencji, etykietaKwartalu,
  kluczKwartalu, granicaKwartalu, limitLubNull, niejednoznacznaKwota, opisNiejednoznacznejKwoty, polaczWpisy,
  ostrzezeniaZwrotow, opisOstrzezeniaZwrotu,
} from './ewidencja-logika.js';
import { pobierzKurs, pobierzKursyHurtem, WALUTY } from './nbp.js';
import { eksportujCsv, importujCsv } from './csv.js';
import { eksportujXlsx, importujXlsx } from './xlsx.js';
import * as magazyn from './magazyn.js';

const $ = (id) => document.getElementById(id);
const MAX_PLIK = 10 * 1024 * 1024;
const NAZWY_DNI = ['niedziela', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota'];

// ------------------------------------------------------------ stan

const stan = {
  wpisy: [],
  przyklad: false,
  edytowany: null, // id wpisu w edycji
  filtr: null, // klucz kwartału, 'wszystkie' albo null (bieżący)
  pamietaj: true,
  pamietajDane: false, // „Zapamiętaj moje dane i dane klientów do faktur” (dane zapisuje strona faktury)
  dostepna: true, // czy pamięć przeglądarki w ogóle działa
  zapisNieudany: false, // ostatni zapis w pamięci przeglądarki się nie udał (np. brak miejsca)
  zmianyOdZapisuPliku: false,
  kursRecznie: false, // użytkownik sam wpisał kurs: nie nadpisujemy go
  kursInfo: null,
};
let licznikId = 0;
const noweId = () => `w${Date.now().toString(36)}${(licznikId += 1).toString(36)}`;
const dzis = () => dataWarszawa();

// ------------------------------------------------------------ pomocnicze widoku

function el(tag, atrybuty = {}, ...dzieci) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(atrybuty)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'klasa') e.className = v;
    else if (k === 'tekst') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const d of dzieci.flat()) if (d !== null && d !== undefined && d !== false) e.append(d);
  return e;
}

/** replaceChildren bez pustych dzieci (null, undefined, false nie mogą trafić na stronę jako tekst „null”). */
function zastap(rodzic, ...dzieci) {
  rodzic.replaceChildren(...dzieci.flat().filter((d) => d !== null && d !== undefined && d !== false));
}

/** 2026-10-21 → 21.10.2026 */
export function dataPl(d) {
  return d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : '';
}
const dataPlZDniem = (d) => {
  const [r, m, dd] = d.split('-').map(Number);
  return `${dataPl(d)} (${NAZWY_DNI[new Date(Date.UTC(r, m - 1, dd)).getUTCDay()]})`;
};

/** Odmiana liczebnika: odmiana(5, ['wpis', 'wpisy', 'wpisów']) → '5 wpisów'. */
function odmiana(n, [jeden, kilka, wiele]) {
  const d = n % 10;
  const s = n % 100;
  if (n === 1) return `${n} ${jeden}`;
  return `${n} ${d >= 2 && d <= 4 && (s < 12 || s > 14) ? kilka : wiele}`;
}
const WPIS = ['wpis', 'wpisy', 'wpisów'];
const SPRZEDAZ = ['sprzedaż', 'sprzedaże', 'sprzedaży'];
const WIERSZ = ['wiersz', 'wiersze', 'wierszy'];
const liczbaPl = (t) => String(t).replace('.', ',').replace('-', '−');

let ostatnieOgloszenie = '';
function oglos(tekst) {
  const r = $('ogloszenie');
  if (tekst === ostatnieOgloszenie) r.textContent = '';
  r.textContent = tekst;
  ostatnieOgloszenie = tekst;
}

function pokazStanPliku(tekst) {
  $('pliki-stan').textContent = tekst;
}

// ------------------------------------------------------------ zapis i odczyt

const TEKST_NIEUDANEGO_ZAPISU = 'Nie udało się zapisać wpisów w pamięci przeglądarki. Zapisz plik XLSX albo CSV, żeby ich nie stracić.';

function utrwal() {
  // Pamięć mogła zostać wyłączona w innej karcie, zanim ta karta obsłużyła zdarzenie storage: wtedy nic nie zapisujemy
  // (magazyn.zapisz też to sprawdza) i nie pokazujemy komunikatu o nieudanym zapisie.
  if (stan.przyklad || !stan.pamietaj || !magazyn.pamiecWlaczona()) return;
  stan.zapisNieudany = !magazyn.zapisz(stan.wpisy);
  if (stan.zapisNieudany) {
    pokazStanPliku(TEKST_NIEUDANEGO_ZAPISU);
    oglos(TEKST_NIEUDANEGO_ZAPISU);
  } else if ($('pliki-stan').textContent === TEKST_NIEUDANEGO_ZAPISU) {
    pokazStanPliku(''); // zapis znów działa: stary komunikat nie jest już prawdziwy
  }
}

function ustawWpisy(wpisy, { zmiana = true } = {}) {
  stan.wpisy = wpisy;
  if (zmiana) stan.zmianyOdZapisuPliku = true;
  utrwal();
  odswiez();
}

function wczytajStart() {
  stan.dostepna = magazyn.dostepny();
  $('pamietaj').disabled = !stan.dostepna;
  $('pamietaj-dane').disabled = !stan.dostepna;
  if (!stan.dostepna) $('pamietaj-info').textContent = 'Pamięć przeglądarki jest niedostępna (np. tryb prywatny), więc wpisy znikną po zamknięciu strony. Zapisz plik przed zamknięciem.';
  wczytajZMagazynu();
}

/** Ustawienia i wpisy z pamięci przeglądarki (przy starcie i po zmianie w innej karcie). */
function wczytajZMagazynu() {
  const u = magazyn.wczytajUstawienia();
  stan.pamietaj = stan.dostepna && u.pamietaj !== false;
  $('pamietaj').checked = stan.pamietaj;
  odswiezPamiecDanych();
  if (u.osoba) $('druk-osoba').value = String(u.osoba).slice(0, 80);
  if (!stan.pamietaj) return;
  const zapisane = magazyn.wczytaj();
  const wpisy = [];
  for (const w of zapisane?.wpisy ?? []) {
    try { wpisy.push(normalizujWpis(w)); } catch { /* pomijamy uszkodzony wpis */ }
  }
  stan.wpisy = wpisy;
}

/** Inna karta zmieniła dane strony: wczytujemy je ponownie, żeby nie nadpisać ich starszą wersją. */
function poZmianieWInnejKarcie(ev) {
  if (ev.key !== null && (!ev.key.startsWith('dn-') || ev.key === 'dn-test')) return;
  // Okno potwierdzenia jest otwarte (np. wyłączenie pamięci): zmianę uwzględniamy dopiero po jego zamknięciu.
  if ($('dialog').open) { $('dialog').addEventListener('close', () => poZmianieWInnejKarcie(ev), { once: true }); return; }
  // Wpisy, które są tylko na tej stronie (pamięć wyłączona, nieudany zapis, przykład), nigdy nie są zastępowane
  // danymi z innej karty. Przy włączaniu pamięci tutaj łączymy je z zapisanymi (zmienPamiec).
  if (!stan.pamietaj || stan.zapisNieudany || stan.przyklad) return;
  wczytajZMagazynu();
  odswiez();
}

/** Przełącznik „Zapamiętaj moje dane i dane klientów do faktur” i informacja o danych z wcześniejszej wersji. */
function odswiezPamiecDanych() {
  const d = magazyn.stanPamieciDanych();
  stan.pamietajDane = stan.dostepna && d.wlaczona;
  $('pamietaj-dane').checked = stan.pamietajDane;
  // Dane z wcześniejszej wersji: jednorazowy wybór „Zachowaj moje dane” albo „Usuń”.
  $('pamietaj-dane-migracja').hidden = !(stan.dostepna && d.czekaNaWybor);
}

/** Akapit z dopiskiem o terminie w dzień wolny od pracy (albo null, gdy termin to dzień roboczy). */
function akapitDopisku(termin) {
  const t = dopisekTerminu(termin);
  return t ? el('p', { tekst: t }) : null;
}

/** Opis prognozowanego przekroczenia według przyczyny: zaplanowana sprzedaż albo obecne tempo. */
function opisGrozby(przekroczenie, przyczyna) {
  return przyczyna === 'plan'
    ? `według zaplanowanych sprzedaży przekroczysz limit ${dataPl(przekroczenie.data)}`
    : `przy obecnym tempie przekroczysz limit około ${dataPl(przekroczenie.data)}`;
}

// ------------------------------------------------------------ dialog

function zapytaj({ tytul, tekst, przyciski }) {
  const d = $('dialog');
  $('dialog-tytul').textContent = tytul;
  $('dialog-tekst').textContent = tekst;
  const kontener = $('dialog-przyciski');
  zastap(kontener);
  return new Promise((rozwiaz) => {
    const zamknij = (wynik) => { d.close(); rozwiaz(wynik); };
    let domyslny = null;
    for (const p of przyciski) {
      const b = el('button', { type: 'button', klasa: p.klasa ?? 'drugorzedny', tekst: p.tekst, onclick: () => zamknij(p.wynik) });
      if (p.domyslny) domyslny = b;
      kontener.append(b);
    }
    d.addEventListener('cancel', () => rozwiaz(null), { once: true });
    d.showModal();
    (domyslny ?? kontener.firstChild)?.focus();
  });
}

// ------------------------------------------------------------ stan kwartału

function renderujStan() {
  const p = prognoza(stan.wpisy, dzis());
  const { rok, q } = kwartal(dzis());
  const g = granicaKwartalu(rok, q);
  $('stan-tytul').textContent = etykietaKwartalu(rok, q);
  $('stan-okres').textContent = `Od ${dataPl(g.od)} do ${dataPl(g.doDnia)}, dziś ${dataPl(dzis())}`;
  const puste = stan.wpisy.length === 0;
  $('stan-pusto').hidden = !puste;
  $('stan-dane').hidden = puste;
  if (puste) return;
  if (!p) {
    $('stan-bez-kursu').hidden = true;
    $('stan-zwroty').hidden = true;
    $('stan-status').textContent = 'Brak kwoty limitu na ten rok. Uzupełnimy ją po ogłoszeniu płacy minimalnej.';
    return;
  }
  const s = p.status;
  $('stan-bez-kursu').hidden = p.bezKursu === 0;
  $('stan-bez-kursu').textContent = `Bez kursu NBP: ${odmiana(p.bezKursu, SPRZEDAZ)} w walucie, więc suma kwartału może być zaniżona. Uzupełnij kursy na liście wpisów.`;
  $('stan-procent').textContent = procentTekst(s.procent);
  $('stan-pasek').style.width = `${Math.min(Math.max(s.procent, 0), 100)}%`;
  $('stan-pasek').className = `pasek-wypelnienie ${klasaProgu(s)}`;
  $('stan-pasek-prognoza').style.width = `${Math.min(Math.max(p.statusNaKoniec.procent, 0), 100)}%`;
  const grozi = Boolean(p.przekroczenie?.prognoza);
  const klasaStatusu = grozi ? klasaProgu(p.statusNaKoniec) : klasaProgu(s);
  let status = grozi ? `Uwaga: ${opisGrozby(p.przekroczenie, p.przyczynaPrzekroczenia)}.` : opisProgu(s);
  // Przekroczenie się nie cofa: późniejsze zwroty nie przywracają stanu „w limicie”.
  if (!grozi && s.przekroczonyOd) status = `Limit przekroczony ${dataPl(s.przekroczonyOd)}.${p.zapasGr >= 0n ? ' Późniejsze zwroty tego nie cofają.' : ''}`;
  $('stan-status').textContent = status;
  $('stan-status').className = `status ${klasaStatusu}`;
  $('stan-suma').textContent = formatujZl(p.sumaGr);
  if (p.zapasGr < 0n) $('stan-zapas').textContent = `limit przekroczony o ${formatujZl(-p.zapasGr)}`;
  else if (s.przekroczonyOd) $('stan-zapas').textContent = `nic, limit przekroczony ${dataPl(s.przekroczonyOd)}`;
  else if (p.planPrzekroczenie) $('stan-zapas').textContent = `${formatujZl(p.zapasGr)}, ale zaplanowane sprzedaże go przekraczają`;
  else if (p.zaplanowaneGr !== 0n) $('stan-zapas').textContent = `${formatujZl(p.wolneGr)} po zaplanowanych sprzedażach`;
  else $('stan-zapas').textContent = formatujZl(p.zapasGr);
  const zaplanowane = p.zaplanowaneGr !== 0n ? `, w tym zaplanowane: ${formatujZl(p.zaplanowaneGr)}` : '';
  $('stan-koniec').textContent = p.tempoDzienneGr > 0n || p.zaplanowaneGr !== 0n
    ? `${formatujZl(p.sumaNaKoniecGr)} (${procentTekst(p.statusNaKoniec.procent)})${zaplanowane}`
    : 'brak sprzedaży do oceny';
  $('stan-budzet').textContent = p.wolneGr > 0n && !s.przekroczonyOd ? formatujZl(p.budzetDziennyGr) : '—';
  $('stan-zwroty').hidden = p.ostrzezenia.length === 0;
  $('stan-zwroty').textContent = p.ostrzezenia.map((o) => `Zwrot z ${dataPl(o.data)}: ${opisOstrzezeniaZwrotu(o)}`).join(' ');

  let zdanie;
  if (p.przekroczenie && !p.przekroczenie.prognoza) {
    zdanie = `Limit przekroczony ${dataPl(p.przekroczenie.data)}. Zobacz niżej, co dalej.`;
  } else if (p.planPrzekroczenie) {
    zdanie = `Zaplanowane sprzedaże (${formatujZl(p.zaplanowaneGr)}) razem ze sprzedażą do dziś przekraczają limit ${dataPl(p.planPrzekroczenie.data)}. Żeby się zmieścić, zmniejsz albo przesuń zaplanowaną sprzedaż.`;
  } else if (p.przekroczenie) {
    const zPlanem = p.zaplanowaneGr !== 0n ? ' razem z zaplanowanymi sprzedażami' : '';
    zdanie = `Sprzedajesz średnio ${formatujZl(p.tempoDzienneGr)} dziennie, a żeby zmieścić się w limicie${zPlanem}, do końca kwartału możesz średnio ${formatujZl(p.budzetDziennyGr)} dziennie.`;
  } else if (p.tempoDzienneGr > 0n) {
    zdanie = `Przy obecnym tempie (${formatujZl(p.tempoDzienneGr)} dziennie) zmieścisz się w limicie do końca kwartału.`;
  } else {
    zdanie = 'W tym kwartale nie ma jeszcze sprzedaży, więc nie ma z czego liczyć prognozy.';
  }
  if (p.pewnosc === 'mala' && p.tempoDzienneGr > 0n && !(p.przekroczenie && !p.przekroczenie.prognoza) && !p.planPrzekroczenie) {
    zdanie += ' Prognoza jest mało pewna: minęło mało dni albo jest mało wpisów.';
  }
  $('stan-prognoza').textContent = zdanie;
  $('stan-prognoza').className = `prognoza ${grozi || p.status.przekroczony ? `status-tekst ${klasaStatusu}` : ''}`;

  const nazwy = { '0.70': '70%', '0.85': '85%', '0.95': '95%', '1.00': '100%' };
  zastap($('stan-progi'), ...p.progi.filter((x) => x.prog !== 'przekroczenie').map((x) => {
    let kiedy;
    let klasa = '';
    if (x.osiagnietyDnia) { kiedy = `osiągnięty ${dataPl(x.osiagnietyDnia)}`; klasa = 'osiagniety'; }
    else if (x.prognozaDnia) kiedy = `około ${dataPl(x.prognozaDnia)} (prognoza)`;
    else kiedy = 'nie w tym kwartale';
    return el('tr', { klasa },
      el('th', { scope: 'row', tekst: nazwy[x.prog] }),
      el('td', { klasa: 'num', tekst: formatujZl(x.kwotaGr) }),
      el('td', { tekst: kiedy }));
  }));
}

// ------------------------------------------------------------ lista wpisów

function opcjeFiltra() {
  const s = $('filtr-kwartal');
  const { rok, q } = kwartal(dzis());
  const biezacy = kluczKwartalu(rok, q);
  const klucze = new Set([biezacy, ...stan.wpisy.map((w) => { const k = kwartal(w.data); return kluczKwartalu(k.rok, k.q); })]);
  const posortowane = [...klucze].sort((a, b) => {
    const [ra, qa] = a.split('-').map(Number); const [rb, qb] = b.split('-').map(Number);
    return (rb - ra) || (qb - qa);
  });
  const wybrany = stan.filtr ?? biezacy;
  zastap(s,
    ...posortowane.map((k) => { const [r, qq] = k.split('-').map(Number); return el('option', { value: k, tekst: etykietaKwartalu(r, qq) }); }),
    el('option', { value: 'wszystkie', tekst: 'Wszystkie wpisy' }),
  );
  s.value = [...s.options].some((o) => o.value === wybrany) ? wybrany : biezacy;
}

function opisKwoty(w) {
  const gr = kwotaPlnGr(w);
  if (w.waluta === 'PLN') return { glowna: formatujZl(gr), dodatkowa: '' };
  const wWalucie = `${liczbaPl(w.kwota)} ${w.waluta}`;
  if (gr === null) return { glowna: wWalucie, dodatkowa: 'brak kursu NBP' };
  const zrodlo = w.kursData ? `, kurs NBP z ${dataPl(w.kursData)}` : ', kurs NBP';
  return { glowna: formatujZl(gr), dodatkowa: `${wWalucie} × ${liczbaPl(w.kurs)}${zrodlo}` };
}

function renderujListe() {
  opcjeFiltra();
  const ostrzezenia = new Map(ostrzezeniaZwrotow(stan.wpisy, dzis()).map((o) => [o.id, o]));
  const filtr = $('filtr-kwartal').value;
  const widoczne = posortuj(stan.wpisy).filter((w) => {
    if (filtr === 'wszystkie') return true;
    const k = kwartal(w.data);
    return kluczKwartalu(k.rok, k.q) === filtr;
  }).reverse();
  $('wpisy-pusto').hidden = widoczne.length > 0;
  zastap($('lista-wpisow'), ...widoczne.map((w) => {
    const k = opisKwoty(w);
    const brak = kwotaPlnGr(w) === null;
    return el('li', { klasa: `wpis${brak ? ' bez-kursu' : ''}${stan.edytowany === w.id ? ' edytowany' : ''}` },
      el('div', { klasa: 'wpis-tresc' },
        el('p', { klasa: 'wpis-data', tekst: dataPl(w.data) }),
        el('p', { klasa: 'wpis-opis', tekst: w.opis || 'Sprzedaż bez opisu' }),
        el('p', { klasa: `wpis-kwota${kwotaPlnGr(w) < 0n ? ' ujemna' : ''}`, tekst: k.glowna }),
        k.dodatkowa ? el('p', { klasa: `wpis-dodatkowa${brak ? ' ostrzezenie-tekst' : ''}`, tekst: k.dodatkowa }) : null,
        w.dotyczy ? el('p', { klasa: 'wpis-dodatkowa', tekst: `Zwrot dotyczy sprzedaży z ${dataPl(w.dotyczy)}.` }) : null,
        ostrzezenia.has(w.id) ? el('p', { klasa: 'wpis-dodatkowa ostrzezenie-tekst', tekst: opisOstrzezeniaZwrotu(ostrzezenia.get(w.id)) }) : null),
      el('div', { klasa: 'wpis-akcje' },
        el('button', { type: 'button', klasa: 'drugorzedny maly', tekst: 'Edytuj', 'aria-label': `Edytuj wpis z ${dataPl(w.data)}, ${k.glowna}`, onclick: () => edytuj(w.id) }),
        el('button', { type: 'button', klasa: 'drugorzedny maly', tekst: 'Usuń', 'aria-label': `Usuń wpis z ${dataPl(w.data)}, ${k.glowna}`, onclick: () => usun(w.id) })));
  }));
  const braki = stan.wpisy.filter((w) => kwotaPlnGr(w) === null).length;
  $('braki-kursow').hidden = braki === 0;
  $('braki-kursow-tekst').textContent = `Bez kursu NBP: ${odmiana(braki, SPRZEDAZ)} w walucie. Bez kursu nie liczą się do limitu.`;
}

// ------------------------------------------------------------ historia

function renderujHistorie() {
  const h = historiaKwartalow(stan.wpisy, dzis());
  const p = prognoza(stan.wpisy, dzis());
  const grozi = p?.przekroczenie?.prognoza ? p : null; // bieżący kwartał z prognozą przekroczenia
  $('historia-pusto').hidden = h.length > 0;
  $('historia-tabela').hidden = h.length === 0;
  zastap($('historia-wiersze'), ...h.map((k) => {
    // Kwartał, który jeszcze się nie zaczął: procent i pasek z planu, a nie „0,0%” sprzedaży do dziś.
    const s = k.przyszly ? k.statusZPlanem : k.status;
    const procent = s ? s.procent : null;
    const pasek = el('div', { klasa: 'pasek maly', 'aria-hidden': 'true' }, el('div', { klasa: `pasek-wypelnienie ${s ? klasaProgu(s) : ''}` }));
    if (procent !== null) pasek.firstChild.style.width = `${Math.min(Math.max(procent, 0), 100)}%`;
    let opis;
    if (!k.status) opis = k.rok < 2026 ? 'limit kwartalny od 2026' : 'brak kwoty limitu na ten rok';
    else if (k.przekroczenie) opis = `przekroczony ${dataPl(k.przekroczenie.data)}`;
    else if (grozi && grozi.rok === k.rok && grozi.q === k.q) opis = `Uwaga: ${opisGrozby(grozi.przekroczenie, grozi.przyczynaPrzekroczenia)}`;
    else if (k.prognozaPrzekroczenia) opis = `Uwaga: przekroczysz limit według zaplanowanych sprzedaży, dnia ${dataPl(k.prognozaPrzekroczenia.data)}`;
    else opis = opisProgu(k.status).replace(/\.$/, '');
    let klasaStanu = k.status ? klasaProgu(k.status) : null;
    if (!k.przekroczenie && grozi && grozi.rok === k.rok && grozi.q === k.q) klasaStanu = klasaProgu(grozi.statusNaKoniec);
    else if (!k.przekroczenie && k.prognozaPrzekroczenia) klasaStanu = klasaProgu(k.statusZPlanem);
    if (k.bezKursu) opis += ` · bez kursu: ${k.bezKursu}`;
    if (k.zaplanowane) opis += ` · zaplanowane: ${formatujZl(k.zaplanowaneGr)}`;
    if (k.ostrzezenia.length) opis += ' · zwrot do sprawdzenia (zob. wpisy)';
    return el('tr', {},
      el('th', { scope: 'row', tekst: `${['I', 'II', 'III', 'IV'][k.q - 1]} ${k.rok}` }),
      el('td', { klasa: 'num', tekst: formatujZl(k.sumaGr) }),
      el('td', { klasa: 'kol-pasek' }, el('span', { klasa: 'procent-maly', tekst: procent === null ? '—' : `${procentTekst(procent)}${k.przyszly ? ' w planie' : ''}` }), procent === null ? null : pasek),
      el('td', { klasa: klasaStanu ? `status-tekst ${klasaStanu}` : 'muted', tekst: opis }));
  }));
}

// ------------------------------------------------------------ po przekroczeniu

/** Kopia linku do biznes.gov.pl ze źródeł sekcji (adresy zewnętrzne trzymamy tylko w HTML). */
function linkRejestracji() {
  const a = $('link-rejestracja').cloneNode(true);
  a.removeAttribute('id');
  return a;
}

function renderujPrzekroczenie() {
  const box = $('przekroczenie-stan');
  const historia = historiaKwartalow(stan.wpisy, dzis());
  const h = historia.find((k) => k.przekroczenie);
  const p = prognoza(stan.wpisy, dzis());
  // Najbliższy kwartał po bieżącym, w którym limit przekroczy zaplanowana sprzedaż (historia jest od najnowszego).
  const planowane = historia.filter((k) => k.prognozaPrzekroczenia && !(p && k.rok === p.rok && k.q === p.q)).pop() ?? null;
  // Fakt przekroczenia nie ukrywa prognozy: po nim ramka pokazuje też przekroczenie przewidywane z tempa albo z planu.
  const czesci = [];
  if (h) {
    czesci.push(
      el('p', { klasa: 'ramka-tytul', tekst: `Limit przekroczony ${dataPl(h.przekroczenie.data)} (${etykietaKwartalu(h.rok, h.q)}).` }),
      el('p', { tekst: `Termin na wniosek do CEIDG mija ${dataPlZDniem(h.przekroczenie.termin)}, czyli 7 dni od przekroczenia.` }),
      akapitDopisku(h.przekroczenie.termin),
      el('p', {}, 'Jak złożyć wniosek, opisuje ', linkRejestracji(), '.'));
  }
  if (p?.przekroczenie?.prognoza && p.przyczynaPrzekroczenia === 'plan') {
    czesci.push(
      el('p', { klasa: 'ramka-tytul', tekst: `Według zaplanowanych sprzedaży limit zostanie przekroczony ${dataPl(p.przekroczenie.data)}.` }),
      el('p', { tekst: `Wtedy termin na wniosek do CEIDG mija ${dataPl(p.przekroczenie.termin)}. Zaplanowane sprzedaże są większe niż zapas do limitu (${formatujZl(p.zapasGr)}).` }),
      akapitDopisku(p.przekroczenie.termin));
  } else if (p?.przekroczenie?.prognoza) {
    const poPlanie = p.zaplanowaneGr !== 0n ? ' po odjęciu zaplanowanych sprzedaży' : '';
    czesci.push(
      el('p', { klasa: 'ramka-tytul', tekst: `Przy obecnym tempie limit zostanie przekroczony około ${dataPl(p.przekroczenie.data)}.` }),
      el('p', { tekst: `Wtedy termin na wniosek do CEIDG mija ${dataPl(p.przekroczenie.termin)}. Do limitu zostało ${formatujZl(p.wolneGr)}${poPlanie}.` }),
      akapitDopisku(p.przekroczenie.termin));
  } else if (planowane) {
    czesci.push(
      el('p', { klasa: 'ramka-tytul', tekst: `Według zaplanowanych sprzedaży limit zostanie przekroczony ${dataPl(planowane.prognozaPrzekroczenia.data)} (${etykietaKwartalu(planowane.rok, planowane.q)}).` }),
      el('p', { tekst: `Wtedy termin na wniosek do CEIDG mija ${dataPl(planowane.prognozaPrzekroczenia.termin)}. Zmniejsz albo przesuń zaplanowaną sprzedaż, jeśli chcesz zmieścić się w limicie.` }),
      akapitDopisku(planowane.prognozaPrzekroczenia.termin));
  }
  box.className = 'ramka';
  if (h) box.classList.add('alarm');
  else if (czesci.length) box.classList.add('uwaga-ramka');
  if (czesci.length) {
    zastap(box, ...czesci);
  } else {
    zastap(box, el('p', { tekst: stan.wpisy.length
      ? 'Na razie limit nie jest przekroczony i prognoza na ten kwartał tego nie przewiduje.'
      : 'Gdy dodasz sprzedaż, tu zobaczysz datę przekroczenia i termin na wniosek.' }));
  }
}

// ------------------------------------------------------------ wszystko

function odswiez() {
  renderujStan();
  renderujListe();
  renderujHistorie();
  renderujPrzekroczenie();
  opcjeRokuWydruku();
  $('przyklad-pasek').hidden = !stan.przyklad;
}

// ------------------------------------------------------------ formularz

function opcjeWalut() {
  zastap($('f-waluta'),
    el('option', { value: 'PLN', tekst: 'PLN (złoty)' }),
    ...WALUTY.map((k) => el('option', { value: k, tekst: k })),
  );
}

/** Kwota w formularzu jest zwrotem (zaczyna się od minusa). */
const zwrotWFormularzu = () => /^\s*[-−]/.test($('f-kwota').value);

function wartosciFormularza() {
  return {
    data: $('f-data').value,
    kwota: $('f-kwota').value,
    waluta: $('f-waluta').value,
    kurs: $('f-waluta').value === 'PLN' ? '' : $('f-kurs').value,
    opis: $('f-opis').value,
    dotyczy: zwrotWFormularzu() ? $('f-dotyczy').value : '',
  };
}

/**
 * Przy zwrocie: etykieta „Data dokumentu korekty” (nie data fizycznego zwrotu towaru), podpowiedź o tej dacie
 * i pole „dotyczy sprzedaży z dnia”.
 */
function odswiezZwrot() {
  const zwrot = zwrotWFormularzu();
  $('etykieta-data').textContent = zwrot ? 'Data dokumentu korekty' : 'Data sprzedaży';
  $('f-data-zwrot').hidden = !zwrot;
  $('pole-dotyczy').hidden = !zwrot;
}

function pokazBladFormularza(tekst, pole) {
  $('form-blad').textContent = tekst;
  $('form-blad').hidden = !tekst;
  for (const id of ['f-data', 'f-kwota', 'f-kurs', 'f-dotyczy']) $(id).removeAttribute('aria-invalid');
  if (pole) { $(pole).setAttribute('aria-invalid', 'true'); $(pole).focus(); }
  if (tekst) oglos(tekst);
}

function odswiezPodglad() {
  odswiezZwrot();
  const v = wartosciFormularza();
  const czyWaluta = v.waluta !== 'PLN';
  $('pole-kurs').hidden = !czyWaluta;
  let tekst = '';
  try {
    const w = normalizujWpis({ ...v, data: v.data || dzis(), dotyczy: '' });
    const gr = kwotaPlnGr(w);
    if (czyWaluta && gr !== null) tekst = `W złotych: ${formatujZl(gr)} (${liczbaPl(w.kwota)} ${w.waluta} × ${liczbaPl(w.kurs)})`;
    else if (czyWaluta) tekst = 'Bez kursu sprzedaż nie liczy się do limitu. Kurs pobierzemy z NBP albo wpisz go sam.';
  } catch { tekst = ''; }
  $('f-podglad').textContent = tekst;
  $('f-podglad').hidden = !tekst;
}

let zegarKursu = null;
let numerZapytania = 0;

function opisKursu(k) {
  const pominiete = [...(k.pominiete ?? [])].reverse().map((p) => `${dataPl(p.data)} (${p.powod})`);
  const dzien = `Kurs z ${dataPlZDniem(k.data)}, tabela ${k.tabela}.`;
  if (k.innyDzien) return `${dzien} NBP nie opublikował tabeli z ${dataPl(k.oczekiwany)}.`;
  return pominiete.length ? `${dzien} Pominięte dni bez tabeli: ${pominiete.join(', ')}.` : `${dzien} To ostatni dzień roboczy przed sprzedażą.`;
}

async function pobierzKursFormularza({ wymus = false } = {}) {
  const { data, waluta } = wartosciFormularza();
  if (waluta === 'PLN' || !data) return;
  if (stan.kursRecznie && !wymus) return;
  const nr = (numerZapytania += 1);
  $('kurs-info').textContent = 'Pobieram kurs z NBP…';
  const k = await pobierzKurs(waluta, data, { pobierz: (...a) => fetch(...a), dzis: dzis() });
  if (nr !== numerZapytania) return; // nowsze zapytanie w toku
  if (k.stan === 'ok') {
    $('f-kurs').value = liczbaPl(k.kurs);
    stan.kursRecznie = false;
    stan.kursInfo = { data: k.data, tabela: k.tabela };
    $('kurs-info').textContent = opisKursu(k);
    oglos(`Kurs NBP ${liczbaPl(k.kurs)} z ${dataPl(k.data)}.`);
  } else {
    stan.kursInfo = null;
    if (!stan.kursRecznie) $('f-kurs').value = '';
    $('kurs-info').textContent = {
      niedostepny: (k.oczekiwany ?? '') < dzis()
        ? `NBP nie zwrócił kursu z ${dataPl(k.oczekiwany ?? '')}. Sprawdź tabelę A na stronie NBP i wpisz kurs sam.`
        : `NBP nie ma jeszcze kursu z ${dataPl(k.oczekiwany ?? '')}. Wpisz kurs sam, gdy się pojawi.`,
      'brak-waluty': 'NBP nie podaje kursu średniego tej waluty w tabeli A. Wpisz kurs sam.',
    }[k.stan] ?? 'Nie udało się połączyć z NBP. Sprawdź internet albo wpisz kurs sam.';
  }
  odswiezPodglad();
}

function zaplanujKurs() {
  clearTimeout(zegarKursu);
  zegarKursu = setTimeout(() => pobierzKursFormularza(), 400);
}

function wyczyscFormularz() {
  stan.edytowany = null;
  stan.kursRecznie = false;
  stan.kursInfo = null;
  $('f-kwota').value = '';
  $('f-opis').value = '';
  $('f-kurs').value = '';
  $('f-dotyczy').value = '';
  $('kurs-info').textContent = '';
  $('form-tytul').textContent = 'Dodaj sprzedaż';
  $('f-zapisz').textContent = 'Dodaj sprzedaż';
  $('f-anuluj').hidden = true;
  pokazBladFormularza('');
  odswiezPodglad();
}

function zapiszFormularz(ev) {
  ev.preventDefault();
  const v = wartosciFormularza();
  if (!v.data) { pokazBladFormularza('Podaj datę sprzedaży.', 'f-data'); return; }
  if (!v.kwota.trim()) { pokazBladFormularza('Wpisz kwotę, np. 49,90.', 'f-kwota'); return; }
  if (niejednoznacznaKwota(v.kwota)) {
    const t = opisNiejednoznacznejKwoty(v.kwota);
    pokazBladFormularza(`${t[0].toUpperCase()}${t.slice(1)}.`, 'f-kwota');
    return;
  }
  let wpis;
  try {
    wpis = normalizujWpis({
      ...v,
      kwota: v.kwota.replace('−', '-'),
      id: stan.edytowany ?? noweId(),
      kursData: stan.kursInfo?.data ?? '',
      kursTabela: stan.kursInfo?.tabela ?? '',
      zmieniono: new Date().toISOString(), // przy łączeniu wersji z dwóch kart wygrywa później zmieniona (polaczWpisy)
    });
  } catch (e) {
    const pole = /dotyczy zwrot/.test(e.message) ? 'f-dotyczy' : /datę/.test(e.message) ? 'f-data' : /Kurs/.test(e.message) ? 'f-kurs' : /kwot|Kwota/i.test(e.message) ? 'f-kwota' : null;
    pokazBladFormularza(e.message, pole);
    return;
  }
  if (stan.przyklad) { stan.przyklad = false; stan.wpisy = []; }
  // Wpis mógł zniknąć w innej karcie w czasie edycji: wtedy zapisujemy go jako nowy, zamiast go zgubić.
  const edycja = Boolean(stan.edytowany) && stan.wpisy.some((w) => w.id === stan.edytowany);
  const wpisy = edycja ? stan.wpisy.map((w) => (w.id === wpis.id ? wpis : w)) : [...stan.wpisy, wpis];
  const { rok, q } = kwartal(wpis.data);
  stan.filtr = kluczKwartalu(rok, q);
  const zachowajDate = wpis.data;
  wyczyscFormularz();
  $('f-data').value = zachowajDate;
  ustawWpisy(wpisy);
  const gr = kwotaPlnGr(wpis);
  const p = prognoza(stan.wpisy, dzis());
  const stanKw = p && kluczKwartalu(p.rok, p.q) === kluczKwartalu(rok, q) ? ` ${procentTekst(p.status.procent)} limitu kwartału.` : '';
  oglos(`${edycja ? 'Zapisano zmiany' : 'Dodano sprzedaż'}: ${dataPl(wpis.data)}, ${gr === null ? `${liczbaPl(wpis.kwota)} ${wpis.waluta} bez kursu` : formatujZl(gr)}.${stanKw}`);
  pokazPotwierdzenie(wpis, edycja);
}

/** Widoczne potwierdzenie przy przycisku: co dodano i stan kwartału tej sprzedaży. */
function pokazPotwierdzenie(wpis, edycja) {
  const gr = kwotaPlnGr(wpis);
  const { rok, q } = kwartal(wpis.data);
  const kw = historiaKwartalow(stan.wpisy, dzis()).find((k) => k.rok === rok && k.q === q);
  const p = prognoza(stan.wpisy, dzis());
  const biezacy = p && p.rok === rok && p.q === q;
  const kwota = gr === null ? `${liczbaPl(wpis.kwota)} ${wpis.waluta} (bez kursu, nie liczy się do limitu)` : formatujZl(gr);
  let stanKw = '';
  let klasa = 'poziom-ok';
  if (kw?.status) {
    klasa = klasaProgu(kw.status);
    const etykieta = etykietaKwartalu(rok, q);
    const doDzis = kw.zaplanowane ? ' do dziś' : '';
    if (kw.przyszly) {
      // Kwartał jeszcze się nie zaczął: cała jego sprzedaż jest zaplanowana, więc bez „0,0% limitu do dziś”.
      klasa = klasaProgu(kw.statusZPlanem);
      stanKw = `${etykieta} jeszcze się nie zaczął. Zaplanowane: ${formatujZl(kw.zaplanowaneGr)} (${procentTekst(kw.statusZPlanem.procent)} limitu)`;
      stanKw += kw.prognozaPrzekroczenia ? `, według nich przekroczysz limit ${dataPl(kw.prognozaPrzekroczenia.data)}.` : `, zostanie ${formatujZl(kw.wolneGr)}.`;
    } else if (kw.status.przekroczony) {
      const od = kw.status.przekroczonyOd ? ` ${dataPl(kw.status.przekroczonyOd)}` : '';
      stanKw = `${etykieta}: ${procentTekst(kw.status.procent)} limitu, limit przekroczony${od}.`;
    } else if (kw.prognozaPrzekroczenia) {
      // „Zostało” liczymy od limitu minus sprzedaż do dziś i zaplanowana; tu plan już przekracza limit.
      klasa = klasaProgu(kw.statusZPlanem);
      stanKw = `${etykieta}: ${procentTekst(kw.status.procent)} limitu${doDzis}. Według zaplanowanych sprzedaży przekroczysz limit ${dataPl(kw.prognozaPrzekroczenia.data)}.`;
    } else {
      const poPlanie = kw.zaplanowane ? ' po zaplanowanych sprzedażach' : '';
      stanKw = `${etykieta}: ${procentTekst(kw.status.procent)} limitu${doDzis}, zostało ${formatujZl(kw.wolneGr)}${poPlanie}.`;
    }
    if (biezacy && p.przekroczenie?.prognoza && p.przyczynaPrzekroczenia === 'tempo') {
      klasa = klasaProgu(p.statusNaKoniec);
      stanKw += ` Przy obecnym tempie przekroczysz limit około ${dataPl(p.przekroczenie.data)}.`;
    }
  }
  const box = $('f-potwierdzenie');
  box.className = `potwierdzenie ${klasa}`;
  zastap(box,
    el('span', { klasa: 'potwierdzenie-tytul', tekst: `${edycja ? 'Zapisano' : 'Dodano'}: ${dataPl(wpis.data)}, ${kwota}.` }),
    stanKw ? el('span', { klasa: 'potwierdzenie-stan', tekst: ` ${stanKw}` }) : null,
    ' ', el('a', { href: '#stan', tekst: 'Zobacz stan kwartału' }));
  box.hidden = false;
  const dotyk = window.matchMedia('(pointer: coarse)').matches;
  if (dotyk) {
    document.activeElement?.blur(); // chowa klawiaturę, żeby potwierdzenie było widać
  } else {
    $('f-kwota').focus({ preventScroll: true });
  }
  const ograniczRuch = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  requestAnimationFrame(() => box.scrollIntoView({ block: 'nearest', behavior: ograniczRuch ? 'auto' : 'smooth' }));
}

function edytuj(id) {
  const w = stan.wpisy.find((x) => x.id === id);
  if (!w) return;
  stan.edytowany = id;
  $('f-data').value = w.data;
  $('f-kwota').value = liczbaPl(w.kwota);
  if (![...$('f-waluta').options].some((o) => o.value === w.waluta)) $('f-waluta').append(el('option', { value: w.waluta, tekst: w.waluta }));
  $('f-waluta').value = w.waluta;
  $('f-kurs').value = w.kurs ? liczbaPl(w.kurs) : '';
  $('f-opis').value = w.opis;
  $('f-dotyczy').value = w.dotyczy ?? '';
  stan.kursRecznie = Boolean(w.kurs);
  stan.kursInfo = w.kursData ? { data: w.kursData, tabela: w.kursTabela } : null;
  $('kurs-info').textContent = w.kursData ? `Kurs z ${dataPlZDniem(w.kursData)}${w.kursTabela ? `, tabela ${w.kursTabela}` : ''}.` : '';
  $('f-potwierdzenie').hidden = true;
  $('form-tytul').textContent = `Edytuj sprzedaż z ${dataPl(w.data)}`;
  $('f-zapisz').textContent = 'Zapisz zmiany';
  $('f-anuluj').hidden = false;
  pokazBladFormularza('');
  odswiezPodglad();
  renderujListe();
  $('formularz').scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  $('f-kwota').focus({ preventScroll: true });
}

async function usun(id) {
  const w = stan.wpisy.find((x) => x.id === id);
  if (!w) return;
  const k = opisKwoty(w);
  const odp = await zapytaj({
    tytul: 'Usunąć wpis?',
    tekst: `${dataPl(w.data)}, ${k.glowna}${w.opis ? `, ${w.opis}` : ''}.`,
    przyciski: [{ tekst: 'Anuluj', wynik: false, domyslny: true }, { tekst: 'Usuń', wynik: true, klasa: 'niebezpieczny' }],
  });
  if (!odp) return;
  if (stan.edytowany === id) wyczyscFormularz();
  ustawWpisy(stan.wpisy.filter((x) => x.id !== id));
  oglos(`Usunięto wpis z ${dataPl(w.data)}.`);
  $('wpisy-tytul').setAttribute('tabindex', '-1');
  $('wpisy-tytul').focus();
}

// ------------------------------------------------------------ kursy hurtem

async function uzupelnijKursy() {
  const braki = stan.wpisy.filter((w) => w.waluta !== 'PLN' && !w.kurs);
  if (!braki.length) return;
  $('uzupelnij-kursy').disabled = true;
  $('braki-kursow-tekst').textContent = 'Pobieram kursy z NBP…';
  const wyniki = await pobierzKursyHurtem(braki.map((w) => ({ waluta: w.waluta, data: w.data })), { pobierz: (...a) => fetch(...a), dzis: dzis() });
  let uzupelnione = 0;
  const wpisy = stan.wpisy.map((w) => {
    if (w.waluta === 'PLN' || w.kurs) return w;
    const k = wyniki.get(`${w.waluta}|${w.data}`);
    if (k?.stan !== 'ok') return w;
    uzupelnione += 1;
    return { ...w, kurs: k.kurs, kursData: k.data, kursTabela: k.tabela };
  });
  $('uzupelnij-kursy').disabled = false;
  ustawWpisy(wpisy);
  const zostalo = braki.length - uzupelnione;
  oglos(`Uzupełniono kursy: ${uzupelnione}.${zostalo ? ` Bez kursu zostało: ${zostalo}.` : ''}`);
  pokazStanPliku(`Uzupełniono kursy NBP: ${odmiana(uzupelnione, WPIS)}.${zostalo ? ` Bez kursu zostało: ${odmiana(zostalo, WPIS)} (NBP nie ma jeszcze kursu albo waluty).` : ''}`);
}

// ------------------------------------------------------------ pliki

function pobierzPlik(dane, nazwa, typ) {
  const url = URL.createObjectURL(new Blob([dane], { type: typ }));
  const a = el('a', { href: url, download: nazwa });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function nazwaPliku(rozszerzenie) {
  return `ewidencja-dn-${dzis()}.${rozszerzenie}`;
}

async function zapiszXlsx() {
  if (!stan.wpisy.length) { pokazStanPliku('Nie ma jeszcze czego zapisać.'); oglos('Nie ma jeszcze czego zapisać.'); return; }
  $('zapisz-xlsx').disabled = true;
  try {
    const odp = await fetch('/pobierz/arkusz-limit-dn.xlsx', { credentials: 'omit' });
    if (!odp.ok) throw new Error('wzór');
    const plik = await eksportujXlsx(stan.wpisy, new Uint8Array(await odp.arrayBuffer()));
    pobierzPlik(plik, nazwaPliku('xlsx'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    poZapisie('XLSX');
  } catch {
    pokazStanPliku('Nie udało się przygotować arkusza. Zapisz CSV albo spróbuj ponownie.');
    oglos('Nie udało się przygotować arkusza.');
  } finally {
    $('zapisz-xlsx').disabled = false;
  }
}

function zapiszCsv() {
  if (!stan.wpisy.length) { pokazStanPliku('Nie ma jeszcze czego zapisać.'); oglos('Nie ma jeszcze czego zapisać.'); return; }
  pobierzPlik(eksportujCsv(stan.wpisy), nazwaPliku('csv'), 'text/csv;charset=utf-8');
  poZapisie('CSV');
}

function poZapisie(format) {
  stan.zmianyOdZapisuPliku = false;
  const t = `Zapisano plik ${format}: ${odmiana(stan.wpisy.length, WPIS)}.`;
  pokazStanPliku(t);
  oglos(t);
}

async function wczytajPlik(plik) {
  if (!plik) return;
  if (plik.size > MAX_PLIK) { pokazStanPliku('Plik jest za duży (limit 10 MB).'); oglos('Plik jest za duży.'); return; }
  let wynik;
  try {
    const nazwa = plik.name.toLowerCase();
    if (nazwa.endsWith('.csv') || plik.type === 'text/csv') wynik = importujCsv(new Uint8Array(await plik.arrayBuffer())); // kodowanie rozpoznaje dekodujCsv
    else wynik = await importujXlsx(new Uint8Array(await plik.arrayBuffer()));
  } catch (e) {
    const t = `Nie udało się wczytać pliku. ${e instanceof BladDanych ? e.message : 'Sprawdź, czy to arkusz XLSX albo CSV.'}`;
    pokazStanPliku(t); oglos(t); return;
  }
  const { wpisy, bledy } = wynik;
  if (!wpisy.length) {
    const t = bledy.length ? `W pliku nie ma poprawnych wpisów. Pierwszy błąd: wiersz ${bledy[0].wiersz}, ${bledy[0].powod}.` : 'W pliku nie ma wpisów.';
    pokazStanPliku(t); oglos(t); return;
  }
  const nowe = wpisy.map((w) => ({ ...w, id: noweId() }));
  let tryb = 'zastap';
  if (stan.wpisy.length && !stan.przyklad) {
    tryb = await zapytaj({
      tytul: 'Masz już wpisy',
      tekst: `W przeglądarce: ${odmiana(stan.wpisy.length, WPIS)}. W pliku: ${odmiana(nowe.length, WPIS)}.`,
      przyciski: [
        { tekst: 'Anuluj', wynik: null },
        { tekst: 'Dodaj do obecnych', wynik: 'dodaj' },
        { tekst: 'Zastąp wpisami z pliku', wynik: 'zastap', klasa: 'glowny-maly', domyslny: true },
      ],
    });
    if (!tryb) return;
  }
  stan.przyklad = false;
  stan.filtr = null;
  ustawWpisy(tryb === 'dodaj' ? [...stan.wpisy, ...nowe] : nowe, { zmiana: false });
  const braki = nowe.filter((w) => w.waluta !== 'PLN' && !w.kurs).length;
  let t = `Wczytano z pliku ${plik.name}: ${odmiana(nowe.length, WPIS)}.`;
  if (bledy.length) t += ` Pominięto z błędami: ${odmiana(bledy.length, WIERSZ)} (pierwszy: wiersz ${bledy[0].wiersz}, ${bledy[0].powod}).`;
  if (braki) t += ` Bez kursu NBP: ${odmiana(braki, WPIS)}, możesz je uzupełnić niżej.`;
  pokazStanPliku(t);
  oglos(t);
  $('stan-tytul').setAttribute('tabindex', '-1');
  $('stan-tytul').focus();
}

// ------------------------------------------------------------ wydruk

function opcjeRokuWydruku() {
  const s = $('druk-rok');
  const lata = [...new Set([Number(dzis().slice(0, 4)), ...stan.wpisy.map((w) => Number(w.data.slice(0, 4)))])].sort((a, b) => b - a);
  const wybrany = s.value;
  zastap(s, ...lata.map((r) => el('option', { value: String(r), tekst: String(r) })));
  if (lata.includes(Number(wybrany))) s.value = wybrany;
}

function zbudujWydruk() {
  const rok = Number($('druk-rok').value);
  const osoba = $('druk-osoba').value.trim();
  const { wiersze, sumaGr, brakiKursu } = wierszeEwidencji(stan.wpisy, rok);
  const zl = (g) => formatujZl(g).replace(/\s*zł$/, '');
  const tbody = el('tbody');
  let poprzedniQ = null;
  const sumaKwartalu = (q) => wiersze.filter((x) => x.q === q).reduce((s, x) => (x.plnGr === null ? s : s + x.plnGr), 0n);
  const dodajPodsumowanie = (q) => {
    const limit = limitLubNull(rok);
    const suma = sumaKwartalu(q);
    const proc = limit ? ` (${procentTekst(statusLimitu(suma, limit).procent)} limitu)` : '';
    tbody.append(el('tr', { klasa: 'suma-kwartalu' },
      el('td', { colspan: '3', tekst: `Razem ${etykietaKwartalu(rok, q)}${proc}` }),
      el('td', { klasa: 'num', tekst: zl(suma) }), el('td', {}), el('td', {}), el('td', {})));
  };
  for (const x of wiersze) {
    if (poprzedniQ !== null && x.q !== poprzedniQ) dodajPodsumowanie(poprzedniQ);
    poprzedniQ = x.q;
    const waluta = x.waluta === 'PLN' ? '' : `${liczbaPl(x.kwota)} ${x.waluta} × ${x.kurs ? liczbaPl(x.kurs) : '?'}${x.kursData ? ` (${dataPl(x.kursData)})` : ''}`;
    tbody.append(el('tr', {},
      el('td', { klasa: 'num', tekst: String(x.lp) }),
      el('td', { tekst: dataPl(x.data) }),
      el('td', { tekst: x.opis }),
      el('td', { klasa: 'num', tekst: x.plnGr === null ? 'brak kursu' : zl(x.plnGr) }),
      el('td', { klasa: 'num', tekst: zl(x.narastajacoRokGr) }),
      el('td', { klasa: 'num', tekst: zl(x.narastajacoKwartalGr) }),
      el('td', { tekst: waluta })));
  }
  if (poprzedniQ !== null) dodajPodsumowanie(poprzedniQ);
  const tabela = el('table', {},
    el('thead', {}, el('tr', {},
      ...['Lp.', 'Data sprzedaży', 'Opis', 'Kwota sprzedaży (zł)', 'Narastająco od początku roku (zł)', 'Narastająco w kwartale (zł)', 'Waluta i kurs NBP']
        .map((t) => el('th', { scope: 'col', tekst: t })))),
    tbody);
  zastap($('wydruk'),
    el('h1', { tekst: `Uproszczona ewidencja sprzedaży – ${rok}` }),
    osoba ? el('p', { tekst: `Prowadzący: ${osoba}` }) : null,
    el('p', { tekst: `Sporządzono ${dataPl(dzis())}. ${odmiana(wiersze.length, WPIS).replace(/^./, (c) => c.toUpperCase())}, razem ${formatujZl(sumaGr)}.` }),
    wiersze.length ? tabela : el('p', { tekst: 'Brak wpisów w tym roku.' }),
    brakiKursu ? el('p', { klasa: 'druk-uwaga', tekst: `Uwaga: bez kursu NBP (nie wliczono do sum): ${odmiana(brakiKursu, SPRZEDAZ)}.` }) : null,
    el('p', { klasa: 'druk-stopka', tekst: 'Kolumny według wzoru z biznes.gov.pl (Lp., data sprzedaży, kwota sprzedaży, kwota narastająco). Sprzedaż w walucie przeliczona po kursie średnim NBP z ostatniego dnia roboczego przed sprzedażą. Przygotowano w Narzędziowniku DN (dn.noblecode.pl).' }),
  );
}

function drukuj() {
  zbudujWydruk();
  window.print();
}

// ------------------------------------------------------------ przykład

function pokazPrzyklad() {
  const d = dzis();
  const { rok, q } = kwartal(d);
  const { od } = granicaKwartalu(rok, q);
  const dzien = (n) => {
    const t = new Date(Date.UTC(+od.slice(0, 4), +od.slice(5, 7) - 1, +od.slice(8, 10) + n)).toISOString().slice(0, 10);
    return t > d ? d : t;
  };
  const surowe = [
    [0, '1250', 'PLN', '', 'Obraz olejny, zamówienie'], [3, '85', 'EUR', '4.3745', 'Etsy: kolczyki'],
    [6, '320', 'PLN', '', 'Warsztaty ceramiki'], [9, '149', 'USD', '3.9821', 'Gumroad: e-book'],
    [12, '980', 'PLN', '', 'Kurs online, 4 osoby'], [15, '-85', 'PLN', '', 'Zwrot: kolczyki'],
    [17, '2100', 'PLN', '', 'Ilustracje do książki'], [19, '210', 'EUR', '4.3612', 'Etsy: grafika'],
    [21, '640', 'PLN', '', 'Sesja zdjęciowa'],
  ];
  stan.wpisy = surowe.map(([n, kwota, waluta, kurs, opis]) => normalizujWpis({ id: noweId(), data: dzien(n), kwota, waluta, kurs, opis }));
  stan.przyklad = true;
  stan.filtr = null;
  odswiez();
  oglos('Pokazano przykładowe dane. Nie są zapisywane.');
  $('stan-tytul').setAttribute('tabindex', '-1');
  $('stan-tytul').focus();
}

// ------------------------------------------------------------ pamięć i czyszczenie

async function wyczysc() {
  const odp = await zapytaj({
    tytul: 'Wyczyścić dane?',
    tekst: 'Usuniemy z tej przeglądarki wpisy ewidencji, wystawione faktury, Twoje dane do faktur, dane klientów, zapamiętane przekroczenie limitu KSeF i ustawienia pamięci. Bez zapisanego pliku i PDF faktur nie da się ich odzyskać.',
    przyciski: [{ tekst: 'Anuluj', wynik: false, domyslny: true }, { tekst: 'Wyczyść dane', wynik: true, klasa: 'niebezpieczny' }],
  });
  if (!odp) return;
  magazyn.wyczysc();
  stan.wpisy = [];
  stan.przyklad = false;
  stan.filtr = null;
  stan.zmianyOdZapisuPliku = false;
  $('druk-osoba').value = '';
  wyczyscFormularz();
  if (!stan.pamietaj) magazyn.zapiszUstawienia({ pamietaj: false });
  odswiezPamiecDanych();
  odswiez();
  pokazStanPliku('Dane wyczyszczone.');
  oglos('Dane wyczyszczone.');
}

async function zmienPamiec() {
  if ($('pamietaj').checked) {
    stan.pamietaj = true;
    magazyn.zmienUstawienia({ pamietaj: true });
    // Pamięć mogła być włączona w innej karcie: łączymy wpisy z tej strony z zapisanymi, zamiast je nadpisać.
    if (!stan.przyklad) {
      const lokalne = stan.wpisy;
      wczytajZMagazynu();
      stan.wpisy = polaczWpisy(stan.wpisy, lokalne);
      odswiez();
    }
    utrwal();
    oglos('Wpisy będą pamiętane w tej przeglądarce.');
    return;
  }
  const odp = await zapytaj({
    tytul: 'Wyłączyć pamięć przeglądarki?',
    tekst: tekstWylaczeniaPamieci({ daneZostaja: magazyn.zostajaDaneFaktur(), strona: 'ewidencja' }),
    przyciski: [{ tekst: 'Anuluj', wynik: false, domyslny: true }, { tekst: 'Wyłącz i usuń', wynik: true, klasa: 'niebezpieczny' }],
  });
  if (!odp) { $('pamietaj').checked = true; return; }
  stan.pamietaj = false;
  magazyn.usunWpisy();
  oglos('Pamięć wpisów wyłączona. Wpisy i faktury usunięte z tej przeglądarki, zapisz plik przed zamknięciem strony.');
}

/** Imię do wydruku to dana osobowa: zapisujemy je tylko przy włączonym „Zapamiętaj moje dane…”. */
function zapiszOsobe() {
  if (stan.dostepna && magazyn.pamiecDanychWlaczona()) magazyn.zmienUstawienia({ osoba: $('druk-osoba').value.trim() || undefined });
}

const TEKST_USUNIECIA_DANYCH = 'Usuniemy z tej przeglądarki Twoje dane do faktur (imię i nazwisko, NIP albo PESEL, adres), zapisanych klientów, imię do wydruku i dane osobowe z zapisanych faktur. Zostaną wpisy oraz numery, daty i kwoty faktur.';

/** Dane z wcześniejszej wersji strony: wybór „Usuń” (z potwierdzeniem). */
async function usunDaneZWczesniejszej() {
  const odp = await zapytaj({
    tytul: 'Usunąć dane do faktur?',
    tekst: TEKST_USUNIECIA_DANYCH,
    przyciski: [{ tekst: 'Anuluj', wynik: false, domyslny: true }, { tekst: 'Usuń', wynik: true, klasa: 'niebezpieczny' }],
  });
  if (!odp) { setTimeout(() => $('migracja-usun').focus(), 0); return; }
  magazyn.usunDaneFaktur();
  odswiezPamiecDanych();
  oglos('Dane osobowe do faktur usunięte z tej przeglądarki.');
  setTimeout(() => $('pamietaj-dane').focus(), 0);
}

async function zmienPamiecDanych() {
  if ($('pamietaj-dane').checked) {
    magazyn.zachowajDaneFaktur();
    zapiszOsobe();
    odswiezPamiecDanych();
    oglos('Twoje dane i dane klientów do faktur będą pamiętane w tej przeglądarce.');
    return;
  }
  const odp = await zapytaj({
    tytul: 'Nie pamiętać danych do faktur?',
    tekst: TEKST_USUNIECIA_DANYCH,
    przyciski: [{ tekst: 'Anuluj', wynik: false, domyslny: true }, { tekst: 'Wyłącz i usuń', wynik: true, klasa: 'niebezpieczny' }],
  });
  if (!odp) { $('pamietaj-dane').checked = true; return; }
  magazyn.usunDaneFaktur();
  odswiezPamiecDanych();
  oglos('Dane osobowe do faktur usunięte z tej przeglądarki.');
}

// ------------------------------------------------------------ start

function start() {
  opcjeWalut();
  wczytajStart();
  $('f-data').value = dzis();
  $('f-data').max = '2035-12-31';

  $('wpis-form').addEventListener('submit', zapiszFormularz);
  $('f-anuluj').addEventListener('click', () => { const d = $('f-data').value; wyczyscFormularz(); $('f-data').value = d; renderujListe(); });
  for (const id of ['f-kwota', 'f-opis']) $(id).addEventListener('input', odswiezPodglad);
  $('f-kurs').addEventListener('input', () => { stan.kursRecznie = $('f-kurs').value.trim() !== ''; stan.kursInfo = null; $('kurs-info').textContent = stan.kursRecznie ? 'Kurs wpisany ręcznie.' : ''; odswiezPodglad(); });
  $('f-waluta').addEventListener('change', () => { stan.kursRecznie = false; $('f-kurs').value = ''; odswiezPodglad(); zaplanujKurs(); });
  $('f-data').addEventListener('change', () => { if (!stan.kursRecznie) { $('f-kurs').value = ''; zaplanujKurs(); } odswiezPodglad(); });
  $('kurs-pobierz').addEventListener('click', () => pobierzKursFormularza({ wymus: true }));

  $('filtr-kwartal').addEventListener('change', () => { stan.filtr = $('filtr-kwartal').value; renderujListe(); });
  $('uzupelnij-kursy').addEventListener('click', uzupelnijKursy);
  $('pokaz-przyklad').addEventListener('click', pokazPrzyklad);
  $('przyklad-koniec').addEventListener('click', () => { stan.wpisy = []; stan.przyklad = false; stan.filtr = null; odswiez(); oglos('Usunięto przykładowe dane.'); $('f-kwota').focus(); });
  $('pusto-dodaj').addEventListener('click', (ev) => { ev.preventDefault(); $('formularz').scrollIntoView({ block: 'start' }); $('f-kwota').focus({ preventScroll: true }); });

  $('zapisz-xlsx').addEventListener('click', zapiszXlsx);
  $('zapisz-csv').addEventListener('click', zapiszCsv);
  for (const b of document.querySelectorAll('[data-akcja="wczytaj"]')) b.addEventListener('click', () => $('plik').click());
  $('plik').addEventListener('change', async () => { await wczytajPlik($('plik').files[0]); $('plik').value = ''; });
  $('drukuj').addEventListener('click', drukuj);
  window.addEventListener('beforeprint', zbudujWydruk);
  $('druk-osoba').addEventListener('change', zapiszOsobe);
  $('pamietaj').addEventListener('change', zmienPamiec);
  $('pamietaj-dane').addEventListener('change', zmienPamiecDanych);
  $('migracja-zachowaj').addEventListener('click', () => {
    magazyn.zachowajDaneFaktur();
    zapiszOsobe();
    odswiezPamiecDanych();
    oglos('Zachowano Twoje dane do faktur. Zmienisz to przełącznikiem „Zapamiętaj moje dane i dane klientów do faktur”.');
    $('pamietaj-dane').focus();
  });
  $('migracja-usun').addEventListener('click', usunDaneZWczesniejszej);
  $('wyczysc').addEventListener('click', wyczysc);

  // Bez pamięci przeglądarki albo po nieudanym zapisie w niej: ostrzeżenie przed zamknięciem strony z niezapisanymi wpisami.
  window.addEventListener('beforeunload', (ev) => {
    if ((!stan.pamietaj || stan.zapisNieudany) && !stan.przyklad && stan.wpisy.length && stan.zmianyOdZapisuPliku) ev.preventDefault();
  });
  // Ta sama strona otwarta w dwóch kartach: zmiana w jednej odświeża drugą.
  window.addEventListener('storage', poZmianieWInnejKarcie);

  // Po powrocie na kartę z nowym dniem (np. po północy 31 grudnia) stan kwartału, limit roku i prognoza
  // liczą się od nowej daty, a nie od dnia otwarcia strony.
  let dzienWidoku = dzis();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || dzis() === dzienWidoku) return;
    dzienWidoku = dzis();
    odswiez();
  });

  odswiez();
  odswiezPodglad();
}

start();

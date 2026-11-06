// Faktura bez VAT (zwolnienie): formularz, podsumowanie z regułą KSeF, wydruk (PDF przez okno drukowania),
// lista wystawionych faktur i dopisanie sprzedaży do ewidencji. Liczenie jest w faktura-logika.js, tu tylko widok.
// Bez wstawiania HTML z tekstu i bez połączeń sieciowych: dane faktury nie opuszczają przeglądarki.

import { BladDanych, dataWarszawa, formatujZl, naGrosze } from './logic.js';
import { normalizujWpis } from './ewidencja-logika.js';
import {
  normalizujFakture, proponowanyNumer, numerZajety, moznaUsunac, regulaKsef, opisKsef, dokumentFaktury, terminy,
  dodajFaktureDoEwidencji, dopiszNabywce, wartoscPozycjiGr, slownie, sprawdzNip, nipZKreskami, dataPl, MAX_POZYCJI,
  MAX_KWOTA_GR, BladPola, lukaWNumeracji, polaczUtrate, skrotKsef, TEKSTY_OKIEN, KOMUNIKAT_PO_OKNIE_LIMITU, polaczFaktury,
  nadajIdFakturom, bezFaktury, opisTerminu, MAX_ZAPLAT,
} from './faktura-logika.js';
import * as magazyn from './magazyn.js';

const $ = (id) => document.getElementById(id);
const dzis = () => dataWarszawa();

const stan = {
  faktury: [],
  sprzedawca: null,
  nabywcy: [],
  pamietaj: true, // „Pamiętaj wpisy ewidencji”: wystawione faktury i utrata prawa
  pamietajDane: false, // „Zapamiętaj moje dane i dane klientów do faktur”: dane sprzedawcy i zapisani klienci
  dostepna: true, // czy pamięć przeglądarki w ogóle działa
  pozycje: 1,
  numerRecznie: false,
  utrataOd: null, // 'RRRR-MM': od tego miesiąca faktury dla firm tylko w KSeF (art. 145m ust. 2), zapamiętane w magazyn
  doDruku: null, // znormalizowana faktura przygotowana do wydruku
};
const wystawioneTeraz = new Set(); // id faktur wystawionych w tej wizycie (ich pełne dane zostają na stronie do zamknięcia)
let licznikId = 0;
const noweId = () => `f${Date.now().toString(36)}${(licznikId += 1).toString(36)}`;

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

let ostatnieOgloszenie = '';
function oglos(tekst) {
  const r = $('ogloszenie');
  if (tekst === ostatnieOgloszenie) r.textContent = '';
  r.textContent = tekst;
  ostatnieOgloszenie = tekst;
}

function zapytaj({ tytul, tekst, przyciski }) {
  const d = $('dialog');
  $('dialog-tytul').textContent = tytul;
  // Tekst: jeden akapit albo lista akapitów (po najwyżej 2 zdania).
  zastap($('dialog-tekst'), ...[tekst].flat().map((t) => el('p', { tekst: t })));
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

// ------------------------------------------------------------ pamięć

function utrwal() {
  // Bez zgody na dane osobowe magazyn zapisuje faktury w skrócie (numer, daty, kwota, rodzaj nabywcy).
  if (stan.pamietaj) magazyn.zapiszFaktury({ faktury: stan.faktury, utrataOd: stan.utrataOd });
  // Dane sprzedawcy (NIP albo PESEL, adres) i klientów tylko po włączeniu drugiego przełącznika.
  if (stan.pamietajDane) magazyn.zapiszDaneFaktur({ sprzedawca: stan.sprzedawca, nabywcy: stan.nabywcy });
}

function wczytajStart() {
  stan.dostepna = magazyn.dostepny();
  wczytajZMagazynu();
}

/** Faktury, sprzedawca, klienci i utrata prawa z pamięci przeglądarki (przy starcie, przed wystawieniem i po zmianie w innej karcie). */
function wczytajZMagazynu() {
  stan.pamietaj = stan.dostepna && magazyn.pamiecWlaczona();
  $('pamietaj').checked = stan.pamietaj;
  $('pamietaj').disabled = !stan.dostepna;
  const dane = magazyn.stanPamieciDanych();
  stan.pamietajDane = stan.dostepna && dane.wlaczona;
  $('pamietaj-dane').checked = stan.pamietajDane;
  $('pamietaj-dane').disabled = !stan.dostepna;
  // Dane z wcześniejszej wersji: jednorazowy wybór „Zachowaj moje dane” albo „Usuń”.
  $('pamietaj-dane-migracja').hidden = !(stan.dostepna && dane.czekaNaWybor);
  if (stan.pamietajDane) {
    // Przy wyłączonym przełączniku dane z tej wizyty zostają tylko na stronie (nie są zastępowane pustymi).
    const z = magazyn.wczytajDaneFaktur();
    stan.sprzedawca = z.sprzedawca;
    stan.nabywcy = z.nabywcy.filter((n) => n && typeof n.nazwa === 'string');
  }
  if (!stan.pamietaj) return;
  const d = magazyn.wczytajFaktury();
  // Zapisane faktury zostają, nawet gdy później zaostrzyliśmy walidację: tylko numer, data i kwota muszą być czytelne
  // (inaczej numeracja straciłaby wcześniejsze numery).
  // Faktury ze starszych wersji nie mają identyfikatora: dostają stały, wyliczony (usuwanie po identyfikatorze, nie numerze).
  // Rekord skrócony (bez danych osobowych) też wystarcza do numeracji i limitu KSeF. Pełne faktury z tej wizyty
  // zostają w pamięci strony, więc „Drukuj” działa dla nich do zamknięcia strony.
  const naStronie = new Map(stan.faktury.filter(pelnaFaktura).map((f) => [f.id, f]));
  stan.faktury = nadajIdFakturom(d.faktury.filter((f) => {
    try { return /^\d+\/\d{4}$/.test(f.numer) && naGrosze(f.suma) > 0n && /^\d{4}-\d{2}-\d{2}$/.test(f.dataWystawienia); } catch { return false; }
  })).map((f) => (pelnaFaktura(f) ? f : naStronie.get(f.id) ?? f));
  stan.utrataOd = d.utrataOd;
}

/** Czy faktura ma wszystko do wydruku (pełny rekord, a nie skrócony bez danych osobowych). */
function pelnaFaktura(f) {
  return Array.isArray(f?.pozycje) && f.pozycje.length > 0 && Boolean(f.sprzedawca?.nazwa) && Boolean(f.nabywca?.nazwa) && Boolean(f.podstawa?.tekst);
}

/** Wpisuje zapamiętane dane sprzedawcy w puste pola formularza. */
function wypelnijSprzedawce() {
  if (!stan.sprzedawca) return false;
  const pola = [['f-sprzedawca-nazwa', stan.sprzedawca.nazwa ?? ''], ['f-sprzedawca-adres', stan.sprzedawca.adres ?? '']];
  const id = stan.sprzedawca.id ?? stan.sprzedawca.nip ?? ''; // starsze zapisy mają tylko pole nip
  pola.push(['f-sprzedawca-nip', stan.sprzedawca.rodzajId === 'PESEL' ? id : (id ? nipZKreskami(id) : '')]);
  for (const [pole, wartosc] of pola) if (!$(pole).value) $(pole).value = wartosc;
  return true;
}

/** Inna karta zmieniła dane strony: wczytujemy je ponownie, żeby numeracja i reguła KSeF znały wszystkie faktury. */
function poZmianieWInnejKarcie(ev) {
  if (ev.key !== null && (!ev.key.startsWith('dn-') || ev.key === 'dn-test')) return;
  // Okno potwierdzenia jest otwarte (np. wyłączenie pamięci): zmianę uwzględniamy dopiero po jego zamknięciu.
  if ($('dialog').open) { $('dialog').addEventListener('close', () => poZmianieWInnejKarcie(ev), { once: true }); return; }
  // Przy wyłączonej pamięci faktury z tej wizyty są tylko na stronie: zmiany z innych kart ich nie zastępują.
  // Po włączeniu pamięci tutaj łączymy je z zapisanymi (zmienPamiec).
  if (!stan.pamietaj) return;
  const byloPrzekroczenie = Boolean(stan.utrataOd);
  wczytajZMagazynu();
  if (byloPrzekroczenie && !stan.utrataOd) $('f-przekroczony').checked = false;
  odswiezEwidencje();
  renderujListe();
  odswiez();
}

// ------------------------------------------------------------ pozycje

function wierszPozycji(i) {
  const id = (p) => `pozycja-${i}-${p}`;
  const usun = i > 0
    ? el('button', { type: 'button', klasa: 'drugorzedny maly', tekst: 'Usuń', 'aria-label': `Usuń pozycję ${i + 1}`, onclick: () => usunPozycje(i) })
    : null;
  return el('li', { klasa: 'pozycja', 'data-i': String(i) },
    el('div', { klasa: 'pole pozycja-nazwa' },
      el('label', { for: id('nazwa'), tekst: `Pozycja ${i + 1}: towar lub usługa` }),
      el('input', { id: id('nazwa'), maxlength: '200', autocomplete: 'off', placeholder: i === 0 ? 'np. projekt logo' : null })),
    el('div', { klasa: 'pole' }, el('label', { for: id('ilosc'), tekst: 'Ilość' }),
      el('input', { id: id('ilosc'), inputmode: 'decimal', autocomplete: 'off', value: '1' })),
    el('div', { klasa: 'pole' }, el('label', { for: id('jm'), tekst: 'Jednostka' }),
      el('input', { id: id('jm'), maxlength: '12', autocomplete: 'off', value: 'szt.' })),
    el('div', { klasa: 'pole' }, el('label', { for: id('cena'), tekst: 'Cena (zł)' }),
      el('input', { id: id('cena'), inputmode: 'decimal', autocomplete: 'off', placeholder: 'np. 450' })),
    usun);
}

// ------------------------------------------------------------ wpłaty (daty zapłaty, także zaliczki)

function wierszZaplaty(i) {
  const usun = i > 0
    ? el('button', { type: 'button', klasa: 'drugorzedny maly', tekst: 'Usuń', 'aria-label': `Usuń wpłatę ${i + 1}`, onclick: () => usunZaplate(i) })
    : null;
  return el('li', { klasa: 'zaplata' },
    el('div', { klasa: 'pole' },
      el('label', { for: `zaplata-${i}`, tekst: i === 0 ? 'Data wpłaty' : `Data wpłaty ${i + 1}` }),
      el('input', { id: `zaplata-${i}`, type: 'date', min: '2020-01-01', max: '2035-12-31', 'aria-describedby': 'zaplaty-info' })),
    usun);
}

const odczytajZaplaty = () => [...$('zaplaty').querySelectorAll('input[type="date"]')].map((e) => e.value);

function ustawZaplaty(lista) {
  zastap($('zaplaty'), ...lista.map((_, i) => wierszZaplaty(i)));
  lista.forEach((d, i) => { $(`zaplata-${i}`).value = d; });
  $('dodaj-zaplate').hidden = lista.length >= MAX_ZAPLAT;
}

function dodajZaplate() {
  const lista = odczytajZaplaty();
  if (lista.length >= MAX_ZAPLAT) return;
  ustawZaplaty([...lista, '']);
  $(`zaplata-${lista.length}`).focus();
  odswiez();
}

function usunZaplate(i) {
  ustawZaplaty(odczytajZaplaty().filter((_, j) => j !== i));
  $(`zaplata-${Math.max(0, i - 1)}`).focus();
  oglos(`Usunięto wpłatę ${i + 1}.`);
  odswiez();
}

function odczytajPozycje() {
  return [...$('pozycje').children].map((li) => {
    const i = li.dataset.i;
    const v = (p) => $(`pozycja-${i}-${p}`).value;
    return { nazwa: v('nazwa'), ilosc: v('ilosc'), jm: v('jm'), cena: v('cena') };
  });
}

function ustawPozycje(lista) {
  zastap($('pozycje'), ...lista.map((_, i) => wierszPozycji(i)));
  lista.forEach((p, i) => {
    for (const k of ['nazwa', 'ilosc', 'jm', 'cena']) $(`pozycja-${i}-${k}`).value = String(p[k] ?? '');
  });
  stan.pozycje = lista.length;
  $('dodaj-pozycje').hidden = lista.length >= MAX_POZYCJI;
}

function dodajPozycje() {
  const lista = odczytajPozycje();
  if (lista.length >= MAX_POZYCJI) return;
  ustawPozycje([...lista, { nazwa: '', ilosc: '1', jm: 'szt.', cena: '' }]);
  $(`pozycja-${lista.length}-nazwa`).focus();
  odswiez();
}

function usunPozycje(i) {
  const lista = odczytajPozycje().filter((_, j) => j !== i);
  ustawPozycje(lista);
  $(`pozycja-${Math.max(0, i - 1)}-nazwa`).focus();
  oglos(`Usunięto pozycję ${i + 1}.`);
  odswiez();
}

// ------------------------------------------------------------ formularz

const rodzaj = () => (document.querySelector('input[name="rodzaj"]:checked')?.value ?? 'konsument');

function wartosciFormularza() {
  return {
    numer: $('f-numer').value,
    dataWystawienia: dzis(), // pokazywana jako tekst, zawsze dziś (art. 106e ust. 1 pkt 1)
    dataSprzedazy: $('f-data-sprzedazy').value,
    dataZadania: $('f-data-zadania').value,
    zaplaty: odczytajZaplaty(),
    sprzedawca: { nazwa: $('f-sprzedawca-nazwa').value, adres: $('f-sprzedawca-adres').value, id: $('f-sprzedawca-nip').value },
    nabywca: { rodzaj: rodzaj(), nazwa: $('f-nabywca-nazwa').value, adres: $('f-nabywca-adres').value, nip: $('f-nabywca-nip').value },
    pozycje: odczytajPozycje(),
    podstawa: { kod: $('f-podstawa').value, tekst: $('f-podstawa-tekst').value },
    platnosc: $('f-platnosc').value,
  };
}

/** Suma pozycji do podglądu: pomija pozycje, których jeszcze nie da się policzyć. */
function sumaPodgladu(pozycje) {
  let s = 0n;
  for (const p of pozycje) {
    try {
      const c = String(p.cena).trim().replace(/\s/g, '').replace(',', '.');
      const il = String(p.ilosc).trim().replace(/\s/g, '').replace(',', '.') || '1';
      if (!/^\d+(\.\d{1,2})?$/.test(c) || !/^\d+(\.\d{1,4})?$/.test(il)) continue;
      s += wartoscPozycjiGr(il, c);
    } catch { /* pozycja w trakcie pisania */ }
  }
  return s;
}

function inneGr() {
  try { const g = naGrosze($('f-inne').value.trim().replace(/\s/g, '').replace(/zł$/i, '') || '0'); return g > 0n ? g : 0n; } catch { return 0n; }
}

function regula(v, kwotaGr) {
  return regulaKsef({
    dataWystawienia: dzis(), // datą wystawienia jest zawsze dziś (art. 106e ust. 1 pkt 1)
    dzis: dzis(),
    rodzaj: v.nabywca.rodzaj,
    kwotaGr,
    faktury: stan.faktury,
    numer: v.numer.trim(),
    inneGr: inneGr(),
    przekroczonoWczesniej: $('f-przekroczony').checked,
    utrataOd: stan.utrataOd,
  });
}

function odswiezRodzaj() {
  const firma = rodzaj() === 'firma';
  $('pole-nabywca-nip').hidden = !firma;
  $('pole-nabywca-nip').parentElement.classList.toggle('jedna', !firma); // pełna szerokość nazwy bez pola NIP
  $('etykieta-nabywca').textContent = firma ? 'Nazwa firmy klienta' : 'Imię i nazwisko klienta';
  $('inne-faktury').hidden = !firma;
  opcjeZapisanych();
}

function odswiezNumer() {
  const data = dzis();
  if (!stan.numerRecznie) $('f-numer').value = proponowanyNumer(stan.faktury, data);
  const numer = $('f-numer').value.trim();
  let info = stan.pamietaj
    ? 'Kolejny numer w roku wystawienia, możesz go zmienić.'
    : 'Bez pamięci przeglądarki strona nie zna wcześniejszych faktur, więc sprawdź numer sam.';
  const luka = lukaWNumeracji(stan.faktury, numer);
  if (numerZajety(stan.faktury, numer)) info = `Faktura ${numer} już jest na liście wystawionych.`;
  else if (luka && stan.pamietaj) info = `Uwaga: kolejny wolny numer to ${luka}, więc w numeracji powstanie luka.`;
  $('numer-info').className = `podpowiedz${numerZajety(stan.faktury, numer) || (luka && stan.pamietaj) ? ' ostrzezenie-tekst' : ''}`;
  $('numer-info').textContent = info;
}

function odswiezTermin() {
  const ds = $('f-data-sprzedazy').value;
  const zaplaty = odczytajZaplaty();
  // Bez daty zapłaty termin liczy się jak dotąd, a podpowiedź mówi, kiedy warto ją podać.
  $('zaplaty-info').hidden = zaplaty.some((d) => d);
  if (!ds) { $('termin-info').textContent = ''; return; }
  const t = terminy(ds, $('f-data-zadania').value, zaplaty);
  $('termin-info').textContent = opisTerminu(t, { zadanie: $('f-data-zadania').value });
  $('termin-info').className = `podpowiedz${t.terminNiejasny || t.poTerminieZadania ? ' ostrzezenie-tekst' : ''}`;
}

/** Podsumowanie: kwota, słownie, stan KSeF. Wywoływane przy każdej zmianie formularza. */
function odswiez() {
  const v = wartosciFormularza();
  const suma = sumaPodgladu(v.pozycje);
  $('razem').textContent = formatujZl(suma);
  $('razem-slownie').textContent = suma > 0n && suma <= MAX_KWOTA_GR ? `Słownie: ${slownie(suma)}` : '';
  const r = regula(v, suma);
  const blokada = r.stan === 'blokada';
  $('ksef-blokada').hidden = !blokada;
  $('ksef-ok').hidden = blokada;
  $(blokada ? 'ksef-blokada-tekst' : 'ksef-ok-tekst').textContent = opisKsef(r);
  $('ksef-ok').className = `ramka ${r.powod === 'w-limicie' && r.zapasGr < 200000n ? 'uwaga-ramka' : ''}`;
  $('wystaw').textContent = blokada ? 'Tej faktury nie wystawisz tutaj' : 'Wystaw i drukuj fakturę';
  $('wystaw').setAttribute('aria-disabled', String(blokada));
  // Krótki stan KSeF dla firmy pod „Kto kupuje”, widoczny także przy wyborze osoby prywatnej.
  const rf = v.nabywca.rodzaj === 'firma' ? r : regula({ ...v, nabywca: { ...v.nabywca, rodzaj: 'firma' } }, suma);
  $('ksef-skrot').textContent = skrotKsef(rf);
  $('ksef-skrot').className = `podpowiedz status-tekst ${rf.stan === 'blokada' ? 'poziom-95' : 'poziom-ok'}`;
  // Bez pamięci przeglądarki licznik limitu widzi tylko faktury z tej wizyty: mówimy to wprost.
  $('ksef-pamiec').hidden = !(v.nabywca.rodzaj === 'firma' && !stan.pamietaj && ['w-limicie', 'limit'].includes(r.powod));
  $('f-przekroczony').checked = $('f-przekroczony').checked || Boolean(stan.utrataOd);
  $('f-przekroczony').disabled = Boolean(stan.utrataOd);
  $('cofnij-utrate').hidden = !stan.utrataOd;
  if (stan.utrataOd && v.nabywca.rodzaj === 'firma') $('inne-faktury').open = true;
  $('pole-podstawa-tekst').hidden = $('f-podstawa').value !== 'inna';
  const nip = sprawdzNip($('f-nabywca-nip').value, { zagraniczny: false });
  $('nip-info').textContent = { ok: `NIP poprawny: ${nipZKreskami(nip.nip ?? '')}.`, blad: nip.blad }[nip.stan] ?? 'Sprawdzamy cyfrę kontrolną NIP.';
  $('nip-info').className = `podpowiedz${nip.stan === 'blad' ? ' ostrzezenie-tekst' : ''}`;
  odswiezNumer();
  odswiezTermin();
  return r;
}

function pokazBlad(tekst, pole) {
  $('form-blad').textContent = tekst;
  $('form-blad').hidden = !tekst;
  for (const e of $('faktura-form').querySelectorAll('[aria-invalid]')) e.removeAttribute('aria-invalid');
  if (pole) {
    const mapa = {
      dataWystawienia: 'f-data-sprzedazy', dataSprzedazy: 'f-data-sprzedazy', numer: 'f-numer', sprzedawcaNazwa: 'f-sprzedawca-nazwa',
      sprzedawcaNip: 'f-sprzedawca-nip', sprzedawcaId: 'f-sprzedawca-nip', sprzedawcaAdres: 'f-sprzedawca-adres', rodzaj: 'rodzaj-konsument', nabywcaNazwa: 'f-nabywca-nazwa', nabywcaAdres: 'f-nabywca-adres',
      nabywcaNip: 'f-nabywca-nip', podstawaTekst: 'f-podstawa-tekst', pozycje: 'pozycja-0-nazwa',
    };
    const e = $(mapa[pole] ?? pole);
    if (e) {
      if (e.closest('details')) e.closest('details').open = true;
      e.setAttribute('aria-invalid', 'true');
      e.focus();
    }
  }
  if (tekst) oglos(tekst);
}

// ------------------------------------------------------------ wystawienie

async function wystaw(ev) {
  ev.preventDefault();
  odswiezDateWystawienia(); // po północy pokazuje nowy dzień, zgodny z datą w logice
  $('potwierdzenie').hidden = true;
  // Faktury mogły przybyć w innej karcie: numer i regułę KSeF liczymy od aktualnej listy z pamięci przeglądarki.
  if (stan.pamietaj) {
    wczytajZMagazynu();
    renderujListe();
    odswiez();
  }
  let f;
  try {
    f = normalizujFakture(wartosciFormularza(), { dzis: dzis() });
  } catch (e) {
    if (!(e instanceof BladDanych)) throw e;
    pokazBlad(e.message, e instanceof BladPola ? e.pole : null);
    return;
  }
  f.id = noweId(); // unikalny identyfikator: usuwanie z listy nie zależy od numeru
  if (numerZajety(stan.faktury, f.numer)) {
    pokazBlad(`Faktura ${f.numer} już jest na liście. Zmień numer albo wydrukuj ją ponownie z listy.`, 'numer');
    return;
  }
  const r = regula(f, naGrosze(f.suma));
  if (r.stan === 'blokada') {
    pokazBlad('');
    if (r.powod === 'limit') {
      // Art. 145m ust. 2: prawo do faktur poza KSeF przepada od faktury, która przekracza limit. Zapamiętujemy to,
      // gdy użytkownik potwierdzi, że tę fakturę wystawi w KSeF (pytamy, żeby literówka w kwocie nie blokowała na zawsze).
      const odp = await zapytaj({
        tytul: 'Ta faktura idzie do KSeF',
        tekst: TEKSTY_OKIEN.limit(r.miesiac),
        przyciski: [{ tekst: 'Wrócę do formularza', wynik: false, domyslny: true }, { tekst: 'Wystawię ją w KSeF', wynik: true, klasa: 'glowny-maly' }],
      });
      if (odp) {
        stan.utrataOd = polaczUtrate(stan.utrataOd, r.miesiac);
        utrwal();
        odswiez();
      } else {
        // „Wrócę do formularza” albo Esc: fokus na cenie ostatniej pozycji. setTimeout, bo po Esc
        // przeglądarka po zamknięciu okna oddaje fokus elementowi sprzed okna.
        oglos(KOMUNIKAT_PO_OKNIE_LIMITU);
        setTimeout(() => {
          const ostatnia = $('pozycje').lastElementChild?.dataset.i ?? '0';
          const pole = $(`pozycja-${ostatnia}-cena`);
          pole.focus({ preventScroll: true });
          pole.scrollIntoView({ block: 'center' });
        }, 0);
        return;
      }
    }
    const poOknie = regula(f, naGrosze(f.suma));
    // Po anulowaniu okna faktura nie jest wystawiona, więc nie mówimy „tę i każdą kolejną…”.
    oglos(poOknie.powod === 'limit' ? KOMUNIKAT_PO_OKNIE_LIMITU : opisKsef(poOknie));
    $('ksef-blokada').setAttribute('tabindex', '-1');
    $('ksef-blokada').focus();
    $('ksef-blokada').scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    return;
  }
  pokazBlad('');
  stan.faktury = [...stan.faktury, f];
  wystawioneTeraz.add(f.id);
  stan.sprzedawca = f.sprzedawca;
  stan.nabywcy = dopiszNabywce(stan.nabywcy, f.nabywca);
  utrwal();
  const ewidencja = $('f-ewidencja').checked && stan.pamietaj ? dopiszDoEwidencji(f) : '';
  stan.numerRecznie = false;
  renderujListe();
  odswiez();
  const tekst = `Wystawiono fakturę ${f.numer} na ${formatujZl(naGrosze(f.suma))}.${ewidencja} W oknie drukowania wybierz „Zapisz jako PDF”, jeśli wolisz plik.`;
  zastap($('potwierdzenie'), el('span', { klasa: 'potwierdzenie-tytul', tekst }));
  $('potwierdzenie').hidden = false;
  oglos(tekst);
  if (window.matchMedia('(pointer: coarse)').matches) document.activeElement?.blur(); // chowa klawiaturę
  $('potwierdzenie').scrollIntoView({ block: 'center' });
  drukuj(f);
}

function dopiszDoEwidencji(f) {
  const zapisane = magazyn.wczytaj();
  const wpisy = [];
  for (const w of zapisane?.wpisy ?? []) {
    try { wpisy.push(normalizujWpis(w)); } catch { /* pomijamy uszkodzony wpis */ }
  }
  const wynik = dodajFaktureDoEwidencji(wpisy, f, noweId());
  if (wynik.stan === 'bez-zmian') return ' Ta sprzedaż już jest w ewidencji.';
  if (!magazyn.zapisz(wynik.wpisy)) return ' Nie udało się zapisać sprzedaży w ewidencji.';
  return {
    dodano: ' Sprzedaż dodana do ewidencji.',
    zaktualizowano: ' Wpis tej faktury w ewidencji zaktualizowany.',
    polaczono: ` W ewidencji była już sprzedaż z ${dataPl(f.dataSprzedazy)} na tę kwotę, więc dopisaliśmy do niej numer faktury.`,
  }[wynik.stan];
}

// ------------------------------------------------------------ wydruk

function zbudujWydruk(f) {
  if (!f) {
    zastap($('wydruk'), el('p', { tekst: 'Najpierw wystaw fakturę przyciskiem „Wystaw i drukuj fakturę”.' }));
    return;
  }
  const d = dokumentFaktury(f);
  const blok = (o) => el('div', { klasa: 'druk-strona' }, el('h2', { tekst: o.naglowek }), ...o.linie.map((l) => el('p', { tekst: l })));
  zastap($('wydruk'),
    el('div', { klasa: 'druk-faktura' },
      el('div', { klasa: 'druk-naglowek' },
        el('div', {}, el('h1', { tekst: d.tytul }), el('p', { klasa: 'druk-podtytul', tekst: d.podtytul })),
        el('dl', { klasa: 'druk-daty' }, ...d.daty.flatMap(([k, v]) => [el('dt', { tekst: k }), el('dd', { tekst: v })]))),
      el('div', { klasa: 'druk-strony' }, blok(d.sprzedawca), blok(d.nabywca)),
      el('table', {},
        el('thead', {}, el('tr', {}, ...d.naglowkiPozycji.map((t, i) => el('th', { scope: 'col', klasa: i === 1 || i === 3 ? null : 'num', tekst: t })))),
        el('tbody', {}, ...d.pozycje.map((w) => el('tr', {}, ...w.map((t, i) => el('td', { klasa: i === 1 || i === 3 ? null : 'num', tekst: t })))))),
      el('p', { klasa: 'druk-razem', tekst: d.razem }),
      el('p', { tekst: d.slownie }),
      el('p', { klasa: 'druk-zwolnienie', tekst: d.zwolnienie }),
      d.platnosc ? el('p', { tekst: d.platnosc }) : null,
      el('p', { klasa: 'druk-stopka', tekst: d.stopka })));
}

function drukuj(f) {
  stan.doDruku = f;
  zbudujWydruk(f);
  window.print();
}

// ------------------------------------------------------------ lista faktur

function renderujListe() {
  const lista = [...stan.faktury].sort((a, b) => (a.dataWystawienia < b.dataWystawienia ? 1 : a.dataWystawienia > b.dataWystawienia ? -1 : 0));
  $('wystawione-pusto').hidden = lista.length > 0;
  zastap($('lista-faktur'), ...lista.map((f) => {
    const kwota = formatujZl(naGrosze(f.suma));
    return el('li', { klasa: 'wpis' },
      el('div', { klasa: 'wpis-tresc' },
        el('p', { klasa: 'wpis-data', tekst: dataPl(f.dataWystawienia) }),
        el('p', { klasa: 'wpis-opis', tekst: f.nabywca?.nazwa
          ? `${f.numer} · ${f.nabywca.nazwa}${f.nabywca.rodzaj === 'firma' ? ' (firma)' : ''}`
          : `${f.numer} · ${f.nabywca?.rodzaj === 'firma' ? 'dla firmy' : 'dla osoby prywatnej'} (bez danych klienta)` }),
        el('p', { klasa: 'wpis-kwota', tekst: kwota })),
      el('div', { klasa: 'wpis-akcje' },
        // Drukuj tylko pełną fakturę: rekord skrócony nie ma danych stron ani pozycji.
        pelnaFaktura(f) ? el('button', { type: 'button', klasa: 'drugorzedny maly', tekst: 'Drukuj', 'aria-label': `Drukuj fakturę ${f.numer}`, onclick: () => drukuj(f) }) : null,
        moznaUsunac(stan.faktury, f.numer)
          ? el('button', { type: 'button', klasa: 'drugorzedny maly', tekst: 'Usuń', 'aria-label': `Usuń fakturę ${f.numer}`, onclick: () => usunFakture(f) })
          : null));
  }));
}

async function usunFakture(f) {
  const odp = await zapytaj({
    tytul: `Usunąć fakturę ${f.numer}?`,
    tekst: 'Usuń ją tylko, jeśli nikomu jej nie przekazałeś. Wysłaną fakturę poprawia się fakturą korygującą, a wpis w ewidencji zostaje.',
    przyciski: [{ tekst: 'Anuluj', wynik: false, domyslny: true }, { tekst: 'Usuń', wynik: true, klasa: 'niebezpieczny' }],
  });
  if (!odp) return;
  stan.faktury = bezFaktury(stan.faktury, f.id); // po identyfikatorze: druga faktura z tym samym numerem zostaje
  utrwal();
  renderujListe();
  odswiez();
  oglos(`Usunięto fakturę ${f.numer}.`);
  $('wystawione-tytul').setAttribute('tabindex', '-1');
  $('wystawione-tytul').focus();
}

// ------------------------------------------------------------ zapisani klienci

function opcjeZapisanych() {
  const r = rodzaj();
  const pasujacy = stan.nabywcy.filter((n) => n.rodzaj === r);
  $('pole-zapisani').hidden = pasujacy.length === 0;
  zastap($('f-zapisani'),
    el('option', { value: '', tekst: 'Wpiszę nowego klienta' }),
    ...pasujacy.map((n) => el('option', { value: String(stan.nabywcy.indexOf(n)), tekst: n.nip ? `${n.nazwa}, NIP ${nipZKreskami(n.nip)}` : n.nazwa })));
}

function wybierzZapisanego() {
  const n = stan.nabywcy[Number($('f-zapisani').value)];
  if (!$('f-zapisani').value || !n) return;
  $('f-nabywca-nazwa').value = n.nazwa;
  $('f-nabywca-adres').value = n.adres;
  $('f-nabywca-nip').value = n.nip ? nipZKreskami(n.nip) : '';
  odswiez();
}

// ------------------------------------------------------------ pamięć

async function zmienPamiec() {
  if ($('pamietaj').checked) {
    stan.pamietaj = true;
    magazyn.zmienUstawienia({ pamietaj: true });
    // Pamięć mogła być włączona w innej karcie: łączymy faktury z tej wizyty z zapisanymi, zamiast je nadpisać.
    const lokalne = { faktury: stan.faktury, sprzedawca: stan.sprzedawca, nabywcy: stan.nabywcy, utrataOd: stan.utrataOd };
    wczytajZMagazynu();
    stan.faktury = polaczFaktury(stan.faktury, lokalne.faktury);
    stan.sprzedawca = lokalne.sprzedawca ?? stan.sprzedawca;
    stan.nabywcy = [...lokalne.nabywcy].reverse().reduce((lista, n) => dopiszNabywce(lista, n), stan.nabywcy);
    stan.utrataOd = polaczUtrate(stan.utrataOd, lokalne.utrataOd);
    utrwal();
    renderujListe();
    oglos('Wpisy i wystawione faktury będą pamiętane w tej przeglądarce.');
  } else {
    const odp = await zapytaj({
      tytul: 'Wyłączyć pamięć przeglądarki?',
      tekst: 'Usuniemy z tej przeglądarki wpisy ewidencji, wystawione faktury i zapamiętane przekroczenie limitu KSeF. Faktury z tej wizyty zostaną na stronie do jej zamknięcia.',
      przyciski: [{ tekst: 'Anuluj', wynik: false, domyslny: true }, { tekst: 'Wyłącz i usuń', wynik: true, klasa: 'niebezpieczny' }],
    });
    if (!odp) { $('pamietaj').checked = true; return; }
    stan.pamietaj = false;
    magazyn.usunWpisy();
    oglos('Pamięć wpisów wyłączona. Wpisy i faktury usunięte z tej przeglądarki.');
  }
  odswiezEwidencje();
  odswiez();
}

/** Przełącznik „Zapamiętaj moje dane i dane klientów do faktur” (domyślnie wyłączony). */
async function zmienPamiecDanych() {
  if ($('pamietaj-dane').checked) {
    magazyn.zachowajDaneFaktur();
    // Dane mogły być zapisane w innej karcie: łączymy je z danymi z tej wizyty.
    const lokalne = { sprzedawca: stan.sprzedawca, nabywcy: stan.nabywcy };
    wczytajZMagazynu();
    stan.sprzedawca = lokalne.sprzedawca ?? stan.sprzedawca;
    stan.nabywcy = [...lokalne.nabywcy].reverse().reduce((lista, n) => dopiszNabywce(lista, n), stan.nabywcy);
    utrwal();
    wypelnijSprzedawce();
    renderujListe();
    oglos('Twoje dane, dane klientów i pełne faktury będą pamiętane w tej przeglądarce.');
    return;
  }
  const odp = await zapytaj({
    tytul: 'Nie pamiętać danych do faktur?',
    tekst: TEKST_USUNIECIA_DANYCH,
    przyciski: [{ tekst: 'Anuluj', wynik: false, domyslny: true }, { tekst: 'Wyłącz i usuń', wynik: true, klasa: 'niebezpieczny' }],
  });
  if (!odp) { $('pamietaj-dane').checked = true; return; }
  stan.pamietajDane = false;
  magazyn.usunDaneFaktur();
  skrocWczesniejsze();
  wczytajZMagazynu();
  renderujListe();
  oglos('Dane osobowe do faktur usunięte z tej przeglądarki.');
}

/** Po usunięciu danych osobowych: faktury sprzed tej wizyty także na stronie tylko w skrócie (bez „Drukuj”). */
function skrocWczesniejsze() {
  stan.faktury = stan.faktury.map((f) => (wystawioneTeraz.has(f.id) ? f : magazyn.skrocFakture(f)));
}

const TEKST_USUNIECIA_DANYCH = 'Usuniemy z tej przeglądarki Twoje dane do faktur (imię i nazwisko, NIP albo PESEL, adres), zapisanych klientów, imię do wydruku ewidencji i dane osobowe z zapisanych faktur. Zostaną numery, daty i kwoty faktur, a dane z tej wizyty zostaną na stronie do jej zamknięcia.';

/** Dane z wcześniejszej wersji strony: wybór „Zachowaj moje dane”. */
function zachowajDaneZWczesniejszej() {
  magazyn.zachowajDaneFaktur();
  wczytajZMagazynu();
  wypelnijSprzedawce();
  renderujListe();
  odswiez();
  oglos('Zachowano Twoje dane do faktur. Zmienisz to przełącznikiem „Zapamiętaj moje dane i dane klientów do faktur”.');
  $('pamietaj-dane').focus();
}

/** Dane z wcześniejszej wersji strony: wybór „Usuń” (z potwierdzeniem). */
async function usunDaneZWczesniejszej() {
  const odp = await zapytaj({
    tytul: 'Usunąć dane do faktur?',
    tekst: TEKST_USUNIECIA_DANYCH,
    przyciski: [{ tekst: 'Anuluj', wynik: false, domyslny: true }, { tekst: 'Usuń', wynik: true, klasa: 'niebezpieczny' }],
  });
  if (!odp) { setTimeout(() => $('migracja-usun').focus(), 0); return; }
  magazyn.usunDaneFaktur();
  skrocWczesniejsze();
  wczytajZMagazynu();
  renderujListe();
  odswiez();
  oglos('Dane osobowe do faktur usunięte z tej przeglądarki.');
  setTimeout(() => $('pamietaj-dane').focus(), 0);
}

function odswiezEwidencje() {
  $('f-ewidencja').disabled = !stan.pamietaj;
  if (!stan.pamietaj) $('f-ewidencja').checked = false;
  let info = 'Jeśli sprzedaż z tą datą i kwotą już tam jest, dopiszemy do niej tylko numer faktury.';
  if (!stan.dostepna) info = 'Pamięć przeglądarki jest niedostępna (np. tryb prywatny), więc sprzedaż wpisz w ewidencji sam.';
  else if (!stan.pamietaj) info = 'Działa przy włączonej pamięci przeglądarki (niżej), bo ewidencja jest na innej stronie.';
  $('ewidencja-info').textContent = info;
  if (!stan.dostepna) $('pamietaj-info').textContent = 'Pamięć przeglądarki jest niedostępna, więc faktury znikną po zamknięciu strony. Zapisz każdą jako PDF.';
}

// ------------------------------------------------------------ utrata prawa (art. 145m ust. 2): zapamiętanie i cofnięcie

async function zaznaczUtrate() {
  if (!$('f-przekroczony').checked) return;
  const odp = await zapytaj({
    tytul: 'Zapamiętać przekroczenie limitu?',
    tekst: TEKSTY_OKIEN.zaznacz,
    przyciski: [{ tekst: 'Anuluj', wynik: false, domyslny: true }, { tekst: 'Zapamiętaj', wynik: true, klasa: 'glowny-maly' }],
  });
  if (odp) {
    stan.utrataOd = polaczUtrate(stan.utrataOd, dzis().slice(0, 7));
    utrwal();
    oglos('Zapamiętane: faktury dla firm wystawiasz w KSeF.');
  } else {
    $('f-przekroczony').checked = false;
  }
  odswiez();
  setTimeout(() => (odp ? $('cofnij-utrate') : $('f-przekroczony')).focus(), 0);
}

async function cofnijUtrate() {
  const odp = await zapytaj({
    tytul: 'Cofnąć zapamiętane przekroczenie?',
    tekst: TEKSTY_OKIEN.cofnij,
    przyciski: [{ tekst: 'Anuluj', wynik: false, domyslny: true }, { tekst: 'Cofnij', wynik: true, klasa: 'niebezpieczny' }],
  });
  if (!odp) { setTimeout(() => $('cofnij-utrate').focus(), 0); return; }
  stan.utrataOd = null;
  $('f-przekroczony').checked = false;
  utrwal();
  odswiez();
  oglos('Cofnięto zapamiętane przekroczenie limitu.');
  setTimeout(() => $('f-przekroczony').focus(), 0);
}

/** Tekst „dziś, DD.MM.RRRR” przy dacie wystawienia (odświeżany przy starcie, wystawieniu i powrocie na kartę). */
function odswiezDateWystawienia() {
  $('data-wystawienia').textContent = `dziś, ${dataPl(dzis())}`;
}

// ------------------------------------------------------------ start

function start() {
  wczytajStart();
  ustawPozycje([{ nazwa: '', ilosc: '1', jm: 'szt.', cena: '' }]);
  ustawZaplaty(['']);
  // Datą wystawienia jest dzień wystawienia: pokazujemy ją jako tekst, nie jako zablokowany kalendarz.
  odswiezDateWystawienia();
  // Po powrocie na kartę (np. po północy) tekst i numer pokazują właściwy dzień.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { odswiezDateWystawienia(); odswiez(); } });
  $('f-data-sprzedazy').value = dzis();
  if (!wypelnijSprzedawce()) {
    $('twoje-dane').open = true; // pierwsza faktura: od razu widać pola sprzedawcy
  }

  $('faktura-form').addEventListener('submit', wystaw);
  // Stare potwierdzenie znika przy pierwszej zmianie formularza po wystawieniu.
  // Tak samo błąd formularza i oznaczenie pola z błędem.
  const schowajPotwierdzenie = () => {
    $('potwierdzenie').hidden = true;
    $('form-blad').hidden = true;
    for (const e of $('faktura-form').querySelectorAll('[aria-invalid]')) e.removeAttribute('aria-invalid');
  };
  $('faktura-form').addEventListener('input', schowajPotwierdzenie);
  $('faktura-form').addEventListener('change', schowajPotwierdzenie);
  $('faktura-form').addEventListener('input', (e) => {
    if (e.target.id === 'f-numer') stan.numerRecznie = $('f-numer').value.trim() !== '';
    odswiez();
  });
  $('faktura-form').addEventListener('change', (e) => {
    if (e.target.name === 'rodzaj') odswiezRodzaj();
    if (e.target.id === 'f-zapisani') wybierzZapisanego();
    odswiez();
  });
  $('dodaj-pozycje').addEventListener('click', dodajPozycje);
  $('dodaj-zaplate').addEventListener('click', dodajZaplate);
  $('pamietaj').addEventListener('change', zmienPamiec);
  $('pamietaj-dane').addEventListener('change', zmienPamiecDanych);
  $('migracja-zachowaj').addEventListener('click', zachowajDaneZWczesniejszej);
  $('migracja-usun').addEventListener('click', usunDaneZWczesniejszej);
  $('f-przekroczony').addEventListener('change', zaznaczUtrate);
  $('cofnij-utrate').addEventListener('click', cofnijUtrate);
  window.addEventListener('beforeprint', () => zbudujWydruk(stan.doDruku));
  // Ta sama strona otwarta w dwóch kartach: zmiana w jednej odświeża drugą.
  window.addEventListener('storage', poZmianieWInnejKarcie);

  odswiezRodzaj();
  odswiezEwidencje();
  renderujListe();
  odswiez();
}

start();

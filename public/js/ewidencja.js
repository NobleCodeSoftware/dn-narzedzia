import {
  BladDanych, wczytajEwidencje, zapiszEwidencje, sprawdzEwidencje, dodajWpis, usunOstatni, raportMiesiaca,
  importujPlik, dopiszImport, pobierzKursNbp, limitDlaRoku, statusLimitu, przychodKwartalu, kwartal,
  dataWarszawa, formatujZl, groszeNaTekst,
} from './logic.js';
import { opisProgu, klasaProgu, magazyn, nazwaPliku } from './wspolne.js';

const $ = (id) => document.getElementById(id);
const ls = magazyn();
const KLUCZ_BUFORA = 'dn-narzedzia.ewidencja.bufor';
const KLUCZ_WLACZONY = 'dn-narzedzia.ewidencja.bufor-wlaczony';

const stan = { wiersze: [], nazwa: '', zmiany: false };

// ------------------------------------------------------------ renderowanie

function komorka(tr, tekst, klasa) {
  const td = document.createElement('td');
  td.textContent = tekst;
  if (klasa) td.className = klasa;
  tr.appendChild(td);
}

function renderWpisy() {
  const tbody = $('wpisy');
  tbody.replaceChildren();
  for (const w of stan.wiersze) {
    const tr = document.createElement('tr');
    komorka(tr, w.lp); komorka(tr, w.data); komorka(tr, w.kanal); komorka(tr, w.id_transakcji); komorka(tr, w.opis);
    komorka(tr, w.kwota, 'num'); komorka(tr, w.waluta); komorka(tr, w.kurs_nbp, 'num'); komorka(tr, w.data_kursu);
    komorka(tr, w.kwota_pln, 'num'); komorka(tr, w.korekta_do);
    tbody.appendChild(tr);
  }
  $('liczba-wpisow').textContent = String(stan.wiersze.length);
  $('usun-ostatni').disabled = stan.wiersze.length === 0;
  const bledy = sprawdzEwidencje(stan.wiersze);
  const box = $('walidacja');
  box.hidden = bledy.length === 0;
  box.textContent = bledy.length ? `Plik ma błędy (popraw je w arkuszu i otwórz ponownie): ${bledy.join('; ')}` : '';
}

function renderLimit() {
  const p = $('limit-stan');
  const meter = $('limit-meter');
  const dzis = dataWarszawa();
  const ostatnia = stan.wiersze.length ? stan.wiersze.map((w) => w.data).sort().at(-1) : dzis;
  try {
    const { rok, q } = kwartal(ostatnia);
    const s = statusLimitu(przychodKwartalu(stan.wiersze, ostatnia), limitDlaRoku(rok));
    p.textContent = `${rok}, kwartał ${q}: ${formatujZl(s.przychodGr)} z ${formatujZl(s.limitGr)} `
      + `(${s.procent.toLocaleString('pl-PL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%). ${opisProgu(s)}`;
    p.className = klasaProgu(s);
    meter.value = Math.min(s.procent, 100);
    meter.hidden = false;
  } catch (e) {
    p.className = '';
    p.textContent = `Nie policzono limitu: ${e.message}`;
    meter.hidden = true;
  }
}

function renderRaport() {
  const miesiac = $('miesiac').value;
  const tbody = $('raport');
  tbody.replaceChildren();
  $('raport-tytul').textContent = `Uproszczona ewidencja sprzedaży — ${miesiac || ''}`;
  let pozycje = [];
  try { pozycje = miesiac ? raportMiesiaca(stan.wiersze, miesiac) : []; } catch (e) { pozycje = []; }
  if (!pozycje.length) {
    const tr = document.createElement('tr');
    komorka(tr, '—'); komorka(tr, 'brak sprzedaży'); komorka(tr, '0,00', 'num'); komorka(tr, '0,00', 'num');
    tbody.appendChild(tr);
    return;
  }
  for (const r of pozycje) {
    const tr = document.createElement('tr');
    komorka(tr, String(r.lp)); komorka(tr, r.data);
    komorka(tr, groszeNaTekst(r.kwotaGr).replace('.', ','), 'num');
    komorka(tr, groszeNaTekst(r.narastajacoGr).replace('.', ','), 'num');
    tbody.appendChild(tr);
  }
}

function renderStanPliku() {
  const nazwa = stan.nazwa ? `Plik: ${stan.nazwa}` : 'Nowa ewidencja (jeszcze bez pliku)';
  const zmiany = stan.zmiany ? ' · NIEZAPISANE ZMIANY — zapisz plik CSV' : ' · zapisane';
  $('stan-pliku').textContent = `${nazwa} · wpisów: ${stan.wiersze.length}${stan.wiersze.length || stan.nazwa ? zmiany : ''}`;
  $('stan-pliku').className = stan.zmiany ? 'status-danger' : '';
}

function zapiszBufor() {
  if (!$('bufor-wlacz').checked) return;
  const ok = ls.zapisz(KLUCZ_BUFORA, JSON.stringify({ wiersze: stan.wiersze, nazwa: stan.nazwa, czas: new Date().toISOString() }));
  $('bufor-info').textContent = ok
    ? `Kopia robocza zapisana w tej przeglądarce (${new Date().toLocaleString('pl-PL')}). To nie zastępuje pliku.`
    : 'Przeglądarka nie pozwala zapisać kopii roboczej (tryb prywatny lub blokada). Zapisuj plik CSV.';
  renderBuforAkcje();
}

function renderBuforAkcje() {
  $('bufor-akcje').hidden = ls.czytaj(KLUCZ_BUFORA) === null;
}

function odswiez({ zmiana = false } = {}) {
  if (zmiana) stan.zmiany = true;
  renderWpisy();
  renderLimit();
  renderRaport();
  renderStanPliku();
  if (zmiana) zapiszBufor();
}

function ustawWiersze(wiersze, nazwa) {
  stan.wiersze = wiersze;
  stan.nazwa = nazwa;
  stan.zmiany = false;
  const ostatnia = wiersze.length ? wiersze.map((w) => w.data).sort().at(-1) : dataWarszawa();
  $('miesiac').value = ostatnia.slice(0, 7);
  odswiez();
}

// ------------------------------------------------------------ plik

function potwierdzUtrate() {
  return !stan.zmiany || window.confirm('Masz niezapisane zmiany. Kontynuować bez zapisu pliku?');
}

$('nowa').addEventListener('click', () => {
  if (!potwierdzUtrate()) return;
  ustawWiersze([], '');
});

$('otworz').addEventListener('change', async (ev) => {
  const plik = ev.target.files && ev.target.files[0];
  ev.target.value = '';
  if (!plik || !potwierdzUtrate()) return;
  try {
    ustawWiersze(wczytajEwidencje(await plik.text()), plik.name);
    zapiszBufor();
  } catch (e) {
    if (!(e instanceof BladDanych)) throw e;
    window.alert(`Nie udało się otworzyć pliku: ${e.message}`);
  }
});

async function zapiszPlik() {
  // BOM, żeby Excel poprawnie odczytał polskie znaki.
  const tresc = `﻿${zapiszEwidencje(stan.wiersze)}`;
  const nazwa = nazwaPliku(stan.nazwa, dataWarszawa());
  if (typeof window.showSaveFilePicker === 'function') {
    try {
      const uchwyt = await window.showSaveFilePicker({ suggestedName: nazwa, types: [{ description: 'CSV', accept: { 'text/csv': ['.csv'] } }] });
      const strumien = await uchwyt.createWritable();
      await strumien.write(new Blob([tresc], { type: 'text/csv;charset=utf-8' }));
      await strumien.close();
      stan.nazwa = uchwyt.name;
      stan.zmiany = false;
      renderStanPliku();
      return;
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      // inne błędy: zapis przez pobranie pliku
    }
  }
  const url = URL.createObjectURL(new Blob([tresc], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nazwa;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  stan.nazwa = nazwa;
  stan.zmiany = false;
  renderStanPliku();
}

$('zapisz').addEventListener('click', () => { zapiszPlik(); });

window.addEventListener('beforeunload', (ev) => {
  if (stan.zmiany) { ev.preventDefault(); ev.returnValue = ''; }
});

// ------------------------------------------------------------ bufor (opcjonalny)

$('bufor-wlacz').checked = ls.czytaj(KLUCZ_WLACZONY) === '1';
$('bufor-wlacz').addEventListener('change', (ev) => {
  if (ev.target.checked) {
    ls.zapisz(KLUCZ_WLACZONY, '1');
    zapiszBufor();
  } else {
    ls.usun(KLUCZ_WLACZONY);
    $('bufor-info').textContent = 'Nowe zmiany nie będą zapisywane w przeglądarce. Istniejącą kopię usuń przyciskiem poniżej.';
  }
});

$('bufor-przywroc').addEventListener('click', () => {
  const surowe = ls.czytaj(KLUCZ_BUFORA);
  if (!surowe || !potwierdzUtrate()) return;
  try {
    const dane = JSON.parse(surowe);
    if (!Array.isArray(dane.wiersze)) throw new Error('uszkodzona kopia');
    ustawWiersze(dane.wiersze.map((w) => ({ ...w })), dane.nazwa || '');
    stan.zmiany = true; // kopia robocza nie jest plikiem
    renderStanPliku();
    $('bufor-info').textContent = `Przywrócono kopię z ${new Date(dane.czas).toLocaleString('pl-PL')}. Zapisz plik CSV.`;
  } catch (e) {
    $('bufor-info').textContent = `Nie udało się przywrócić kopii: ${e.message}`;
  }
});

$('bufor-usun').addEventListener('click', () => {
  ls.usun(KLUCZ_BUFORA);
  renderBuforAkcje();
  $('bufor-info').textContent = 'Kopia robocza usunięta z tej przeglądarki.';
});

// ------------------------------------------------------------ dodawanie

const pole = (id) => $(id).value.trim();

async function uzupelnijKurs() {
  const waluta = pole('f-waluta').toUpperCase();
  const data = pole('f-data');
  if (waluta === 'PLN') { $('f-kurs').value = ''; $('f-data-kursu').value = ''; return; }
  $('dodaj-komunikat').textContent = `Pobieram kurs ${waluta} z NBP…`;
  const k = await pobierzKursNbp(waluta, data);
  $('f-kurs').value = k.kurs;
  $('f-data-kursu').value = k.dataKursu;
  $('dodaj-komunikat').textContent = `Kurs ${waluta} ${k.kurs} z ${k.dataKursu} (tabela ${k.tabela}).`;
}

$('pobierz-kurs').addEventListener('click', async () => {
  try { await uzupelnijKurs(); } catch (e) { $('dodaj-komunikat').textContent = `Błąd: ${e.message}`; }
});

$('dodaj-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const kom = $('dodaj-komunikat');
  try {
    if (pole('f-waluta').toUpperCase() !== 'PLN' && !pole('f-kurs')) await uzupelnijKurs();
    stan.wiersze = dodajWpis(stan.wiersze, {
      data: pole('f-data'), kanal: pole('f-kanal'), idTransakcji: pole('f-id'), opis: pole('f-opis'),
      kwota: pole('f-kwota'), waluta: pole('f-waluta'), kurs: pole('f-kurs'), dataKursu: pole('f-data-kursu'),
      korektaDo: pole('f-korekta'),
    });
    const nowy = stan.wiersze.at(-1);
    kom.textContent = `Dodano lp ${nowy.lp}: ${nowy.kwota} ${nowy.waluta} = ${nowy.kwota_pln} zł. Pamiętaj o zapisie pliku.`;
    for (const id of ['f-id', 'f-opis', 'f-kwota', 'f-kurs', 'f-data-kursu', 'f-korekta']) $(id).value = '';
    $('miesiac').value = nowy.data.slice(0, 7);
    odswiez({ zmiana: true });
  } catch (e) {
    if (!(e instanceof BladDanych)) throw e;
    kom.textContent = `Nie dodano: ${e.message}`;
  }
});

for (const id of ['f-data', 'f-waluta']) {
  $(id).addEventListener('change', () => { $('f-kurs').value = ''; $('f-data-kursu').value = ''; });
}

// ------------------------------------------------------------ import

$('import').addEventListener('change', async (ev) => {
  const plik = ev.target.files && ev.target.files[0];
  ev.target.value = '';
  if (!plik) return;
  const wynik = $('import-wynik');
  wynik.textContent = `Czytam ${plik.name}…`;
  try {
    const { format, pozycje, uwagi } = importujPlik(await plik.text());
    wynik.textContent = `Rozpoznano eksport ${format}: ${pozycje.length} transakcji. Pobieram kursy NBP…`;
    const r = await dopiszImport(stan.wiersze, pozycje, (waluta, data) => pobierzKursNbp(waluta, data));
    stan.wiersze = r.wiersze;
    const linie = [`Dodano: ${r.dodane}. Pominięto jako już zapisane: ${r.pominiete.length}.`];
    if (r.bledy.length) linie.push(`Błędy (nie dodano):\n- ${r.bledy.join('\n- ')}`);
    if (uwagi.length) linie.push(`Do sprawdzenia:\n- ${uwagi.join('\n- ')}`);
    if (r.dodane) linie.push('Zapisz plik CSV, żeby nie stracić zmian.');
    wynik.textContent = linie.join('\n\n');
    if (r.dodane) {
      $('miesiac').value = stan.wiersze.at(-1).data.slice(0, 7);
      odswiez({ zmiana: true });
    }
  } catch (e) {
    if (!(e instanceof BladDanych)) throw e;
    wynik.textContent = `Import nieudany: ${e.message}`;
  }
});

// ------------------------------------------------------------ usuwanie, raport, wydruk

$('usun-ostatni').addEventListener('click', () => {
  const ostatni = stan.wiersze.at(-1);
  if (!ostatni || !window.confirm(`Usunąć wpis lp ${ostatni.lp} (${ostatni.data}, ${ostatni.kwota} ${ostatni.waluta})?`)) return;
  stan.wiersze = usunOstatni(stan.wiersze);
  odswiez({ zmiana: true });
});

$('miesiac').addEventListener('change', renderRaport);
$('drukuj').addEventListener('click', () => window.print());

// ------------------------------------------------------------ start

$('f-data').value = dataWarszawa();
$('miesiac').value = dataWarszawa().slice(0, 7);
renderBuforAkcje();
if (ls.czytaj(KLUCZ_BUFORA) !== null) {
  $('bufor-info').textContent = 'W tej przeglądarce jest kopia robocza. Przywróć ją albo otwórz swój plik CSV.';
}
odswiez();

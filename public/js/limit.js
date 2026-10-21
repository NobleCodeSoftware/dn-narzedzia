import { BladDanych, naGrosze, limitDlaRoku, statusLimitu, dataWarszawa, kwartal, formatujZl } from './logic.js';
import { opisProgu, klasaProgu, szczegolyWyniku, procentTekst } from './wspolne.js';

const $ = (id) => document.getElementById(id);
const pole = $('przychod');
const wyborKwartalu = $('kwartal');
let pokazany = false;

function ustawBiezacyKwartal() {
  const { rok, q } = kwartal(dataWarszawa());
  const wartosc = `${rok}-${q}`;
  if ([...wyborKwartalu.options].some((o) => o.value === wartosc)) wyborKwartalu.value = wartosc;
}

function pokazBlad(tekst) {
  $('blad').textContent = tekst;
  $('blad').hidden = false;
  $('wynik').hidden = true;
  pole.setAttribute('aria-invalid', 'true');
}

function licz() {
  $('blad').hidden = true;
  pole.removeAttribute('aria-invalid');
  const tekst = pole.value.trim().replace(/\s*zł$/i, '');
  if (tekst === '') { pokazBlad('Wpisz kwotę przychodu, np. 2500 albo 2500,50.'); return; }
  let przychodGr;
  try {
    przychodGr = naGrosze(tekst, 'przychód');
  } catch (e) {
    if (!(e instanceof BladDanych)) throw e;
    pokazBlad('Wpisz kwotę samymi cyframi, np. 2500 albo 2500,50.');
    return;
  }
  if (przychodGr < 0n) { pokazBlad('Kwota nie może być ujemna.'); return; }
  const [rok, q] = wyborKwartalu.value.split('-');
  const s = statusLimitu(przychodGr, limitDlaRoku(rok));
  $('wynik-procent').textContent = procentTekst(s.procent);
  $('pasek').style.width = `${Math.min(s.procent, 100)}%`;
  $('pasek').className = `pasek-wypelnienie ${klasaProgu(s)}`;
  $('wynik-status').textContent = opisProgu(s);
  $('wynik-status').className = `status ${klasaProgu(s)}`;
  $('wynik-szczegoly').textContent = szczegolyWyniku(s, formatujZl, `${['I', 'II', 'III', 'IV'][q - 1]} kwartał ${rok}`);
  $('wynik').hidden = false;
  pokazany = true;
}

$('limit-form').addEventListener('submit', (ev) => { ev.preventDefault(); licz(); });
pole.addEventListener('input', () => { if (pokazany && pole.value.trim() !== '') licz(); });
wyborKwartalu.addEventListener('change', () => { if (pokazany) licz(); });

ustawBiezacyKwartal();

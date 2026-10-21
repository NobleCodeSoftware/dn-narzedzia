import { BladDanych, naGrosze, limitDlaRoku, statusLimitu, dataWarszawa, kwartal, formatujZl } from './logic.js';
import { opisProgu, klasaProgu, szczegolyWyniku, procentTekst } from './wspolne.js';

const $ = (id) => document.getElementById(id);
const pole = $('przychod');
const wyborKwartalu = $('kwartal');
const wynik = $('wynik');

function ustawBiezacyKwartal() {
  const { rok, q } = kwartal(dataWarszawa());
  const wartosc = `${rok}-${q}`;
  if ([...wyborKwartalu.options].some((o) => o.value === wartosc)) wyborKwartalu.value = wartosc;
}

function ukryjBlad() {
  $('blad').hidden = true;
  pole.removeAttribute('aria-invalid');
}

function pokazBlad(tekst) {
  $('blad').textContent = tekst;
  $('blad').hidden = false;
  wynik.hidden = true;
  pole.setAttribute('aria-invalid', 'true');
}

/** Odczyt kwoty: { gr } albo { blad } albo { pusto: true }. */
function odczytajKwote() {
  const tekst = pole.value.trim().replace(/\s*zł$/i, '');
  if (tekst === '') return { pusto: true };
  try {
    const gr = naGrosze(tekst, 'przychód');
    return gr < 0n ? { blad: 'Kwota nie może być ujemna.' } : { gr };
  } catch (e) {
    if (!(e instanceof BladDanych)) throw e;
    return { blad: 'Wpisz kwotę samymi cyframi, np. 2500 albo 2500,50.' };
  }
}

function pokazWynik(przychodGr) {
  ukryjBlad();
  const [rok, q] = wyborKwartalu.value.split('-');
  const s = statusLimitu(przychodGr, limitDlaRoku(rok));
  $('wynik-procent').textContent = procentTekst(s.procent);
  $('pasek').style.width = `${Math.min(s.procent, 100)}%`;
  $('pasek').className = `pasek-wypelnienie ${klasaProgu(s)}`;
  $('wynik-status').textContent = opisProgu(s);
  $('wynik-status').className = `status ${klasaProgu(s)}`;
  $('wynik-szczegoly').textContent = szczegolyWyniku(s, formatujZl, `${['I', 'II', 'III', 'IV'][q - 1]} kwartał ${rok}`);
  $('wynik-dalej').hidden = !s.przekroczony;
  wynik.hidden = false;
}

/** Po „Sprawdź limit”: chowa klawiaturę i przewija do wyniku, jeśli nie jest cały widoczny. */
function przewinDoWyniku() {
  pole.blur();
  const ograniczRuch = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const r = wynik.getBoundingClientRect();
  if (r.top < 0 || r.bottom > window.innerHeight) {
    wynik.scrollIntoView({ block: 'nearest', behavior: ograniczRuch ? 'auto' : 'smooth' });
  }
}

// Przycisk albo Enter: pełne sprawdzenie z komunikatem błędu.
$('limit-form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const k = odczytajKwote();
  if (k.pusto) { pokazBlad('Wpisz kwotę sprzedaży, np. 2500 albo 2500,50.'); return; }
  if (k.blad) { pokazBlad(k.blad); return; }
  pokazWynik(k.gr);
  przewinDoWyniku();
});

// Na bieżąco przy wpisywaniu: wynik dla poprawnej kwoty; puste pole chowa wynik bez komunikatu;
// niedokończony wpis (np. „12,”) nie zmienia ekranu, żeby nic nie migało.
function naBiezaco() {
  const k = odczytajKwote();
  if (k.pusto) { ukryjBlad(); wynik.hidden = true; return; }
  if (k.gr !== undefined) pokazWynik(k.gr);
}
pole.addEventListener('input', naBiezaco);
wyborKwartalu.addEventListener('change', naBiezaco);

ustawBiezacyKwartal();

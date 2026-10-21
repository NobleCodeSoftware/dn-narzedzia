import { limitDlaRoku, statusLimitu, dataWarszawa, kwartal, formatujZl } from './logic.js';
import { opisProgu, klasaProgu, szczegolyWyniku, procentTekst, odczytajWpis, ogloszenieWyniku } from './wspolne.js';

const $ = (id) => document.getElementById(id);
const pole = $('przychod');
const wyborKwartalu = $('kwartal');
const wynik = $('wynik');
const ogloszenie = $('ogloszenie');
const PRZERWA_W_PISANIU_MS = 700;
let zegarOgloszenia = null;
let ostatnieOgloszenie = '';

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
  wyczyscOgloszenie();
}

/** Czytnik ekranu dostaje wynik tylko przez #ogloszenie: od razu po wysłaniu albo po przerwie w pisaniu. */
function zaplanujOgloszenie(tekst, opoznienie) {
  clearTimeout(zegarOgloszenia);
  zegarOgloszenia = null;
  const ustaw = () => {
    // Ten sam tekst nie byłby ogłoszony ponownie: najpierw czyścimy region.
    if (tekst === ostatnieOgloszenie) ogloszenie.textContent = '';
    ogloszenie.textContent = tekst;
    ostatnieOgloszenie = tekst;
  };
  if (opoznienie) zegarOgloszenia = setTimeout(ustaw, opoznienie); else ustaw();
}

function anulujOgloszenie() {
  clearTimeout(zegarOgloszenia);
  zegarOgloszenia = null;
}

/** Gdy wynik znika, czytnik nie powinien znaleźć w regionie starego wyniku. */
function wyczyscOgloszenie() {
  anulujOgloszenie();
  ogloszenie.textContent = '';
  ostatnieOgloszenie = '';
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
  const etykieta = `${['I', 'II', 'III', 'IV'][q - 1]} kwartał ${rok}`;
  $('wynik-szczegoly').textContent = szczegolyWyniku(s, formatujZl, etykieta);
  $('wynik-dalej').hidden = !s.przekroczony;
  wynik.hidden = false;
  return ogloszenieWyniku(s, formatujZl, etykieta);
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
  anulujOgloszenie();
  const k = odczytajWpis(pole.value);
  if (k.stan === 'pusto' || k.stan === 'niedokonczony') { pokazBlad('Wpisz kwotę sprzedaży, np. 2500 albo 2500,50.'); return; }
  if (k.stan === 'blad') { pokazBlad(k.blad); return; }
  zaplanujOgloszenie(pokazWynik(k.gr), 0);
  przewinDoWyniku();
});

// Na bieżąco przy wpisywaniu (bez tekstu błędu; ten pojawia się dopiero po wysłaniu):
// - poprawna kwota: wynik od razu, ogłoszenie dla czytnika po przerwie w pisaniu;
// - puste pole: wynik znika;
// - błędny wpis (np. „-5”, „5000a”): wynik znika, pole dostaje aria-invalid;
// - niedokończony wpis (np. „5000,”): nic się nie zmienia, żeby nie migało.
function naBiezaco() {
  const k = odczytajWpis(pole.value);
  if (k.stan === 'niedokonczony') return;
  anulujOgloszenie();
  if (k.stan === 'ok') { zaplanujOgloszenie(pokazWynik(k.gr), PRZERWA_W_PISANIU_MS); return; }
  $('blad').hidden = true;
  wynik.hidden = true;
  wyczyscOgloszenie();
  if (k.stan === 'blad') pole.setAttribute('aria-invalid', 'true'); else pole.removeAttribute('aria-invalid');
}
pole.addEventListener('input', naBiezaco);
wyborKwartalu.addEventListener('change', naBiezaco);

ustawBiezacyKwartal();

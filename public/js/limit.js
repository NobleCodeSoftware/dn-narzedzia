import {
  PLACA_MINIMALNA, BladDanych, naGrosze, limitKwartalny, statusLimitu, przychodKwartalu,
  wczytajEwidencje, dataWarszawa, kwartal, formatujZl, groszeNaTekst,
} from './logic.js';
import { opisProgu, klasaProgu } from './wspolne.js';

const $ = (id) => document.getElementById(id);
const rok = $('rok');
const kw = $('kwartal');
const placa = $('placa');
const przychod = $('przychod');

function ustawDomyslne() {
  const dzis = dataWarszawa();
  const { rok: r, q } = kwartal(dzis);
  if ([...rok.options].some((o) => o.value === String(r))) rok.value = String(r);
  kw.value = String(q);
  placa.value = PLACA_MINIMALNA[rok.value];
}

function pokazBlad(tekst) {
  $('blad').textContent = tekst;
  $('blad').hidden = false;
  $('wynik').hidden = true;
}

function licz() {
  $('blad').hidden = true;
  try {
    const limitGr = limitKwartalny(placa.value);
    const przychodGr = przychod.value.trim() === '' ? 0n : naGrosze(przychod.value, 'przychód');
    const s = statusLimitu(przychodGr, limitGr);
    $('wynik-procent').textContent = `${s.procent.toLocaleString('pl-PL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
    $('wynik-meter').value = Math.min(s.procent, 100);
    $('wynik-kwartal').textContent = `${rok.value}, kwartał ${kw.value}`;
    $('wynik-limit').textContent = formatujZl(limitGr);
    $('wynik-przychod').textContent = formatujZl(przychodGr);
    $('wynik-pozostalo').textContent = formatujZl(s.pozostaloGr);
    const status = $('wynik-status');
    status.textContent = opisProgu(s);
    status.className = klasaProgu(s);
    $('wynik').hidden = false;
  } catch (e) {
    if (!(e instanceof BladDanych)) throw e;
    pokazBlad(`Sprawdź dane: ${e.message}`);
  }
}

rok.addEventListener('change', () => { placa.value = PLACA_MINIMALNA[rok.value] ?? ''; licz(); });
kw.addEventListener('change', licz);
$('limit-form').addEventListener('submit', (ev) => { ev.preventDefault(); licz(); });

$('plik-ewidencji').addEventListener('change', async (ev) => {
  const plik = ev.target.files && ev.target.files[0];
  ev.target.value = '';
  if (!plik) return;
  try {
    const wiersze = wczytajEwidencje(await plik.text());
    const miesiac = String((Number(kw.value) - 1) * 3 + 1).padStart(2, '0');
    const suma = przychodKwartalu(wiersze, `${rok.value}-${miesiac}-01`);
    przychod.value = groszeNaTekst(suma).replace('.', ',');
    licz();
  } catch (e) {
    if (!(e instanceof BladDanych)) throw e;
    pokazBlad(`Nie udało się odczytać pliku ewidencji: ${e.message}`);
  }
});

ustawDomyslne();

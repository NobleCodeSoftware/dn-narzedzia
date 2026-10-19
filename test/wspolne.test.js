import { test } from 'node:test';
import assert from 'node:assert/strict';
import { opisProgu, klasaProgu, magazyn, nazwaPliku } from '../public/js/wspolne.js';
import { statusLimitu } from '../public/js/logic.js';

test('opis i klasa progu', () => {
  const L = 1081350n;
  assert.match(opisProgu(statusLimitu(0n, L)), /Poniżej/);
  assert.equal(klasaProgu(statusLimitu(0n, L)), 'status-ok');
  assert.match(opisProgu(statusLimitu(800000n, L)), /70%/);
  assert.equal(klasaProgu(statusLimitu(950000n, L)), 'status-warn');
  assert.match(opisProgu(statusLimitu(1030000n, L)), /95%/);
  assert.match(opisProgu(statusLimitu(L, L)), /100%/);
  assert.match(opisProgu(statusLimitu(L + 1n, L)), /7 dni/);
  assert.equal(klasaProgu(statusLimitu(L + 1n, L)), 'status-danger');
});

test('magazyn: działa bez localStorage i przy wyjątkach (Safari prywatne, blokady)', () => {
  const brak = magazyn({});
  assert.equal(brak.czytaj('x'), null);
  assert.equal(brak.zapisz('x', '1'), false);
  const rzuca = magazyn({ get localStorage() { throw new Error('SecurityError'); } });
  assert.equal(rzuca.czytaj('x'), null);
  assert.equal(rzuca.zapisz('x', '1'), false);
  const pelny = magazyn({ localStorage: { getItem: () => null, setItem: () => { throw new Error('QuotaExceeded'); }, removeItem() {} } });
  assert.equal(pelny.zapisz('x', '1'), false);
  const m = new Map();
  const ok = magazyn({ localStorage: { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) } });
  assert.equal(ok.zapisz('x', '1'), true);
  assert.equal(ok.czytaj('x'), '1');
  ok.usun('x');
  assert.equal(ok.czytaj('x'), null);
});

test('nazwaPliku', () => {
  assert.equal(nazwaPliku('', '2026-10-18'), 'ewidencja-sprzedazy-2026-10-18.csv');
  assert.equal(nazwaPliku('moja.csv', '2026-10-18'), 'moja.csv');
});

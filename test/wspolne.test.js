import { test } from 'node:test';
import assert from 'node:assert/strict';
import { opisProgu, klasaProgu, procentTekst, szczegolyWyniku, odczytajWpis, ogloszenieWyniku } from '../public/js/wspolne.js';
import { statusLimitu, formatujZl } from '../public/js/logic.js';

test('opis i klasa progu 70/85/95/100%', () => {
  const L = 1081350n;
  assert.match(opisProgu(statusLimitu(0n, L)), /Mieścisz się/);
  assert.equal(klasaProgu(statusLimitu(0n, L)), 'poziom-ok');
  assert.match(opisProgu(statusLimitu(800000n, L)), /70%/);
  assert.equal(klasaProgu(statusLimitu(800000n, L)), 'poziom-70');
  assert.equal(klasaProgu(statusLimitu(950000n, L)), 'poziom-85');
  assert.match(opisProgu(statusLimitu(1030000n, L)), /95%/);
  assert.equal(klasaProgu(statusLimitu(1030000n, L)), 'poziom-95');
  assert.match(opisProgu(statusLimitu(L, L)), /w całości/);
  assert.equal(klasaProgu(statusLimitu(L, L)), 'poziom-100');
  assert.match(opisProgu(statusLimitu(L + 1n, L)), /przekroczony/);
  assert.equal(klasaProgu(statusLimitu(L + 1n, L)), 'poziom-100');
});

test('procentTekst i szczegóły wyniku', () => {
  assert.equal(procentTekst(45.2), '45,2%');
  assert.equal(procentTekst(100), '100,0%');
  const L = 1081350n;
  assert.equal(szczegolyWyniku(statusLimitu(250000n, L), formatujZl, 'IV kwartał 2026'),
    `Do limitu ${formatujZl(L)} na IV kwartał 2026 zostało ${formatujZl(831350n)}.`);
  assert.match(szczegolyWyniku(statusLimitu(1100000n, L), formatujZl, 'IV kwartał 2026'), /o 186,50\s?zł wyższy/);
});

test('odczytajWpis: pusto, niedokończony, błąd i poprawna kwota', () => {
  assert.deepEqual(odczytajWpis(''), { stan: 'pusto' });
  assert.deepEqual(odczytajWpis('   '), { stan: 'pusto' });
  for (const t of ['5000,', '5000.', '5 000,', '0,']) assert.equal(odczytajWpis(t).stan, 'niedokonczony', t);
  for (const t of ['-5', '5000a', 'abc', '-', ',5,', '1e3', '5000,,']) assert.equal(odczytajWpis(t).stan, 'blad', t);
  assert.match(odczytajWpis('-5').blad, /ujemna/);
  assert.match(odczytajWpis('5000a').blad, /cyframi/);
  assert.deepEqual(odczytajWpis('7600'), { stan: 'ok', gr: 760000n });
  assert.deepEqual(odczytajWpis('2 500,50 zł'), { stan: 'ok', gr: 250050n });
  assert.deepEqual(odczytajWpis('5000,5'), { stan: 'ok', gr: 500050n });
});

test('ogloszenieWyniku: procent, status i kwoty w jednym tekście', () => {
  const t = ogloszenieWyniku(statusLimitu(760000n, 1081350n), formatujZl, 'IV kwartał 2026');
  assert.match(t, /^70,3% limitu\. Wykorzystano co najmniej 70% limitu\. Do limitu .* zostało /);
});

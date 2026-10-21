import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BladDanych, naGrosze, groszeNaTekst, formatujZl, limitKwartalny, limitDlaRoku, statusLimitu,
  kwartal, dodajDni, dataWarszawa, poprawnaData,
} from '../public/js/logic.js';

// ---------------------------------------------------------------- liczby

test('naGrosze: przecinek, kropka, spacje, zaokrąglenie połówkowe od zera', () => {
  assert.equal(naGrosze('10 813,50'), 1081350n);
  assert.equal(naGrosze('12.5'), 1250n);
  assert.equal(naGrosze('0.005'), 1n);
  assert.equal(naGrosze('-0.005'), -1n);
  assert.equal(naGrosze('0.004'), 0n);
  assert.throws(() => naGrosze('1e3'), BladDanych);
  assert.throws(() => naGrosze('abc'), BladDanych);
  assert.throws(() => naGrosze(''), BladDanych);
});

test('formatowanie kwot', () => {
  assert.equal(groszeNaTekst(1081350n), '10813.50');
  assert.equal(groszeNaTekst(-5n), '-0.05');
  assert.equal(formatujZl(1081350n), '10 813,50 zł');
  assert.equal(formatujZl(-123456789n), '−1 234 567,89 zł');
});

// ---------------------------------------------------------------- daty

test('daty: walidacja, dodawanie dni, kwartały, strefa Warszawy', () => {
  assert.ok(poprawnaData('2026-02-28'));
  assert.ok(!poprawnaData('2026-02-29'));
  assert.ok(poprawnaData('2028-02-29'));
  assert.equal(dodajDni('2026-01-01', -1), '2025-12-31');
  assert.deepEqual(kwartal('2026-03-31'), { rok: 2026, q: 1 });
  assert.deepEqual(kwartal('2026-04-01'), { rok: 2026, q: 2 });
  assert.deepEqual(kwartal('2026-12-31'), { rok: 2026, q: 4 });
  // 23:30 UTC 31.03 to już 1.04 w Warszawie (CEST, UTC+2) — inny kwartał.
  assert.equal(dataWarszawa('2026-03-31T23:30:00Z'), '2026-04-01');
  assert.equal(dataWarszawa('2026-12-31T22:59:59Z'), '2026-12-31');
  assert.equal(dataWarszawa('2026-12-31T23:00:00Z'), '2027-01-01');
});

// ---------------------------------------------------------------- limit

test('limit kwartalny 2026 = 10 813,50 zł, 2027 = 11 137,50 zł, parametr płacy', () => {
  assert.equal(limitKwartalny('4806'), 1081350n);
  assert.equal(limitDlaRoku(2026), 1081350n);
  assert.equal(limitDlaRoku(2027), 1113750n);
  assert.equal(limitDlaRoku(2027, '5000'), 1125000n);
  assert.throws(() => limitDlaRoku(2030), BladDanych);
  assert.throws(() => limitKwartalny('0'), BladDanych);
});

test('statusLimitu: procent i progi 70/85/95/100%', () => {
  const limit = 1081350n;
  assert.equal(statusLimitu(0n, limit).prog, null);
  const s70 = statusLimitu(756945n, limit); // dokładnie 70%
  assert.equal(s70.prog, '0.70');
  assert.equal(s70.procent, 70);
  assert.equal(statusLimitu(756944n, limit).prog, null);
  assert.equal(statusLimitu(919148n, limit).prog, '0.85'); // 85,0000…%
  assert.equal(statusLimitu(1027283n, limit).prog, '0.95');
  const s100 = statusLimitu(1081350n, limit);
  assert.equal(s100.prog, '1.00');
  assert.equal(s100.przekroczony, false);
  assert.equal(s100.pozostaloGr, 0n);
  const sPonad = statusLimitu(1081351n, limit);
  assert.equal(sPonad.przekroczony, true);
  assert.equal(sPonad.pozostaloGr, -1n);
  assert.equal(statusLimitu(540675n, limit).procent, 50);
});

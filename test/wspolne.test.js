import { test } from 'node:test';
import assert from 'node:assert/strict';
import { opisProgu, klasaProgu, procentTekst, szczegolyWyniku, odczytajWpis, ogloszenieWyniku, tekstWylaczeniaPamieci } from '../public/js/wspolne.js';
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

// ---------------------------------------------------------------- termin wniosku do CEIDG w dzień wolny

import { dopisekTerminu } from '../public/js/wspolne.js';
import { najblizszyDzienRoboczy } from '../public/js/kalendarz.js';
import { historiaKwartalow, normalizujWpis } from '../public/js/ewidencja-logika.js';

test('termin CEIDG: D + 7 dni bez przesunięcia, dopisek o najbliższym dniu roboczym, gdy termin wypada w dzień wolny', () => {
  // Przekroczenie w sobotę 2.01.2027: termin 9.01.2027 (sobota). 10.01 to niedziela, więc najbliższy dzień roboczy to 11.01.
  const [kw] = historiaKwartalow([normalizujWpis({ id: 'a', data: '2027-01-02', kwota: '12000' })], '2027-01-05');
  assert.deepEqual(kw.przekroczenie, { data: '2027-01-02', termin: '2027-01-09' }, 'termin bez przesunięcia');
  assert.equal(najblizszyDzienRoboczy('2027-01-09'), '2027-01-11');
  assert.equal(najblizszyDzienRoboczy('2027-01-05'), '2027-01-05', 'dzień roboczy bez zmian');
  assert.equal(najblizszyDzienRoboczy('2027-01-06'), '2027-01-07', 'Trzech Króli');
  assert.equal(dopisekTerminu(kw.przekroczenie.termin),
    'Ten dzień jest wolny od pracy. Termin mógłby przesunąć się na 11.01.2027, ale przepisy tego nie przesądzają. Wniosek do CEIDG złożysz online także w dzień wolny, więc najbezpieczniej zrób to do 09.01.2027.');
  assert.equal(dopisekTerminu('2027-01-08'), '', 'piątek: bez dopisku');
  assert.match(dopisekTerminu('2026-12-24'), /przesunąć się na 28\.12\.2026/, 'Wigilia i święta');
  // Dopisek nie zmienia statusu ani terminu.
  assert.equal(kw.status.przekroczony, true);
});

test('dopisek terminu na Boże Ciało i Poniedziałek Wielkanocny 2027', () => {
  assert.match(dopisekTerminu('2027-05-27'), /przesunąć się na 28\.05\.2027/);
  assert.match(dopisekTerminu('2027-03-29'), /przesunąć się na 30\.03\.2027/);
});

test('okno wyłączenia pamięci: o danych do faktur tylko wtedy, gdy mogą być zapisane; najwyżej 2 zdania', () => {
  const zdania = (t) => 1 + [...t.matchAll(/[.!?]\s+(?=[A-ZĄĆĘŁŃÓŚŹŻ])/g)].length;
  const POCZATEK = 'Usuniemy z tej przeglądarki wpisy ewidencji, wystawione faktury i zapamiętane przekroczenie limitu KSeF';
  const DANE = ', a Twoje dane do faktur i zapisani klienci zostaną (decyduje o nich osobny przełącznik)';
  assert.equal(tekstWylaczeniaPamieci({ daneZostaja: false, strona: 'ewidencja' }),
    `${POCZATEK}. Wpisy z tej wizyty zostaną na stronie do jej zamknięcia, więc zapisz plik.`);
  assert.equal(tekstWylaczeniaPamieci({ daneZostaja: true, strona: 'ewidencja' }),
    `${POCZATEK}${DANE}. Wpisy z tej wizyty zostaną na stronie do jej zamknięcia, więc zapisz plik.`);
  assert.equal(tekstWylaczeniaPamieci({ daneZostaja: false, strona: 'faktura' }),
    `${POCZATEK}. Faktury z tej wizyty zostaną na stronie do jej zamknięcia.`);
  assert.equal(tekstWylaczeniaPamieci({ daneZostaja: true, strona: 'faktura' }),
    `${POCZATEK}${DANE}. Faktury z tej wizyty zostaną na stronie do jej zamknięcia.`);
  for (const daneZostaja of [false, true]) {
    for (const strona of ['ewidencja', 'faktura']) assert.ok(zdania(tekstWylaczeniaPamieci({ daneZostaja, strona })) <= 2);
  }
});

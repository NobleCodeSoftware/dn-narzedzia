// Wspólne pomocniki interfejsu bez zależności od DOM (testowane w node:test).

/** Komunikat dla progu limitu. Informacja ogólna, bez wniosków indywidualnych. */
export function opisProgu(s) {
  if (s.przekroczony) {
    return 'Przychód przekracza limit kwartalny. Przeczytaj poniżej ogólne informacje o skutkach przekroczenia (termin 7 dni na wniosek do CEIDG) i sprawdź je w źródłach.';
  }
  switch (s.prog) {
    case '1.00': return 'Wykorzystano 100% limitu. Każda kolejna sprzedaż w tym kwartale przekroczy limit.';
    case '0.95': return 'Wykorzystano co najmniej 95% limitu.';
    case '0.85': return 'Wykorzystano co najmniej 85% limitu.';
    case '0.70': return 'Wykorzystano co najmniej 70% limitu.';
    default: return 'Poniżej pierwszego progu ostrzeżenia (70%).';
  }
}

export function klasaProgu(s) {
  if (s.przekroczony || s.prog === '1.00' || s.prog === '0.95') return 'status-danger';
  if (s.prog) return 'status-warn';
  return 'status-ok';
}

/** Dostęp do localStorage odporny na tryb prywatny, blokady i brak API. */
export function magazyn(okno = globalThis) {
  const pobierzLs = () => { try { return okno.localStorage || null; } catch { return null; } };
  return {
    czytaj(klucz) { try { const ls = pobierzLs(); return ls ? ls.getItem(klucz) : null; } catch { return null; } },
    zapisz(klucz, wartosc) { try { const ls = pobierzLs(); if (!ls) return false; ls.setItem(klucz, wartosc); return true; } catch { return false; } },
    usun(klucz) { try { const ls = pobierzLs(); if (ls) ls.removeItem(klucz); } catch { /* brak dostępu */ } },
  };
}

/** Nazwa pliku do zapisu: ewidencja-sprzedazy-RRRR-MM-DD.csv albo nazwa otwartego pliku. */
export function nazwaPliku(otwarty, dzis) {
  if (otwarty && /\.csv$/i.test(otwarty)) return otwarty;
  return `ewidencja-sprzedazy-${dzis}.csv`;
}

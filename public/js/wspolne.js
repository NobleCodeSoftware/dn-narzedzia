// Teksty wyniku licznika, bez zależności od DOM (testowane w node:test).
// Informacja ogólna, bez wniosków indywidualnych.

/** Krótki komunikat dla progu limitu (70/85/95/100%). */
export function opisProgu(s) {
  if (s.przekroczony) return 'Limit przekroczony.';
  switch (s.prog) {
    case '1.00': return 'Limit wykorzystany w całości. Każda kolejna sprzedaż w tym kwartale go przekroczy.';
    case '0.95': return 'Uwaga: wykorzystano co najmniej 95% limitu.';
    case '0.85': return 'Uwaga: wykorzystano co najmniej 85% limitu.';
    case '0.70': return 'Wykorzystano co najmniej 70% limitu.';
    default: return 'Mieścisz się w limicie.';
  }
}

export function klasaProgu(s) {
  if (s.przekroczony || s.prog === '1.00') return 'poziom-100';
  if (s.prog === '0.95') return 'poziom-95';
  if (s.prog === '0.85') return 'poziom-85';
  if (s.prog === '0.70') return 'poziom-70';
  return 'poziom-ok';
}

/** „45,2%” — jedno miejsce po przecinku, zapis polski. */
export function procentTekst(procent) {
  return `${procent.toLocaleString('pl-PL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

/** Zdanie z kwotami: ile zostało albo o ile przekroczono limit. */
export function szczegolyWyniku(s, formatujZl, etykietaKwartalu) {
  if (s.przekroczony) {
    return `Przychód jest o ${formatujZl(-s.pozostaloGr)} wyższy niż limit ${formatujZl(s.limitGr)} na ${etykietaKwartalu}.`;
  }
  return `Do limitu ${formatujZl(s.limitGr)} na ${etykietaKwartalu} zostało ${formatujZl(s.pozostaloGr)}.`;
}

// Kontrola przed publikacją (nie w CI): w public/ nie może zostać żaden placeholder {{...}}
// ani znacznik [DO-UZUPEŁNIENIA…] (miejsce w tekście do uzupełnienia). Uruchom: node scripts/sprawdz-publikacje.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const pliki = (k) => readdirSync(k).flatMap((n) => {
  const p = join(k, n);
  return statSync(p).isDirectory() ? pliki(p) : (p.endsWith('.html') ? [p] : []);
});
let braki = 0;
for (const p of pliki(PUBLIC)) {
  const tekst = readFileSync(p, 'utf8');
  const znalezione = [...new Set([...tekst.matchAll(/\{\{[A-Z_]+\}\}|\[DO-UZUPEŁNIENIA[^\]]*\]/g)].map((m) => m[0]))];
  if (znalezione.length) {
    braki += znalezione.length;
    console.log(`${relative(PUBLIC, p)}: ${znalezione.join(', ')}`);
  }
}
if (braki) {
  console.error(`\nBłąd: w public/ zostały niewypełnione znaczniki (${braki}).`);
  process.exit(1);
}
console.log('OK: brak placeholderów.');

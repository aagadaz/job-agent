/**
 * Lecteur CSV minimal mais correct pour nos fichiers d'entreprises :
 * - séparateur détecté sur la 1re ligne : « ; » (Excel français), « , » ou tabulation ;
 * - champs entre guillemets, avec "" pour un guillemet littéral (RFC 4180) ;
 * - BOM UTF-8 et fins de ligne Windows (\r\n) tolérés.
 */
export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, '');
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? '';
  const sep = [';', '\t', ','].sort((a, b) => count(firstLine, b) - count(firstLine, a))[0];

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (quoted) {
      if (c === '"' && clean[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && clean[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.map(r => r.map(f => f.trim())).filter(r => r.some(Boolean));
}

function count(s: string, ch: string): number {
  return s.split(ch).length - 1;
}

export interface CompanyLine { name: string; careersUrl: string }

/** Lignes du fichier → (nom, URL facultative). Ignore l'en-tête et les doublons. */
export function readCompanyLines(text: string): CompanyLine[] {
  const rows = parseCsv(text);
  if (rows.length && /^(nom|name|entreprise|company|société|societe)$/i.test(rows[0][0])) rows.shift();
  const seen = new Set<string>();
  const out: CompanyLine[] = [];
  for (const [name = '', second = ''] of rows) {
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    // 2e colonne prise comme URL seulement si elle en a l'air (sinon : colonne libre, ignorée)
    out.push({ name: name.slice(0, 100), careersUrl: /^(https?:\/\/|[\w-]+\.)/i.test(second) ? second : '' });
  }
  return out;
}

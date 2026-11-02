import { decodeEntities } from './html';

// Lecture minimaliste de flux XML/RSS au format connu et stable (Personio, Teamtailor).
// Pas de dépendance : on extrait des balises précises, on ne cherche pas à valider le XML.

const esc = (tag: string) => tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Contenu brut de chaque occurrence de <tag>…</tag> (balises imbriquées du même nom non gérées). */
export function xmlBlocks(xml: string, tag: string): string[] {
  const re = new RegExp(`<${esc(tag)}(?:\\s[^>]*)?>([\\s\\S]*?)</${esc(tag)}>`, 'g');
  return [...xml.matchAll(re)].map(m => m[1]);
}

/** Texte de la première occurrence de <tag> : CDATA déballé, entités décodées. '' si absente. */
export function xmlText(xml: string, tag: string): string {
  const raw = xmlBlocks(xml, tag)[0];
  if (raw === undefined) return '';
  const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(raw);
  return cdata ? cdata[1] : decodeEntities(raw.trim());
}

import type Anthropic from '@anthropic-ai/sdk';
import { fold } from './text';

// Classement automatique des entreprises par TYPE (secteur) avec Claude.
//
// Principe : on donne à Claude la liste des catégories EXISTANTES (les 4 de base + celles
// déjà utilisées par l'utilisateur) et un lot d'entreprises avec des indices (intitulés de
// postes, domaine du lien de l'annonce). Il doit réutiliser une catégorie existante dès que
// c'est raisonnable, et n'en créer une nouvelle que si aucune ne convient.
//
// La sortie passe par un OUTIL (tool_use) à schéma JSON : pas de texte libre à analyser.
// Puis on la nettoie côté serveur, car un modèle peut toujours renvoyer autre chose que
// ce qu'on attend (casse différente, catégorie inventée trop longue, entreprise inconnue…).

const MODEL = process.env.CLAUDE_MODEL || 'claude-haiku-5-5';
export const MAX_COMPANIES_PER_CALL = 40;
export const MAX_CATEGORY_LENGTH = 40;
const MAX_NEW_PER_CALL = 4; // garde-fou contre l'éparpillement en micro-catégories

export interface CompanyToClassify {
  name: string;
  hints: string[]; // ex. « Data Scientist », « careers.kering.com »
}

const TOOL: Anthropic.Tool = {
  name: 'classify_companies',
  description: 'Enregistre le type (secteur) de chaque entreprise',
  input_schema: {
    type: 'object',
    properties: {
      results: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            company: { type: 'string', description: "Nom de l'entreprise, recopié tel quel" },
            category: { type: 'string', description: 'Catégorie choisie (existante de préférence)' },
            confidence: { type: 'string', enum: ['high', 'low'], description: 'low si tu ne connais pas cette entreprise et devines' },
          },
          required: ['company', 'category', 'confidence'],
        },
      },
    },
    required: ['results'],
  },
};

const SYSTEM = `Tu classes des entreprises par type / secteur d'activité, pour le suivi de candidatures d'un ingénieur data/IA en France.

Règles :
- Utilise une catégorie EXISTANTE dès qu'elle convient raisonnablement, en la recopiant exactement.
- Ne crée une nouvelle catégorie que si aucune existante ne convient. Elle doit être courte (1 à 3 mots), en anglais, dans le même style que les existantes (ex. « Luxury & retail », « Healthcare », « Public sector »), et assez large pour regrouper d'autres entreprises. Pas de quasi-doublon d'une catégorie existante.
- Crée au plus ${MAX_NEW_PER_CALL} nouvelles catégories pour tout le lot.
- Classe selon l'activité principale de l'entreprise, pas selon le poste : une banque qui recrute un data scientist reste « Financial services » ; une ESN / un cabinet de conseil reste « Consulting ».
- Si tu ne connais pas l'entreprise, déduis le secteur des indices fournis et mets confidence = low.
- Réponds pour CHAQUE entreprise, en recopiant son nom exactement.`;

/** Rapproche une étiquette d'une catégorie existante (casse et accents ignorés). */
export function matchCategory(label: string, categories: readonly string[]): string | null {
  const k = fold(label).replace(/[^a-z0-9]+/g, ' ').trim();
  return categories.find(c => fold(c).replace(/[^a-z0-9]+/g, ' ').trim() === k) ?? null;
}

/** Nettoie une catégorie proposée : espaces, longueur, première lettre en majuscule. */
export function cleanCategory(raw: string): string {
  const s = raw.replace(/\s+/g, ' ').trim().slice(0, MAX_CATEGORY_LENGTH);
  return s ? s[0].toUpperCase() + s.slice(1) : '';
}

/**
 * Classe un lot d'entreprises. Renvoie un dictionnaire nom → catégorie (seules les entreprises
 * du lot, avec une catégorie non vide). Lève une erreur si l'API échoue (à gérer par l'appelant).
 */
export async function classifyCompanies(
  client: Anthropic,
  companies: CompanyToClassify[],
  categories: readonly string[],
): Promise<Map<string, string>> {
  const batch = companies.slice(0, MAX_COMPANIES_PER_CALL);
  if (batch.length === 0) return new Map();

  // Les noms viennent de l'utilisateur ou de pages web : on les encadre et on les tronque,
  // pour qu'un nom piégé (« ignore les règles… ») reste une donnée et pas une consigne.
  const list = batch
    .map(c => `- ${c.name.slice(0, 120)}${c.hints.length ? ` (indices : ${c.hints.map(h => h.slice(0, 80)).slice(0, 4).join(' ; ')})` : ''}`)
    .join('\n');

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: SYSTEM,
    tools: [TOOL],
    tool_choice: { type: 'tool', name: TOOL.name },
    messages: [{
      role: 'user',
      content: `<categories_existantes>\n${categories.map(c => `- ${c}`).join('\n')}\n</categories_existantes>\n\n<entreprises>\n${list}\n</entreprises>`,
    }],
  });

  const toolUse = message.content.find(b => b.type === 'tool_use');
  const results = (toolUse?.input as { results?: { company?: unknown; category?: unknown }[] } | undefined)?.results ?? [];

  // Validation de la sortie : entreprise du lot uniquement, catégorie rapprochée des existantes,
  // et pas plus de MAX_NEW_PER_CALL créations (les suivantes sont ignorées → resteront « — »).
  const names = new Map(batch.map(c => [fold(c.name).trim(), c.name]));
  const known = [...categories];
  const out = new Map<string, string>();
  let created = 0;
  for (const r of results) {
    if (typeof r.company !== 'string' || typeof r.category !== 'string') continue;
    const name = names.get(fold(r.company).trim());
    if (!name) continue;
    let category = matchCategory(r.category, known);
    if (!category) {
      const fresh = cleanCategory(r.category);
      if (!fresh || created >= MAX_NEW_PER_CALL) continue;
      known.push(fresh);
      created++;
      category = fresh;
    }
    out.set(name, category);
  }
  return out;
}

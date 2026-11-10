import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';

const MODEL = process.env.CLAUDE_MODEL || 'claude-haiku-5-5';

/**
 * Extrait le texte d'un PDF déjà en mémoire (upload depuis l'interface).
 * unpdf = pdf.js empaqueté pour le serverless (pas de worker, pas de module natif).
 * Import DYNAMIQUE : la bibliothèque n'est chargée qu'au moment d'extraire un PDF.
 * Si elle posait problème, seul l'upload de CV échouerait, pas toutes les pages.
 */
export async function extractPdfText(data: Buffer | Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(data)); // copie : pdf.js "détache" le buffer reçu
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

/** Extrait le texte d'un PDF sur disque (outils en ligne de commande). */
export async function extractCVText(cvPath: string): Promise<string> {
  return extractPdfText(fs.readFileSync(cvPath));
}

/**
 * Déduit 3 à 5 mots-clés de recherche du CV.
 * Le client Anthropic est INJECTÉ : chaque utilisateur appelle Claude avec sa propre clé.
 */
export async function deriveKeywords(client: Anthropic, cvText: string): Promise<string[]> {
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 512,
    tools: [
      {
        name: 'search_keywords',
        description: "Mots-clés de recherche d'emploi déduits du CV",
        input_schema: {
          type: 'object',
          properties: {
            keywords: {
              type: 'array',
              items: { type: 'string' },
              description: '3 à 5 intitulés de poste pertinents',
            },
          },
          required: ['keywords'],
        },
      },
    ],
    tool_choice: { type: 'tool', name: 'search_keywords' },
    messages: [
      {
        role: 'user',
        content: `Tu es un expert RH. Déduis de ce CV les intitulés de poste à rechercher.\n\n<cv>\n${cvText}\n</cv>`,
      },
    ],
  });

  const toolUse = message.content.find(block => block.type === 'tool_use');
  const keywords = (toolUse?.input as { keywords?: unknown } | undefined)?.keywords;
  const list = Array.isArray(keywords) ? keywords.filter((k): k is string => typeof k === 'string' && k.trim() !== '').slice(0, 5) : [];
  // Pas de mots-clés « par défaut » : la plateforme sert à tous les métiers, des valeurs
  // inventées ramèneraient des offres hors sujet. Mieux vaut une erreur claire.
  if (list.length === 0) throw new Error('Mots-clés non déduits du CV : indique-les dans Profil');
  return list;
}
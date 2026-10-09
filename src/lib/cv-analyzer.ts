import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import { PDFParse } from 'pdf-parse';

const MODEL = process.env.CLAUDE_MODEL ?? 'claude-haiku-4-5-20251001';
const DEFAULT_KEYWORDS = ['data scientist', 'machine learning engineer', 'AI engineer'];

export async function extractCVText(cvPath: string): Promise<string> {
  const parser = new PDFParse({ data: fs.readFileSync(cvPath) });
  try {
    const result = await parser.getText();
    return result.text;
  } finally {
    await parser.destroy();
  }
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
  if (!Array.isArray(keywords) || keywords.length === 0) {
    console.warn('⚠️ Mots-clés non déduits du CV, valeurs par défaut utilisées');
    return DEFAULT_KEYWORDS;
  }
  return keywords.filter((k): k is string => typeof k === 'string').slice(0, 5);
}
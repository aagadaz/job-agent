import Anthropic from '@anthropic-ai/sdk'
import fs from 'fs';
import {PDFParse} from 'pdf-parse';
import * as dotenv from 'dotenv';


dotenv.config();

const client = new Anthropic({
  apiKey : process.env.ANTHROPIC_API_KEY,

});

const MODEL = process.env.CLAUDE_MODEL ??
'claude-haiku-4-5-20251001';

export interface SearchParams {
  keywords: string[];
  location : string;
  niveauxExperience: string;
}

export interface CVAnalysis {
  cvText : string ;
  params : SearchParams;
}

const DEFAULT_PARAMS : SearchParams = {
  keywords : [' data scientist', 'machine learning', 'AI Engineer'],
  location : 'France',
  niveauxExperience : '101881',
};

export async function extractCVText(cvPath:string): Promise <string> {
  const parser = new PDFParse({data : fs.readFileSync(cvPath)});
  try{ 
    const result = await parser.getText();
    return result.text;

  } finally{
    await parser.destroy();

  }
}

export async function analyzeCV(cvPath: string): Promise<CVAnalysis> {
  const cvText = await extractCVText(cvPath);
  console.log('📄 CV extrait, envoi à Claude...');

  // "Tool use forcé" : on décrit la forme attendue avec un JSON Schema et on
  // oblige Claude à appeler cet outil. On reçoit alors un objet déjà parsé.
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    tools: [
      {
        name: 'search_params',
        description: "Paramètres de recherche d'emploi déduits du CV",
        input_schema: {
          type: 'object',
          properties: {
            keywords: {
              type: 'array',
              items: { type: 'string' },
              description: '3 à 5 intitulés de poste ou mots-clés pertinents',
            },
            location: { type: 'string', description: 'Ville cible (Paris par défaut)' },
            niveauxExperience: {
              type: 'string',
              enum: ['101881', '20043'],
              description: '"101881" si moins de 2 ans d\'expérience, sinon "20043"',
            },
          },
          required: ['keywords', 'location', 'niveauxExperience'],
        },
      },
    ],
    tool_choice: { type: 'tool', name: 'search_params' },
    messages: [
      {
        role: 'user',
        content: `Tu es un expert RH. Analyse ce CV et génère des paramètres de recherche d'emploi optimaux pour l'APEC.\n\n<cv>\n${cvText}\n</cv>`,
      },
    ],
  });

  const toolUse = message.content.find(block => block.type === 'tool_use');
  if (!toolUse) {
    console.error("⚠️ Claude n'a pas renvoyé de paramètres, valeurs par défaut utilisées");
    return { cvText, params: DEFAULT_PARAMS };
  }

  const params = toolUse.input as SearchParams;
  console.log('✅ Paramètres générés par Claude :', params);
  return { cvText, params };
}
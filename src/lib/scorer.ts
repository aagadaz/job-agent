import Anthropic from '@anthropic-ai/sdk';
import * as dotenv from 'dotenv';
import type { JobDetail, OfferScore, ScoredOffer } from './types';

dotenv.config();

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.CLAUDE_MODEL ?? 'claude-haiku-4-5-20251001';
const CONCURRENCY = 3;              // appels Claude en parallèle (reste sous les rate limits)
const MAX_OFFER_CHARS = 6_000;      // borne le coût : les descriptions APEC peuvent être très longues

// Grille de notation explicite : sans elle, un LLM note "au feeling" et les
// scores ne sont pas comparables d'une offre à l'autre.
const SYSTEM_PROMPT = `Tu es un recruteur tech senior. Tu évalues l'adéquation entre le CV d'un candidat et une offre d'emploi.

Grille de notation (score 0-100) :
- 40 pts : compétences techniques exigées présentes dans le CV (langages, frameworks, ML/LLM, data, cloud)
- 25 pts : niveau d'expérience compatible (le candidat est junior, < 2 ans hors stages/alternance)
- 20 pts : domaine et missions proches des expériences du candidat
- 15 pts : conditions (CDI, localisation, éléments rédhibitoires éventuels)

Sois strict et factuel : ne crédite une compétence que si elle apparaît explicitement dans le CV.
Une offre exigeant 5+ ans d'expérience ne peut pas dépasser 45.`;

const SCORE_TOOL: Anthropic.Tool = {
  name: 'score_offer',
  description: "Enregistre l'évaluation de l'offre par rapport au CV",
  input_schema: {
    type: 'object',
    properties: {
      score: { type: 'integer', minimum: 0, maximum: 100, description: 'Score selon la grille' },
      justification: { type: 'string', description: '1 à 2 phrases expliquant le score' },
      strengths: {
        type: 'array', items: { type: 'string' }, maxItems: 4,
        description: "Éléments du CV qui correspondent à l'offre",
      },
      missingSkills: {
        type: 'array', items: { type: 'string' }, maxItems: 4,
        description: "Exigences de l'offre absentes du CV",
      },
    },
    required: ['score', 'justification', 'strengths', 'missingSkills'],
  },
};

/** Le verdict est DÉRIVÉ du score par du code, pas demandé au LLM : une seule source de vérité. */
function verdictFromScore(score: number): OfferScore['verdict'] {
  if (score >= 70) return 'Postuler';
  if (score >= 50) return 'À étudier';
  return 'Ignorer';
}

function formatOffer(offer: JobDetail): string {
  const text = [
    `Intitulé : ${offer.title}`,
    `Entreprise : ${offer.company}`,
    `Lieu : ${offer.location}`,
    `Contrat : ${offer.employmentType}`,
    `Salaire : ${offer.salary}`,
    `Description :\n${offer.description}`,
    `Profil recherché :\n${offer.qualifications}`,
  ].join('\n');
  return text.slice(0, MAX_OFFER_CHARS);
}

export async function scoreOffer(cvText: string, offer: JobDetail): Promise<OfferScore | null> {
  try {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools: [SCORE_TOOL],
      tool_choice: { type: 'tool', name: 'score_offer' },
      messages: [
        {
          role: 'user',
          content: `<cv>\n${cvText}\n</cv>\n\n<offre>\n${formatOffer(offer)}\n</offre>`,
        },
      ],
    });

    const toolUse = message.content.find(b => b.type === 'tool_use');
    if (!toolUse) return null;

    const raw = toolUse.input as Omit<OfferScore, 'verdict'>;
    // Garde-fou : on ne fait jamais confiance aveuglément à une sortie de modèle.
    const score = Math.max(0, Math.min(100, Math.round(Number(raw.score) || 0)));
    return {
      score,
      verdict: verdictFromScore(score),
      justification: raw.justification ?? '',
      strengths: Array.isArray(raw.strengths) ? raw.strengths : [],
      missingSkills: Array.isArray(raw.missingSkills) ? raw.missingSkills : [],
    };
  } catch (err) {
    console.error(`⚠️ Scoring échoué pour "${offer.title}" :`, (err as Error).message);
    return null; // l'offre sera quand même enregistrée, marquée "Non noté"
  }
}

/** Note toutes les offres avec au plus CONCURRENCY appels simultanés. */
export async function scoreOffers(cvText: string, offers: JobDetail[]): Promise<ScoredOffer[]> {
  const results: ScoredOffer[] = new Array(offers.length);
  let next = 0;

  async function worker() {
    while (next < offers.length) {
      const i = next++; // JS est mono-thread : pas de race condition sur cet incrément
      const scoring = await scoreOffer(cvText, offers[i]);
      results[i] = { ...offers[i], scoring };
      const label = scoring ? `${scoring.score}/100 (${scoring.verdict})` : 'non noté';
      console.log(`  🎯 [${i + 1}/${offers.length}] ${offers[i].title} — ${label}`);
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, offers.length) }, worker));
  // Les meilleures offres en premier dans le Sheet
  return results.sort((a, b) => (b.scoring?.score ?? -1) - (a.scoring?.score ?? -1));
}
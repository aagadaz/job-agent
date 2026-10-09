import Anthropic from '@anthropic-ai/sdk';
import type { JobDetail, OfferScore, ScoredOffer } from './types';

const MODEL = process.env.CLAUDE_MODEL ?? 'claude-haiku-4-5-20251001';
const CONCURRENCY = 3;
const MAX_OFFER_CHARS = 6_000;

const SYSTEM_PROMPT = `Tu es un recruteur tech senior. Tu évalues l'adéquation entre le CV d'un candidat et une offre d'emploi.

Grille de notation (score 0-100) :
- 40 pts : compétences techniques exigées présentes dans le CV (langages, frameworks, ML/LLM, data, cloud)
- 25 pts : niveau d'expérience compatible avec celui du candidat
- 20 pts : domaine et missions proches des expériences du candidat
- 15 pts : conditions (CDI, localisation, éléments rédhibitoires éventuels)

Sois strict et factuel : ne crédite une compétence que si elle apparaît explicitement dans le CV.
Une offre exigeant beaucoup plus d'expérience que le candidat n'en a ne peut pas dépasser 45.`;

const SCORE_TOOL: Anthropic.Tool = {
  name: 'score_offer',
  description: "Enregistre l'évaluation de l'offre par rapport au CV",
  input_schema: {
    type: 'object',
    properties: {
      score: { type: 'integer', minimum: 0, maximum: 100, description: 'Score selon la grille' },
      justification: { type: 'string', description: '1 à 2 phrases expliquant le score' },
      strengths: { type: 'array', items: { type: 'string' }, maxItems: 4, description: "Éléments du CV qui correspondent à l'offre" },
      missingSkills: { type: 'array', items: { type: 'string' }, maxItems: 4, description: "Exigences de l'offre absentes du CV" },
    },
    required: ['score', 'justification', 'strengths', 'missingSkills'],
  },
};

function verdictFromScore(score: number): OfferScore['verdict'] {
  if (score >= 70) return 'Postuler';
  if (score >= 50) return 'À étudier';
  return 'Ignorer';
}

function formatOffer(offer: JobDetail): string {
  return [
    `Intitulé : ${offer.title}`,
    `Entreprise : ${offer.company}`,
    `Lieu : ${offer.location}`,
    `Contrat : ${offer.employmentType}`,
    `Salaire : ${offer.salary}`,
    `Description :\n${offer.description}`,
    `Profil recherché :\n${offer.qualifications}`,
  ].join('\n').slice(0, MAX_OFFER_CHARS);
}

export async function scoreOffer(client: Anthropic, cvText: string, offer: JobDetail): Promise<OfferScore | null> {
  try {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools: [SCORE_TOOL],
      tool_choice: { type: 'tool', name: 'score_offer' },
      messages: [{ role: 'user', content: `<cv>\n${cvText}\n</cv>\n\n<offre>\n${formatOffer(offer)}\n</offre>` }],
    });

    const toolUse = message.content.find(b => b.type === 'tool_use');
    if (!toolUse) return null;

    const raw = toolUse.input as Omit<OfferScore, 'verdict'>;
    const score = Math.max(0, Math.min(100, Math.round(Number(raw.score) || 0)));
    return {
      score,
      verdict: verdictFromScore(score),
      justification: raw.justification ?? '',
      strengths: Array.isArray(raw.strengths) ? raw.strengths : [],
      missingSkills: Array.isArray(raw.missingSkills) ? raw.missingSkills : [],
    };
  } catch (err) {
    console.error(`  ⚠️ Scoring échoué pour "${offer.title}" :`, (err as Error).message);
    return null;
  }
}

export async function scoreOffers(client: Anthropic, cvText: string, offers: JobDetail[]): Promise<ScoredOffer[]> {
  const results: ScoredOffer[] = new Array(offers.length);
  let next = 0;

  async function worker() {
    while (next < offers.length) {
      const i = next++;
      const scoring = await scoreOffer(client, cvText, offers[i]);
      results[i] = { ...offers[i], scoring };
      const label = scoring ? `${scoring.score}/100 (${scoring.verdict})` : 'non noté';
      console.log(`  🎯 [${i + 1}/${offers.length}] ${offers[i].title} — ${label}`);
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, offers.length) }, worker));
  return results;
}
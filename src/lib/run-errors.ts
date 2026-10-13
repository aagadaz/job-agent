// Traduit l'erreur TECHNIQUE d'une recherche (enregistrée telle quelle en base, pour le
// diagnostic) en message pour l'UTILISATEUR : ce qui s'est passé, et quoi faire.
// Module pur, sans dépendance : testable et utilisable partout.

const RULES: { test: RegExp; message: string }[] = [
  { test: /profil incomplet/i, message: 'Ton profil est incomplet : ajoute au moins un mot-clé dans Profil (ou ton CV et une clé Claude).' },
  { test: /authentication_error|invalid x-api-key|\b401\b/i, message: 'Ta clé Claude a été refusée. Vérifie-la ou remplace-la dans Profil.' },
  { test: /credit balance|billing|\b402\b/i, message: 'Ton crédit Claude est épuisé : recharge-le sur console.anthropic.com, puis relance la recherche.' },
  { test: /unsupported state|authenticate data|decrypt/i, message: 'Ta clé Claude enregistrée est illisible : ressaisis-la dans Profil.' },
  { test: /rate.?limit|overloaded|\b429\b|\b529\b/i, message: 'Le service de notation est surchargé. Réessaie dans quelques minutes.' },
  { test: /lancement manuel impossible/i, message: "La recherche n'a pas pu être lancée. Réessaie dans quelques minutes." },
  { test: /interrompue|introuvable|worker github|sans enregistrer/i, message: "La recherche s'est interrompue avant la fin. Tu peux la relancer." },
  { test: /database_url|eai_again|enotfound|econnrefused|etimedout|econnreset|connection terminated|timeout/i, message: 'Problème technique temporaire de notre côté. Réessaie un peu plus tard.' },
];

const FALLBACK = "Une erreur inattendue a interrompu la recherche. Tu peux la relancer ; si ça se reproduit, préviens l'administrateur.";

export function describeRunError(technical: string | null | undefined): string {
  if (!technical) return FALLBACK;
  return RULES.find(r => r.test.test(technical))?.message ?? FALLBACK;
}

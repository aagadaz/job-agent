// Traduit l'erreur TECHNIQUE d'une recherche ou d'une réanalyse (enregistrée telle quelle en
// base, pour le diagnostic) en message pour l'UTILISATEUR : ce qui s'est passé, et quoi faire.
// Module pur, sans dépendance : testable et utilisable partout.
//
// Chaque règle reconnaît DEUX formulations : celle de l'API (anglais : « credit balance »,
// « authentication_error »…) et celle que la plateforme écrit elle-même en français quand elle
// arrête une notation (src/lib/scorer.ts, src/rescore.ts). Oublier la seconde affichait le
// message générique au lieu de dire, par exemple, que le crédit Claude était épuisé.

const RULES: { test: RegExp; message: string }[] = [
  { test: /mots-clés non déduits/i, message: "Claude n'a pas pu déduire de mots-clés de ton CV : indique-les dans Profil." },
  { test: /profil incomplet/i, message: 'Ton profil est incomplet : ajoute au moins un mot-clé dans Profil (ou ton CV et une clé Claude).' },
  { test: /il faut une clé claude et un cv/i, message: 'Il faut une clé Claude et un CV de notation (Profil) pour analyser tes offres.' },
  { test: /authentication_error|invalid x-api-key|\b401\b|clé claude refusée/i, message: 'Ta clé Claude a été refusée. Vérifie-la ou remplace-la dans Profil.' },
  { test: /permission_error|\b403\b|sans droit d'accès/i, message: "Ta clé Claude n'a pas accès au modèle utilisé. Vérifie les droits de ta clé sur console.anthropic.com." },
  { test: /credit balance|billing|\b402\b|crédit claude épuisé/i, message: 'Ton crédit Claude est épuisé : recharge-le sur console.anthropic.com (Plans & Billing), puis relance.' },
  { test: /unsupported state|authenticate data|decrypt/i, message: 'Ta clé Claude enregistrée est illisible : ressaisis-la dans Profil.' },
  { test: /rate.?limit|overloaded|\b429\b|\b529\b/i, message: 'Le service de notation est surchargé. Réessaie dans quelques minutes.' },
  { test: /lancement manuel impossible|réanalyse impossible/i, message: "Le traitement n'a pas pu être lancé. Réessaie dans quelques minutes." },
  { test: /interrompue|introuvable|worker github|sans enregistrer/i, message: "Le traitement s'est interrompu avant la fin. Tu peux le relancer." },
  { test: /database_url|eai_again|enotfound|econnrefused|etimedout|econnreset|connection terminated|timeout/i, message: 'Problème technique temporaire de notre côté. Réessaie un peu plus tard.' },
];

const FALLBACK = "Une erreur inattendue a interrompu le traitement. Tu peux le relancer ; si ça se reproduit, préviens l'administrateur.";

export function describeRunError(technical: string | null | undefined): string {
  if (!technical) return FALLBACK;
  return RULES.find(r => r.test.test(technical))?.message ?? FALLBACK;
}

/**
 * URL publique de l'application, pour les liens envoyés par e-mail.
 * JAMAIS déduite de l'en-tête Host de la requête : un attaquant pourrait la forger
 * (« Host header injection ») et faire envoyer à sa victime un lien vers SON site,
 * qui lui transmettrait le jeton de connexion. Source fixe uniquement :
 * APP_URL, sinon l'URL de production que Vercel fournit, sinon le développement local.
 */
export function appUrl(): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, '');
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return 'http://localhost:3000';
}

import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';

// Authentification "compte de service" Google, sans bibliothèque : on signe nous-mêmes
// un JWT avec la clé privée, puis on l'échange contre un jeton d'accès d'une heure.
// (Protocole OAuth 2.0 "JWT Bearer", RFC 7523.)

interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

let cachedAccount: ServiceAccount | null = null;

/** Lit les identifiants : variable GOOGLE_CREDENTIALS_JSON (Vercel, CI) ou fichier (local). */
export function getServiceAccount(): ServiceAccount {
  if (cachedAccount) return cachedAccount;
  const inline = process.env.GOOGLE_CREDENTIALS_JSON;
  const path = process.env.GOOGLE_CREDENTIALS_PATH;
  const raw = inline || (path ? readFileSync(path, 'utf8') : null);
  if (!raw) throw new Error('GOOGLE_CREDENTIALS_JSON ou GOOGLE_CREDENTIALS_PATH manquant');
  const parsed = JSON.parse(raw) as ServiceAccount;
  if (!parsed.client_email || !parsed.private_key) throw new Error('Identifiants Google invalides');
  cachedAccount = parsed;
  return parsed;
}

/** Email du compte de service : c'est à lui que chaque utilisateur partage son Sheet. */
export function serviceAccountEmail(): string | null {
  try {
    return getServiceAccount().client_email;
  } catch {
    return null;
  }
}

const b64url = (data: string | Buffer) => Buffer.from(data).toString('base64url');

/** Construit et signe (RS256) le JWT qui prouve à Google que nous détenons la clé privée. */
export function signServiceJwt(account: ServiceAccount, scope: string, nowSec = Math.floor(Date.now() / 1000)): string {
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: account.client_email,                                     // qui demande
    scope,                                                         // quels droits
    aud: account.token_uri ?? 'https://oauth2.googleapis.com/token', // pour quel serveur
    iat: nowSec,                                                   // émis à
    exp: nowSec + 3600,                                            // expire dans 1 h (maximum autorisé)
  };
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(account.private_key);
  return `${unsigned}.${b64url(signature)}`;
}

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

/** Jeton d'accès pour `scope`, mis en cache jusqu'à 1 minute avant son expiration. */
export async function getAccessToken(scope: string): Promise<string> {
  const hit = tokenCache.get(scope);
  if (hit && hit.expiresAt - 60_000 > Date.now()) return hit.token;

  const account = getServiceAccount();
  const res = await fetch(account.token_uri ?? 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: signServiceJwt(account, scope),
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Authentification Google refusée (HTTP ${res.status})`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache.set(scope, { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 });
  return data.access_token;
}

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// Chiffrement symétrique authentifié AES-256-GCM.
// Format stocké en base : "v1:<iv>:<tag>:<texte chiffré>", chaque partie en base64.
const VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits : la taille recommandée pour GCM

function getMasterKey(): Buffer {
  const b64 = process.env.ENCRYPTION_KEY;
  if (!b64) throw new Error('ENCRYPTION_KEY doit être défini (32 octets en base64)');
  const key = Buffer.from(b64, 'base64');
  if (key.length !== 32) throw new Error(`ENCRYPTION_KEY doit faire 32 octets, reçu ${key.length}`);
  return key;
}

export function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH); // un IV neuf à CHAQUE chiffrement
  const cipher = createCipheriv(ALGORITHM, getMasterKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag(); // empreinte d'intégrité : toute altération sera détectée
  return [VERSION, iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join(':');
}

export function decrypt(payload: string): string {
  const [version, iv, tag, ciphertext] = payload.split(':');
  if (version !== VERSION || !iv || !tag || !ciphertext) {
    throw new Error('Format de donnée chiffrée invalide');
  }
  const decipher = createDecipheriv(ALGORITHM, getMasterKey(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  // final() lève une exception si le tag ne correspond pas (donnée modifiée ou mauvaise clé)
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]).toString('utf8');
}

/** Version affichable d'une clé API : "sk-ant-…a3F9". */
export function maskSecret(secret: string): string {
  return secret.length <= 12 ? '••••' : `${secret.slice(0, 7)}…${secret.slice(-4)}`;
}
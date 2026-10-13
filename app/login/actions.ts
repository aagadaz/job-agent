'use server';

import { redirect } from 'next/navigation';
import { AuthError } from 'next-auth';
import { z } from 'zod';
import { signIn } from '@/auth';
import { createLoginToken } from '@/db/login-tokens';
import { appUrl } from '@/lib/app-url';
import { isMailConfigured, sendMail } from '@/lib/mailer';

export interface MagicLinkResult { ok: boolean; message: string }

// Réponse IDENTIQUE que l'adresse ait un compte ou non : on ne révèle pas qui est inscrit.
const SENT = 'Si l’adresse est valide, un lien de connexion vient d’y être envoyé (pense à vérifier les spams). Il est valable 15 minutes.';

export async function requestMagicLink(_prev: MagicLinkResult | null, form: FormData): Promise<MagicLinkResult> {
  const parsed = z.email().max(254).safeParse(String(form.get('email') ?? '').trim().toLowerCase());
  if (!parsed.success) return { ok: false, message: 'Adresse e-mail invalide.' };
  if (!isMailConfigured()) return { ok: false, message: 'La connexion par e-mail n’est pas encore disponible. Utilise Google.' };

  const email = parsed.data;
  const token = await createLoginToken(email);
  if (!token) return { ok: true, message: SENT }; // limite atteinte : même message, pas d'envoi

  const url = `${appUrl()}/login/verify?token=${token}`;
  try {
    await sendMail(
      email,
      'Ton lien de connexion à Job Agent',
      `Bonjour,\n\nClique sur ce lien pour te connecter à Job Agent (valable 15 minutes, utilisable une seule fois) :\n${url}\n\nSi tu n'es pas à l'origine de cette demande, ignore simplement cet e-mail.`,
      `<p>Bonjour,</p><p><a href="${url}">Se connecter à Job Agent</a></p><p>Ce lien est valable 15 minutes et ne fonctionne qu’une fois.</p><p style="color:#666">Si tu n’es pas à l’origine de cette demande, ignore simplement cet e-mail.</p>`,
    );
  } catch (err) {
    console.error('[magic-link] envoi impossible :', err instanceof Error ? err.message : err);
    return { ok: false, message: 'L’e-mail n’a pas pu être envoyé. Réessaie dans quelques minutes ou utilise Google.' };
  }
  return { ok: true, message: SENT };
}

/** Appelée par le bouton de /login/verify (POST) : consomme le jeton et ouvre la session. */
export async function confirmMagicLink(form: FormData): Promise<void> {
  try {
    await signIn('magic-link', { token: String(form.get('token') ?? ''), redirectTo: '/offers' });
  } catch (err) {
    // En cas de succès, signIn LÈVE une exception de redirection Next.js : il faut la relancer.
    if (err instanceof AuthError) redirect('/login?error=link');
    throw err;
  }
}

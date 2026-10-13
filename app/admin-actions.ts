'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { deleteUserAccount } from '@/db/admin';
import { SettingsSchema, saveSettings } from '@/db/settings';
import { requireAdmin } from '@/lib/session';

// Actions d'administration : CHACUNE revérifie le rôle admin. La page /admin a beau être
// protégée, une server action est un endpoint public qu'on peut appeler sans passer par elle.

export interface AdminResult { ok: boolean; message: string }

export async function updateSettings(_prev: AdminResult | null, form: FormData): Promise<AdminResult> {
  await requireAdmin();
  const parsed = SettingsSchema.safeParse({
    signupOpen: form.get('signupOpen') === 'on', // case à cocher : présente = cochée
    maxUsers: Number(form.get('maxUsers')),
    maxScoredPerRun: Number(form.get('maxScoredPerRun')),
    maxUnscoredPerRun: Number(form.get('maxUnscoredPerRun')),
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, message: `Valeur invalide (${issue.path.join('.')}) : ${issue.message}` };
  }
  await saveSettings(parsed.data);
  revalidatePath('/admin');
  return { ok: true, message: 'Réglages enregistrés : effet immédiat.' };
}

export async function deleteUser(userId: string): Promise<AdminResult> {
  const adminId = await requireAdmin();
  const id = z.string().uuid().parse(userId);
  if (id === adminId) return { ok: false, message: 'Tu ne peux pas supprimer ton propre compte ici.' };
  await deleteUserAccount(id);
  revalidatePath('/admin');
  return { ok: true, message: 'Compte et données supprimés.' };
}

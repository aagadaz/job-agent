import { z } from 'zod';
import { auth } from '@/auth';
import { getCvFile } from '@/db/cvs';

// Téléchargement du PDF d'origine d'un CV. Requête filtrée par l'utilisateur de la SESSION :
// le CV d'un autre donne la même 404 qu'un CV inexistant.
export async function GET(_req: Request, { params }: { params: Promise<{ cvId: string }> }) {
  const userId = (await auth())?.user?.id;
  if (!userId) return new Response('Non connecté', { status: 401 });
  const { cvId } = await params;
  if (!z.string().uuid().safeParse(cvId).success) return new Response('Introuvable', { status: 404 });

  const file = await getCvFile(userId, cvId);
  if (!file) return new Response('Introuvable', { status: 404 });
  return new Response(new Uint8Array(file.data), {
    headers: {
      'Content-Type': 'application/pdf',
      // inline : s'ouvre dans l'aperçu PDF du navigateur (Safari sur iPhone) ; nom encodé (accents)
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

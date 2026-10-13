import { redirect } from 'next/navigation';
import { auth, signIn } from '@/auth';
import { MagicLinkForm } from './MagicLinkForm';

const ERRORS: Record<string, string> = {
  full: 'Les inscriptions sont fermées ou complètes pour le moment. Réessaie plus tard.',
  link: 'Ce lien de connexion a expiré ou a déjà été utilisé. Demandes-en un nouveau.',
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if ((await auth())?.user?.id) redirect('/offers');
  const { error } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-xl border bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold">job-agent</h1>
        <p className="mt-1 text-sm text-gray-600">
          Ton agent de recherche d&apos;emploi : il collecte les offres chaque matin et les note selon ton CV.
          Connexion et inscription avec Google ou par lien envoyé par e-mail.
        </p>
        {error && (
          <p className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700">
            {ERRORS[error] ?? 'La connexion a échoué. Réessaie.'}
          </p>
        )}
        <form
          className="mt-6"
          action={async () => {
            'use server';
            await signIn('google', { redirectTo: '/offers' });
          }}
        >
          <button className="w-full rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700">
            Se connecter avec Google
          </button>
        </form>
        <div className="my-5 flex items-center gap-3 text-xs text-gray-400">
          <span className="h-px flex-1 bg-gray-200" />ou<span className="h-px flex-1 bg-gray-200" />
        </div>
        <MagicLinkForm />
        <p className="mt-4 text-center text-xs text-gray-500">
          En te connectant, tu acceptes notre{' '}
          <a href="/confidentialite" className="underline">politique de confidentialité</a>.
        </p>
      </div>
    </main>
  );
}

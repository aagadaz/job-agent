import { redirect } from 'next/navigation';
import { auth, signIn } from '@/auth';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if ((await auth())?.user?.id) redirect('/offers');
  const { error } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-xl border bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold">job-agent</h1>
        <p className="mt-1 text-sm text-gray-600">Accès réservé aux comptes invités.</p>
        {error && (
          <p className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700">
            Connexion refusée : ce compte Google n&apos;est pas sur la liste des invités.
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
      </div>
    </main>
  );
}

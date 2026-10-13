import { redirect } from 'next/navigation';
import { confirmMagicLink } from '../actions';

// Pourquoi une page avec un BOUTON plutôt qu'une connexion directe au clic du lien ?
// Les antivirus de messagerie (Outlook Safe Links, Gmail…) ouvrent les liens des e-mails
// pour les analyser : un simple GET consommerait le jeton avant l'utilisateur. Les robots
// suivent les liens mais ne soumettent pas les formulaires : la connexion se fait en POST.
export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  if (!token) redirect('/login');

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-xl border bg-white p-8 text-center shadow-sm">
        <h1 className="text-xl font-semibold">Connexion à job-agent</h1>
        <p className="mt-2 text-sm text-gray-600">Clique sur le bouton pour terminer ta connexion.</p>
        <form action={confirmMagicLink} className="mt-6">
          <input type="hidden" name="token" value={token} />
          <button className="w-full rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700">
            Se connecter
          </button>
        </form>
      </div>
    </main>
  );
}

import { ApiKeyForm } from '../../components/ApiKeyForm';
import { ProfileForm } from '../../components/ProfileForm';
import { SheetForm } from '../../components/SheetForm';
import { getUserWithProfile } from '@/db/dashboard';
import { decrypt, maskSecret } from '@/lib/crypto';
import { serviceAccountEmail } from '@/lib/google-auth';
import { requireUserId } from '@/lib/session';

export default async function ProfilePage() {
  const userId = await requireUserId();
  const row = await getUserWithProfile(userId);
  const profile = row?.profile;

  // On ne renvoie JAMAIS la clé au navigateur : seulement sa version masquée
  let masked: string | null = null;
  if (row?.user.anthropicKeyEncrypted) {
    try {
      masked = maskSecret(decrypt(row.user.anthropicKeyEncrypted));
    } catch {
      masked = 'illisible (à ressaisir)';
    }
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[2fr_1fr]">
      <section className="rounded-xl border bg-white p-6">
        <h1 className="mb-4 text-lg font-semibold">Profil de recherche</h1>
        <ProfileForm
          initial={{
            keywords: profile?.keywords.join(', ') ?? '',
            location: profile?.location ?? 'Paris',
            includeTerms: profile?.includeTerms.join(', ') ?? 'data, machine learning, ml, ia, ai, llm, nlp, mlops',
            excludeTerms: profile?.excludeTerms.join(', ') ?? 'senior, lead, principal, staff, head of, director',
            rejectThreshold: profile?.rejectThreshold ?? 35,
            cvChars: profile?.cvText?.length ?? 0,
          }}
        />
      </section>
      <section className="h-fit rounded-xl border bg-white p-6">
        <h2 className="mb-1 text-lg font-semibold">Clé API Claude</h2>
        <p className="mb-4 text-sm text-gray-600">Chiffrée avant d&apos;être enregistrée. Les appels de notation sont facturés sur cette clé.</p>
        <ApiKeyForm masked={masked} />
      </section>
      <section className="h-fit rounded-xl border bg-white p-6 lg:col-start-2">
        <h2 className="mb-1 text-lg font-semibold">Google Sheet des candidatures</h2>
        <p className="mb-4 text-sm text-gray-600">
          Quand tu passes une offre en « Postulé », une ligne est ajoutée ; les statuts suivants la mettent à jour.
        </p>
        <SheetForm
          currentUrl={profile?.sheetId ? `https://docs.google.com/spreadsheets/d/${profile.sheetId}` : ''}
          serviceEmail={serviceAccountEmail()}
        />
      </section>
    </div>
  );
}

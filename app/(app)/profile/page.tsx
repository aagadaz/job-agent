import { ApiKeyForm } from '../../components/ApiKeyForm';
import { ProfileForm } from '../../components/ProfileForm';
import { CvLibrary } from '../../components/CvLibrary';
import { MAX_CVS, listCvs } from '@/db/cvs';
import { SheetForm } from '../../components/SheetForm';
import { getUserWithProfile } from '@/db/dashboard';
import { decrypt, maskSecret } from '@/lib/crypto';
import { serviceAccountEmail } from '@/lib/google-auth';
import { requireUserId } from '@/lib/session';

export default async function ProfilePage() {
  const userId = await requireUserId();
  const [row, cvs] = await Promise.all([getUserWithProfile(userId), listCvs(userId)]);
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
    <div className="grid gap-4 sm:gap-8 lg:grid-cols-[2fr_1fr] [&>*]:min-w-0">
      {/* En premier : c'est ce qu'on vient le plus souvent changer ici. id="cv" : cible des liens « ajoute ton CV » */}
      <section id="cv" className="h-fit scroll-mt-20 rounded-xl border bg-white p-4 sm:p-6">
        <h1 className="mb-1 text-lg font-semibold">Mes CV</h1>
        <p className="mb-4 text-sm text-gray-600">
          Garde ici tes différentes versions (français, anglais, par type de poste). Celle marquée « Utilisé pour la
          notation » note les offres ; pour chaque lettre de motivation, tu choisis le CV à utiliser.
        </p>
        <CvLibrary
          max={MAX_CVS}
          cvs={cvs.map(c => ({ ...c, createdAt: c.createdAt.toISOString(), active: !!c.active }))}
        />
      </section>
      <section className="rounded-xl border bg-white p-4 sm:p-6 lg:col-start-1">
        <h2 className="mb-4 text-lg font-semibold">Profil de recherche</h2>
        <ProfileForm
          initial={{
            keywords: profile?.keywords.join(', ') ?? '',
            // Profil antérieur aux zones : on convertit l'ancienne ville en zone France
            areas: profile?.areas.length ? profile.areas : [{ country: 'fr', city: profile?.location ?? 'Paris' }],
            // Valeurs par défaut NEUTRES : la plateforme sert à tous les métiers. Seul le filtre de
            // séniorité a du sens pour tout le monde (et reste modifiable).
            includeTerms: profile?.includeTerms.join(', ') ?? '',
            excludeTerms: profile?.excludeTerms.join(', ') ?? 'senior, lead, principal, staff, head of, director',
            rejectThreshold: profile?.rejectThreshold ?? 35,
            // undefined (pas encore de profil) → défaut 5 ; null (choisi) → pas de limite
            maxExperienceYears: profile === null || profile === undefined ? 5 : profile.maxExperienceYears,
            useAdzuna: profile?.useAdzuna ?? true,
            contractTypes: profile?.contractTypes ?? [],
          }}
        />
      </section>
      <section className="h-fit rounded-xl border bg-white p-4 sm:p-6 lg:col-start-2 lg:row-start-1">
        <h2 className="mb-1 text-lg font-semibold">Clé API Claude</h2>
        <p className="mb-4 text-sm text-gray-600">
          <b>Facultative.</b> Sans clé, tu reçois quand même les offres correspondant à tes mots-clés, mais elles ne
          sont pas notées. Avec une clé (et ton CV), chaque offre est notée et analysée par Claude. Chiffrée avant
          d&apos;être enregistrée ; les appels de notation sont facturés sur cette clé.
        </p>
        <ApiKeyForm masked={masked} />
      </section>
      <section className="h-fit rounded-xl border bg-white p-4 sm:p-6 lg:col-start-2">
        <h2 className="mb-1 text-lg font-semibold">Google Sheet des candidatures</h2>
        <p className="mb-4 text-sm text-gray-600">
          Chaque candidature envoyée y est ajoutée, et chaque changement d’étape (depuis le fil ou l’onglet Candidatures) y est reporté, avec le vocabulaire de ton Sheet.
        </p>
        <SheetForm
          currentUrl={profile?.sheetId ? `https://docs.google.com/spreadsheets/d/${profile.sheetId}/edit${profile.sheetGid !== null ? `#gid=${profile.sheetGid}` : ''}` : ''}
          serviceEmail={serviceAccountEmail()}
        />
      </section>
    </div>
  );
}

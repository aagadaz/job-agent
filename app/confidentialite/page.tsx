import type { Metadata } from 'next';
import Link from 'next/link';

// Page PUBLIQUE (hors du groupe (app) protégé) : Google et les futurs utilisateurs doivent
// pouvoir la lire sans être connectés. Le texte décrit ce que fait RÉELLEMENT l'application :
// à mettre à jour à chaque changement dans les données collectées ou les prestataires.

export const metadata: Metadata = { title: 'Confidentialité · Job Agent' };

const CONTACT = 'afgadazi@gmail.com';
const UPDATED = '13 octobre 2026';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="space-y-2 text-sm leading-relaxed text-gray-700">{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl space-y-8 px-6 py-12">
      <header>
        <h1 className="text-2xl font-semibold">Politique de confidentialité</h1>
        <p className="mt-1 text-sm text-gray-500">Dernière mise à jour : {UPDATED}</p>
      </header>

      <Section title="Qui sommes-nous ?">
        <p>
          Job Agent est un projet personnel et non commercial, édité par Afzal Agadazi, qui aide un petit nombre
          d&apos;utilisateurs à trouver des offres d&apos;emploi correspondant à leur CV. Responsable du traitement
          et contact : <a className="underline" href={`mailto:${CONTACT}`}>{CONTACT}</a>.
        </p>
      </Section>

      <Section title="Quelles données collectons-nous ?">
        <ul className="list-disc space-y-1 pl-5">
          <li><b>Compte</b> : ton adresse e-mail, et ton nom s&apos;il est transmis par Google lors de la connexion. Si tu te connectes par lien e-mail, une empreinte (hachage SHA-256) du lien (jamais le lien lui-même) est conservée 15 minutes au plus.</li>
          <li><b>CV</b> : le <b>texte</b> extrait de ton CV. Le fichier PDF lui-même n&apos;est pas conservé.</li>
          <li><b>Préférences de recherche</b> : mots-clés, zones (pays, villes), filtres, seuil de notation, entreprises suivies.</li>
          <li><b>Clé API Claude</b> : stockée <b>chiffrée</b> (AES-256-GCM) ; elle n&apos;est jamais réaffichée en clair.</li>
          <li><b>Résultats</b> : les offres trouvées, leur note, ton statut de candidature, et l&apos;identifiant de ton Google Sheet si tu en connectes un.</li>
          <li><b>Historique technique</b> : date et résultat de chaque recherche, messages d&apos;erreur.</li>
        </ul>
        <p>Nous ne collectons aucune donnée de navigation, et il n&apos;y a ni publicité ni outil de mesure d&apos;audience.</p>
      </Section>

      <Section title="Pourquoi ?">
        <p>
          Uniquement pour faire fonctionner le service : rechercher des offres chaque jour, les noter au regard de ton
          CV, et te permettre de suivre tes candidatures. Tes données ne sont ni vendues, ni louées, ni utilisées
          à d&apos;autres fins. La base légale est l&apos;exécution du service que tu demandes en créant ton compte.
        </p>
      </Section>

      <Section title="Avec qui sont-elles partagées ?">
        <p>Avec les seuls prestataires techniques nécessaires au service :</p>
        <ul className="list-disc space-y-1 pl-5">
          <li><b>Anthropic</b> (Claude) : le texte de ton CV et les offres sont envoyés à l&apos;API Claude, avec ta propre clé, pour les noter.</li>
          <li><b>Google</b> : connexion (Google Sign-In), envoi des e-mails de connexion (Gmail) et, si tu l&apos;actives, écriture dans ton Google Sheet.</li>
          <li><b>Vercel</b> (hébergement du site), <b>Neon</b> (base de données), <b>GitHub</b> (exécution des recherches quotidiennes).</li>
          <li><b>Sources d&apos;offres</b> (Adzuna, pages carrières des entreprises) : elles ne reçoivent que des mots-clés de recherche, jamais ton identité ni ton CV.</li>
        </ul>
        <p>
          Certains de ces prestataires sont situés hors de l&apos;Union européenne (notamment aux États-Unis) ; les
          transferts s&apos;appuient sur leurs garanties contractuelles (clauses contractuelles types).
        </p>
      </Section>

      <Section title="Combien de temps ?">
        <p>
          Tes données sont conservées tant que ton compte existe. À la suppression du compte, toutes tes données
          (profil, CV, clé, entreprises, offres, historique des recherches) sont effacées de la base. Les journaux
          d&apos;exécution des recherches, conservés chez GitHub, sont supprimés automatiquement au bout de 90 jours au plus.
        </p>
      </Section>

      <Section title="Sécurité">
        <p>
          Connexion chiffrée (HTTPS), clés API chiffrées en base, accès réservé : chaque utilisateur ne voit que ses
          propres données. L&apos;administrateur du service peut techniquement accéder aux données pour assurer son
          fonctionnement, mais jamais à ta clé API en clair depuis l&apos;interface.
        </p>
      </Section>

      <Section title="Tes droits">
        <p>
          Conformément au RGPD, tu peux demander l&apos;accès à tes données, leur rectification, leur suppression
          (suppression du compte), leur portabilité, ou t&apos;opposer à leur traitement, en écrivant à{' '}
          <a className="underline" href={`mailto:${CONTACT}`}>{CONTACT}</a>. Réponse sous un mois au plus. Tu peux
          aussi introduire une réclamation auprès de la CNIL (cnil.fr).
        </p>
      </Section>

      <Section title="Cookies">
        <p>
          Un seul cookie, strictement nécessaire : celui de ta session de connexion. Aucun cookie publicitaire ou de
          suivi ; aucun bandeau de consentement n&apos;est donc requis.
        </p>
      </Section>

      <p className="text-sm"><Link href="/login" className="underline">← Retour à la connexion</Link></p>
    </main>
  );
}

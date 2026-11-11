import type { NextConfig } from 'next';

// unpdf s'intègre au bundle, et `pg` fait déjà partie de la liste des paquets que Next laisse
// externes par défaut.
const nextConfig: NextConfig = {
  experimental: {
    // Envoi des CV en PDF par server action : 1 Mo par défaut, trop peu pour un CV avec photo.
    // Vercel refuse de toute façon les requêtes de plus de 4,5 Mo : les PDF sont plafonnés
    // à 4 Mo côté serveur (MAX_CV_BYTES), cette limite laisse la marge du formulaire.
    serverActions: { bodySizeLimit: '4.5mb' },
  },
};

export default nextConfig;

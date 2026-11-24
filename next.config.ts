import type { NextConfig } from 'next';
//unpdf s'intègre au bundle et 'pg' fait déjà partie de la liste des paquets que Next laisse 
// externes par défaut 

const nextConfig: NextConfig = {
  // Image Docker : serveur Node autonome (" standalone"). Activé seulement  quand le
  // Dockerfile définit NEXT_OUTPUT = standalone : le déploiement Vercel n'est pas modifié.
  ...(process.env.NEXT_OUTPUT === 'standalone' ? {output: 'standalone' as const }: {}),
  experimental: {
    // Envoi des CV en PDF par server action : 1Mo par défaut, trop peu pour un CV avec photo.
    // Vercel refuse de toute façon les requêtes de plus de 4,5Mo : les PDF sont plafonnés
    // à 4 Mo côté serveur (MAX_CV_BYTES), cette limite laisse la marge du formulaire.
    serverActions: { bodySizeLimit: '4.5mb'},
  },

};

export default nextConfig;
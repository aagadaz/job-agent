import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Paquets Node à ne pas embarquer dans le bundle serveur (binaires, workers, fichiers annexes)
  serverExternalPackages: ['pdf-parse', 'pdfjs-dist', 'pg'],
};

export default nextConfig;

import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

// next/font télécharge la police AU BUILD et la sert depuis notre domaine : pas de requête
// vers Google à chaque visite (vie privée, RGPD) ni de « saut » de texte au chargement.
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

export const metadata: Metadata = {
  title: 'job-agent',
  description: "Veille d'offres d'emploi notées par Claude",
  // iPhone : « Partager → Sur l'écran d'accueil » ouvre l'application en plein écran, sans la
  // barre de Safari, avec ce nom sous l'icône (app/apple-icon.tsx).
  appleWebApp: { capable: true, title: 'Job Agent', statusBarStyle: 'default' },
  formatDetection: { telephone: false }, // pas de numéros « cliquables » inventés dans les offres
};

// viewport-fit=cover : la page s'étend sous l'encoche / la Dynamic Island et la barre d'accueil
// de l'iPhone ; les marges de sécurité (env(safe-area-inset-*)) sont gérées dans le CSS.
// Pas de maximumScale : le zoom à deux doigts reste possible (accessibilité).
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#17181b' },
  ],
};

// Exécuté AVANT l'affichage : pose le thème tout de suite, sinon la page apparaîtrait
// en clair puis basculerait en sombre (« flash »). Choix enregistré, sinon celui du système.
const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem('theme');if(t!=='light'&&t!=='dark'){t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}document.documentElement.dataset.theme=t}catch(e){}})()`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning : data-theme est posé par le script avant React, c'est voulu
    <html lang="fr" className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-screen bg-gray-50 font-sans text-gray-900 antialiased">{children}</body>
    </html>
  );
}

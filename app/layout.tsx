import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'job-agent',
  description: "Veille d'offres d'emploi notées par Claude",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body className="min-h-screen bg-gray-50 text-gray-900 antialiased">{children}</body>
    </html>
  );
}

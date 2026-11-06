'use client';

import { useEffect, useState } from 'react';

// Interrupteur clair ↔ sombre. Tant que l'utilisateur n'a rien choisi, on suit le réglage du
// système (y compris s'il change en direct). Un clic fixe le choix inverse de l'affichage actuel,
// mémorisé dans localStorage ; le script du <head> (layout) le réapplique avant le 1er rendu.

type Theme = 'light' | 'dark';

const current = (): Theme => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
function apply(theme: Theme) { document.documentElement.dataset.theme = theme; }

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('light');

  useEffect(() => {
    setTheme(current());
    // Sans choix enregistré, suivre le système quand il change (ex. passage en sombre le soir)
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      try { if (localStorage.getItem('theme')) return; } catch {}
      const t: Theme = mq.matches ? 'dark' : 'light';
      apply(t); setTheme(t);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const toggle = () => {
    const next: Theme = current() === 'dark' ? 'light' : 'dark';
    apply(next); setTheme(next);
    try { localStorage.setItem('theme', next); } catch {}
  };

  const target = theme === 'dark' ? 'clair' : 'sombre';
  return (
    <button
      onClick={toggle}
      title={`Passer en mode ${target}`}
      aria-label={`Passer en mode ${target}`}
      className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900"
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {theme === 'dark'
          ? (<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>)
          : <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />}
      </svg>
      {/* Libellé visible : une icône seule ne se devine pas. Il annonce l'action, pas l'état. */}
      <span className="hidden sm:inline">Mode {target}</span>
    </button>
  );
}

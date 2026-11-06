'use client';

import { useEffect, useState } from 'react';

type Choice = 'system' | 'light' | 'dark';
const NEXT: Record<Choice, Choice> = { system: 'light', light: 'dark', dark: 'system' };
const LABEL: Record<Choice, string> = { system: 'Thème : automatique', light: 'Thème : clair', dark: 'Thème : sombre' };

function apply(choice: Choice) {
  const dark = choice === 'dark' || (choice === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

/** Bascule automatique → clair → sombre. « Automatique » suit le réglage du système, même en direct. */
export function ThemeToggle() {
  const [choice, setChoice] = useState<Choice>('system');

  useEffect(() => {
    let saved: Choice = 'system';
    try { const t = localStorage.getItem('theme'); if (t === 'light' || t === 'dark') saved = t; } catch {}
    setChoice(saved);
    // En mode automatique, suivre le système quand il change (ex. passage en sombre le soir)
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => { try { if (!localStorage.getItem('theme')) apply('system'); } catch {} };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const cycle = () => {
    const next = NEXT[choice];
    setChoice(next);
    try { if (next === 'system') localStorage.removeItem('theme'); else localStorage.setItem('theme', next); } catch {}
    apply(next);
  };

  return (
    <button onClick={cycle} title={LABEL[choice]} aria-label={LABEL[choice]} className="rounded-md p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-900">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {choice === 'light' && (<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>)}
        {choice === 'dark' && <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />}
        {choice === 'system' && (<><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></>)}
      </svg>
    </button>
  );
}

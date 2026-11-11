'use client';

import { useEffect, useState, useTransition } from 'react';

// Cellules éditables du tableau : on modifie sur place, l'enregistrement part quand on quitte
// le champ (blur) ou qu'on change une liste. Un liseré rouge signale une valeur refusée.

type Save = (value: string) => Promise<{ ok: boolean; message: string }>;

function useSaver(save: Save) {
  const [pending, start] = useTransition();
  const [error, setError] = useState('');
  const run = (value: string) => start(async () => {
    const res = await save(value);
    setError(res.ok ? '' : res.message);
  });
  return { pending, error, run };
}

const base = 'w-full rounded border border-transparent bg-transparent px-1.5 py-1 text-sm hover:border-gray-200 focus:border-gray-300 focus:bg-white focus:outline-none';

export function EditText({ value, save, placeholder, multiline, className = '' }: { value: string; save: Save; placeholder?: string; multiline?: boolean; className?: string }) {
  const { pending, error, run } = useSaver(save);
  const [current, setCurrent] = useState(value);
  // La valeur peut changer « par ailleurs » (action groupée, classement auto) : on se recale
  useEffect(() => setCurrent(value), [value]);
  const props = {
    value: current,
    placeholder,
    title: error || undefined,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setCurrent(e.target.value),
    onBlur: () => { if (current !== value) run(current); },
    className: `${base} ${error ? 'border-red-400' : ''} ${pending ? 'opacity-60' : ''} ${className}`,
  };
  // field-sizing: content : la zone de texte grandit avec son contenu (Safari 26, Chrome 123+) ;
  // ailleurs, elle garde une ligne et se redimensionne à la main.
  return multiline ? <textarea rows={1} {...props} className={`${props.className} resize-y [field-sizing:content]`} /> : <input {...props} />;
}

export function EditSelect({ value, options, save, tone }: { value: string; options: { value: string; label: string }[]; save: Save; tone?: (v: string) => string }) {
  const { pending, error, run } = useSaver(save);
  const [current, setCurrent] = useState(value);
  useEffect(() => setCurrent(value), [value]);
  return (
    <select
      value={current}
      title={error || undefined}
      onChange={e => { setCurrent(e.target.value); run(e.target.value); }}
      className={`rounded-full border-0 px-2 py-1 text-xs font-medium ${tone ? tone(current) : 'bg-gray-100 text-gray-700'} ${pending ? 'opacity-60' : ''} ${error ? 'ring-1 ring-red-400' : ''}`}
    >
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function EditDate({ value, save }: { value: string | null; save: Save }) {
  const { pending, run } = useSaver(save);
  return (
    <input
      type="date"
      key={value ?? ''} // champ non contrôlé : une nouvelle clé le recrée avec la nouvelle valeur
      defaultValue={value ?? ''}
      onChange={e => run(e.target.value)}
      className={`${base} w-36 ${pending ? 'opacity-60' : ''}`}
    />
  );
}

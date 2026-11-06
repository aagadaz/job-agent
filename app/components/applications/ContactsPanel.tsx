'use client';

import { useActionState, useEffect, useRef, useTransition } from 'react';
import { addContact, editContact, removeContact } from '../../applications-actions';
import { ResultMessage } from '../ResultMessage';
import { EditText } from './Editable';

export interface ContactView { id: string; company: string; name: string; role: string; email: string; linkedin: string; notes: string; applications: number }

const input = 'rounded-md border px-2.5 py-1.5 text-sm';

export function AddContactForm({ defaultCompany = '' }: { defaultCompany?: string }) {
  const [result, action, pending] = useActionState(addContact, null);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => { if (result?.ok) form.current?.reset(); }, [result]);
  return (
    <form ref={form} action={action} className="flex flex-wrap items-end gap-2">
      <input name="company" required defaultValue={defaultCompany} placeholder="Entreprise" className={`${input} w-44`} />
      <input name="name" required placeholder="Nom" className={`${input} w-40`} />
      <input name="role" placeholder="Rôle (recruteuse, manager…)" className={`${input} w-48`} />
      <input name="email" type="email" placeholder="E-mail" className={`${input} w-48`} />
      <input name="linkedin" type="url" placeholder="Profil LinkedIn" className={`${input} w-48`} />
      <input name="notes" placeholder="Notes (Alumni ESEO…)" className={`${input} w-48`} />
      <button disabled={pending} className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
        {pending ? 'Ajout…' : 'Ajouter le contact'}
      </button>
      <ResultMessage result={result} />
    </form>
  );
}

export function ContactRow({ c }: { c: ContactView }) {
  const [deleting, startDelete] = useTransition();
  const save = (field: string) => (value: string) => editContact(c.id, field, value);
  return (
    <tr className={`border-t align-top ${deleting ? 'opacity-40' : ''}`}>
      <td className="min-w-36 px-1 py-1">
        <EditText value={c.company} save={save('company')} className="font-medium" />
        {c.applications > 0 && <span className="ml-1.5 text-xs text-gray-500">{c.applications} candidature{c.applications > 1 ? 's' : ''}</span>}
      </td>
      <td className="min-w-36 px-1 py-1"><EditText value={c.name} save={save('name')} /></td>
      <td className="min-w-36 px-1 py-1"><EditText value={c.role} save={save('role')} placeholder="Rôle" /></td>
      <td className="min-w-44 px-1 py-1">
        <EditText value={c.email} save={save('email')} placeholder="E-mail" />
        {c.email && <a href={`mailto:${c.email}`} className="px-1.5 text-xs text-gray-500 underline">écrire</a>}
      </td>
      <td className="min-w-44 px-1 py-1">
        <EditText value={c.linkedin} save={save('linkedin')} placeholder="https://linkedin.com/in/…" />
        {c.linkedin && <a href={c.linkedin} target="_blank" rel="noopener noreferrer" className="px-1.5 text-xs text-gray-500 underline">ouvrir</a>}
      </td>
      <td className="min-w-48 px-1 py-1"><EditText value={c.notes} save={save('notes')} placeholder="Notes…" multiline /></td>
      <td className="px-2 py-2 text-right">
        <button onClick={() => startDelete(() => removeContact(c.id))} className="text-xs text-gray-400 hover:text-red-600" title="Supprimer">✕</button>
      </td>
    </tr>
  );
}

'use client';

import { useCallback, useEffect, useRef, type Dispatch, type PointerEvent as ReactPointerEvent, type SetStateAction } from 'react';

// Sélection « cliquer-glisser » sur les lignes d'un tableau, comme dans un explorateur de
// fichiers ou un tableur :
//  - on appuie sur une ligne (ailleurs que dans un champ) : elle bascule, et ce choix
//    (sélectionner OU désélectionner) devient le « mode » du glissé ;
//  - en glissant, toutes les lignes entre la ligne de départ et celle sous le curseur prennent
//    ce mode ; revenir en arrière rend aux lignes quittées leur état d'avant le glissé ;
//  - Maj + clic : sélectionne la plage depuis la dernière ligne cliquée ;
//  - près du haut ou du bas de la fenêtre, la page défile toute seule.

/** Sélection pendant un glissé : état de départ + plage [from, to] forcée au mode choisi. Pur. */
export function rangeSelection(base: ReadonlySet<string>, ids: readonly string[], from: number, to: number, mode: boolean): Set<string> {
  const next = new Set(base);
  for (let i = Math.min(from, to); i <= Math.max(from, to); i++) {
    if (mode) next.add(ids[i]); else next.delete(ids[i]);
  }
  return next;
}

// Éléments où un appui garde son rôle normal (écrire, choisir, cliquer un lien)
const CONTROLS = 'input:not([type=checkbox]), select, textarea, button, a, [contenteditable]';
const EDGE = 60;   // px : zone de défilement automatique en haut et en bas de la fenêtre
const SPEED = 14;  // px par tick

interface DragState { mode: boolean; from: number; base: Set<string>; x: number; y: number }

export function useDragSelect(ids: readonly string[], selected: Set<string>, setSelected: Dispatch<SetStateAction<Set<string>>>) {
  const idsRef = useRef(ids);
  idsRef.current = ids;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const drag = useRef<DragState | null>(null);
  const anchor = useRef<number | null>(null);
  const skipChange = useRef(false); // l'appui a déjà basculé la case : ignorer son onChange

  const rowIndexAt = (x: number, y: number): number | null => {
    const tr = document.elementFromPoint(x, y)?.closest<HTMLElement>('tr[data-row-id]');
    if (!tr) return null;
    const i = idsRef.current.indexOf(tr.dataset.rowId!);
    return i >= 0 ? i : null;
  };

  const extendTo = useCallback((x: number, y: number) => {
    const d = drag.current;
    if (!d) return;
    const i = rowIndexAt(x, y);
    if (i === null) return;
    setSelected(rangeSelection(d.base, idsRef.current, d.from, i, d.mode));
  }, [setSelected]);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!drag.current) return;
      drag.current.x = e.clientX;
      drag.current.y = e.clientY;
      extendTo(e.clientX, e.clientY);
    };
    const stop = () => {
      if (!drag.current) return;
      drag.current = null;
      document.body.style.userSelect = '';
    };
    // Défilement automatique tant que le curseur reste près d'un bord
    const timer = setInterval(() => {
      const d = drag.current;
      if (!d) return;
      const dy = d.y < EDGE ? -SPEED : d.y > window.innerHeight - EDGE ? SPEED : 0;
      if (dy) { window.scrollBy(0, dy); extendTo(d.x, d.y); }
    }, 16);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    return () => {
      clearInterval(timer);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
  }, [extendTo]);

  /** À brancher sur le <tbody>. */
  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    const target = e.target as Element;
    if (target.closest(CONTROLS)) return;
    const tr = target.closest<HTMLElement>('tr[data-row-id]');
    if (!tr) return;
    const i = idsRef.current.indexOf(tr.dataset.rowId!);
    if (i < 0) return;
    e.preventDefault(); // pas de sélection de texte ni de focus pendant le glissé
    skipChange.current = target.matches('input[type=checkbox]');

    const current = selectedRef.current;
    if (e.shiftKey && anchor.current !== null) {
      setSelected(rangeSelection(current, idsRef.current, anchor.current, i, true));
      return;
    }
    const mode = !current.has(idsRef.current[i]);
    drag.current = { mode, from: i, base: new Set(current), x: e.clientX, y: e.clientY };
    anchor.current = i;
    document.body.style.userSelect = 'none';
    setSelected(rangeSelection(current, idsRef.current, i, i, mode));
  };

  /** onChange des cases : clavier (Espace) → bascule ; souris → déjà traité par l'appui. */
  const onCheckboxChange = (id: string) => {
    if (skipChange.current) { skipChange.current = false; return; }
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    anchor.current = idsRef.current.indexOf(id);
  };

  return { onPointerDown, onCheckboxChange };
}

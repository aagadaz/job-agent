'use client';

import { updateWeeklyGoal } from '../../applications-actions';
import { EditText } from './Editable';

/** Objectif hebdomadaire, modifiable sur place (enregistré en quittant le champ). */
export function GoalInput({ goal }: { goal: number }) {
  return (
    <span className="inline-flex items-center gap-1">
      objectif
      <EditText value={String(goal)} save={updateWeeklyGoal} className="!w-12 text-center" />
      / semaine
    </span>
  );
}

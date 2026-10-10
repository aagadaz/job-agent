// Pastille de score, partagée par la liste et la page de détail (composant serveur : pas d'état).
export function scoreColor(score: number | null): string {
  if (score === null) return 'bg-gray-100 text-gray-600';
  if (score >= 70) return 'bg-green-100 text-green-800';
  if (score >= 50) return 'bg-amber-100 text-amber-800';
  return 'bg-gray-100 text-gray-700';
}

export function ScoreBadge({ score, large = false }: { score: number | null; large?: boolean }) {
  return (
    <span className={`rounded-md font-semibold ${large ? 'px-3 py-2 text-xl' : 'px-2 py-1 text-sm'} ${scoreColor(score)}`}>
      {score ?? '—'}
    </span>
  );
}

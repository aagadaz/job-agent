import type { ActionResult } from '../actions';

export function ResultMessage({ result }: { result: ActionResult | null }) {
  if (!result) return null;
  return (
    <p className={`mt-3 rounded-md p-3 text-sm ${result.ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'}`}>
      {result.message}
    </p>
  );
}

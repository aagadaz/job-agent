// Pilotage du workflow GitHub Actions depuis l'interface (déclencher, puis suivre).
// Le jeton reste côté serveur : ce module n'est importé que par du code serveur.

const API = 'https://api.github.com';
const WORKFLOW = 'daily.yml';

function config() {
  const token = process.env.GITHUB_DISPATCH_TOKEN;
  const repo = process.env.GITHUB_REPO; // ex. "aagadaz/job-agent"
  return token && repo ? { token, repo } : null;
}

export const isGithubConfigured = () => config() !== null;

function headers(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

/** Titre donné au run par `run-name` dans daily.yml : c'est notre clé de corrélation. */
export const manualRunTitle = (runId: string) => `Recherche manuelle ${runId}`;

/** Déclenche le workflow pour un utilisateur. Renvoie null si accepté, sinon la raison. */
export async function dispatchSearch(userId: string, runId: string): Promise<string | null> {
  const cfg = config();
  if (!cfg) return 'GITHUB_DISPATCH_TOKEN / GITHUB_REPO non configurés';
  const res = await fetch(`${API}/repos/${cfg.repo}/actions/workflows/${WORKFLOW}/dispatches`, {
    method: 'POST',
    headers: headers(cfg.token),
    body: JSON.stringify({ ref: 'main', inputs: { user_id: userId, run_id: runId } }),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (!res) return 'GitHub injoignable';
  return res.status === 204 ? null : `GitHub a répondu HTTP ${res.status}`; // 204 No Content = accepté
}

export interface GithubRunState {
  status: 'queued' | 'in_progress' | 'completed' | string;
  conclusion: 'success' | 'failure' | 'cancelled' | 'timed_out' | string | null;
  url: string;
}

/** Retrouve le run GitHub d'un lancement manuel par son titre. null = introuvable (ou API indisponible). */
export async function findManualRun(runId: string): Promise<GithubRunState | null> {
  const cfg = config();
  if (!cfg) return null;
  const res = await fetch(
    `${API}/repos/${cfg.repo}/actions/workflows/${WORKFLOW}/runs?event=workflow_dispatch&per_page=30`,
    { headers: headers(cfg.token), signal: AbortSignal.timeout(10_000), cache: 'no-store' },
  ).catch(() => null);
  if (!res?.ok) return null;
  const data = (await res.json()) as {
    workflow_runs: { display_title: string; status: string; conclusion: string | null; html_url: string }[];
  };
  const run = data.workflow_runs.find(r => r.display_title === manualRunTitle(runId));
  return run ? { status: run.status, conclusion: run.conclusion, url: run.html_url } : null;
}

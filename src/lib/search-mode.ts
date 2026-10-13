// Une seule règle, utilisée par le worker, le bouton « Lancer une recherche » et l'interface :
// - 'scored'   : clé Claude + CV → collecte, filtres, puis notation par Claude ;
// - 'unscored' : pas de clé (ou pas de CV) mais des mots-clés → collecte et filtres gratuits seulement ;
// - null       : rien pour chercher (ni clé + CV, ni mots-clés) → aucune recherche possible.
// Module pur : aucun import serveur.

export type SearchMode = 'scored' | 'unscored';

export function searchMode(input: { hasKey: boolean; hasCv: boolean; keywords: string[] }): SearchMode | null {
  if (input.hasKey && input.hasCv) return 'scored';
  if (input.keywords.length > 0) return 'unscored';
  return null;
}

export const NO_SEARCH_MESSAGE =
  'Indique au moins un mot-clé dans Profil (ou ajoute ton CV et une clé Claude pour que les mots-clés soient déduits du CV).';

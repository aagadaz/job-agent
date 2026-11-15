// Sources désactivables dans le profil. Module PUR : partagé par le worker et le serveur.

/** Sources que l'utilisateur a désactivées (leurs offres sont écartées du fil, motif « source »). */
export function disabledSources(p: { useAdzuna: boolean; useHimalayas: boolean }): string[] {
  return [...(p.useAdzuna ? [] : ['adzuna']), ...(p.useHimalayas ? [] : ['himalayas'])];
}

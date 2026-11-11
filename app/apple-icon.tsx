import { ImageResponse } from 'next/og';

// Icône de l'écran d'accueil iPhone (« Sur l'écran d'accueil ») : le logo « ja » de l'en-tête,
// générée au build. iOS arrondit lui-même les coins : on remplit tout le carré.
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#111827', color: '#ffffff', fontSize: 84, fontWeight: 700, letterSpacing: -2 }}>
        ja
      </div>
    ),
    size,
  );
}

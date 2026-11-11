import { ImageResponse } from 'next/og';

// Icône de l'onglet du navigateur : même logo que l'en-tête.
export const size = { width: 64, height: 64 };
export const contentType = 'image/png';

export default function Icon() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#111827', color: '#ffffff', fontSize: 32, fontWeight: 700, borderRadius: 12 }}>
        ja
      </div>
    ),
    size,
  );
}

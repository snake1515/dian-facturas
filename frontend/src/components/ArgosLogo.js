import React, { useId } from 'react';

// Logo de Argos: escudo vigilante (Argos Panoptes, el vigilante que todo lo ve).
// Escudo metálico facetado con una mirada azul.
export default function ArgosLogo({ size = 34, radius }) {
  const id = useId().replace(/:/g, '');
  const r = radius ?? Math.round(size * 0.19);
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" style={{ flexShrink: 0, display: 'block' }} aria-label="Argos">
      <defs>
        <linearGradient id={`met${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f1f5f9" />
          <stop offset=".45" stopColor="#94a3b8" />
          <stop offset=".55" stopColor="#e2e8f0" />
          <stop offset="1" stopColor="#64748b" />
        </linearGradient>
        <linearGradient id={`az${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#38bdf8" />
          <stop offset="1" stopColor="#1d4ed8" />
        </linearGradient>
        <linearGradient id={`fo${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1e293b" />
          <stop offset="1" stopColor="#0b1020" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx={r * 64 / size} fill={`url(#fo${id})`} />
      <path d="M32 5 L55 13 L52 38 L32 59 L12 38 L9 13 Z" fill="none" stroke={`url(#met${id})`} strokeWidth="3.5" />
      <path d="M32 5 L55 13 L52 38 L32 59 Z" fill={`url(#met${id})`} opacity=".12" />
      <path d="M14 29 L24 22 L40 22 L50 29 L40 36 L24 36 Z" fill={`url(#az${id})`} />
      <path d="M14 29 L24 22 L32 22 L22 29 Z" fill="#bae6fd" opacity=".55" />
      <path d="M32 24.5 L36.5 29 L32 33.5 L27.5 29 Z" fill="#0b1020" />
      <path d="M24 43 L32 50 L40 43" fill="none" stroke={`url(#az${id})`} strokeWidth="3" />
    </svg>
  );
}

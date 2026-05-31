import React, { createContext, useContext, useState } from 'react';
import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';

export const TEMAS = {
  oscuro: {
    nombre: 'Oscuro', emoji: '🌙',
    '--t-bg-app':         '#0f1117',
    '--t-bg-sidebar':     '#161b27',
    '--t-bg-card':        '#1e2535',
    '--t-bg-input':       '#0f1117',
    '--t-bg-inner':       '#0a0d14',
    '--t-border':         '#2a3348',
    '--t-accent':         '#3b82f6',
    '--t-text-primary':   '#e2e8f0',
    '--t-text-secondary': '#94a3b8',
    '--t-text-muted':     '#64748b',
  },
  blanco: {
    nombre: 'Blanco', emoji: '☀️',
    '--t-bg-app':         '#f1f5f9',
    '--t-bg-sidebar':     '#ffffff',
    '--t-bg-card':        '#ffffff',
    '--t-bg-input':       '#f8fafc',
    '--t-bg-inner':       '#f1f5f9',
    '--t-border':         '#cbd5e1',
    '--t-accent':         '#3b82f6',
    '--t-text-primary':   '#0f172a',
    '--t-text-secondary': '#475569',
    '--t-text-muted':     '#94a3b8',
  },
  rosado: {
    nombre: 'Rosado', emoji: '🌸',
    '--t-bg-app':         '#1a0f14',
    '--t-bg-sidebar':     '#200d18',
    '--t-bg-card':        '#2a1520',
    '--t-bg-input':       '#1a0f14',
    '--t-bg-inner':       '#130a10',
    '--t-border':         '#3d1f2e',
    '--t-accent':         '#ec4899',
    '--t-text-primary':   '#fce7f3',
    '--t-text-secondary': '#f9a8d4',
    '--t-text-muted':     '#9d6b80',
  },
  morado: {
    nombre: 'Morado', emoji: '🔮',
    '--t-bg-app':         '#0f0a1a',
    '--t-bg-sidebar':     '#130e22',
    '--t-bg-card':        '#1e1535',
    '--t-bg-input':       '#0f0a1a',
    '--t-bg-inner':       '#0a0714',
    '--t-border':         '#2d1f4a',
    '--t-accent':         '#8b5cf6',
    '--t-text-primary':   '#ede9fe',
    '--t-text-secondary': '#c4b5fd',
    '--t-text-muted':     '#7c6a9e',
  },
  azul: {
    nombre: 'Azul cielo', emoji: '🌊',
    '--t-bg-app':         '#0c1628',
    '--t-bg-sidebar':     '#0f1e38',
    '--t-bg-card':        '#162844',
    '--t-bg-input':       '#0c1628',
    '--t-bg-inner':       '#091220',
    '--t-border':         '#1e3a5f',
    '--t-accent':         '#38bdf8',
    '--t-text-primary':   '#e0f2fe',
    '--t-text-secondary': '#7dd3fc',
    '--t-text-muted':     '#4a7fa5',
  },
  verde: {
    nombre: 'Verde', emoji: '🌿',
    '--t-bg-app':         '#071510',
    '--t-bg-sidebar':     '#0a1f15',
    '--t-bg-card':        '#0f2d1e',
    '--t-bg-input':       '#071510',
    '--t-bg-inner':       '#050f0a',
    '--t-border':         '#1a4a2e',
    '--t-accent':         '#22c55e',
    '--t-text-primary':   '#dcfce7',
    '--t-text-secondary': '#86efac',
    '--t-text-muted':     '#4a8f63',
  },
};

const ThemeContext = createContext(null);

export function ThemeProvider({ userId, initialTema, children }) {
  const [temaId, setTemaId] = useState(() => initialTema || 'oscuro');

  const cambiarTema = async (id) => {
    setTemaId(id);
    try {
      await axios.put(`${API_URL}/auth/tema`, { tema: id });
    } catch (err) {
      console.error('Error guardando tema:', err.message);
    }
  };

  const tema = TEMAS[temaId] || TEMAS.oscuro;
  const cssVars = Object.fromEntries(Object.entries(tema).filter(([k]) => k.startsWith('--')));

  return (
    <ThemeContext.Provider value={{ temaId, tema, cambiarTema }}>
      <div style={{ ...cssVars, minHeight: '100vh' }}>{children}</div>
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme debe usarse dentro de ThemeProvider');
  return ctx;
}

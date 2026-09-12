import React from 'react';
import { APP_VERSION } from '../version';

// Cada cuánto se revisa si hay una versión nueva mientras la pestaña está abierta.
const CHECK_INTERVAL_MS = 2 * 60 * 1000; // 2 minutos

/**
 * Envuelve toda la app. Compara la versión con la que quedó "horneada" en
 * este bundle (APP_VERSION) contra la última publicada (public/version.json,
 * consultada con cache-busting para no recibir una copia vieja cacheada).
 *
 * Si detecta que este bundle quedó desactualizado, deja de renderizar la
 * aplicación y muestra una pantalla de bloqueo: el usuario no puede seguir
 * usando la versión vieja, solo puede actualizar.
 */
export default function VersionWatcher({ children }) {
  const [isStale, setIsStale] = React.useState(false);
  const checkingRef = React.useRef(false);

  const checkVersion = React.useCallback(async () => {
    if (checkingRef.current) return;
    checkingRef.current = true;
    try {
      const res = await fetch(`/version.json?_=${Date.now()}`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (data.version && data.version !== APP_VERSION) {
          setIsStale(true);
        }
      }
    } catch (e) {
      // Sin internet u otro fallo puntual: no bloqueamos al usuario por esto,
      // simplemente se reintentará en el próximo chequeo.
    } finally {
      checkingRef.current = false;
    }
  }, []);

  React.useEffect(() => {
    checkVersion();
    const interval = setInterval(checkVersion, CHECK_INTERVAL_MS);

    // Revisa también cuando el usuario vuelve a esta pestaña (muy común:
    // deja la pestaña abierta de un día para otro y regresa a trabajar).
    const onVisibility = () => {
      if (document.visibilityState === 'visible') checkVersion();
    };
    window.addEventListener('focus', checkVersion);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', checkVersion);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [checkVersion]);

  if (isStale) {
    return (
      <div style={overlayStyle}>
        <div style={cardStyle}>
          <h2 style={{ margin: '0 0 12px' }}>Hay una nueva versión disponible</h2>
          <p style={{ margin: '0 0 20px', lineHeight: 1.5, color: '#475569' }}>
            Esta pestaña está usando una versión anterior de la aplicación.
            Para evitar errores o inconsistencias en los datos, actualiza
            antes de continuar trabajando.
          </p>
          <button style={buttonStyle} onClick={() => window.location.reload()}>
            Actualizar ahora
          </button>
        </div>
      </div>
    );
  }

  return children;
}

const overlayStyle = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(15, 17, 23, 0.92)',
  zIndex: 999999,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 16,
};

const cardStyle = {
  background: '#ffffff',
  color: '#0f172a',
  padding: '32px',
  borderRadius: 14,
  maxWidth: 420,
  width: '100%',
  textAlign: 'center',
  boxShadow: '0 20px 60px rgba(0,0,0,0.45)',
};

const buttonStyle = {
  padding: '12px 28px',
  fontSize: 16,
  fontWeight: 600,
  border: 'none',
  borderRadius: 8,
  background: '#2563eb',
  color: '#fff',
  cursor: 'pointer',
};

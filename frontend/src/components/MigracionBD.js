import React, { useEffect, useRef, useState } from 'react';
import api from '../services/api';

const mb = (b) => (b == null ? '—' : (b / 1024 / 1024).toFixed(1) + ' MB');
const EN_CURSO = ['estructura', 'datos', 'restricciones', 'verificando'];
const FASES = { estructura: 'Creando tablas', datos: 'Copiando datos', restricciones: 'Creando llaves e índices', verificando: 'Verificando', terminado: 'Terminado', error: 'Error' };

const caja = { background: '#0f1117', border: '1px solid #2a3348', borderRadius: 8, padding: 14, marginBottom: 12 };
const td = { padding: '3px 6px', fontSize: 12, color: '#cbd5e1' };
const btn = (color) => ({ background: color, color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', fontSize: 13, cursor: 'pointer' });

// Copia la base de datos actual a otro PostgreSQL (DESTINO_DATABASE_URL en Render).
// La base actual solo se lee; nunca se modifica.
export default function MigracionBD() {
  const [vista, setVista] = useState(null);
  const [estado, setEstado] = useState(null);
  const [reemplazar, setReemplazar] = useState(false);
  const [cargando, setCargando] = useState(false);
  const timer = useRef(null);

  const consultarEstado = async () => {
    try {
      const res = await api.get('/storage-admin/migracion/estado');
      setEstado(res.data);
      if (!EN_CURSO.includes(res.data.fase)) { clearInterval(timer.current); timer.current = null; }
    } catch (e) { /* reintenta en el siguiente ciclo */ }
  };
  const seguir = () => { if (!timer.current) timer.current = setInterval(consultarEstado, 2000); };

  useEffect(() => {
    // Si se recarga la página durante una migración, retoma el seguimiento
    api.get('/storage-admin/migracion/estado').then(r => {
      if (r.data.fase !== 'inactivo') setEstado(r.data);
      if (EN_CURSO.includes(r.data.fase)) seguir();
    }).catch(() => {});
    return () => clearInterval(timer.current);
  }, []);

  const verPrevia = async () => {
    setCargando(true);
    try { const r = await api.get('/storage-admin/migracion/vista-previa', { timeout: 0 }); setVista(r.data); }
    catch (err) { alert(err.response?.data?.error || err.message); }
    finally { setCargando(false); }
  };

  const iniciar = async () => {
    const d = vista.destino;
    const txt = window.prompt(
      `Se copiará TODA la base de datos (${mb(vista.origen.bytes)}) al servidor:\n${d.host}\n\n` +
      `La base actual NO se modifica.` + (reemplazar ? `\n⚠️ Se borrarán las tablas que ya existan en el DESTINO.` : '') +
      `\n\nEscriba MIGRAR para confirmar:`
    );
    if (txt !== 'MIGRAR') return;
    try {
      await api.post('/storage-admin/migracion/iniciar', { confirmacion: 'MIGRAR', reemplazar });
      setEstado({ fase: 'estructura', log: [], tablas: [] });
      seguir();
    } catch (err) { alert(err.response?.data?.error || err.message); }
  };

  const enCurso = estado && EN_CURSO.includes(estado.fase);
  const totalFilas = estado?.tablas?.reduce((a, t) => a + (t.total || 0), 0) || 0;
  const copiadas = estado?.tablas?.reduce((a, t) => a + (t.copiadas || 0), 0) || 0;
  const destinoListo = vista?.destino?.configurado && !vista.destino.error;
  const destinoConTablas = destinoListo && vista.destino.tablasExistentes?.length > 0;

  return (
    <div style={{ marginBottom: 24, paddingBottom: 16, borderBottom: '1px solid #2a3348' }}>
      <h3 style={{ fontSize: 14, fontWeight: 600, color: '#e2e8f0', marginBottom: 8, marginTop: 0 }}>Migrar base de datos a otro servidor</h3>
      <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 0, lineHeight: 1.6 }}>
        Copia toda la base de datos (tablas, datos, llaves, índices y consecutivos) al PostgreSQL configurado en la
        variable <b>DESTINO_DATABASE_URL</b> de Render. La base actual solo se lee, no se modifica.
        Después de verificar, se cambia <b>DATABASE_URL</b> por la nueva.
      </p>

      <button onClick={verPrevia} disabled={cargando || enCurso} style={{ ...btn('#3b82f6'), marginBottom: 12 }}>
        {cargando ? 'Revisando…' : '🔍 Revisar origen y destino'}
      </button>

      {vista && (
        <div style={caja}>
          <div style={{ fontSize: 13, color: '#e2e8f0', marginBottom: 6 }}>
            Base actual: <b>{mb(vista.origen.bytes)}</b> · {vista.origen.tablas.length} tablas
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 10 }}>
            <thead><tr>{['Tabla', 'Filas aprox.', 'Tamaño'].map(h => <th key={h} style={{ ...td, color: '#64748b', textAlign: 'left' }}>{h}</th>)}</tr></thead>
            <tbody>
              {vista.origen.tablas.slice(0, 8).map(t => (
                <tr key={t.tabla} style={{ borderTop: '1px solid #1e2535' }}>
                  <td style={td}>{t.tabla}</td><td style={td}>{t.filas_aprox.toLocaleString('es-CO')}</td><td style={td}>{mb(t.bytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ fontSize: 13, color: '#e2e8f0', borderTop: '1px solid #2a3348', paddingTop: 10 }}>
            {!vista.destino.configurado && <span style={{ color: '#fbbf24' }}>⚠️ Falta la variable DESTINO_DATABASE_URL en Render (servicio dian-facturas).</span>}
            {vista.destino.error && <span style={{ color: '#f87171' }}>❌ No se pudo conectar al destino: {vista.destino.error}</span>}
            {destinoListo && (
              <>
                Destino: <b>{vista.destino.host}</b> · {vista.destino.version}
                <div style={{ fontSize: 12, marginTop: 4, color: destinoConTablas ? '#fbbf24' : '#4ade80' }}>
                  {destinoConTablas ? `⚠️ El destino ya tiene ${vista.destino.tablasExistentes.length} tablas` : '✅ Destino vacío, listo para copiar'}
                </div>
              </>
            )}
          </div>

          {destinoListo && (
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
              {destinoConTablas && (
                <label style={{ fontSize: 12, color: '#f87171', display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input type="checkbox" checked={reemplazar} onChange={e => setReemplazar(e.target.checked)} />
                  Reemplazar (borrar las tablas del DESTINO y copiar de nuevo)
                </label>
              )}
              <button onClick={iniciar} disabled={enCurso || (destinoConTablas && !reemplazar)}
                style={{ ...btn('#16a34a'), opacity: enCurso || (destinoConTablas && !reemplazar) ? 0.5 : 1 }}>
                🚚 Iniciar migración
              </button>
            </div>
          )}
        </div>
      )}

      {estado && (
        <div style={caja}>
          <div style={{ fontSize: 13, color: estado.fase === 'error' ? '#f87171' : estado.fase === 'terminado' ? '#4ade80' : '#e2e8f0', marginBottom: 8 }}>
            {enCurso && '⏳ '}{FASES[estado.fase] || estado.fase}
            {estado.fase === 'datos' && totalFilas > 0 && ` · ${copiadas.toLocaleString('es-CO')} de ${totalFilas.toLocaleString('es-CO')} filas (${Math.floor(copiadas * 100 / totalFilas)}%)`}
          </div>
          {estado.fase === 'datos' && totalFilas > 0 && (
            <div style={{ height: 6, background: '#1e2535', borderRadius: 3, marginBottom: 10 }}>
              <div style={{ height: 6, width: `${Math.floor(copiadas * 100 / totalFilas)}%`, background: '#3b82f6', borderRadius: 3 }} />
            </div>
          )}
          {estado.error && <div style={{ fontSize: 12, color: '#f87171', marginBottom: 8 }}>{estado.error}</div>}

          {estado.resultado && (
            <>
              <div style={{ fontSize: 13, marginBottom: 6, color: estado.resultado.ok ? '#4ade80' : '#f87171' }}>
                {estado.resultado.ok ? '✅ Copia verificada: todas las tablas tienen las mismas filas' : '⚠️ Hay tablas con diferencias — no cambie DATABASE_URL todavía'}
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>{['Tabla', 'Origen', 'Destino', ''].map(h => <th key={h} style={{ ...td, color: '#64748b', textAlign: 'left' }}>{h}</th>)}</tr></thead>
                <tbody>
                  {estado.resultado.verificacion.map(v => (
                    <tr key={v.tabla} style={{ borderTop: '1px solid #1e2535' }}>
                      <td style={td}>{v.tabla}</td><td style={td}>{v.origen}</td><td style={td}>{v.destino}</td>
                      <td style={{ ...td, color: v.ok ? '#4ade80' : '#f87171' }}>{v.ok ? '✓' : '✗'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {estado.log?.length > 0 && (
            <details style={{ marginTop: 10 }}>
              <summary style={{ fontSize: 12, color: '#64748b', cursor: 'pointer' }}>Detalle ({estado.log.length})</summary>
              <div style={{ fontSize: 11, color: '#94a3b8', fontFamily: 'monospace', whiteSpace: 'pre-wrap', marginTop: 6, maxHeight: 200, overflowY: 'auto' }}>
                {estado.log.join('\n')}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

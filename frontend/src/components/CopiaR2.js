import React, { useEffect, useRef, useState } from 'react';
import api from '../services/api';

const mb = (b) => (b == null ? '—' : (b / 1024 / 1024).toFixed(1) + ' MB');
const EN_CURSO = ['listando', 'copiando'];
const caja = { background: '#0f1117', border: '1px solid #2a3348', borderRadius: 8, padding: 14, marginBottom: 12 };
const btn = (color) => ({ background: color, color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', fontSize: 13, cursor: 'pointer' });

// Copia todos los archivos (facturas, XML, soportes de Préstamos) de Supabase Storage a Cloudflare R2.
// Supabase solo se lee. Lo que ya está en R2 se salta: se puede repetir sin duplicar.
export default function CopiaR2() {
  const [vista, setVista] = useState(null);
  const [estado, setEstado] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [limpieza, setLimpieza] = useState(null);
  const timer = useRef(null);

  const consultar = async () => {
    try {
      const r = await api.get('/storage-admin/r2/estado');
      setEstado(r.data);
      if (!EN_CURSO.includes(r.data.fase)) { clearInterval(timer.current); timer.current = null; }
    } catch (e) { /* reintenta */ }
  };
  const seguir = () => { if (!timer.current) timer.current = setInterval(consultar, 2000); };

  useEffect(() => {
    api.get('/storage-admin/r2/estado').then(r => {
      if (r.data.fase !== 'inactivo') setEstado(r.data);
      if (EN_CURSO.includes(r.data.fase)) seguir();
    }).catch(() => {});
    return () => clearInterval(timer.current);
  }, []);

  const revisar = async () => {
    setCargando(true);
    try { const r = await api.get('/storage-admin/r2/vista-previa', { timeout: 0 }); setVista(r.data); }
    catch (err) { alert(err.response?.data?.error || err.message); }
    finally { setCargando(false); }
  };

  const iniciar = async () => {
    const txt = window.prompt(`Se copiarán ${vista.archivos} archivos (${mb(vista.bytes)}) de Supabase a Cloudflare R2.\nSupabase NO se modifica.\n\nEscriba COPIAR para confirmar:`);
    if (txt !== 'COPIAR') return;
    try {
      await api.post('/storage-admin/r2/iniciar', { confirmacion: 'COPIAR' });
      setEstado({ fase: 'listando', errores: [] });
      seguir();
    } catch (err) { alert(err.response?.data?.error || err.message); }
  };

  const limpiarGmail = async () => {
    const txt = window.prompt('Se borrarán de R2 los PDF y XML que llegaron por Gmail.\nSe pueden volver a abrir: el PDF se trae del correo y el XML está en la base.\nLos PDF subidos a mano y los soportes de Préstamos NO se tocan.\n\nEscriba BORRAR para confirmar:');
    if (txt !== 'BORRAR') return;
    setCargando(true);
    try { const r = await api.post('/storage-admin/r2/limpiar-gmail', { confirmacion: 'BORRAR' }, { timeout: 0 }); setLimpieza(r.data); }
    catch (err) { alert(err.response?.data?.error || err.message); }
    finally { setCargando(false); }
  };

  const enCurso = estado && EN_CURSO.includes(estado.fase);
  const hechos = (estado?.copiados || 0) + (estado?.saltados || 0) + (estado?.errores?.length || 0) + (estado?.erroresExtra || 0);
  const pct = estado?.total ? Math.round((hechos / estado.total) * 100) : 0;

  return (
    <div style={{ marginBottom: 24, paddingBottom: 16, borderBottom: '1px solid #2a3348' }}>
      <h3 style={{ fontSize: 14, fontWeight: 600, color: '#e2e8f0', marginBottom: 8, marginTop: 0 }}>Copiar archivos de Supabase a Cloudflare R2</h3>
      <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 0, lineHeight: 1.6 }}>
        Pasa a R2 todos los archivos antiguos (facturas, XML y soportes de Préstamos). Supabase solo se lee, no se borra nada.
        Lo que ya esté en R2 se salta, así que se puede repetir si se interrumpe.
      </p>
      <button onClick={revisar} disabled={cargando || enCurso} style={{ ...btn('#3b82f6'), marginBottom: 12 }}>
        {cargando ? 'Contando archivos…' : '🔍 Revisar archivos en Supabase'}
      </button>

      {vista && (
        <div style={caja}>
          <div style={{ fontSize: 13, color: '#e2e8f0', marginBottom: 8 }}><b>{vista.archivos}</b> archivos · <b>{mb(vista.bytes)}</b> por copiar</div>
          {vista.gmail?.archivos > 0 && <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 8 }}>No se copian {vista.gmail.archivos} archivos de Gmail ({mb(vista.gmail.bytes)}): se leen del correo y de la base.</div>}
          <table style={{ fontSize: 12, color: '#cbd5e1', marginBottom: 10 }}><tbody>
            {Object.entries(vista.porCarpeta).sort((a, b) => b[1].bytes - a[1].bytes).map(([c, v]) => (
              <tr key={c}><td style={{ paddingRight: 12 }}>{c}</td><td style={{ paddingRight: 12 }}>{v.n} archivos</td><td>{mb(v.bytes)}</td></tr>
            ))}
          </tbody></table>
          <button onClick={iniciar} disabled={enCurso || !vista.archivos} style={btn('#16a34a')}>☁️ Copiar todo a R2</button>
        </div>
      )}

      <button onClick={limpiarGmail} disabled={cargando || enCurso} style={{ ...btn('#b45309'), marginBottom: 12, marginLeft: 8 }}>
        🧹 Quitar de R2 los archivos de Gmail
      </button>
      {limpieza && (
        <div style={{ ...caja, fontSize: 12, color: '#cbd5e1' }}>
          Borrados de R2: <b>{limpieza.borrados}</b> ({mb(limpieza.bytesLiberados)}) · Quedan: <b>{limpieza.quedan}</b> archivos ({mb(limpieza.bytesQuedan)})
        </div>
      )}

      {estado && estado.fase !== 'inactivo' && (
        <div style={caja}>
          <div style={{ fontSize: 13, color: '#e2e8f0', marginBottom: 6 }}>
            {estado.fase === 'listando' && '⏳ Listando archivos en Supabase…'}
            {estado.fase === 'copiando' && `⏳ Copiando… ${hechos} de ${estado.total} (${pct}%)`}
            {estado.fase === 'terminado' && '✅ Copia terminada'}
            {estado.fase === 'error' && `❌ Error: ${estado.mensaje}`}
          </div>
          {estado.total > 0 && (
            <div style={{ background: '#1e2536', borderRadius: 4, height: 8, marginBottom: 8 }}>
              <div style={{ width: `${pct}%`, background: '#22c55e', height: 8, borderRadius: 4 }} />
            </div>
          )}
          <div style={{ fontSize: 12, color: '#94a3b8' }}>
            Copiados: <b>{estado.copiados || 0}</b> ({mb(estado.bytesCopiados)}) · Ya estaban en R2: <b>{estado.saltados || 0}</b> ·
            Errores: <b style={{ color: (estado.errores?.length || 0) ? '#f87171' : undefined }}>{(estado.errores?.length || 0) + (estado.erroresExtra || 0)}</b>
          </div>
          {estado.errores?.length > 0 && (
            <details style={{ marginTop: 8 }}><summary style={{ fontSize: 12, color: '#f87171', cursor: 'pointer' }}>Ver errores</summary>
              <ul style={{ fontSize: 11, color: '#fca5a5' }}>{estado.errores.slice(0, 50).map((e, i) => <li key={i}>{e.ruta}: {e.error}</li>)}</ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

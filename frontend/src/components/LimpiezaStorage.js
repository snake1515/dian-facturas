import React, { useState } from 'react';
import api from '../services/api';

const mb = (b) => (b == null ? '—' : (b / 1024 / 1024).toFixed(1) + ' MB');
const LIMITE = 1024 * 1024 * 1024; // 1 GB (plan gratis de Supabase)

export default function LimpiezaStorage() {
  const [anio, setAnio] = useState(new Date().getFullYear() - 1);
  const [manuales, setManuales] = useState(false);
  const [preview, setPreview] = useState(null);
  const [resultado, setResultado] = useState(null);
  const [cargando, setCargando] = useState(false);

  const verPrevia = async () => {
    setCargando(true); setResultado(null);
    try {
      const res = await api.get('/storage-admin/vista-previa', { params: { anio, manuales: manuales ? 1 : 0 } });
      setPreview(res.data);
    } catch (err) { alert(err.response?.data?.error || err.message); }
    finally { setCargando(false); }
  };

  const liberar = async () => {
    const txt = window.prompt(
      `Se borrarán del Storage ${preview.archivosBorrar} archivos del año ${preview.anio} (${mb(preview.bytesLiberar)}).\n` +
      `Las facturas NO se borran.` + (manuales ? '\n⚠️ Incluye PDF manuales, que NO se pueden recuperar.' : '') +
      `\n\nEscriba BORRAR para confirmar:`
    );
    if (txt !== 'BORRAR') return;
    setCargando(true);
    try {
      const res = await api.post('/storage-admin/liberar', { anio: preview.anio, incluirManuales: manuales, confirmacion: 'BORRAR' }, { timeout: 0 });
      setResultado(res.data); setPreview(null);
    } catch (err) { alert(err.response?.data?.error || err.message); }
    finally { setCargando(false); }
  };

  const fila = (label, d, color) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0', color: color || '#cbd5e1' }}>
      <span>{label}</span><span>{d.n} archivos · {mb(d.bytes)}</span>
    </div>
  );

  return (
    <div>
      <h3 style={{ fontSize: 14, fontWeight: 600, color: '#e2e8f0', marginBottom: 8, marginTop: 0 }}>Liberar espacio de Storage</h3>
      <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 0, lineHeight: 1.6 }}>
        Borra del Storage los archivos PDF/XML de las facturas de un año. <b>Las facturas no se borran</b>:
        los PDF de Gmail se siguen descargando desde el correo y los XML desde la base de datos.
      </p>

      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 12 }}>
        <div>
          <label style={{ display: 'block', fontSize: 11, color: '#64748b', marginBottom: 4 }}>Año</label>
          <input type="number" value={anio} onChange={e => { setAnio(e.target.value); setPreview(null); }}
            style={{ width: 100, background: '#0f1117', border: '1px solid #2a3348', borderRadius: 6, padding: '8px 12px', color: '#e2e8f0', fontSize: 13 }} />
        </div>
        <label style={{ fontSize: 12, color: manuales ? '#f87171' : '#94a3b8', display: 'flex', gap: 6, alignItems: 'center', paddingBottom: 8 }}>
          <input type="checkbox" checked={manuales} onChange={e => { setManuales(e.target.checked); setPreview(null); }} />
          Incluir PDF subidos a mano (no recuperables)
        </label>
        <button onClick={verPrevia} disabled={cargando}
          style={{ background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }}>
          {cargando && !preview ? 'Calculando...' : '🔍 Vista previa'}
        </button>
      </div>

      {preview && (
        <div style={{ background: '#0f1117', border: '1px solid #2a3348', borderRadius: 8, padding: 14 }}>
          <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 8 }}>
            Storage actual: <b style={{ color: preview.bucket.bytes > LIMITE ? '#f87171' : '#4ade80' }}>{mb(preview.bucket.bytes)}</b> de 1024 MB
            {preview.bucket.archivos != null && ` · ${preview.bucket.archivos} archivos`}
          </div>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6 }}>Facturas de {preview.anio} con archivos: {preview.facturas}</div>
          {fila('PDF de Gmail a borrar', preview.pdfGmail)}
          {fila('XML a borrar', preview.xml)}
          {manuales ? fila('PDF manuales a borrar ⚠️', preview.pdfManual, '#f87171') : fila('PDF manuales (se conservan)', preview.pdfManualConservados, '#64748b')}
          <div style={{ borderTop: '1px solid #2a3348', marginTop: 8, paddingTop: 8, fontSize: 13, color: '#e2e8f0' }}>
            Se liberarían <b>{mb(preview.bytesLiberar)}</b>
            {preview.bucket.bytes != null && <> → el Storage quedaría en <b style={{ color: preview.bucket.bytes - preview.bytesLiberar > LIMITE ? '#f87171' : '#4ade80' }}>{mb(preview.bucket.bytes - preview.bytesLiberar)}</b></>}
          </div>
          {preview.archivosBorrar > 0 && (
            <button onClick={liberar} disabled={cargando}
              style={{ marginTop: 12, background: 'rgba(239,68,68,.1)', color: '#f87171', border: '1px solid rgba(239,68,68,.3)', borderRadius: 6, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }}>
              {cargando ? 'Borrando... (puede tardar)' : `🗑️ Borrar ${preview.archivosBorrar} archivos`}
            </button>
          )}
        </div>
      )}

      {resultado && (
        <div style={{ background: '#0f1117', border: '1px solid #2a3348', borderRadius: 8, padding: 14, fontSize: 13, color: '#e2e8f0' }}>
          ✅ Borrados: {resultado.borrados} ({mb(resultado.bytesLiberados)}) · ❌ Fallidos: {resultado.fallidos}
          {resultado.error && <div style={{ color: '#f87171', fontSize: 12, marginTop: 6 }}>Error de Supabase: {resultado.error}</div>}
        </div>
      )}
    </div>
  );
}

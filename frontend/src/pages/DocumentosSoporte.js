import React, { useState, useRef } from 'react';
import { procesarDocumentosSoporte } from '../services/api';

const MAX_PDFS = 150;

const card = { background: 'var(--t-bg-card)', border: '1px solid var(--t-border)', borderRadius: 10, padding: '20px' };
const inputSt = { background: 'var(--t-bg-card)', border: '1px solid var(--t-border)', borderRadius: 6, padding: '8px 12px', color: 'var(--t-text-primary)', fontSize: 13, outline: 'none', boxSizing: 'border-box', width: '100%' };
const btnPrimary = { background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, padding: '9px 18px', fontSize: 13, fontWeight: 500, cursor: 'pointer' };
const btnGhost = { background: 'var(--t-bg-card)', border: '1px solid var(--t-border)', borderRadius: 6, padding: '9px 18px', fontSize: 13, color: 'var(--t-text-secondary)', cursor: 'pointer' };
const overlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 };

// Lee el mensaje de error de una respuesta con responseType: 'blob'
// (axios no lo parsea a JSON automáticamente cuando el responseType es blob).
async function leerErrorBlob(err) {
  const data = err.response?.data;
  if (data instanceof Blob) {
    try {
      const texto = await data.text();
      const json = JSON.parse(texto);
      return json.error || 'Error al procesar el lote';
    } catch {
      return 'Error al procesar el lote';
    }
  }
  return err.response?.data?.error || err.message || 'Error al procesar el lote';
}

export default function DocumentosSoporte() {
  const [pdfs, setPdfs] = useState([]);
  const [excelFile, setExcelFile] = useState(null);
  const [mostrarModal, setMostrarModal] = useState(false);
  const [contrasena, setContrasena] = useState('');
  const [procesando, setProcesando] = useState(false);
  const [error, setError] = useState('');
  const [ultimoResultado, setUltimoResultado] = useState(null);

  const pdfsInputRef = useRef(null);
  const excelInputRef = useRef(null);

  const puedeEnviar = pdfs.length > 0 && pdfs.length <= MAX_PDFS && excelFile && !procesando;

  const reiniciarSeleccion = () => {
    setPdfs([]);
    setExcelFile(null);
    if (pdfsInputRef.current) pdfsInputRef.current.value = '';
    if (excelInputRef.current) excelInputRef.current.value = '';
  };

  const abrirModalContrasena = () => {
    setError('');
    setContrasena('');
    setMostrarModal(true);
  };

  const confirmarYProcesar = async () => {
    if (!contrasena) return;
    setMostrarModal(false);
    setProcesando(true);
    setError('');
    setUltimoResultado(null);

    try {
      const res = await procesarDocumentosSoporte(pdfs, excelFile, contrasena);

      const blob = new Blob([res.data], { type: 'application/zip' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `documentos_soporte_${Date.now()}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);

      setUltimoResultado({ ok: true, total: pdfs.length });
      reiniciarSeleccion();
    } catch (err) {
      const mensaje = await leerErrorBlob(err);
      setError(mensaje);
    } finally {
      setContrasena('');
      setProcesando(false);
    }
  };

  return (
    <div style={{ maxWidth: 640 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--t-text-primary)', marginBottom: 4 }}>Documentos Soporte</h1>
      <p style={{ fontSize: 13, color: 'var(--t-text-muted)', marginBottom: 20 }}>
        Sube los PDFs descargados de la DIAN (nombrados con el CUFE) junto con el Excel del reporte.
        Se validan y renombran, y descargas el resultado en un .zip — nada queda guardado en el servidor.
      </p>

      <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--t-text-secondary)', display: 'block', marginBottom: 6 }}>
            Excel del reporte
          </label>
          <input
            ref={excelInputRef}
            type="file"
            accept=".xlsx,.xls"
            onChange={(e) => setExcelFile(e.target.files?.[0] || null)}
            style={inputSt}
          />
        </div>

        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--t-text-secondary)', display: 'block', marginBottom: 6 }}>
            PDFs (máximo {MAX_PDFS} por lote)
          </label>
          <input
            ref={pdfsInputRef}
            type="file"
            accept=".pdf"
            multiple
            onChange={(e) => setPdfs(Array.from(e.target.files || []))}
            style={inputSt}
          />
          {pdfs.length > 0 && (
            <div style={{ fontSize: 12, color: pdfs.length > MAX_PDFS ? '#f87171' : 'var(--t-text-muted)', marginTop: 6 }}>
              {pdfs.length} archivo{pdfs.length === 1 ? '' : 's'} seleccionado{pdfs.length === 1 ? '' : 's'}
              {pdfs.length > MAX_PDFS && ` — supera el máximo de ${MAX_PDFS}, súbelos en dos tandas`}
            </div>
          )}
        </div>

        {error && (
          <div style={{ fontSize: 13, color: '#f87171', background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 6, padding: '8px 12px' }}>
            {error}
          </div>
        )}

        {ultimoResultado?.ok && !error && (
          <div style={{ fontSize: 13, color: '#4ade80', background: 'rgba(74,222,128,.1)', border: '1px solid rgba(74,222,128,.3)', borderRadius: 6, padding: '8px 12px' }}>
            Lote procesado — revisa el reporte.xlsx dentro del .zip descargado para ver el detalle de cada archivo.
          </div>
        )}

        <div>
          <button
            onClick={abrirModalContrasena}
            disabled={!puedeEnviar}
            style={{ ...btnPrimary, opacity: puedeEnviar ? 1 : 0.5, cursor: puedeEnviar ? 'pointer' : 'not-allowed' }}
          >
            {procesando ? 'Procesando…' : 'Procesar y descargar'}
          </button>
        </div>
      </div>

      {mostrarModal && (
        <div style={overlay} onClick={() => setMostrarModal(false)}>
          <div style={{ ...card, width: 360 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--t-text-primary)', marginBottom: 4 }}>
              Contraseña de los PDFs
            </div>
            <div style={{ fontSize: 12, color: 'var(--t-text-muted)', marginBottom: 12 }}>
              Se usa solo para este lote — no se guarda en ningún lado.
            </div>
            <input
              type="password"
              autoFocus
              value={contrasena}
              onChange={(e) => setContrasena(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && contrasena) confirmarYProcesar(); }}
              style={{ ...inputSt, marginBottom: 16 }}
              placeholder="••••••••"
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button style={btnGhost} onClick={() => setMostrarModal(false)}>Cancelar</button>
              <button
                style={{ ...btnPrimary, opacity: contrasena ? 1 : 0.5, cursor: contrasena ? 'pointer' : 'not-allowed' }}
                disabled={!contrasena}
                onClick={confirmarYProcesar}
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

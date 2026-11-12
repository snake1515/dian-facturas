import React, { useRef, useState } from 'react';
import api from '../services/api';

// La contraseña se recuerda solo mientras la página esté abierta (no se guarda
// en el navegador ni en el servidor): así se escribe una sola vez por sesión.
let passwordRecordada = '';

const ESTADOS = {
  pendiente: { icono: '•',  color: 'var(--t-text-muted)', texto: 'En espera' },
  subiendo:  { icono: '⏳', color: '#93c5fd', texto: 'Subiendo…' },
  ok:        { icono: '✅', color: '#4ade80', texto: 'Subida' },
  adjunto:   { icono: '📎', color: '#4ade80', texto: 'PDF adjuntado' },
  aviso:     { icono: '⚠️', color: '#fbbf24', texto: 'Aviso' },
  duplicada: { icono: '⚠️', color: '#fbbf24', texto: 'Ya existe' },
  error:     { icono: '❌', color: '#f87171', texto: 'Error' },
};

/**
 * Subida de varios PDF de la DIAN a la vez, con una sola contraseña
 * para todos (los PDF descargados del portal DIAN vienen protegidos).
 */
export default function SubirPdfsDian({ onClose, onTerminado }) {
  const [archivos, setArchivos] = useState([]); // { file, estado, mensaje }
  const [password, setPassword] = useState(passwordRecordada);
  const [verPassword, setVerPassword] = useState(false);
  const [subiendo, setSubiendo] = useState(false);
  const [terminado, setTerminado] = useState(false);
  const inputRef = useRef(null);

  const agregar = (lista) => {
    const nuevos = [...lista].filter(f => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
    setArchivos(prev => {
      const ya = new Set(prev.map(a => a.file.name + a.file.size));
      return [...prev, ...nuevos.filter(f => !ya.has(f.name + f.size)).map(file => ({ file, estado: 'pendiente', mensaje: '' }))];
    });
    setTerminado(false);
  };

  const actualizar = (i, cambios) => setArchivos(prev => prev.map((a, j) => (j === i ? { ...a, ...cambios } : a)));

  const subirTodos = async () => {
    passwordRecordada = password;
    setSubiendo(true);
    let huboCambios = false;
    // Uno por uno, para no saturar el servidor
    for (let i = 0; i < archivos.length; i++) {
      if (!['pendiente', 'error'].includes(archivos[i].estado)) continue;
      actualizar(i, { estado: 'subiendo', mensaje: '' });
      try {
        const fd = new FormData();
        fd.append('pdf', archivos[i].file);
        if (password) fd.append('password', password);
        const resp = await api.post('/facturas/subir-pdf', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
        huboCambios = true;
        const d = resp.data || {};
        if (d.sinPdf) actualizar(i, { estado: 'aviso', mensaje: d.mensaje });
        else if (d.pdfAdjuntado) actualizar(i, { estado: 'adjunto', mensaje: d.mensaje });
        else actualizar(i, { estado: 'ok', mensaje: d.datos ? `${d.datos.numero} · ${d.datos.proveedorNombre || ''}` : '' });
      } catch (err) {
        const data = err.response?.data || {};
        if (err.response?.status === 409) {
          actualizar(i, { estado: 'duplicada', mensaje: data.mensaje || 'La factura ya existe' });
        } else if (data.codigo === 'requiere_password') {
          actualizar(i, { estado: 'error', mensaje: 'El PDF tiene contraseña: escríbala arriba y pulse Reintentar' });
        } else if (data.codigo === 'password_incorrecta') {
          actualizar(i, { estado: 'error', mensaje: 'Contraseña incorrecta para este PDF' });
        } else {
          actualizar(i, { estado: 'error', mensaje: data.mensaje || data.error || err.message });
        }
      }
    }
    setSubiendo(false);
    setTerminado(true);
    if (huboCambios) onTerminado?.();
  };

  const conteo = archivos.reduce((c, a) => ({ ...c, [a.estado]: (c[a.estado] || 0) + 1 }), {});
  const porSubir = (conteo.pendiente || 0) + (conteo.error || 0);

  const input = { background: 'var(--t-bg-input)', border: '1px solid var(--t-border)', borderRadius: 6, color: 'var(--t-text-primary)', padding: '8px 12px', fontSize: 13 };
  const btn = (primario) => ({
    padding: '8px 16px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer',
    border: primario ? 'none' : '1px solid var(--t-border)',
    background: primario ? 'var(--t-accent, #3b82f6)' : 'transparent',
    color: primario ? '#fff' : 'var(--t-text-secondary)',
  });

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={() => !subiendo && onClose()}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: 'var(--t-bg-card)', border: '1px solid var(--t-border)', borderRadius: 12, width: '100%', maxWidth: 640, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--t-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>📤 Subir PDF DIAN</h3>
          <button onClick={onClose} disabled={subiendo} style={{ ...btn(false), padding: '4px 10px' }}>✕</button>
        </div>

        <div style={{ padding: 20, overflowY: 'auto' }}>
          {/* Contraseña (una sola para todos) */}
          <label style={{ fontSize: 12, color: 'var(--t-text-muted)', display: 'block', marginBottom: 4 }}>
            Contraseña de los PDF <span style={{ opacity: .7 }}>(una sola para todos · déjela vacía si no tienen)</span>
          </label>
          <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
            <input type={verPassword ? 'text' : 'password'} value={password} autoComplete="off"
              onChange={e => setPassword(e.target.value)} disabled={subiendo}
              placeholder="Contraseña del PDF" style={{ ...input, flex: 1 }} />
            <button type="button" onClick={() => setVerPassword(v => !v)} style={btn(false)} title="Mostrar / ocultar">
              {verPassword ? '🙈' : '👁'}
            </button>
          </div>

          {/* Selección de archivos (varios a la vez) */}
          <div onClick={() => !subiendo && inputRef.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); if (!subiendo) agregar(e.dataTransfer.files); }}
            style={{ border: '2px dashed var(--t-border)', borderRadius: 10, padding: 18, textAlign: 'center', cursor: subiendo ? 'default' : 'pointer', color: 'var(--t-text-muted)', fontSize: 13 }}>
            <div style={{ fontSize: 26 }}>📄</div>
            Haga clic para elegir los PDF (puede seleccionar varios) o arrástrelos aquí
            <input ref={inputRef} type="file" accept=".pdf,application/pdf" multiple style={{ display: 'none' }}
              onChange={e => { agregar(e.target.files); e.target.value = ''; }} />
          </div>

          {archivos.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 12, color: 'var(--t-text-muted)', marginBottom: 6 }}>
                {archivos.length} archivo(s)
                {terminado && <> · ✅ {(conteo.ok || 0) + (conteo.adjunto || 0)} subidos
                  {conteo.duplicada ? ` · ⚠️ ${conteo.duplicada} ya existían` : ''}
                  {conteo.aviso ? ` · ⚠️ ${conteo.aviso} sin PDF guardado` : ''}
                  {conteo.error ? ` · ❌ ${conteo.error} con error` : ''}</>}
              </div>
              <div style={{ border: '1px solid var(--t-border)', borderRadius: 8 }}>
                {archivos.map((a, i) => {
                  const e = ESTADOS[a.estado];
                  return (
                    <div key={a.file.name + a.file.size} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 12px', borderTop: i ? '1px solid var(--t-border)' : 'none', fontSize: 13 }}>
                      <span style={{ width: 20 }}>{e.icono}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.file.name}</div>
                        <div style={{ fontSize: 11, color: e.color }}>{e.texto}{a.mensaje ? ` · ${a.mensaje}` : ''}</div>
                      </div>
                      {a.estado === 'pendiente' && !subiendo && (
                        <button onClick={() => setArchivos(prev => prev.filter((_, j) => j !== i))}
                          style={{ ...btn(false), padding: '2px 8px', fontSize: 11 }} title="Quitar">✕</button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div style={{ padding: '14px 20px', borderTop: '1px solid var(--t-border)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} disabled={subiendo} style={btn(false)}>{terminado ? 'Cerrar' : 'Cancelar'}</button>
          <button onClick={subirTodos} disabled={subiendo || porSubir === 0} style={{ ...btn(true), opacity: subiendo || porSubir === 0 ? 0.6 : 1 }}>
            {subiendo ? '⏳ Subiendo…' : (conteo.error && terminado ? `Reintentar ${conteo.error} con error` : `Subir ${porSubir} archivo(s)`)}
          </button>
        </div>
      </div>
    </div>
  );
}

import React, { useState, useEffect, useCallback, useRef, useContext } from 'react';
import * as XLSX from 'xlsx';
import api from '../services/api';
import AuthContext from '../context/AuthContext';

// ── Bodegas conocidas (mismo listado que usa Préstamos) ───────────────────────
const BODEGAS = [
  { codigo: 'ST', nombre: 'SERVICIO TRANSFUSIONAL' },
  { codigo: '99', nombre: 'OXIGENO UCI' },
  { codigo: 'AF', nombre: 'ACTIVOS FIJOS' },
  { codigo: 'AG', nombre: 'ALMACÉN GENERAL' },
  { codigo: 'AP', nombre: 'FARMACIA AA' },
  { codigo: 'BN', nombre: 'NEFROLOGÍA' },
  { codigo: 'BO', nombre: 'BODEGA OBRA SANTANDER' },
  { codigo: 'LB', nombre: 'LABORATORIO' },
  { codigo: 'BV', nombre: 'BODEGA OBRA BOLÍVAR' },
  { codigo: 'CU', nombre: 'CUARENTENA' },
  { codigo: 'EF', nombre: 'SERVICIO DIAGNÓSTICO' },
  { codigo: 'FP', nombre: 'FARMACIA UCIS' },
  { codigo: 'NP', nombre: 'CME (CENTRAL DE MEZCLAS DE EGRESO)' },
  { codigo: 'RV', nombre: 'REMISIONES VARIAS' },
  { codigo: 'SO', nombre: 'SERVICIO AMBULATORIO' },
  { codigo: 'UP', nombre: 'MANTENIMIENTO' },
];

// ── Parseo de números en formato colombiano (punto = miles, coma = decimal) ──
function parseNumCO(v) {
  if (v === null || v === undefined || v === '') return 0;
  const s = String(v).trim();
  if (s.includes(',')) return parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0;
  const partes = s.split('.');
  if (partes.length > 1 && partes[partes.length - 1].length === 3) {
    return parseFloat(s.replace(/\./g, '')) || 0;
  }
  return parseFloat(s) || 0;
}

function fmtFechaCorta(f) {
  if (!f) return '—';
  return String(f).substring(0, 10);
}

export default function ValidadorInventario() {
  const { puede, isEditor, isAdmin } = useContext(AuthContext);
  const puedeEditarContado = isEditor || isAdmin; // solo editor/admin modifican cantidades ya guardadas
  const [bodega, setBodega] = useState('BV');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [importando, setImportando] = useState(false);
  const [busqueda, setBusqueda] = useState('');
  const [filtro, setFiltro] = useState('todos');
  const [sortCol, setSortCol] = useState(null);   // 'costo_unitario' | 'costo_total' | null
  const [sortDir, setSortDir] = useState('desc'); // 'asc' | 'desc'
  const [editValues, setEditValues] = useState({});
  const [guardandoId, setGuardandoId] = useState(null);
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);

  const cargar = useCallback(async (bod) => {
    setLoading(true);
    try {
      const res = await api.get('/validador-inventario', { params: { bodega: bod } });
      setItems(res.data || []);
    } catch (e) {
      console.error('Error cargando validador de inventario:', e);
      setError('No se pudo cargar el inventario guardado');
    }
    setLoading(false);
  }, []);

  useEffect(() => { cargar(bodega); }, [bodega, cargar]);

  // ── Cargar / actualizar Excel del sistema (SIIS) ────────────────────────────
  function handleArchivo(e) {
    const file = e.target.files[0];
    if (!file) return;
    setError('');
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const wb = XLSX.read(ev.target.result, { type: 'array', raw: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true });

        // Detectar bodega desde la cabecera del reporte (ej. "Bodega :  BV")
        let bodDetectada = bodega;
        const textoCabecera = String(data[0]?.[1] || '');
        const match = textoCabecera.match(/Bodega\s*:\s*([A-Za-z0-9]{2})/i);
        if (match) bodDetectada = match[1].toUpperCase();

        // Encontrar fila de encabezados (CODIGO, NOMBRE, ...)
        const idxHeader = data.findIndex(r => String(r[0]).trim().toUpperCase() === 'CODIGO');
        if (idxHeader === -1) {
          setError('No se encontró la columna CODIGO en el archivo. ¿Es el reporte correcto?');
          return;
        }

        const filas = data.slice(idxHeader + 1);
        const nuevosItems = [];
        let filasCorregidas = 0;

        // Detecta cuando la celda "nombre" trae pegado un fragmento de HTML roto
        // del reporte SIIS (ej. "...12”\n🔩/td>2045-06-11"). Cuando esto pasa, la
        // celda de fecha real "desaparece" de la fila y todas las columnas
        // siguientes (lote, existencia, costos) se corren una posición.
        const FRAGMENTO_ROTO_RE = /\/t[dr]>\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}-\d{1,2}-\d{1,2})\s*$/i;

        for (const r of filas) {
          const codigo = String(r[0] || '').trim();
          if (!codigo || codigo.toUpperCase().startsWith('TOTAL')) continue;

          let nombreRaw = String(r[1] || '');
          let fecha_vencimiento, lote, existencia_sistema, costo_unitario, costo_total;

          const roto = nombreRaw.match(FRAGMENTO_ROTO_RE);
          if (roto) {
            // Se recupera la fecha real desde dentro del nombre y se corrige
            // el corrimiento: lo que venía en r[2]/r[3]/r[4]/r[5] en realidad
            // corresponde a lote/existencia/costo_unitario/costo_total.
            fecha_vencimiento = roto[1];
            nombreRaw = nombreRaw.slice(0, roto.index);
            lote = String(r[2] || '').trim();
            existencia_sistema = parseNumCO(r[3]);
            costo_unitario = parseNumCO(r[4]);
            costo_total = parseNumCO(r[5]);
            filasCorregidas++;
          } else {
            fecha_vencimiento = String(r[2] || '').trim();
            lote = String(r[3] || '').trim();
            existencia_sistema = parseNumCO(r[4]);
            costo_unitario = parseNumCO(r[5]);
            costo_total = parseNumCO(r[6]);
          }

          // Limpieza general: quita tags HTML sueltos y saltos de línea que a
          // veces vienen pegados en la celda de nombre, sin importar si hubo
          // corrimiento de columnas o no
          const nombre = nombreRaw
            .replace(/<[^>]*>/g, ' ')
            .replace(/\/t[dr]>/gi, ' ')
            .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, ' ')
            .replace(/[\r\n]+/g, ' ')
            .replace(/\s{2,}/g, ' ')
            .trim();

          nuevosItems.push({ codigo, nombre, fecha_vencimiento, lote, existencia_sistema, costo_unitario, costo_total });
        }

        if (nuevosItems.length === 0) {
          setError('El archivo no tiene filas de inventario válidas');
          return;
        }

        if (filasCorregidas > 0) {
          console.warn(`Validador Inventario: se corrigieron ${filasCorregidas} fila(s) con corrimiento de columnas por HTML roto en el reporte SIIS.`);
        }

        setImportando(true);
        const res = await api.post('/validador-inventario/importar', { bodega: bodDetectada, items: nuevosItems });
        setBodega(bodDetectada);
        setItems(res.data || []);
        if (filasCorregidas > 0) {
          setError(`⚠️ Se corrigieron automáticamente ${filasCorregidas} fila(s) del Excel que tenían la fecha de vencimiento pegada al nombre (fragmento HTML roto del reporte SIIS). Revisa esos ítems para confirmar que quedaron bien.`);
        }
      } catch (err) {
        console.error(err);
        setError('Error procesando el archivo: ' + err.message);
      } finally {
        setImportando(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };
    reader.readAsArrayBuffer(file);
  }

  // ── Guardar conteo físico individual ────────────────────────────────────────
  async function guardarConteo(item) {
    const valor = editValues[item.id];
    if (valor === undefined || valor === '') return;
    setGuardandoId(item.id);
    try {
      const res = await api.patch(`/validador-inventario/${item.id}`, { cantidad_fisica: parseNumCO(valor) });
      setItems(prev => prev.map(it => (it.id === item.id ? res.data : it)));
      setEditValues(prev => { const cp = { ...prev }; delete cp[item.id]; return cp; });
    } catch (e) {
      alert('Error guardando el conteo: ' + (e.response?.data?.error || e.message));
    }
    setGuardandoId(null);
  }

  async function deshacerConteo(item) {
    if (!window.confirm(`¿Deshacer el conteo de "${item.nombre}"?`)) return;
    try {
      const res = await api.patch(`/validador-inventario/${item.id}/reset`);
      setItems(prev => prev.map(it => (it.id === item.id ? res.data : it)));
    } catch (e) {
      alert('Error: ' + (e.response?.data?.error || e.message));
    }
  }

  // ── Eliminar manualmente un item sin existencias ────────────────────────────
  // Pide confirmar qué pasó con el producto antes de dejarlo borrar, así no se
  // elimina por error algo que en realidad solo cambió de lote/fecha
  async function eliminarItem(item) {
    const motivo = window.prompt(
      `"${item.nombre}" (código ${item.codigo}) no aparece en las últimas cargas del Excel.\n\n` +
      `¿Qué sucedió con este producto? (ej. agotado, dado de baja, reemplazado por otro lote)\n` +
      `Escribe el motivo para confirmar la eliminación, o cancela si no estás seguro:`
    );
    if (motivo === null || motivo.trim() === '') return; // canceló o no escribió nada
    if (!window.confirm(`¿Confirmas eliminar definitivamente "${item.nombre}"? Esta acción no se puede deshacer.`)) return;
    try {
      await api.delete(`/validador-inventario/${item.id}`);
      setItems(prev => prev.filter(it => it.id !== item.id));
    } catch (e) {
      alert('Error eliminando el item: ' + (e.response?.data?.error || e.message));
    }
  }

  // ── Ordenamiento por columna ─────────────────────────────────────────────────
  function toggleSort(col) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('desc'); }
  }

  // ── Formato moneda COP ────────────────────────────────────────────────────────
  const fmtPesos = (n) => Number(n || 0).toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });

  // ── Filtros y ordenamiento ───────────────────────────────────────────────────
  const itemsFiltrados = items.filter(it => {
    if (busqueda) {
      const q = busqueda.toUpperCase();
      if (!it.codigo.toUpperCase().includes(q) && !it.nombre.toUpperCase().includes(q)) return false;
    }
    if (filtro === 'contados' && !it.contado) return false;
    if (filtro === 'pendientes' && it.contado) return false;
    if (filtro === 'diferencias' && (!it.contado || Number(it.cantidad_fisica) === Number(it.existencia_sistema))) return false;
    if (filtro === 'sin_existencias' && !it.sin_existencias) return false;
    return true;
  });

  if (sortCol) {
    itemsFiltrados.sort((a, b) => {
      const va = Number(a[sortCol] || 0);
      const vb = Number(b[sortCol] || 0);
      return sortDir === 'asc' ? va - vb : vb - va;
    });
  }

  const totales = {
    total: items.length,
    contados: items.filter(it => it.contado).length,
    pendientes: items.filter(it => !it.contado).length,
    diferencias: items.filter(it => it.contado && Number(it.cantidad_fisica) !== Number(it.existencia_sistema)).length,
    sinExistencias: items.filter(it => it.sin_existencias).length,
  };
  const avance = totales.total > 0 ? Math.round((totales.contados / totales.total) * 100) : 0;

  // Fecha de la última vez que se subió un Excel para esta bodega (la más reciente entre todos los ítems)
  const ultimaCarga = items.reduce((max, it) => {
    if (!it.ultima_carga) return max;
    const f = new Date(it.ultima_carga);
    return (!max || f > max) ? f : max;
  }, null);
  const ultimaCargaTexto = ultimaCarga
    ? ultimaCarga.toLocaleString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '—';

  const inputStyle = {
    background: 'var(--t-bg-input)', border: '1px solid var(--t-border)', borderRadius: 6,
    color: 'var(--t-text-primary)', padding: '6px 10px', fontSize: 13,
  };

  const card = (label, value, color) => (
    <div style={{ background: 'var(--t-bg-card)', border: '1px solid var(--t-border)', borderRadius: 10, padding: '14px 16px', flex: 1, minWidth: 120 }}>
      <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 12, color: 'var(--t-text-muted)', marginTop: 2 }}>{label}</div>
    </div>
  );

  return (
    <div style={{ maxWidth: 1300, margin: '0 auto' }}>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--t-text-primary)' }}>Validador de Inventarios</h1>
        <p style={{ fontSize: 13, color: 'var(--t-text-muted)', marginTop: 2 }}>
          Conteo físico de bodega contra el sistema — sube el Excel de SIIS cuando quieras actualizar existencias sin perder lo ya contado
        </p>
        <p style={{ fontSize: 12, color: 'var(--t-text-muted)', marginTop: 4 }}>
          Última carga de Excel para <strong>{bodega}</strong>: {ultimaCargaTexto}
        </p>
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={bodega} onChange={(e) => setBodega(e.target.value)} style={inputStyle}>
          {BODEGAS.map(b => <option key={b.codigo} value={b.codigo}>{b.codigo} — {b.nombre}</option>)}
        </select>

        <input ref={fileInputRef} type="file" accept=".xls,.xlsx" onChange={handleArchivo} style={{ display: 'none' }} id="input-excel-validador" />
        <label htmlFor="input-excel-validador" style={{
          background: 'var(--t-accent)', color: '#fff', border: 'none', borderRadius: 6,
          padding: '8px 14px', fontSize: 13, fontWeight: 500, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
        }}>
          📤 {importando ? 'Procesando…' : 'Cargar / Actualizar Excel'}
        </label>

        <input
          type="text" placeholder="Buscar código o nombre…" value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          style={{ ...inputStyle, flex: 1, minWidth: 200 }}
        />

        <select value={filtro} onChange={(e) => setFiltro(e.target.value)} style={inputStyle}>
          <option value="todos">Todos</option>
          <option value="contados">✅ Contados</option>
          <option value="pendientes">⏳ Pendientes</option>
          <option value="diferencias">⚠️ Con diferencias</option>
          <option value="sin_existencias">🚫 Sin existencias</option>
        </select>
      </div>

      {error && (
        <div style={{ background: '#3a1d1d', color: '#f87171', border: '1px solid #5c2626', borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* Resumen */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
        {card('Total ítems', totales.total, 'var(--t-text-primary)')}
        {card('Contados', totales.contados, '#4ade80')}
        {card('Pendientes', totales.pendientes, '#fbbf24')}
        {card('Con diferencias', totales.diferencias, '#f87171')}
        {card('Sin existencias', totales.sinExistencias, '#94a3b8')}
        {card('% Avance', `${avance}%`, 'var(--t-accent)')}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--t-text-muted)', fontSize: 13 }}>Cargando…</div>
      ) : items.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--t-text-muted)', fontSize: 13 }}>
          No hay inventario cargado para la bodega <strong>{bodega}</strong>. Usa "Cargar / Actualizar Excel" para empezar.
        </div>
      ) : (
        <div style={{ background: 'var(--t-bg-card)', borderRadius: 10, border: '1px solid var(--t-border)', overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--t-bg-sidebar)' }}>
                {[
                  { key: null,            label: 'Código' },
                  { key: null,            label: 'Nombre' },
                  { key: null,            label: 'Lote' },
                  { key: null,            label: 'Fecha Venc.' },
                  { key: null,            label: 'Existencia' },
                  { key: 'costo_unitario', label: 'Costo Unit.' },
                  { key: 'costo_total',    label: 'Costo Total' },
                  { key: null,            label: 'Cant. Física' },
                  { key: null,            label: 'Diferencia' },
                  { key: null,            label: 'Estado' },
                  { key: null,            label: '' },
                ].map(({ key, label }) => (
                  <th
                    key={label}
                    onClick={key ? () => toggleSort(key) : undefined}
                    style={{
                      padding: '10px 12px', textAlign: 'left', color: key ? 'var(--t-accent)' : 'var(--t-text-muted)',
                      fontWeight: 500, whiteSpace: 'nowrap', borderBottom: '1px solid var(--t-border)',
                      cursor: key ? 'pointer' : 'default', userSelect: 'none',
                    }}
                  >
                    {label}
                    {key && sortCol === key && (
                      <span style={{ marginLeft: 4 }}>{sortDir === 'asc' ? '▲' : '▼'}</span>
                    )}
                    {key && sortCol !== key && <span style={{ marginLeft: 4, opacity: 0.3 }}>⇅</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {itemsFiltrados.map(item => {
                const enEdicion = editValues[item.id] !== undefined;
                const yaContado = item.contado;
                // Si ya fue contado, solo editor/admin pueden modificar
                const puedeEditar = !yaContado || puedeEditarContado;
                const valorActual = enEdicion ? editValues[item.id] : (item.cantidad_fisica ?? '');
                const diferencia = yaContado ? Number(item.cantidad_fisica) - Number(item.existencia_sistema) : null;
                return (
                  <tr key={item.id} style={{ borderBottom: '1px solid #1a2234', opacity: item.sin_existencias ? 0.6 : 1 }}>
                    <td style={{ padding: '8px 12px', fontFamily: 'monospace', color: 'var(--t-text-secondary)' }}>{item.codigo}</td>
                    <td style={{ padding: '8px 12px', color: 'var(--t-text-primary)', maxWidth: 240 }}>{item.nombre}</td>
                    <td style={{ padding: '8px 12px', color: 'var(--t-text-secondary)' }}>{item.lote || '—'}</td>
                    <td style={{ padding: '8px 12px', color: 'var(--t-text-secondary)', whiteSpace: 'nowrap' }}>{fmtFechaCorta(item.fecha_vencimiento)}</td>
                    <td style={{ padding: '8px 12px', color: 'var(--t-text-primary)', fontFamily: 'monospace' }}>{Number(item.existencia_sistema).toLocaleString('es-CO')}</td>
                    <td style={{ padding: '8px 12px', color: 'var(--t-text-secondary)', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{fmtPesos(item.costo_unitario)}</td>
                    <td style={{ padding: '8px 12px', color: 'var(--t-text-secondary)', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{fmtPesos(item.costo_total)}</td>
                    <td style={{ padding: '8px 12px' }}>
                      {puedeEditar ? (
                        <input
                          type="number" value={valorActual}
                          onChange={(e) => setEditValues(prev => ({ ...prev, [item.id]: e.target.value }))}
                          placeholder="—"
                          style={{ ...inputStyle, width: 90, fontFamily: 'monospace' }}
                        />
                      ) : (
                        <span title="Solo editor/admin pueden modificar cantidades ya contadas"
                          style={{ color: 'var(--t-text-muted)', fontFamily: 'monospace' }}>
                          {item.cantidad_fisica ?? '—'} 🔒
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '8px 12px', fontFamily: 'monospace' }}>
                      {diferencia === null ? (
                        <span style={{ color: 'var(--t-text-muted)' }}>—</span>
                      ) : diferencia === 0 ? (
                        <span style={{ color: '#4ade80', fontWeight: 600 }}>0</span>
                      ) : (
                        <span style={{ color: '#f87171', fontWeight: 600 }}>{diferencia > 0 ? `+${diferencia}` : diferencia}</span>
                      )}
                    </td>
                    <td style={{ padding: '8px 12px' }}>
                      {item.sin_existencias && (
                        <div style={{ marginBottom: 2 }}>
                          <span style={{ background: '#2a2a35', color: '#94a3b8', padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', display: 'inline-block' }}>
                            🚫 Sin existencias
                          </span>
                          {item.sin_existencias_desde && (
                            <div style={{ fontSize: 10, color: 'var(--t-text-muted)', marginTop: 2 }}>
                              desde {fmtFechaCorta(item.sin_existencias_desde)}
                            </div>
                          )}
                        </div>
                      )}
                      {yaContado ? (
                        <div>
                          <span style={{ background: '#1e2a1e', color: '#4ade80', padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>✅ Contado</span>
                          {item.contado_en && (
                            <div style={{ fontSize: 10, color: 'var(--t-text-muted)', marginTop: 2 }}>
                              {fmtFechaCorta(item.contado_en)}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span style={{ background: 'var(--t-bg-sidebar)', color: '#fbbf24', padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>⏳ Pendiente</span>
                      )}
                    </td>
                    <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>
                      {puedeEditar && (
                        <button
                          onClick={() => guardarConteo(item)}
                          disabled={!enEdicion || guardandoId === item.id}
                          style={{
                            background: enEdicion ? 'var(--t-accent)' : 'var(--t-bg-sidebar)',
                            color: enEdicion ? '#fff' : 'var(--t-text-muted)',
                            border: 'none', borderRadius: 6, padding: '5px 10px', fontSize: 12, fontWeight: 500,
                            cursor: enEdicion ? 'pointer' : 'not-allowed', marginRight: 6,
                          }}
                        >
                          {guardandoId === item.id ? 'Guardando…' : 'Guardar'}
                        </button>
                      )}
                      {yaContado && puedeEditarContado && (
                        <button
                          onClick={() => deshacerConteo(item)}
                          title="Deshacer conteo"
                          style={{ background: 'none', border: '1px solid var(--t-border)', borderRadius: 6, padding: '5px 8px', fontSize: 12, color: 'var(--t-text-muted)', cursor: 'pointer', marginRight: 6 }}
                        >
                          ↺
                        </button>
                      )}
                      {item.sin_existencias && puedeEditarContado && (
                        <button
                          onClick={() => eliminarItem(item)}
                          title="Eliminar definitivamente (solo disponible para ítems sin existencias)"
                          style={{ background: 'none', border: '1px solid #5c2626', borderRadius: 6, padding: '5px 8px', fontSize: 12, color: '#f87171', cursor: 'pointer' }}
                        >
                          🗑️
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}










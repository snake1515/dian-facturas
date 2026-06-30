import React, { useState, useEffect, useCallback, useRef } from 'react';
import * as XLSX from 'xlsx';
import api from '../services/api';

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
  const [bodega, setBodega] = useState('BV');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [importando, setImportando] = useState(false);
  const [busqueda, setBusqueda] = useState('');
  const [filtro, setFiltro] = useState('todos'); // todos | contados | pendientes | diferencias
  const [editValues, setEditValues] = useState({}); // { [id]: 'valor en edición' }
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
        for (const r of filas) {
          const codigo = String(r[0] || '').trim();
          if (!codigo || codigo.toUpperCase().startsWith('TOTAL')) continue;
          nuevosItems.push({
            codigo,
            nombre: String(r[1] || '').trim(),
            fecha_vencimiento: String(r[2] || '').trim(),
            lote: String(r[3] || '').trim(),
            existencia_sistema: parseNumCO(r[4]),
          });
        }

        if (nuevosItems.length === 0) {
          setError('El archivo no tiene filas de inventario válidas');
          return;
        }

        setImportando(true);
        const res = await api.post('/validador-inventario/importar', { bodega: bodDetectada, items: nuevosItems });
        setBodega(bodDetectada);
        setItems(res.data || []);
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

  // ── Filtros ──────────────────────────────────────────────────────────────────
  const itemsFiltrados = items.filter(it => {
    if (busqueda) {
      const q = busqueda.toUpperCase();
      if (!it.codigo.toUpperCase().includes(q) && !it.nombre.toUpperCase().includes(q)) return false;
    }
    if (filtro === 'contados' && !it.contado) return false;
    if (filtro === 'pendientes' && it.contado) return false;
    if (filtro === 'diferencias' && (!it.contado || Number(it.cantidad_fisica) === Number(it.existencia_sistema))) return false;
    return true;
  });

  const totales = {
    total: items.length,
    contados: items.filter(it => it.contado).length,
    pendientes: items.filter(it => !it.contado).length,
    diferencias: items.filter(it => it.contado && Number(it.cantidad_fisica) !== Number(it.existencia_sistema)).length,
  };
  const avance = totales.total > 0 ? Math.round((totales.contados / totales.total) * 100) : 0;

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
                {['Código', 'Nombre', 'Lote', 'Fecha Venc.', 'Existencia Sistema', 'Cantidad Física', 'Diferencia', 'Estado', ''].map(h => (
                  <th key={h} style={{ padding: '10px 12px', textAlign: 'left', color: 'var(--t-text-muted)', fontWeight: 500, whiteSpace: 'nowrap', borderBottom: '1px solid var(--t-border)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {itemsFiltrados.map(item => {
                const enEdicion = editValues[item.id] !== undefined;
                const valorActual = enEdicion ? editValues[item.id] : (item.cantidad_fisica ?? '');
                const diferencia = item.contado ? Number(item.cantidad_fisica) - Number(item.existencia_sistema) : null;
                return (
                  <tr key={item.id} style={{ borderBottom: '1px solid #1a2234' }}>
                    <td style={{ padding: '8px 12px', fontFamily: 'monospace', color: 'var(--t-text-secondary)' }}>{item.codigo}</td>
                    <td style={{ padding: '8px 12px', color: 'var(--t-text-primary)', maxWidth: 280 }}>{item.nombre}</td>
                    <td style={{ padding: '8px 12px', color: 'var(--t-text-secondary)' }}>{item.lote || '—'}</td>
                    <td style={{ padding: '8px 12px', color: 'var(--t-text-secondary)', whiteSpace: 'nowrap' }}>{fmtFechaCorta(item.fecha_vencimiento)}</td>
                    <td style={{ padding: '8px 12px', color: 'var(--t-text-primary)', fontFamily: 'monospace' }}>{Number(item.existencia_sistema).toLocaleString('es-CO')}</td>
                    <td style={{ padding: '8px 12px' }}>
                      <input
                        type="number" value={valorActual}
                        onChange={(e) => setEditValues(prev => ({ ...prev, [item.id]: e.target.value }))}
                        placeholder="—"
                        style={{ ...inputStyle, width: 90, fontFamily: 'monospace' }}
                      />
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
                      {item.contado ? (
                        <span style={{ background: '#1e2a1e', color: '#4ade80', padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>✅ Contado</span>
                      ) : (
                        <span style={{ background: 'var(--t-bg-sidebar)', color: '#fbbf24', padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>⏳ Pendiente</span>
                      )}
                    </td>
                    <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>
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
                      {item.contado && (
                        <button
                          onClick={() => deshacerConteo(item)}
                          title="Deshacer conteo"
                          style={{ background: 'none', border: '1px solid var(--t-border)', borderRadius: 6, padding: '5px 8px', fontSize: 12, color: 'var(--t-text-muted)', cursor: 'pointer' }}
                        >
                          ↺
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

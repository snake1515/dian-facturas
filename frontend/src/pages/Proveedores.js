import React, { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../services/api';

const fmtDate = (s) => { if (!s) return '—'; const [y, m, d] = String(s).substring(0, 10).split('-'); return d && m && y ? `${d}/${m}/${y}` : s; };

const CATS = {
  obra:           { label: 'Obra',           color: '#60a5fa', bg: '#1e3a5f' },
  administrativa: { label: 'Administrativa', color: '#a78bfa', bg: '#2e1065' },
};

// Pestaña Proveedores (solo admin y editor).
// Los proveedores se registran solos a partir de las facturas que llegan.
// Aquí se clasifica cada uno como Obra o Administrativo: sus facturas y notas
// crédito van a la pestaña correspondiente.
export default function Proveedores() {
  const [proveedores, setProveedores] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [buscar, setBuscar] = useState('');
  const [filtro, setFiltro] = useState('sin_clasificar');
  const [seleccion, setSeleccion] = useState(new Set());
  const [guardandoId, setGuardandoId] = useState(null);

  const cargar = useCallback(async () => {
    try {
      setCargando(true);
      const r = await api.get('/proveedores');
      setProveedores(r.data || []);
      // Si ya no quedan sin clasificar, mostrar todos
      if (!(r.data || []).some(p => !p.categoria)) setFiltro(f => (f === 'sin_clasificar' ? '' : f));
    } catch (e) { alert(e.response?.data?.error || 'Error cargando proveedores'); }
    finally { setCargando(false); }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const avisarCambio = () => window.dispatchEvent(new Event('proveedores-actualizados'));

  const clasificar = async (p, categoria) => {
    setGuardandoId(p.id);
    try {
      await api.put(`/proveedores/${p.id}`, { categoria });
      setProveedores(prev => prev.map(x => (x.id === p.id ? { ...x, categoria } : x)));
      avisarCambio();
    } catch (e) { alert(e.response?.data?.error || 'Error al clasificar'); }
    finally { setGuardandoId(null); }
  };

  const clasificarLote = async (categoria) => {
    const ids = [...seleccion];
    if (!ids.length) return;
    if (!window.confirm(`¿Clasificar ${ids.length} proveedor(es) como ${CATS[categoria].label}?`)) return;
    try {
      await api.post('/proveedores/clasificar-lote', { ids, categoria });
      setProveedores(prev => prev.map(x => (seleccion.has(x.id) ? { ...x, categoria } : x)));
      setSeleccion(new Set());
      avisarCambio();
    } catch (e) { alert(e.response?.data?.error || 'Error al clasificar'); }
  };

  const visibles = useMemo(() => {
    const q = buscar.trim().toLowerCase();
    return proveedores.filter(p => {
      if (filtro === 'sin_clasificar' && p.categoria) return false;
      if (filtro && filtro !== 'sin_clasificar' && p.categoria !== filtro) return false;
      if (q && !(`${p.nombre || ''} ${p.nit}`.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [proveedores, buscar, filtro]);

  const conteo = useMemo(() => ({
    total: proveedores.length,
    sin: proveedores.filter(p => !p.categoria).length,
    obra: proveedores.filter(p => p.categoria === 'obra').length,
    adm: proveedores.filter(p => p.categoria === 'administrativa').length,
  }), [proveedores]);

  const todosMarcados = visibles.length > 0 && visibles.every(p => seleccion.has(p.id));
  const toggleTodos = () => setSeleccion(todosMarcados ? new Set() : new Set(visibles.map(p => p.id)));
  const toggle = (id) => setSeleccion(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const card = { background: 'var(--t-bg-card)', border: '1px solid var(--t-border)', borderRadius: 10, padding: '12px 16px' };
  const input = { background: 'var(--t-bg-input)', border: '1px solid var(--t-border)', borderRadius: 6, color: 'var(--t-text-primary)', padding: '8px 12px', fontSize: 13 };
  const th = { padding: '10px 12px', textAlign: 'left', fontSize: 11, color: 'var(--t-text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em', borderBottom: '1px solid var(--t-border)' };
  const td = { padding: '10px 12px', fontSize: 13, borderBottom: '1px solid var(--t-border)', color: 'var(--t-text-primary)' };
  const btnCat = (cat, activo) => ({
    fontSize: 12, padding: '4px 10px', borderRadius: 6, cursor: 'pointer', fontWeight: 600,
    border: `1px solid ${activo ? CATS[cat].color : 'var(--t-border)'}`,
    background: activo ? CATS[cat].bg : 'transparent',
    color: activo ? CATS[cat].color : 'var(--t-text-muted)',
  });

  return (
    <div style={{ padding: '16px 8px' }}>
      <h2 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 4px' }}>Proveedores</h2>
      <p style={{ fontSize: 13, color: 'var(--t-text-muted)', margin: '0 0 16px' }}>
        Los proveedores se agregan solos cuando llegan sus facturas. Clasifique cada uno como <b>Obra</b> o <b>Administrativo</b>:
        sus facturas y notas crédito irán a esa pestaña. Mientras no se clasifique, sus facturas aparecen en ambas.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 16 }}>
        {[
          ['sin_clasificar', 'Sin clasificar', conteo.sin, '#fbbf24'],
          ['obra', 'Obra', conteo.obra, '#60a5fa'],
          ['administrativa', 'Administrativos', conteo.adm, '#a78bfa'],
          ['', 'Todos', conteo.total, 'var(--t-text-secondary)'],
        ].map(([val, label, n, color]) => (
          <div key={label} onClick={() => setFiltro(val)} style={{ ...card, cursor: 'pointer', outline: filtro === val ? `2px solid ${color}` : 'none' }}>
            <div style={{ fontSize: 11, color: 'var(--t-text-muted)' }}>{label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color }}>{n}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <input placeholder="Buscar por nombre o NIT…" value={buscar} onChange={e => setBuscar(e.target.value)} style={{ ...input, flex: '1 1 240px' }} />
        {seleccion.size > 0 && (
          <>
            <span style={{ fontSize: 12, color: 'var(--t-text-muted)' }}>{seleccion.size} seleccionado(s):</span>
            <button onClick={() => clasificarLote('obra')} style={btnCat('obra', true)}>Clasificar como Obra</button>
            <button onClick={() => clasificarLote('administrativa')} style={btnCat('administrativa', true)}>Clasificar como Administrativo</button>
          </>
        )}
      </div>

      <div style={{ background: 'var(--t-bg-card)', border: '1px solid var(--t-border)', borderRadius: 10, overflowX: 'auto' }}>
        {cargando ? (
          <div style={{ padding: 30, textAlign: 'center', color: 'var(--t-text-muted)' }}>Cargando…</div>
        ) : visibles.length === 0 ? (
          <div style={{ padding: 30, textAlign: 'center', color: 'var(--t-text-muted)' }}>
            {filtro === 'sin_clasificar' ? '✅ No hay proveedores sin clasificar' : 'No hay proveedores para mostrar'}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ ...th, width: 32 }}><input type="checkbox" checked={todosMarcados} onChange={toggleTodos} /></th>
                <th style={th}>Proveedor</th>
                <th style={th}>NIT</th>
                <th style={th}>Facturas</th>
                <th style={th}>Notas crédito</th>
                <th style={th}>Última factura</th>
                <th style={th}>Clasificación</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map(p => (
                <tr key={p.id} style={{ background: !p.categoria ? 'rgba(251,191,36,.05)' : 'transparent' }}>
                  <td style={td}><input type="checkbox" checked={seleccion.has(p.id)} onChange={() => toggle(p.id)} /></td>
                  <td style={{ ...td, fontWeight: 500 }}>
                    {p.nombre || '—'}
                    {!p.categoria && <span style={{ marginLeft: 8, fontSize: 10, color: '#fbbf24', background: 'rgba(251,191,36,.12)', padding: '1px 6px', borderRadius: 4, fontWeight: 600 }}>NUEVO</span>}
                  </td>
                  <td style={{ ...td, fontFamily: 'monospace', color: 'var(--t-text-secondary)' }}>{p.nit}</td>
                  <td style={td}>{p.facturas}</td>
                  <td style={td}>{p.notas_credito}</td>
                  <td style={{ ...td, color: 'var(--t-text-secondary)' }}>{fmtDate(p.ultima_factura)}</td>
                  <td style={td}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {Object.keys(CATS).map(cat => (
                        <button key={cat} disabled={guardandoId === p.id} onClick={() => p.categoria !== cat && clasificar(p, cat)} style={btnCat(cat, p.categoria === cat)}>
                          {CATS[cat].label}
                        </button>
                      ))}
                    </div>
                    {p.clasificado_por && p.categoria && (
                      <div style={{ fontSize: 10, color: 'var(--t-text-muted)', marginTop: 3 }}>por {p.clasificado_por}</div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

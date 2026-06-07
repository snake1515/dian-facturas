import React, { useState, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';

const fmt  = (n) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n || 0);
const fmtDate = (s) => { if (!s) return '—'; try { const [y,m,d] = String(s).substring(0,10).split('-'); return `${d}/${m}/${y}`; } catch { return s; } };

const th = { padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--t-text-muted)', letterSpacing: '.06em', textTransform: 'uppercase' };
const td = { padding: '10px 14px', fontSize: 13, color: 'var(--t-text-primary)', verticalAlign: 'middle' };
const inputSt = { background: 'var(--t-bg-card)', border: '1px solid var(--t-border)', borderRadius: 6, padding: '8px 12px', color: 'var(--t-text-primary)', fontSize: 13, outline: 'none', boxSizing: 'border-box' };
const card = { background: 'var(--t-bg-card)', border: '1px solid var(--t-border)', borderRadius: 10, padding: '12px 14px' };

export default function Pendientes() {
  const { puede } = useAuth();

  // ── Búsqueda de factura ──────────────────────────────────────────────────
  const [busqueda, setBusqueda]     = useState('');
  const [factura, setFactura]       = useState(null);
  const [productos, setProductos]   = useState([]);
  const [buscando, setBuscando]     = useState(false);
  const [errorBusq, setErrorBusq]   = useState('');

  // ── Lista de facturas con problemas ─────────────────────────────────────
  const [lista, setLista]           = useState([]);
  const [cargandoLista, setCargandoLista] = useState(false);

  const cargarLista = useCallback(async () => {
    setCargandoLista(true);
    try {
      const res = await api.get('/pendientes');
      setLista(res.data);
    } catch (err) { console.error(err); }
    finally { setCargandoLista(false); }
  }, []);

  React.useEffect(() => { cargarLista(); }, [cargarLista]);

  const buscarFactura = async () => {
    if (!busqueda.trim()) return;
    setBuscando(true);
    setErrorBusq('');
    setFactura(null);
    setProductos([]);
    try {
      const res = await api.get(`/pendientes/factura/${encodeURIComponent(busqueda.trim())}`);
      setFactura(res.data.factura);
      setProductos(res.data.productos.map(p => ({
        ...p,
        _cantEdit: p.cantidad_recibida !== null ? String(p.cantidad_recibida) : '',
        _notaEdit: p.nota || '',
        _dirty: false,
      })));
    } catch (err) {
      setErrorBusq(err.response?.data?.error || 'Factura no encontrada');
    } finally { setBuscando(false); }
  };

  const handleKeyDown = (e) => { if (e.key === 'Enter') buscarFactura(); };

  const updateProd = (id, field, value) => {
    setProductos(prev => prev.map(p => p.id === id ? { ...p, [field]: value, _dirty: true } : p));
  };

  const guardarProducto = async (prod) => {
    try {
      const cantRecibida = prod._cantEdit !== '' ? parseFloat(prod._cantEdit) : null;
      const nota = prod._notaEdit.trim() || null;
      await api.put(`/pendientes/producto/${prod.id}`, {
        factura_id: factura.id,
        cantidad_recibida: cantRecibida,
        nota,
      });
      // Refrescar
      const res = await api.get(`/pendientes/factura/${encodeURIComponent(factura.numero)}`);
      setProductos(res.data.productos.map(p => ({
        ...p,
        _cantEdit: p.cantidad_recibida !== null ? String(p.cantidad_recibida) : '',
        _notaEdit: p.nota || '',
        _dirty: false,
      })));
      await cargarLista();
    } catch (err) {
      alert(err.response?.data?.error || 'Error al guardar');
    }
  };

  const resolverProducto = async (prod) => {
    try {
      await api.delete(`/pendientes/producto/${prod.id}`, { data: { factura_id: factura.id } });
      const res = await api.get(`/pendientes/factura/${encodeURIComponent(factura.numero)}`);
      setProductos(res.data.productos.map(p => ({
        ...p,
        _cantEdit: p.cantidad_recibida !== null ? String(p.cantidad_recibida) : '',
        _notaEdit: p.nota || '',
        _dirty: false,
      })));
      await cargarLista();
    } catch (err) {
      alert(err.response?.data?.error || 'Error al resolver');
    }
  };

  const tieneProblema = (p) =>
    p.nota || (p.cantidad_recibida !== null && parseFloat(p.cantidad_recibida) < parseFloat(p.cantidad));

  return (
    <div style={{ padding: '16px 8px' }}>

      {/* ── Buscador ───────────────────────────────────────────────────── */}
      <div style={{ ...card, marginBottom: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--t-text-primary)', marginBottom: 10 }}>
          🔍 Buscar factura por número
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            style={{ ...inputSt, flex: 1 }}
            placeholder="Ej: FE-0001 o SETP..."
            value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button
            onClick={buscarFactura}
            disabled={buscando}
            style={{ background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 18px', fontSize: 13, fontWeight: 500, cursor: 'pointer', opacity: buscando ? 0.7 : 1 }}>
            {buscando ? 'Buscando...' : 'Buscar'}
          </button>
        </div>
        {errorBusq && (
          <div style={{ marginTop: 8, fontSize: 12, color: '#f87171' }}>⚠️ {errorBusq}</div>
        )}
      </div>

      {/* ── Detalle de factura y productos ─────────────────────────────── */}
      {factura && (
        <div style={{ ...card, marginBottom: 24 }}>
          {/* Cabecera factura */}
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid var(--t-border)' }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--t-text-muted)' }}>Factura</div>
              <div style={{ fontSize: 15, fontWeight: 700, fontFamily: 'monospace', color: '#60a5fa' }}>{factura.numero}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--t-text-muted)' }}>Proveedor</div>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{factura.proveedor_nombre}</div>
              <div style={{ fontSize: 11, color: 'var(--t-text-muted)' }}>NIT {factura.proveedor_nit}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--t-text-muted)' }}>Fecha</div>
              <div style={{ fontSize: 13 }}>{fmtDate(factura.fecha_emision)}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--t-text-muted)' }}>Total</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#4ade80' }}>{fmt(factura.total)}</div>
            </div>
          </div>

          {/* Tabla productos */}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
              <thead>
                <tr style={{ background: 'var(--t-bg-sidebar)', borderBottom: '1px solid var(--t-border)' }}>
                  <th style={th}>Código</th>
                  <th style={th}>Descripción</th>
                  <th style={{ ...th, textAlign: 'right' }}>Cant. factura</th>
                  <th style={{ ...th, textAlign: 'right' }}>Cant. recibida</th>
                  <th style={th}>Nota / Problema</th>
                  {puede.editarPendientes && <th style={th}>Acciones</th>}
                </tr>
              </thead>
              <tbody>
                {productos.map(p => {
                  const problema = tieneProblema(p);
                  const rowBg = problema ? 'rgba(239,68,68,.08)' : 'transparent';
                  const borderLeft = problema ? '3px solid #ef4444' : 'none';

                  return (
                    <tr key={p.id} style={{ borderBottom: '1px solid rgba(42,51,72,.7)', background: rowBg }}>
                      <td style={{ ...td, borderLeft, fontFamily: 'monospace', fontSize: 12, color: 'var(--t-text-muted)' }}>
                        {p.codigo || '—'}
                      </td>
                      <td style={td}>{p.descripcion}</td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{p.cantidad}</td>

                      {/* Cantidad recibida — editable */}
                      <td style={{ ...td, textAlign: 'right' }}>
                        {puede.editarPendientes ? (
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={p._cantEdit}
                            onChange={e => updateProd(p.id, '_cantEdit', e.target.value)}
                            placeholder={String(p.cantidad)}
                            style={{ ...inputSt, width: 70, textAlign: 'right', padding: '4px 8px',
                              borderColor: p._cantEdit !== '' && parseFloat(p._cantEdit) < parseFloat(p.cantidad) ? '#ef4444' : 'var(--t-border)' }}
                          />
                        ) : (
                          <span style={{ color: p.cantidad_recibida !== null && parseFloat(p.cantidad_recibida) < parseFloat(p.cantidad) ? '#f87171' : 'var(--t-text-secondary)' }}>
                            {p.cantidad_recibida !== null ? p.cantidad_recibida : '—'}
                          </span>
                        )}
                      </td>

                      {/* Nota */}
                      <td style={td}>
                        {puede.editarPendientes ? (
                          <input
                            value={p._notaEdit}
                            onChange={e => updateProd(p.id, '_notaEdit', e.target.value)}
                            placeholder="Ej: llegaron rotos, faltaron 2..."
                            style={{ ...inputSt, width: '100%', minWidth: 180, padding: '4px 8px' }}
                          />
                        ) : (
                          <span style={{ fontSize: 12, color: p.nota ? '#fbbf24' : 'var(--t-text-muted)' }}>
                            {p.nota || '—'}
                          </span>
                        )}
                      </td>

                      {/* Acciones */}
                      {puede.editarPendientes && (
                        <td style={td}>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button
                              onClick={() => guardarProducto(p)}
                              disabled={!p._dirty}
                              title="Guardar cambios"
                              style={{ background: p._dirty ? '#3b82f6' : 'var(--t-bg-card)', color: p._dirty ? '#fff' : 'var(--t-text-muted)', border: '1px solid var(--t-border)', borderRadius: 5, padding: '3px 10px', fontSize: 11, cursor: p._dirty ? 'pointer' : 'default', fontWeight: 500 }}>
                              ✓ Guardar
                            </button>
                            {problema && (
                              <button
                                onClick={() => resolverProducto(p)}
                                title="Marcar como resuelto"
                                style={{ background: 'rgba(74,222,128,.1)', color: '#4ade80', border: '1px solid rgba(74,222,128,.3)', borderRadius: 5, padding: '3px 10px', fontSize: 11, cursor: 'pointer' }}>
                                ✓ Resuelto
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {productos.length === 0 && (
            <div style={{ textAlign: 'center', padding: 32, color: 'var(--t-text-muted)', fontSize: 13 }}>
              Esta factura no tiene productos registrados.
            </div>
          )}
        </div>
      )}

      {/* ── Lista facturas con problemas ────────────────────────────────── */}
      <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--t-text-primary)' }}>
          📋 Facturas con productos pendientes
          {lista.length > 0 && (
            <span style={{ marginLeft: 8, background: 'rgba(239,68,68,.15)', color: '#f87171', borderRadius: 20, padding: '1px 10px', fontSize: 12 }}>
              {lista.length}
            </span>
          )}
        </div>
        <button onClick={cargarLista} disabled={cargandoLista}
          style={{ background: 'var(--t-bg-card)', border: '1px solid var(--t-border)', borderRadius: 6, padding: '5px 12px', fontSize: 12, color: 'var(--t-text-secondary)', cursor: 'pointer' }}>
          {cargandoLista ? '⟳ Cargando...' : '⟳ Actualizar'}
        </button>
      </div>

      <div style={{ background: 'var(--t-bg-card)', border: '1px solid var(--t-border)', borderRadius: 10, overflow: 'hidden' }}>
        {cargandoLista ? (
          <div style={{ textAlign: 'center', padding: 48, color: 'var(--t-text-muted)' }}>Cargando...</div>
        ) : lista.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 48, color: 'var(--t-text-muted)' }}>
            <div style={{ fontSize: 36, marginBottom: 10 }}>✅</div>
            <p>No hay facturas con productos pendientes</p>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--t-bg-sidebar)', borderBottom: '1px solid var(--t-border)' }}>
                <th style={th}>Número</th>
                <th style={th}>Proveedor</th>
                <th style={th}>Fecha</th>
                <th style={th}>Total</th>
                <th style={{ ...th, textAlign: 'center' }}>Productos</th>
                <th style={{ ...th, textAlign: 'center' }}>Con problema</th>
                <th style={th}>Acción</th>
              </tr>
            </thead>
            <tbody>
              {lista.map(f => (
                <tr key={f.id} style={{ borderBottom: '1px solid rgba(42,51,72,.7)', background: 'rgba(239,68,68,.05)' }}>
                  <td style={{ ...td, fontFamily: 'monospace', color: '#f87171', fontWeight: 600 }}>{f.numero}</td>
                  <td style={td}>
                    <div style={{ fontWeight: 500 }}>{f.proveedor_nombre}</div>
                    <div style={{ fontSize: 11, color: 'var(--t-text-muted)' }}>NIT {f.proveedor_nit}</div>
                  </td>
                  <td style={{ ...td, color: 'var(--t-text-secondary)' }}>{fmtDate(f.fecha_emision)}</td>
                  <td style={{ ...td, fontWeight: 600 }}>{fmt(f.total)}</td>
                  <td style={{ ...td, textAlign: 'center' }}>{f.total_productos}</td>
                  <td style={{ ...td, textAlign: 'center' }}>
                    <span style={{ background: 'rgba(239,68,68,.15)', color: '#f87171', borderRadius: 20, padding: '2px 10px', fontSize: 12, fontWeight: 600 }}>
                      {f.productos_con_problema}
                    </span>
                  </td>
                  <td style={td}>
                    <button
                      onClick={() => { setBusqueda(f.numero); buscarFacturaDirecta(f.numero); }}
                      style={{ background: 'var(--t-bg-card)', border: '1px solid var(--t-border)', borderRadius: 6, padding: '4px 12px', fontSize: 12, color: 'var(--t-text-secondary)', cursor: 'pointer' }}>
                      Ver detalle →
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );

  async function buscarFacturaDirecta(numero) {
    setBuscando(true);
    setErrorBusq('');
    setFactura(null);
    setProductos([]);
    try {
      const res = await api.get(`/pendientes/factura/${encodeURIComponent(numero)}`);
      setFactura(res.data.factura);
      setProductos(res.data.productos.map(p => ({
        ...p,
        _cantEdit: p.cantidad_recibida !== null ? String(p.cantidad_recibida) : '',
        _notaEdit: p.nota || '',
        _dirty: false,
      })));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setErrorBusq(err.response?.data?.error || 'Error al cargar');
    } finally { setBuscando(false); }
  }
}

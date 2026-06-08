import React, { useState, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';

const fmt = (n) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n || 0);
const fmtDate = (s) => { if (!s) return '—'; try { const [y,m,d] = String(s).substring(0,10).split('-'); return `${d}/${m}/${y}`; } catch { return s; } };

const th = { padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--t-text-muted)', letterSpacing: '.06em', textTransform: 'uppercase' };
const td = { padding: '10px 14px', fontSize: 13, color: 'var(--t-text-primary)', verticalAlign: 'middle' };
const inputSt = { background: 'var(--t-bg-card)', border: '1px solid var(--t-border)', borderRadius: 6, padding: '8px 12px', color: 'var(--t-text-primary)', fontSize: 13, outline: 'none', boxSizing: 'border-box' };
const card = { background: 'var(--t-bg-card)', border: '1px solid var(--t-border)', borderRadius: 10, padding: '12px 14px' };

const TIPOS_PROBLEMA = [
  { value: '',                    label: 'Sin problema',          color: 'var(--t-text-muted)' },
  { value: 'cantidad_incorrecta', label: 'Cantidad incorrecta',   color: '#f59e0b' },
  { value: 'referencia_incorrecta', label: 'Referencia incorrecta', color: '#a78bfa' },
  { value: 'no_llego',            label: 'No llegó',              color: '#f87171' },
];

const TIPOS_NO_FACTURADO = [
  { value: 'no_facturado',        label: 'Producto no facturado', color: '#f87171' },
  { value: 'referencia_incorrecta', label: 'Referencia incorrecta', color: '#a78bfa' },
];

const tipoBadge = (tipo) => {
  const t = [...TIPOS_PROBLEMA, ...TIPOS_NO_FACTURADO].find(x => x.value === tipo);
  if (!t || !t.value) return null;
  return <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 20, background: t.color + '22', color: t.color }}>{t.label}</span>;
};

export default function Pendientes() {
  const { puede } = useAuth();

  const [busqueda, setBusqueda]   = useState('');
  const [factura, setFactura]     = useState(null);
  const [productos, setProductos] = useState([]);
  const [noFact, setNoFact]       = useState([]);
  const [buscando, setBuscando]   = useState(false);
  const [errorBusq, setErrorBusq] = useState('');
  const [lista, setLista]         = useState([]);
  const [cargandoLista, setCargandoLista] = useState(false);

  // Form nuevo producto no facturado
  const [formNF, setFormNF] = useState({ descripcion: '', cantidad: '', tipo_problema: 'no_facturado', nota: '' });
  const [guardandoNF, setGuardandoNF] = useState(false);

  const cargarLista = useCallback(async () => {
    setCargandoLista(true);
    try { const res = await api.get('/pendientes'); setLista(res.data); }
    catch (err) { console.error(err); }
    finally { setCargandoLista(false); }
  }, []);

  React.useEffect(() => { cargarLista(); }, [cargarLista]);

  const cargarDetalle = async (numero) => {
    const res = await api.get(`/pendientes/factura/${encodeURIComponent(numero)}`);
    setFactura(res.data.factura);
    setProductos(res.data.productos.map(p => ({
      ...p,
      _cantEdit: p.cantidad_recibida !== null ? String(p.cantidad_recibida) : '',
      _notaEdit: p.nota || '',
      _tipoEdit: p.tipo_problema || '',
      _dirty: false,
    })));
    // Cargar no facturados
    const nfRes = await api.get(`/pendientes/factura/${res.data.factura.id}/no-facturados`);
    setNoFact(nfRes.data);
  };

  const buscarFactura = async () => {
    if (!busqueda.trim()) return;
    setBuscando(true); setErrorBusq(''); setFactura(null); setProductos([]); setNoFact([]);
    try { await cargarDetalle(busqueda.trim()); }
    catch (err) { setErrorBusq(err.response?.data?.error || 'Factura no encontrada'); }
    finally { setBuscando(false); }
  };

  const buscarFacturaDirecta = async (numero) => {
    setBuscando(true); setBusqueda(numero); setErrorBusq(''); setFactura(null); setProductos([]); setNoFact([]);
    try { await cargarDetalle(numero); window.scrollTo({ top: 0, behavior: 'smooth' }); }
    catch (err) { setErrorBusq(err.response?.data?.error || 'Error al cargar'); }
    finally { setBuscando(false); }
  };

  const updateProd = (id, field, value) => setProductos(prev => prev.map(p => p.id === id ? { ...p, [field]: value, _dirty: true } : p));

  const guardarProducto = async (prod) => {
    try {
      const cantRecibida = prod._cantEdit !== '' ? parseFloat(prod._cantEdit) : null;
      const nota = prod._notaEdit.trim() || null;
      const tipo_problema = prod._tipoEdit || null;
      await api.put(`/pendientes/producto/${prod.id}`, { factura_id: factura.id, cantidad_recibida: cantRecibida, nota, tipo_problema });
      await cargarDetalle(factura.numero);
      await cargarLista();
    } catch (err) { alert(err.response?.data?.error || 'Error al guardar'); }
  };

  const resolverProducto = async (prod) => {
    try {
      await api.delete(`/pendientes/producto/${prod.id}`, { data: { factura_id: factura.id } });
      await cargarDetalle(factura.numero);
      await cargarLista();
    } catch (err) { alert(err.response?.data?.error || 'Error al resolver'); }
  };

  const agregarNoFact = async () => {
    if (!formNF.descripcion.trim()) return alert('Ingresa una descripción');
    setGuardandoNF(true);
    try {
      await api.post('/pendientes/no-facturado', { factura_id: factura.id, ...formNF });
      setFormNF({ descripcion: '', cantidad: '', tipo_problema: 'no_facturado', nota: '' });
      const nfRes = await api.get(`/pendientes/factura/${factura.id}/no-facturados`);
      setNoFact(nfRes.data);
      await cargarLista();
    } catch (err) { alert(err.response?.data?.error || 'Error al guardar'); }
    finally { setGuardandoNF(false); }
  };

  const eliminarNoFact = async (id) => {
    if (!window.confirm('¿Eliminar este registro?')) return;
    try {
      await api.delete(`/pendientes/no-facturado/${id}`);
      setNoFact(prev => prev.filter(x => x.id !== id));
      await cargarLista();
    } catch (err) { alert('Error al eliminar'); }
  };

  const tieneProblema = (p) => p.tipo_problema || p.nota || (p.cantidad_recibida !== null && parseFloat(p.cantidad_recibida) < parseFloat(p.cantidad));

  return (
    <div style={{ padding: '16px 8px' }}>

      {/* ── Buscador ─────────────────────────────────────────────────────── */}
      <div style={{ ...card, marginBottom: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--t-text-primary)', marginBottom: 10 }}>🔍 Buscar factura por número</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input style={{ ...inputSt, flex: 1 }} placeholder="Ej: FE-0001 o SETP..." value={busqueda}
            onChange={e => setBusqueda(e.target.value)} onKeyDown={e => e.key === 'Enter' && buscarFactura()} />
          <button onClick={buscarFactura} disabled={buscando}
            style={{ background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 18px', fontSize: 13, fontWeight: 500, cursor: 'pointer', opacity: buscando ? 0.7 : 1 }}>
            {buscando ? 'Buscando...' : 'Buscar'}
          </button>
        </div>
        {errorBusq && <div style={{ marginTop: 8, fontSize: 12, color: '#f87171' }}>⚠️ {errorBusq}</div>}
      </div>

      {/* ── Detalle factura ───────────────────────────────────────────────── */}
      {factura && (
        <div style={{ ...card, marginBottom: 24 }}>
          {/* Header */}
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid var(--t-border)' }}>
            <div><div style={{ fontSize: 11, color: 'var(--t-text-muted)' }}>Factura</div>
              <div style={{ fontSize: 15, fontWeight: 700, fontFamily: 'monospace', color: '#60a5fa' }}>{factura.numero}</div></div>
            <div><div style={{ fontSize: 11, color: 'var(--t-text-muted)' }}>Proveedor</div>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{factura.proveedor_nombre}</div>
              <div style={{ fontSize: 11, color: 'var(--t-text-muted)' }}>NIT {factura.proveedor_nit}</div></div>
            <div><div style={{ fontSize: 11, color: 'var(--t-text-muted)' }}>Fecha</div>
              <div style={{ fontSize: 13 }}>{fmtDate(factura.fecha_emision)}</div></div>
            <div><div style={{ fontSize: 11, color: 'var(--t-text-muted)' }}>Total</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#4ade80' }}>{fmt(factura.total)}</div></div>
          </div>

          {/* ── Productos de la factura ─────────────────────────────────── */}
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--t-text-muted)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>
            Productos facturados
          </div>
          <div style={{ overflowX: 'auto', marginBottom: 24 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 750 }}>
              <thead>
                <tr style={{ background: 'var(--t-bg-sidebar)', borderBottom: '1px solid var(--t-border)' }}>
                  <th style={th}>Código</th>
                  <th style={th}>Descripción</th>
                  <th style={{ ...th, textAlign: 'right' }}>Cant. factura</th>
                  <th style={{ ...th, textAlign: 'right' }}>Cant. recibida</th>
                  <th style={th}>Tipo problema</th>
                  <th style={th}>Nota</th>
                  {puede.editarPendientes && <th style={th}>Acciones</th>}
                </tr>
              </thead>
              <tbody>
                {productos.map(p => {
                  const problema = tieneProblema(p);
                  return (
                    <tr key={p.id} style={{ borderBottom: '1px solid rgba(42,51,72,.7)', background: problema ? 'rgba(239,68,68,.06)' : 'transparent' }}>
                      <td style={{ ...td, borderLeft: problema ? '3px solid #ef4444' : 'none', fontFamily: 'monospace', fontSize: 12, color: 'var(--t-text-muted)' }}>{p.codigo || '—'}</td>
                      <td style={td}>{p.descripcion}</td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{p.cantidad}</td>

                      {/* Cantidad recibida */}
                      <td style={{ ...td, textAlign: 'right' }}>
                        {puede.editarPendientes ? (
                          <input type="number" min="0" step="1" value={p._cantEdit}
                            onChange={e => updateProd(p.id, '_cantEdit', e.target.value)}
                            placeholder={String(p.cantidad)}
                            style={{ ...inputSt, width: 70, textAlign: 'right', padding: '4px 8px',
                              borderColor: p._cantEdit !== '' && parseFloat(p._cantEdit) < parseFloat(p.cantidad) ? '#ef4444' : 'var(--t-border)' }} />
                        ) : (
                          <span style={{ color: p.cantidad_recibida !== null && parseFloat(p.cantidad_recibida) < parseFloat(p.cantidad) ? '#f87171' : 'var(--t-text-secondary)' }}>
                            {p.cantidad_recibida !== null ? p.cantidad_recibida : '—'}
                          </span>
                        )}
                      </td>

                      {/* Tipo problema */}
                      <td style={td}>
                        {puede.editarPendientes ? (
                          <select value={p._tipoEdit} onChange={e => updateProd(p.id, '_tipoEdit', e.target.value)}
                            style={{ ...inputSt, padding: '4px 8px', fontSize: 11, width: 160 }}>
                            {TIPOS_PROBLEMA.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                          </select>
                        ) : tipoBadge(p.tipo_problema)}
                      </td>

                      {/* Nota */}
                      <td style={td}>
                        {puede.editarPendientes ? (
                          <input value={p._notaEdit} onChange={e => updateProd(p.id, '_notaEdit', e.target.value)}
                            placeholder="Observación..."
                            style={{ ...inputSt, width: '100%', minWidth: 150, padding: '4px 8px' }} />
                        ) : (
                          <span style={{ fontSize: 12, color: p.nota ? '#fbbf24' : 'var(--t-text-muted)' }}>{p.nota || '—'}</span>
                        )}
                      </td>

                      {/* Acciones */}
                      {puede.editarPendientes && (
                        <td style={td}>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button onClick={() => guardarProducto(p)} disabled={!p._dirty}
                              style={{ background: p._dirty ? '#3b82f6' : 'var(--t-bg-card)', color: p._dirty ? '#fff' : 'var(--t-text-muted)', border: '1px solid var(--t-border)', borderRadius: 5, padding: '3px 10px', fontSize: 11, cursor: p._dirty ? 'pointer' : 'default', fontWeight: 500 }}>
                              ✓ Guardar
                            </button>
                            {problema && (
                              <button onClick={() => resolverProducto(p)}
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

          {/* ── Productos no facturados ─────────────────────────────────── */}
          <div style={{ borderTop: '1px solid var(--t-border)', paddingTop: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--t-text-muted)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 10 }}>
              Productos no facturados / referencias incorrectas
              {noFact.length > 0 && <span style={{ marginLeft: 8, background: 'rgba(239,68,68,.15)', color: '#f87171', borderRadius: 20, padding: '1px 8px', fontSize: 11 }}>{noFact.length}</span>}
            </div>

            {/* Lista existentes */}
            {noFact.length > 0 && (
              <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 14 }}>
                <thead>
                  <tr style={{ background: 'var(--t-bg-sidebar)', borderBottom: '1px solid var(--t-border)' }}>
                    <th style={th}>Descripción</th>
                    <th style={{ ...th, textAlign: 'right' }}>Cantidad</th>
                    <th style={th}>Tipo</th>
                    <th style={th}>Nota</th>
                    {puede.editarPendientes && <th style={th}></th>}
                  </tr>
                </thead>
                <tbody>
                  {noFact.map(nf => (
                    <tr key={nf.id} style={{ borderBottom: '1px solid rgba(42,51,72,.7)', background: 'rgba(239,68,68,.04)' }}>
                      <td style={{ ...td, borderLeft: '3px solid #f87171' }}>{nf.descripcion}</td>
                      <td style={{ ...td, textAlign: 'right', color: 'var(--t-text-secondary)' }}>{nf.cantidad || '—'}</td>
                      <td style={td}>{tipoBadge(nf.tipo_problema)}</td>
                      <td style={{ ...td, fontSize: 12, color: '#fbbf24' }}>{nf.nota || '—'}</td>
                      {puede.editarPendientes && (
                        <td style={td}>
                          <button onClick={() => eliminarNoFact(nf.id)}
                            style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: 13 }}>🗑</button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* Formulario agregar */}
            {puede.editarPendientes && (
              <div style={{ background: 'var(--t-bg-app)', border: '1px solid var(--t-border)', borderRadius: 8, padding: '12px 14px' }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--t-text-secondary)', marginBottom: 10 }}>+ Registrar producto no facturado</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                  <div style={{ flex: '2 1 200px' }}>
                    <div style={{ fontSize: 11, color: 'var(--t-text-muted)', marginBottom: 4 }}>Descripción *</div>
                    <input style={{ ...inputSt, padding: '6px 10px' }} value={formNF.descripcion}
                      onChange={e => setFormNF({ ...formNF, descripcion: e.target.value })}
                      placeholder="Ej: Tornillos M6 x 20mm" />
                  </div>
                  <div style={{ flex: '0 1 80px' }}>
                    <div style={{ fontSize: 11, color: 'var(--t-text-muted)', marginBottom: 4 }}>Cantidad</div>
                    <input type="number" min="0" style={{ ...inputSt, padding: '6px 10px' }} value={formNF.cantidad}
                      onChange={e => setFormNF({ ...formNF, cantidad: e.target.value })} placeholder="0" />
                  </div>
                  <div style={{ flex: '1 1 160px' }}>
                    <div style={{ fontSize: 11, color: 'var(--t-text-muted)', marginBottom: 4 }}>Tipo</div>
                    <select style={{ ...inputSt, padding: '6px 10px', fontSize: 11 }} value={formNF.tipo_problema}
                      onChange={e => setFormNF({ ...formNF, tipo_problema: e.target.value })}>
                      {TIPOS_NO_FACTURADO.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </div>
                  <div style={{ flex: '2 1 160px' }}>
                    <div style={{ fontSize: 11, color: 'var(--t-text-muted)', marginBottom: 4 }}>Nota</div>
                    <input style={{ ...inputSt, padding: '6px 10px' }} value={formNF.nota}
                      onChange={e => setFormNF({ ...formNF, nota: e.target.value })}
                      placeholder="Observación adicional..." />
                  </div>
                  <button onClick={agregarNoFact} disabled={guardandoNF}
                    style={{ background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, padding: '7px 14px', fontSize: 12, fontWeight: 500, cursor: 'pointer', opacity: guardandoNF ? 0.7 : 1, flexShrink: 0 }}>
                    {guardandoNF ? 'Guardando...' : '+ Agregar'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Lista facturas con problemas ─────────────────────────────────── */}
      <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--t-text-primary)' }}>
          📋 Facturas con productos pendientes
          {lista.length > 0 && <span style={{ marginLeft: 8, background: 'rgba(239,68,68,.15)', color: '#f87171', borderRadius: 20, padding: '1px 10px', fontSize: 12 }}>{lista.length}</span>}
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
                    <button onClick={() => buscarFacturaDirecta(f.numero)}
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
}

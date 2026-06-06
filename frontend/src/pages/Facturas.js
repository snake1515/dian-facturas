import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  listarFacturas, obtenerFactura, actualizarResponsables, reenviarFactura,
  eliminarFactura, eliminarPorFechas, gmailSync, actualizarEstadoContable, actualizarContrato,
  actualizarDocumentoIngreso, listarContactos, crearContacto, eliminarContacto
} from '../services/api';
import api from '../services/api';

const fmt = (n) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n || 0);
const fmtDate = (s) => { if (!s) return '—'; try { const solo = String(s).substring(0, 10); const [y, m, d] = solo.split('-'); if (!y || !m || !d) return s; return d+'/'+m+'/'+y; } catch(e) { return s; } };

const descargarArchivo = async (id, tipo) => {
  const token = localStorage.getItem('token');
  const base = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';
  const url = base + '/facturas/' + id + '/' + tipo;
  try {
    const res = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
    if (!res.ok) { alert('Archivo no disponible'); return; }
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = tipo + '_factura_' + id + (tipo === 'pdf' ? '.pdf' : '.xml');
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (err) { alert('Error al descargar: ' + err.message); }
};

const ESTADOS_CONTABLES = [
  { value: 'por_gestionar',             label: 'Por gestionar',              color: 'var(--t-text-secondary)', bg: 'var(--t-bg-card)' },
  { value: 'recibio_inventarios',       label: 'Recibió inventarios',        color: '#fbbf24', bg: '#451a03' },
  { value: 'recibio_contabilidad',      label: 'Recibió contabilidad',       color: '#60a5fa', bg: '#1e3a5f' },
  { value: 'ingresado_caja_menor',      label: 'Ingresado por caja menor',   color: '#a78bfa', bg: '#2e1065' },
  { value: 'ingresado_orden_compra',    label: 'Ingresado por orden de compra', color: '#f472b6', bg: '#4a044e' },
  { value: 'aprobado',                  label: 'Aprobado',                   color: '#4ade80', bg: '#052e16' },
];

export default function Facturas({ tipo = 'FE' }) {
  const { puede, isAdmin } = useAuth();
  const [facturas, setFacturas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [search, setSearch] = useState('');
  const [filterEstado, setFilterEstado] = useState('');
  const [filterEstadoContable, setFilterEstadoContable] = useState('');
  const [filterMes, setFilterMes] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [modal, setModal] = useState(null);
  const [activeF, setActiveF] = useState(null);
  const [respEmails, setRespEmails] = useState([]);
  const [contactos, setContactos] = useState([]);
  const [newEmail, setNewEmail] = useState('');
  const [newNombre, setNewNombre] = useState('');
  const [reenvioEmails, setReenvioEmails] = useState([]);
  const [reenvioMsg, setReenvioMsg] = useState('');
  const [deleteRange, setDeleteRange] = useState({ desde: '', hasta: '', tipo: '' });
  const [actionLoading, setActionLoading] = useState(false);
  const [syncModal, setSyncModal] = useState(false);
  const [syncRange, setSyncRange] = useState({ desde: '', hasta: '' });

  // Sort
  const [sortCol, setSortCol] = useState('fecha_emision');
  const [sortDir, setSortDir] = useState('desc');

  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(t);
  }, [search]);

  const cargar = useCallback(async () => {
    try {
      setLoading(true);
      const res = await listarFacturas({
        tipo,
        search: debouncedSearch || undefined,
        estado: filterEstado || undefined,
        estado_contable: filterEstadoContable || undefined,
      });
      setFacturas(res.data);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, [tipo, debouncedSearch, filterEstado, filterEstadoContable]);

  const cargarContactos = useCallback(async () => {
    try { const res = await listarContactos(); setContactos(res.data || []); }
    catch (err) { console.error(err); }
  }, []);

  useEffect(() => { cargar(); cargarContactos(); }, [cargar, cargarContactos]);

  // Sort logic (client-side)
  const facturasFiltradas = facturas.filter(f => {
    if (!filterMes) return true;
    const fecha = String(f.fecha_emision || '').substring(0, 7); // YYYY-MM
    return fecha === filterMes;
  });

  const sortedFacturas = [...facturasFiltradas].sort((a, b) => {
    let va = a[sortCol], vb = b[sortCol];
    if (sortCol === 'total' || sortCol === 'subtotal') { va = parseFloat(va||0); vb = parseFloat(vb||0); }
    else if (sortCol === 'fecha_emision') { va = va || ''; vb = vb || ''; }
    else { va = (va||'').toString().toLowerCase(); vb = (vb||'').toString().toLowerCase(); }
    if (va < vb) return sortDir === 'asc' ? -1 : 1;
    if (va > vb) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  const handleSort = (col) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('asc'); }
  };

  const SortIcon = ({ col }) => {
    if (sortCol !== col) return <span style={{ color: 'var(--t-border)', marginLeft: 4 }}>↕</span>;
    return <span style={{ color: '#3b82f6', marginLeft: 4 }}>{sortDir === 'asc' ? '↑' : '↓'}</span>;
  };

  const handleSync = async () => {
    setSyncing(true);
    try { await gmailSync(); await cargar(); }
    catch (err) { alert('Error al sincronizar: ' + (err.response?.data?.error || err.message)); }
    finally { setSyncing(false); setSyncModal(false); }
  };

  const handleSyncRango = async () => {
    if (!syncRange.desde || !syncRange.hasta) return alert('Selecciona las fechas');
    setSyncing(true);
    try { await gmailSync({ desde: syncRange.desde, hasta: syncRange.hasta }); await cargar(); }
    catch (err) { alert('Error al sincronizar: ' + (err.response?.data?.error || err.message)); }
    finally { setSyncing(false); setSyncModal(false); }
  };

  const openModal = async (m, f) => {
    const fActual = facturas.find(x => x.id === f.id) || f;
    setActiveF(fActual); setModal(m);
    if (m === 'responsables') setRespEmails([...(fActual.responsables || [])]);
    if (m === 'reenviar') {
      const responsables = fActual.responsables || [];
      setReenvioEmails(responsables.length > 0 ? [...responsables] : []);
    }
    // Fetch full factura with productos when opening detail
    if (m === 'ver') {
      try {
        const res = await obtenerFactura(f.id);
        setActiveF(res.data);
      } catch (err) { console.error('Error cargando detalle:', err); }
    }
  };
  const closeModal = () => { setModal(null); setActiveF(null); setNewEmail(''); setNewNombre(''); setReenvioMsg(''); };

  const guardarResponsables = async () => {
    setActionLoading(true);
    try {
      await actualizarResponsables(activeF.id, respEmails);
      setFacturas(prev => prev.map(f => f.id === activeF.id ? { ...f, responsables: respEmails } : f));
      closeModal(); cargar();
    } catch (err) { alert(err.response?.data?.error || 'Error'); }
    finally { setActionLoading(false); }
  };

  const confirmarReenvio = async () => {
    if (!reenvioEmails.length) return alert('Agrega al menos un destinatario');
    setActionLoading(true);
    try {
      const destinatarios = reenvioEmails.map(r => typeof r === 'string' ? { email: r, nombre: null } : r);
      await reenviarFactura(activeF.id, { destinatarios, mensaje: reenvioMsg });
      await cargar(); closeModal();
    } catch (err) { alert(err.response?.data?.error || 'Error al reenviar'); }
    finally { setActionLoading(false); }
  };

  const handleEliminar = async (id) => {
    if (!window.confirm('¿Eliminar esta factura?')) return;
    try { await eliminarFactura(id); await cargar(); }
    catch (err) { alert(err.response?.data?.error || 'Error'); }
  };

  const handleEliminarSeleccionados = async () => {
    if (!window.confirm(`¿Eliminar ${selected.size} factura(s)?`)) return;
    try { await Promise.all([...selected].map(id => eliminarFactura(id))); setSelected(new Set()); await cargar(); }
    catch (err) { alert(err.response?.data?.error || 'Error'); }
  };

  const handleBorrarPorFechas = async () => {
    if (!deleteRange.desde || !deleteRange.hasta) return alert('Selecciona las fechas');
    if (!window.confirm('Esta acción es permanente. ¿Continuar?')) return;
    setActionLoading(true);
    try { const res = await eliminarPorFechas(deleteRange); alert(`Se eliminaron ${res.data.eliminadas} documentos`); setModal(null); await cargar(); }
    catch (err) { alert(err.response?.data?.error || 'Error'); }
    finally { setActionLoading(false); }
  };

  const toggleSelect = (id) => { const n = new Set(selected); n.has(id) ? n.delete(id) : n.add(id); setSelected(n); };
  const toggleAll = () => { if (selected.size === facturas.length) setSelected(new Set()); else setSelected(new Set(facturas.map(f => f.id))); };

  const estadoBadge = (f) => {
    const map = { pendiente: ['#fbbf24', '#451a03', 'Pendiente'], procesado: ['#60a5fa', '#1e3a5f', 'Procesado'], reenviado: ['#4ade80', '#052e16', 'Reenviado'] };
    const [c, bg, label] = map[f.estado] || ['var(--t-text-secondary)', 'var(--t-bg-card)', f.estado];
    return <span style={{ background: bg, color: c, padding: '2px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600 }}>{label}</span>;
  };

  const totales = { docs: facturasFiltradas.length, pendientes: facturasFiltradas.filter(f => f.estado === 'pendiente').length, valor: facturasFiltradas.reduce((a, f) => a + Math.abs(parseFloat(f.total || 0)), 0) };

  // Detectar doc_ingreso duplicados
  const docIngresoCount = {};
  facturas.forEach(f => { if (f.documento_ingreso) { docIngresoCount[f.documento_ingreso] = (docIngresoCount[f.documento_ingreso] || 0) + 1; } });
  const docIngresoDuplicado = (doc) => doc && docIngresoCount[doc] > 1;

  // Detectar facturas cruzadas con nota crédito
  // Si tipo=FE, buscar si alguna NC tiene documento_ingreso = numero de esta factura
  // Si tipo=NC, buscar en facturas FE
  const ncPorFactura = {};
  if (tipo === 'FE') {
    // Necesitamos las NC — las buscamos de la lista si están cargadas, sino marcamos vacío
    facturas.forEach(f => {
      // Las NC se identifican por tipo NC en otra pestaña; aquí usamos una prop del backend
      if (f.nc_referencia) ncPorFactura[f.nc_referencia] = true;
    });
  }

  // Meses disponibles para filtro
  const mesesDisponibles = [...new Set(facturas.map(f => String(f.fecha_emision || '').substring(0, 7)).filter(Boolean))].sort().reverse();

  const thSort = (col, label) => (
    <th style={{ ...th, cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }} onClick={() => handleSort(col)}>
      {label}<SortIcon col={col} />
    </th>
  );

  return (
    <div style={{ padding: '16px 8px' }}>
      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 16 }}>
        {[
          { label: tipo === 'FE' ? 'Facturas' : 'Notas crédito', val: totales.docs, sub: 'documentos', color: '#3b82f6' },
          { label: 'Pendientes', val: totales.pendientes, sub: 'sin procesar', color: '#f59e0b' },
          { label: 'Valor total', val: fmt(totales.valor), sub: 'acumulado', color: '#22c55e' },
        ].map(s => (
          <div key={s.label} style={card}>
            <div style={{ fontSize: 11, color: 'var(--t-text-muted)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.color, display: 'inline-block' }} />{s.label}
            </div>
            <div style={{ fontSize: typeof s.val === 'string' ? 15 : 22, fontWeight: 700, color: 'var(--t-text-primary)' }}>{s.val}</div>
            <div style={{ fontSize: 11, color: 'var(--t-text-muted)', marginTop: 2 }}>{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <input style={{ ...inputSt, flex: '1 1 180px', minWidth: 140 }} placeholder="Buscar proveedor, número, valor, doc. ingreso..." value={search} onChange={e => setSearch(e.target.value)} />
        <select style={{ ...inputSt, flex: '0 1 150px' }} value={filterEstado} onChange={e => setFilterEstado(e.target.value)}>
          <option value="">Todos los estados</option>
          <option value="pendiente">Pendiente</option>
          <option value="procesado">Procesado</option>
          <option value="reenviado">Reenviado</option>
        </select>
        <select style={{ ...inputSt, flex: '0 1 140px' }} value={filterMes} onChange={e => setFilterMes(e.target.value)}>
          <option value="">Todos los meses</option>
          {mesesDisponibles.map(m => {
            const [y, mo] = m.split('-');
            const nombre = new Date(parseInt(y), parseInt(mo)-1, 1).toLocaleString('es-CO', { month: 'long', year: 'numeric' });
            return <option key={m} value={m}>{nombre.charAt(0).toUpperCase() + nombre.slice(1)}</option>;
          })}
        </select>
        <select style={{ ...inputSt, flex: '0 1 170px' }} value={filterEstadoContable} onChange={e => setFilterEstadoContable(e.target.value)}>
          <option value="">Todo estado contable</option>
          {ESTADOS_CONTABLES.map(e => <option key={e.value} value={e.value}>{e.label}</option>)}
        </select>
        {puede.eliminarFacturas && selected.size > 0 && (
          <button style={btnDanger} onClick={handleEliminarSeleccionados}>🗑 Eliminar ({selected.size})</button>
        )}
        {puede.borrarPorFechas && (
          <button style={btnDanger} onClick={() => setModal('deleteRange')}>📅 Borrar por fechas</button>
        )}
        {puede.sincronizar && (
          <button style={{ ...btnGhost, ...(syncing ? { color: '#3b82f6' } : {}) }} onClick={() => setSyncModal(true)} disabled={syncing}>
            {syncing ? '⟳ Sincronizando...' : '⟳ Sincronizar'}
          </button>
        )}
        <button style={btnGhost} onClick={() => setModal('exportar')} title="Descargar reporte Excel">
          📥 Exportar
        </button>
      </div>

      {/* Tabla */}
      <div style={{ background: 'var(--t-bg-card)', border: '1px solid var(--t-border)', borderRadius: 10, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 48, color: 'var(--t-text-muted)' }}>Cargando...</div>
        ) : facturas.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 48, color: 'var(--t-text-muted)' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📄</div>
            <p>No hay {tipo === 'FE' ? 'facturas' : 'notas crédito'} registradas</p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
              <thead>
                <tr style={{ background: 'var(--t-bg-sidebar)', borderBottom: '1px solid var(--t-border)' }}>
                  <th style={th}><input type="checkbox" checked={selected.size === facturas.length && facturas.length > 0} onChange={toggleAll} /></th>
                  <th style={th}>Tipo</th>
                  {thSort('numero', 'Número')}
                  {thSort('proveedor_nombre', 'Proveedor')}
                  {thSort('fecha_emision', 'Fecha')}
                  {thSort('total', 'Total')}
                  {thSort('estado', 'Estado')}
                  <th style={th}>Responsable</th>
                  {thSort('documento_ingreso', 'Doc. ingreso')}
                  {thSort('estado_contable', 'Est. contable')}
                  <th style={th}>Notas</th>
                  <th style={th}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {sortedFacturas.map(f => {
                  const filaRoja = docIngresoDuplicado(f.documento_ingreso);
                  return (
                  <tr key={f.id} style={{ borderBottom: '1px solid rgba(42,51,72,.7)', cursor: 'pointer', background: filaRoja ? 'rgba(239,68,68,.10)' : selected.has(f.id) ? 'rgba(59,130,246,.08)' : 'transparent' }}
                    onClick={() => openModal('ver', f)}>
                    <td style={td} onClick={e => e.stopPropagation()}><input type="checkbox" checked={selected.has(f.id)} onChange={() => toggleSelect(f.id)} /></td>
                    <td style={td}><span style={{ background: f.tipo === 'FE' ? '#1e3a5f' : '#052e16', color: f.tipo === 'FE' ? '#60a5fa' : '#4ade80', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 700 }}>{f.tipo}</span></td>
                    <td style={{ ...td, fontFamily: 'monospace', fontSize: 13, color: '#c8d0e0', whiteSpace: 'nowrap', fontWeight: 500 }}>{f.numero}</td>
                    <td style={td}>
                      <div style={{ fontWeight: 500, color: 'var(--t-text-primary)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.proveedor_nombre}</div>
                      <div style={{ fontSize: 11, color: 'var(--t-text-muted)' }}>NIT: {f.proveedor_nit}</div>
                    </td>
                    <td style={{ ...td, color: 'var(--t-text-secondary)', whiteSpace: 'nowrap' }}>{fmtDate(f.fecha_emision)}</td>
                    <td style={{ ...td, fontWeight: 600, color: parseFloat(f.total) < 0 ? '#f87171' : 'var(--t-text-primary)', whiteSpace: 'nowrap' }}>{fmt(f.total)}</td>
                    <td style={td}>{estadoBadge(f)}</td>
                    <td style={td} onClick={e => e.stopPropagation()}>
                      <ResponsableSelect factura={f} contactos={contactos} onUpdate={cargar} canEdit={puede.editarResponsables !== false} />
                    </td>
                    <td style={{ ...td, borderLeft: filaRoja ? '3px solid #ef4444' : 'none' }} onClick={e => e.stopPropagation()}>
                      <DocIngresoInput factura={f} onUpdate={cargar} canEdit={puede.editarDocIngreso} />
                      {filaRoja && <span style={{ fontSize: 10, color: '#f87171', display: 'block', marginTop: 2 }}>⚠ duplicado</span>}
                    </td>
                    <td style={td} onClick={e => e.stopPropagation()}>
                      <BarraProgreso factura={f} onUpdate={cargar} canEdit={puede.editarEstadoContable} esCruzada={tipo === 'FE' && facturas.some(nc => nc.tipo === 'NC' && nc.documento_ingreso === f.numero)} />
                    </td>
                    <td style={td} onClick={e => e.stopPropagation()}>
                      <NotasInput factura={f} onUpdate={cargar} canEdit={puede.editarNotas} />
                    </td>
                    <td style={td} onClick={e => e.stopPropagation()}>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button style={iconBtn} title="Ver detalle" onClick={() => openModal('ver', f)}>👁</button>
                        <button style={iconBtn} title="Responsables" onClick={() => openModal('responsables', f)}>👤</button>
                        <button style={iconBtn} title="Reenviar" onClick={() => openModal('reenviar', f)}>📤</button>
                        <button style={iconBtn} title="PDF" onClick={() => descargarArchivo(f.id, 'pdf')}>📄</button>
                        <button style={iconBtn} title="XML" onClick={() => descargarArchivo(f.id, 'xml')}>📋</button>
                        {puede.eliminarFacturas && <button style={{ ...iconBtn, color: '#f87171' }} title="Eliminar" onClick={() => handleEliminar(f.id)}>🗑</button>}
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* MODAL VER DETALLE */}
      {modal === 'ver' && activeF && (
        <Modal title={`${activeF.tipo === 'FE' ? 'Factura' : 'Nota crédito'} ${activeF.numero}`} onClose={closeModal}>
          <Section title="Proveedor">
            <Grid2>
              <Item label="Nombre" val={activeF.proveedor_nombre} />
              <Item label="NIT" val={activeF.proveedor_nit} />
              <Item label="Número" val={activeF.numero} />
              <Item label="CUFE" val={activeF.cufe ? activeF.cufe.substring(0, 20) + '...' : '—'} />
              <Item label="Fecha emisión" val={fmtDate(activeF.fecha_emision)} />
              <Item label="Fecha vencimiento" val={fmtDate(activeF.fecha_vencimiento)} />
              <Item label="Estado" val={estadoBadge(activeF)} />
              {activeF.reenviado_a && <Item label="Reenviado a" val={<span style={{ color: '#4ade80' }}>{activeF.reenviado_a}</span>} />}
            </Grid2>
          </Section>
          {activeF.productos?.length > 0 && (
            <Section title="Productos / Servicios">
              <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                <thead>
                  <tr>{['Código', 'Descripción', 'Cant.', 'P. Unit.', 'Total'].map(h => (
                    <th key={h} style={{ padding: '6px 8px', textAlign: 'left', color: 'var(--t-text-muted)', borderBottom: '1px solid var(--t-border)', fontSize: 10, textTransform: 'uppercase' }}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {activeF.productos.map((p, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid rgba(42,51,72,.5)' }}>
                      <td style={{ padding: '8px', color: 'var(--t-text-muted)', fontFamily: 'monospace', fontSize: 11 }}>{p.codigo || '—'}</td>
                      <td style={{ padding: '8px' }}>{p.descripcion}</td>
                      <td style={{ padding: '8px', textAlign: 'right', color: 'var(--t-text-secondary)' }}>{p.cantidad}</td>
                      <td style={{ padding: '8px', textAlign: 'right', color: 'var(--t-text-secondary)' }}>{fmt(p.precioUnitario || p.precio_unitario)}</td>
                      <td style={{ padding: '8px', textAlign: 'right', fontWeight: 600 }}>{fmt(p.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          )}
          <Section title="Totales">
            <TotalRow label="Subtotal" val={fmt(activeF.subtotal)} />
            <TotalRow label="IVA" val={fmt(activeF.iva)} />
            <TotalRow label="Total" val={<span style={{ color: parseFloat(activeF.total) < 0 ? '#f87171' : '#4ade80', fontSize: 16 }}>{fmt(activeF.total)}</span>} grand />
          </Section>
          {activeF.notas && (
            <Section title="Notas">
              <div style={{ fontSize: 13, color: 'var(--t-text-secondary)', whiteSpace: 'pre-wrap' }}>{activeF.notas}</div>
            </Section>
          )}
          {/* Toggle contrato */}
          {activeF.tipo === 'FE' && puede.editarEstadoContable && (
            <div style={{ marginTop: 16, padding: '12px 14px', background: 'var(--t-bg-card)', borderRadius: 8, border: '0.5px solid var(--t-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 16 }}>📄</span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>Es un contrato</div>
                  <div style={{ fontSize: 11, color: 'var(--t-text-muted)' }}>Omite el flujo de aprobación</div>
                </div>
              </div>
              <div
                onClick={async () => {
                  try {
                    await actualizarContrato(activeF.id, !activeF.es_contrato);
                    setActiveF(prev => ({ ...prev, es_contrato: !prev.es_contrato }));
                    await cargar();
                  } catch { alert('Error al actualizar'); }
                }}
                style={{ width: 38, height: 22, background: activeF.es_contrato ? 'var(--t-text-secondary)' : 'var(--t-border)', borderRadius: 11, cursor: 'pointer', position: 'relative', transition: 'background .2s', flexShrink: 0 }}>
                <div style={{ position: 'absolute', top: 3, left: activeF.es_contrato ? 19 : 3, width: 16, height: 16, background: '#fff', borderRadius: '50%', transition: 'left .2s' }} />
              </div>
            </div>
          )}
        </Modal>
      )}

      {/* MODAL RESPONSABLES */}
      {modal === 'responsables' && activeF && (
        <Modal title={`Responsables — ${activeF.numero}`} onClose={closeModal} footer={
          <><button style={btnGhost} onClick={closeModal}>Cancelar</button>
          <button style={btnPrimary} onClick={guardarResponsables} disabled={actionLoading}>{actionLoading ? 'Guardando...' : 'Guardar'}</button></>
        }>
          {contactos.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <p style={{ fontSize: 12, color: 'var(--t-text-secondary)', marginBottom: 8 }}>Seleccionar de contactos:</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {contactos.map(c => {
                  const ya = respEmails.some(r => (typeof r === 'string' ? r : r.email) === c.email);
                  return <button key={c.id} onClick={() => { if (ya) setRespEmails(respEmails.filter(r => (typeof r === 'string' ? r : r.email) !== c.email)); else setRespEmails([...respEmails, { email: c.email, nombre: c.nombre }]); }} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 20, border: '1px solid', borderColor: ya ? 'var(--t-accent)' : 'var(--t-border)', background: ya ? 'rgba(59,130,246,.15)' : 'var(--t-bg-app)', color: ya ? '#60a5fa' : 'var(--t-text-secondary)', cursor: 'pointer' }}>{ya ? '✓ ' : ''}{c.nombre} ({c.email})</button>;
                })}
              </div>
            </div>
          )}
          <p style={{ fontSize: 12, color: 'var(--t-text-secondary)', marginBottom: 8 }}>Asignados:</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, background: 'var(--t-bg-app)', border: '1px solid var(--t-border)', borderRadius: 6, padding: 8, minHeight: 44, marginBottom: 12 }}>
            {respEmails.map((r, i) => {
              const email = typeof r === 'string' ? r : r.email;
              const nombre = typeof r === 'string' ? null : r.nombre;
              return <span key={email} style={{ background: 'rgba(59,130,246,.15)', color: '#60a5fa', borderRadius: 20, padding: '2px 10px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>{nombre ? `${nombre} <${email}>` : email}<span style={{ cursor: 'pointer', color: 'var(--t-text-muted)' }} onClick={() => setRespEmails(respEmails.filter((_, j) => j !== i))}>×</span></span>;
            })}
          </div>
          <p style={{ fontSize: 12, color: 'var(--t-text-secondary)', marginBottom: 6 }}>Agregar manualmente:</p>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <input style={{ ...inputSt, flex: '1 1 120px' }} placeholder="Nombre (opcional)" value={newNombre} onChange={e => setNewNombre(e.target.value)} />
            <input style={{ ...inputSt, flex: '1 1 150px' }} placeholder="correo@empresa.com" value={newEmail} onChange={e => setNewEmail(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && newEmail.includes('@')) { setRespEmails([...respEmails, { email: newEmail.trim(), nombre: newNombre.trim() || null }]); setNewEmail(''); setNewNombre(''); } }} />
            <button style={btnGhost} onClick={() => { if (newEmail.includes('@')) { setRespEmails([...respEmails, { email: newEmail.trim(), nombre: newNombre.trim() || null }]); setNewEmail(''); setNewNombre(''); } }}>+ Agregar</button>
          </div>
        </Modal>
      )}

      {/* MODAL REENVIAR */}
      {modal === 'reenviar' && activeF && (
        <Modal title="Reenviar factura" onClose={closeModal} footer={
          <><button style={btnGhost} onClick={closeModal}>Cancelar</button>
          <button style={btnPrimary} onClick={confirmarReenvio} disabled={actionLoading}>{actionLoading ? 'Enviando...' : '📤 Enviar'}</button></>
        }>
          <div style={{ background: 'var(--t-bg-app)', borderRadius: 8, padding: '10px 12px', marginBottom: 16 }}>
            <div style={{ fontWeight: 500 }}>{activeF.proveedor_nombre}</div>
            <div style={{ color: 'var(--t-text-muted)', fontSize: 12 }}>{activeF.numero} · {fmt(activeF.total)}</div>
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={labelSt}>Destinatarios</label>
            {activeF.responsables?.length > 0 ? activeF.responsables.map(r => {
              const email = typeof r === 'string' ? r : r.email;
              const nombre = typeof r === 'string' ? null : r.nombre;
              return <label key={email} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--t-border)', fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox" checked={reenvioEmails.some(x => (typeof x === 'string' ? x : x.email) === email)} onChange={e => setReenvioEmails(e.target.checked ? [...reenvioEmails, { email, nombre }] : reenvioEmails.filter(x => (typeof x === 'string' ? x : x.email) !== email))} />
                {nombre ? `${nombre} <${email}>` : email}
              </label>;
            }) : <p style={{ fontSize: 12, color: 'var(--t-text-muted)' }}>Sin responsables. Agrega uno abajo.</p>}
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={labelSt}>Destinatario adicional</label>
            <input style={inputSt} type="email" placeholder="correo@empresa.com" onKeyDown={e => { if (e.key === 'Enter' && e.target.value.includes('@')) { setReenvioEmails([...reenvioEmails, e.target.value]); e.target.value = ''; } }} />
          </div>
          <div>
            <label style={labelSt}>Mensaje (opcional)</label>
            <textarea style={{ ...inputSt, resize: 'vertical', minHeight: 80 }} value={reenvioMsg} onChange={e => setReenvioMsg(e.target.value)} placeholder="Adjunto encontrará la factura..." />
          </div>
        </Modal>
      )}

      {/* MODAL BORRAR POR FECHAS */}
      {modal === 'deleteRange' && (
        <Modal title="Borrar por rango de fechas" onClose={closeModal} footer={
          <><button style={btnGhost} onClick={closeModal}>Cancelar</button>
          <button style={btnDanger} onClick={handleBorrarPorFechas} disabled={actionLoading}>{actionLoading ? 'Eliminando...' : '🗑 Eliminar'}</button></>
        }>
          <div style={{ background: 'rgba(245,158,11,.08)', border: '1px solid rgba(245,158,11,.3)', borderRadius: 6, padding: '10px 12px', fontSize: 12, color: '#fbbf24', marginBottom: 16 }}>⚠️ Esta acción es permanente.</div>
          <div style={{ marginBottom: 12 }}><label style={labelSt}>Fecha desde</label><input style={inputSt} type="date" value={deleteRange.desde} onChange={e => setDeleteRange({ ...deleteRange, desde: e.target.value })} /></div>
          <div style={{ marginBottom: 12 }}><label style={labelSt}>Fecha hasta</label><input style={inputSt} type="date" value={deleteRange.hasta} onChange={e => setDeleteRange({ ...deleteRange, hasta: e.target.value })} /></div>
          <div><label style={labelSt}>Tipo</label>
            <select style={inputSt} value={deleteRange.tipo} onChange={e => setDeleteRange({ ...deleteRange, tipo: e.target.value })}>
              <option value="">Todos</option><option value="FE">Solo facturas</option><option value="NC">Solo notas crédito</option>
            </select>
          </div>
        </Modal>
      )}

      {/* MODAL EXPORTAR */}
      {modal === 'exportar' && (
        <ExportModal facturas={sortedFacturas} tipo={tipo} onClose={closeModal} />
      )}

      {/* MODAL SINCRONIZAR */}
      {syncModal && (
        <Modal title="Sincronizar Gmail" onClose={() => setSyncModal(false)} footer={
          <><button style={btnGhost} onClick={() => setSyncModal(false)}>Cancelar</button>
          <button style={btnGhost} onClick={handleSync} disabled={syncing}>⟳ Sincronizar todo</button>
          <button style={btnPrimary} onClick={handleSyncRango} disabled={syncing}>{syncing ? 'Sincronizando...' : '⟳ Sincronizar rango'}</button></>
        }>
          <p style={{ fontSize: 13, color: 'var(--t-text-secondary)', marginBottom: 16 }}>Sincroniza todos los correos o selecciona un rango de fechas específico.</p>
          <div style={{ marginBottom: 12 }}><label style={labelSt}>Desde</label><input style={inputSt} type="date" value={syncRange.desde} onChange={e => setSyncRange({ ...syncRange, desde: e.target.value })} /></div>
          <div><label style={labelSt}>Hasta</label><input style={inputSt} type="date" value={syncRange.hasta} onChange={e => setSyncRange({ ...syncRange, hasta: e.target.value })} /></div>
        </Modal>
      )}
    </div>
  );
}

// ── Notas Input ───────────────────────────────────────────────────────────────
function NotasInput({ factura, onUpdate, canEdit }) {
  const [editing, setEditing] = React.useState(false);
  const [val, setVal] = React.useState(factura.notas || '');
  const [saving, setSaving] = React.useState(false);

  const handleSave = async () => {
    setSaving(true);
    try { await api.put(`/facturas/${factura.id}/notas`, { notas: val }); await onUpdate(); setEditing(false); }
    catch { alert('Error al guardar notas'); }
    finally { setSaving(false); }
  };

  if (!canEdit) return <span style={{ fontSize: 12, color: factura.notas ? 'var(--t-text-primary)' : 'var(--t-text-muted)' }}>{factura.notas || '—'}</span>;

  if (editing) return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }} onClick={e => e.stopPropagation()}>
      <input autoFocus value={val} onChange={e => setVal(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setEditing(false); }}
        style={{ width: 110, background: 'var(--t-bg-card)', border: '1px solid #3b82f6', borderRadius: 4, padding: '2px 6px', color: 'var(--t-text-primary)', fontSize: 12 }} placeholder="Nota..." />
      <button onClick={handleSave} disabled={saving} style={{ background: '#3b82f6', border: 'none', borderRadius: 4, color: '#fff', padding: '2px 6px', fontSize: 11, cursor: 'pointer' }}>✓</button>
      <button onClick={() => setEditing(false)} style={{ background: 'none', border: 'none', color: 'var(--t-text-muted)', cursor: 'pointer', fontSize: 13 }}>✕</button>
    </div>
  );

  return <span onClick={e => { e.stopPropagation(); setEditing(true); }} style={{ fontSize: 12, color: factura.notas ? 'var(--t-text-primary)' : 'var(--t-text-muted)', cursor: 'pointer', padding: '2px 4px', borderRadius: 4 }} title="Clic para editar">{factura.notas || '+ Agregar'}</span>;
}

// ── Doc Ingreso Input ─────────────────────────────────────────────────────────
function DocIngresoInput({ factura, onUpdate, canEdit }) {
  const [editing, setEditing] = React.useState(false);
  const [val, setVal] = React.useState(factura.documento_ingreso || '');
  const [saving, setSaving] = React.useState(false);

  const handleSave = async () => {
    setSaving(true);
    try { await actualizarDocumentoIngreso(factura.id, val); await onUpdate(); setEditing(false); }
    catch { alert('Error al guardar documento de ingreso'); }
    finally { setSaving(false); }
  };

  if (!canEdit) return <span style={{ fontSize: 12, color: factura.documento_ingreso ? 'var(--t-text-primary)' : 'var(--t-text-muted)' }}>{factura.documento_ingreso || '—'}</span>;

  if (editing) return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }} onClick={e => e.stopPropagation()}>
      <input autoFocus value={val} onChange={e => setVal(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setEditing(false); }}
        style={{ width: 90, background: 'var(--t-bg-card)', border: '1px solid #3b82f6', borderRadius: 4, padding: '2px 6px', color: 'var(--t-text-primary)', fontSize: 12 }} placeholder="Ej: OC-001" />
      <button onClick={handleSave} disabled={saving} style={{ background: '#3b82f6', border: 'none', borderRadius: 4, color: '#fff', padding: '2px 6px', fontSize: 11, cursor: 'pointer' }}>✓</button>
      <button onClick={() => setEditing(false)} style={{ background: 'none', border: 'none', color: 'var(--t-text-muted)', cursor: 'pointer', fontSize: 13 }}>✕</button>
    </div>
  );

  return <span onClick={e => { e.stopPropagation(); setEditing(true); }} style={{ fontSize: 12, color: factura.documento_ingreso ? 'var(--t-text-primary)' : 'var(--t-text-muted)', cursor: 'pointer', padding: '2px 4px', borderRadius: 4 }} title="Clic para editar">{factura.documento_ingreso || '+ Agregar'}</span>;
}

// ── Responsable Select inline ─────────────────────────────────────────────────
function ResponsableSelect({ factura, contactos, onUpdate, canEdit }) {
  const [saving, setSaving] = React.useState(false);

  const responsableActual = factura.responsables?.[0];
  const nombreActual = responsableActual
    ? (typeof responsableActual === 'string' ? responsableActual : (responsableActual.nombre || responsableActual.email))
    : null;

  if (!canEdit || contactos.length === 0) {
    return factura.reenviado_a
      ? <span style={{ fontSize: 11, color: '#4ade80' }}>✓ {nombreActual || factura.reenviado_a}</span>
      : nombreActual
        ? <span style={{ fontSize: 11, color: 'var(--t-text-secondary)' }}>{nombreActual}</span>
        : <span style={{ fontSize: 11, color: 'var(--t-text-muted)' }}>Sin asignar</span>;
  }

  const handleChange = async (e) => {
    const val = e.target.value;
    setSaving(true);
    try {
      const contacto = contactos.find(c => c.email === val);
      const nuevos = val ? [{ email: contacto.email, nombre: contacto.nombre }] : [];
      await actualizarResponsables(factura.id, nuevos);
      await onUpdate();
    } catch { alert('Error al asignar responsable'); }
    finally { setSaving(false); }
  };

  const emailActual = responsableActual ? (typeof responsableActual === 'string' ? responsableActual : responsableActual.email) : '';

  return (
    <select value={emailActual} onChange={handleChange} disabled={saving} onClick={e => e.stopPropagation()}
      style={{ background: 'var(--t-bg-card)', border: '1px solid var(--t-border)', borderRadius: 6, color: emailActual ? 'var(--t-text-primary)' : 'var(--t-text-muted)', fontSize: 11, padding: '3px 6px', cursor: 'pointer', outline: 'none', maxWidth: 130, opacity: saving ? 0.6 : 1 }}>
      <option value="">Sin asignar</option>
      {contactos.map(c => <option key={c.email} value={c.email}>{c.nombre}</option>)}
    </select>
  );
}

// ── Barra de Progreso Estado Contable ────────────────────────────────────────
const FLUJO_OC = [
  { value: 'por_gestionar', label: 'Por gestionar' },
  { value: 'ingresado_orden_compra', label: 'Ing. OC' },
  { value: 'recibio_inventarios', label: 'Rec. inventarios' },
  { value: 'recibio_contabilidad', label: 'Rec. contabilidad' },
  { value: 'aprobado', label: 'Aprobado' },
];
const FLUJO_CM = [
  { value: 'por_gestionar', label: 'Por gestionar' },
  { value: 'ingresado_caja_menor', label: 'Ing. caja menor' },
  { value: 'aprobado', label: 'Aprobado' },
];

function BarraProgreso({ factura, onUpdate, canEdit, esCruzada }) {
  const [saving, setSaving] = React.useState(false);
  const estado = factura.estado_contable || 'por_gestionar';
  const esContrato = factura.es_contrato;

  // Si es contrato → badge gris
  if (esContrato) {
    return (
      <span style={{ display:'inline-flex', alignItems:'center', gap:4, fontSize:11, fontWeight:500, padding:'3px 10px', borderRadius:20, background:'var(--t-bg-card)', color:'var(--t-text-secondary)', border:'0.5px solid var(--t-border)' }}>
        📄 Contrato
      </span>
    );
  }

  // Si está cruzada con NC → badge naranja
  if (esCruzada) {
    return (
      <span style={{ display:'inline-flex', alignItems:'center', gap:4, fontSize:11, fontWeight:500, padding:'3px 10px', borderRadius:20, background:'#FAEEDA', color:'#854F0B' }}>
        🔄 Cruzado con nota crédito
      </span>
    );
  }

  // Determinar flujo según estado actual
  const esCM = estado === 'ingresado_caja_menor' || (estado === 'aprobado' && factura.flujo_tipo === 'caja_menor');
  const flujo = esCM ? FLUJO_CM : FLUJO_OC;

  // Si es por_gestionar y no tiene flujo, mostrar selector de tipo
  const sinFlujo = estado === 'por_gestionar' && !factura.flujo_tipo;

  const stepIdx = flujo.findIndex(s => s.value === estado);
  const current = stepIdx >= 0 ? stepIdx : 0;
  const pct = flujo.length > 1 ? (current / (flujo.length - 1)) * 100 : 0;
  const completo = estado === 'aprobado';

  const avanzar = async (val) => {
    if (!canEdit || saving) return;
    setSaving(true);
    try {
      const flujoTipo = FLUJO_CM.some(s => s.value === val) && val !== 'aprobado' ? 'caja_menor' : (val === 'ingresado_orden_compra' ? 'orden_compra' : factura.flujo_tipo);
      await actualizarEstadoContable(factura.id, val, flujoTipo);
      await onUpdate();
    } catch { alert('Error al actualizar'); }
    finally { setSaving(false); }
  };

  const trackColor = esCM ? '#a78bfa' : '#185FA5';
  const doneColor = completo ? '#3B6D11' : trackColor;

  return (
    <div style={{ minWidth: 180, opacity: saving ? 0.6 : 1 }} onClick={e => e.stopPropagation()}>
      {sinFlujo && canEdit && (
        <div style={{ marginBottom: 5 }}>
          <div style={{ fontSize: 10, color:'var(--t-text-muted)', marginBottom: 3 }}>¿Cómo ingresa?</div>
          <div style={{ display:'flex', gap:4 }}>
            <button onClick={() => avanzar('ingresado_orden_compra')} style={{ fontSize:10, padding:'2px 7px', borderRadius:5, border:'0.5px solid var(--t-border)', background:'var(--t-bg-card)', color:'var(--t-text-secondary)', cursor:'pointer' }}>📋 OC</button>
            <button onClick={() => avanzar('ingresado_caja_menor')} style={{ fontSize:10, padding:'2px 7px', borderRadius:5, border:'0.5px solid var(--t-border)', background:'var(--t-bg-card)', color:'#a78bfa', cursor:'pointer' }}>💵 Caja menor</button>
          </div>
        </div>
      )}
      <div style={{ height:4, background:'var(--t-border)', borderRadius:2, marginBottom:5, position:'relative' }}>
        <div style={{ position:'absolute', top:0, left:0, height:'100%', width:`${pct}%`, background: completo ? '#3B6D11' : trackColor, borderRadius:2, transition:'width .3s' }} />
      </div>
      <div style={{ display:'flex', justifyContent:'space-between' }}>
        {flujo.map((s, i) => {
          const done = i < current;
          const active = i === current;
          const color = completo ? '#3B6D11' : (done || active ? trackColor : 'var(--t-border)');
          return (
            <div key={s.value} style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:2, flex:1, cursor: canEdit && i === current + 1 ? 'pointer' : 'default' }}
              onClick={() => canEdit && i === current + 1 && avanzar(s.value)}>
              <div style={{ width:9, height:9, borderRadius:'50%', background: done || active ? color : 'var(--t-bg-card)', border:`1.5px solid ${color}`, boxShadow: active ? `0 0 0 3px ${color}33` : 'none', transition:'all .2s' }} />
              <span style={{ fontSize:9, color: active ? color : 'var(--t-text-muted)', fontWeight: active ? 600 : 400, textAlign:'center', lineHeight:1.2, maxWidth:55, wordBreak:'break-word' }}>{s.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// EstadoContableSelect legacy (usado en modal de ver)
function EstadoContableSelect({ factura, onUpdate, canEdit }) {
  const [saving, setSaving] = React.useState(false);
  const current = factura.estado_contable || 'por_gestionar';
  const est = ESTADOS_CONTABLES.find(e => e.value === current) || ESTADOS_CONTABLES[0];

  if (!canEdit) return <span style={{ background: est.bg, color: est.color, padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600 }}>{est.label}</span>;

  return (
    <select value={current} onChange={async e => { setSaving(true); try { await actualizarEstadoContable(factura.id, e.target.value); await onUpdate(); } catch { alert('Error'); } finally { setSaving(false); } }}
      disabled={saving} onClick={e => e.stopPropagation()}
      style={{ background: est.bg, color: est.color, border: '1px solid rgba(255,255,255,.08)', borderRadius: 6, padding: '3px 8px', fontSize: 11, fontWeight: 600, cursor: 'pointer', outline: 'none', opacity: saving ? 0.6 : 1 }}>
      {ESTADOS_CONTABLES.map(e => <option key={e.value} value={e.value}>{e.label}</option>)}
    </select>
  );
}

// ── Componentes auxiliares ────────────────────────────────────────────────────
const Modal = ({ title, children, onClose, footer }) => (
  <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }} onClick={e => e.target === e.currentTarget && onClose()}>
    <div style={{ background: 'var(--t-bg-sidebar)', border: '1px solid var(--t-border)', borderRadius: 14, width: 600, maxWidth: '100%', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--t-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontWeight: 600, fontSize: 15 }}>{title}</span>
        <button style={{ background: 'var(--t-bg-card)', border: 'none', color: 'var(--t-text-secondary)', borderRadius: 6, width: 28, height: 28, cursor: 'pointer', fontSize: 16 }} onClick={onClose}>×</button>
      </div>
      <div style={{ padding: 20, overflowY: 'auto', flex: 1 }}>{children}</div>
      {footer && <div style={{ padding: '14px 20px', borderTop: '1px solid var(--t-border)', display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>{footer}</div>}
    </div>
  </div>
);
const Section = ({ title, children }) => <div style={{ marginBottom: 20 }}><div style={{ fontSize: 11, fontWeight: 600, color: 'var(--t-text-muted)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 10, paddingBottom: 6, borderBottom: '1px solid var(--t-border)' }}>{title}</div>{children}</div>;
const Grid2 = ({ children }) => <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>{children}</div>;
const Item = ({ label, val }) => <div><div style={{ fontSize: 11, color: 'var(--t-text-muted)' }}>{label}</div><div style={{ fontSize: 13, fontWeight: 500, marginTop: 2 }}>{val}</div></div>;
const TotalRow = ({ label, val, grand }) => <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', fontSize: grand ? 14 : 13, fontWeight: grand ? 600 : 400, color: grand ? 'var(--t-text-primary)' : 'var(--t-text-secondary)', borderTop: grand ? '1px solid #2a3348' : 'none', marginTop: grand ? 4 : 0 }}><span>{label}</span><span>{val}</span></div>;


// ── ExportModal ───────────────────────────────────────────────────────────────
function ExportModal({ facturas, tipo, onClose }) {
  const [desde, setDesde] = React.useState('');
  const [hasta, setHasta] = React.useState('');

  const filtered = facturas.filter(f => {
    if (desde && f.fecha_emision < desde) return false;
    if (hasta && f.fecha_emision > hasta) return false;
    return true;
  });

  const exportar = () => {
    const ESTADOS = {
      por_gestionar: 'Por gestionar', recibio_inventarios: 'Recibió inventarios',
      recibio_contabilidad: 'Recibió contabilidad', ingresado_caja_menor: 'Ingresado por caja menor',
      ingresado_orden_compra: 'Ingresado por orden de compra', aprobado: 'Aprobado',
    };
    const headers = ['Tipo','Número','Proveedor','NIT','Fecha Emisión','Subtotal','IVA','Total',
      'Estado','Estado Contable','Doc. Ingreso','Responsables','Reenviado a','CUFE'];
    const rows = filtered.map(f => [
      f.tipo, f.numero, f.proveedor_nombre, f.proveedor_nit,
      f.fecha_emision ? String(f.fecha_emision).substring(0,10) : '',
      f.subtotal || 0, f.iva || 0, f.total || 0,
      f.estado || '', ESTADOS[f.estado_contable] || f.estado_contable || '',
      f.documento_ingreso || '',
      (f.responsables || []).map(r => typeof r === 'string' ? r : (r.nombre ? r.nombre+' <'+r.email+'>' : r.email)).join('; '),
      f.reenviado_a || '', f.cufe || '',
    ]);

    // Build CSV with BOM for Excel spanish encoding
    const bom = '\uFEFF';
    const csv = bom + [headers, ...rows].map(row =>
      row.map(v => {
        const s = String(v).replace(/"/g, '""');
        return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s}"` : s;
      }).join(',')
    ).join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `reporte_${tipo}_${desde||'todo'}_${hasta||'todo'}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    onClose();
  };

  const inputSt2 = { width: '100%', background: 'var(--t-bg-app)', border: '1px solid var(--t-border)', borderRadius: 6, padding: '8px 12px', color: 'var(--t-text-primary)', fontSize: 13, outline: 'none', boxSizing: 'border-box' };

  return (
    <Modal title={`Exportar reporte — ${tipo === 'FE' ? 'Facturas' : 'Notas crédito'}`} onClose={onClose} footer={
      <>
        <button style={{ background: 'var(--t-bg-card)', color: 'var(--t-text-secondary)', border: '1px solid var(--t-border)', borderRadius: 6, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }} onClick={onClose}>Cancelar</button>
        <button style={{ background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', fontSize: 13, fontWeight: 500, cursor: 'pointer' }} onClick={exportar}>
          📥 Descargar CSV ({filtered.length} registros)
        </button>
      </>
    }>
      <p style={{ fontSize: 12, color: 'var(--t-text-secondary)', marginBottom: 16 }}>
        Filtra por rango de fechas o deja vacío para exportar todo. El archivo abre directamente en Excel.
      </p>
      <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
        <div style={{ flex: 1 }}>
          <label style={{ display: 'block', fontSize: 11, color: 'var(--t-text-muted)', marginBottom: 4 }}>Desde</label>
          <input style={inputSt2} type="date" value={desde} onChange={e => setDesde(e.target.value)} />
        </div>
        <div style={{ flex: 1 }}>
          <label style={{ display: 'block', fontSize: 11, color: 'var(--t-text-muted)', marginBottom: 4 }}>Hasta</label>
          <input style={inputSt2} type="date" value={hasta} onChange={e => setHasta(e.target.value)} />
        </div>
      </div>
      <div style={{ background: 'var(--t-bg-app)', borderRadius: 6, padding: '10px 12px', fontSize: 12, color: 'var(--t-text-muted)' }}>
        📋 Se exportarán <strong style={{ color: 'var(--t-text-primary)' }}>{filtered.length}</strong> registros con todas las columnas: tipo, número, proveedor, NIT, fecha, subtotal, IVA, total, estado, estado contable, documento de ingreso, responsables, CUFE.
      </div>
    </Modal>
  );
}

const card = { background: 'var(--t-bg-card)', border: '1px solid var(--t-border)', borderRadius: 10, padding: '12px 14px' };
const th = { padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--t-text-muted)', letterSpacing: '.06em', textTransform: 'uppercase' };
const td = { padding: '10px 14px', fontSize: 13, color: 'var(--t-text-primary)', verticalAlign: 'middle' };
const inputSt = { width: '100%', background: 'var(--t-bg-card)', border: '1px solid var(--t-border)', borderRadius: 6, padding: '8px 12px', color: 'var(--t-text-primary)', fontSize: 13, outline: 'none', boxSizing: 'border-box' };
const labelSt = { display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--t-text-secondary)', marginBottom: 6 };
const btnPrimary = { background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, padding: '7px 14px', fontSize: 12, fontWeight: 500, cursor: 'pointer' };
const btnGhost = { background: 'var(--t-bg-card)', color: 'var(--t-text-secondary)', border: '1px solid var(--t-border)', borderRadius: 6, padding: '7px 14px', fontSize: 12, cursor: 'pointer' };
const btnDanger = { background: 'rgba(239,68,68,.1)', color: '#f87171', border: '1px solid rgba(239,68,68,.3)', borderRadius: 6, padding: '7px 14px', fontSize: 12, cursor: 'pointer' };
const iconBtn = { background: 'none', border: 'none', cursor: 'pointer', padding: '4px 5px', borderRadius: 4, fontSize: 14 };




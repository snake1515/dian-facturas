import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  listarFacturas, actualizarResponsables, reenviarFactura,
  eliminarFactura, eliminarPorFechas, gmailSync, urlPDF, urlXML
} from '../services/api';

const fmt = (n) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n || 0);
const fmtDate = (s) => { if (!s) return '—'; const d = new Date(s + 'T00:00:00'); return d.toLocaleDateString('es-CO'); };

export default function Facturas({ tipo = 'FE' }) {
  const { isAdmin } = useAuth();
  const [facturas, setFacturas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [search, setSearch] = useState('');
  const [filterEstado, setFilterEstado] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [modal, setModal] = useState(null);
  const [activeF, setActiveF] = useState(null);
  const [respEmails, setRespEmails] = useState([]);
  const [newEmail, setNewEmail] = useState('');
  const [reenvioEmails, setReenvioEmails] = useState([]);
  const [reenvioMsg, setReenvioMsg] = useState('');
  const [deleteRange, setDeleteRange] = useState({ desde: '', hasta: '', tipo: '' });
  const [actionLoading, setActionLoading] = useState(false);

  const cargar = useCallback(async () => {
    try {
      setLoading(true);
      const res = await listarFacturas({ tipo, search: search || undefined, estado: filterEstado || undefined });
      setFacturas(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [tipo, search, filterEstado]);

  useEffect(() => { cargar(); }, [cargar]);

  const handleSync = async () => {
    setSyncing(true);
    try { await gmailSync(); await cargar(); } catch (err) { alert('Error al sincronizar: ' + (err.response?.data?.error || err.message)); }
    finally { setSyncing(false); }
  };

  const openModal = (m, f) => { setActiveF(f); setModal(m); if (m === 'responsables') setRespEmails([...f.responsables]); if (m === 'reenviar') setReenvioEmails([...f.responsables]); };
  const closeModal = () => { setModal(null); setActiveF(null); setNewEmail(''); setReenvioMsg(''); };

  const guardarResponsables = async () => {
    setActionLoading(true);
    try {
      await actualizarResponsables(activeF.id, respEmails);
      await cargar();
      closeModal();
    } catch (err) { alert(err.response?.data?.error || 'Error'); }
    finally { setActionLoading(false); }
  };

  const confirmarReenvio = async () => {
    if (!reenvioEmails.length) return alert('Agrega al menos un destinatario');
    setActionLoading(true);
    try {
      await reenviarFactura(activeF.id, { destinatarios: reenvioEmails, mensaje: reenvioMsg });
      await cargar();
      closeModal();
    } catch (err) { alert(err.response?.data?.error || 'Error al reenviar'); }
    finally { setActionLoading(false); }
  };

  const handleEliminar = async (id) => {
    if (!window.confirm('¿Eliminar esta factura?')) return;
    try { await eliminarFactura(id); await cargar(); } catch (err) { alert(err.response?.data?.error || 'Error'); }
  };

  const handleEliminarSeleccionados = async () => {
    if (!window.confirm(`¿Eliminar ${selected.size} factura(s) seleccionadas?`)) return;
    try {
      await Promise.all([...selected].map(id => eliminarFactura(id)));
      setSelected(new Set());
      await cargar();
    } catch (err) { alert(err.response?.data?.error || 'Error'); }
  };

  const handleBorrarPorFechas = async () => {
    if (!deleteRange.desde || !deleteRange.hasta) return alert('Selecciona las fechas');
    if (!window.confirm('Esta acción es permanente. ¿Continuar?')) return;
    setActionLoading(true);
    try {
      const res = await eliminarPorFechas(deleteRange);
      alert(`Se eliminaron ${res.data.eliminadas} documentos`);
      setModal(null);
      await cargar();
    } catch (err) { alert(err.response?.data?.error || 'Error'); }
    finally { setActionLoading(false); }
  };

  const toggleSelect = (id) => {
    const n = new Set(selected);
    n.has(id) ? n.delete(id) : n.add(id);
    setSelected(n);
  };

  const toggleAll = () => {
    if (selected.size === facturas.length) setSelected(new Set());
    else setSelected(new Set(facturas.map(f => f.id)));
  };

  const estadoBadge = (f) => {
    const map = { pendiente: ['#fbbf24', '#451a03', 'Pendiente'], procesado: ['#60a5fa', '#1e3a5f', 'Procesado'], reenviado: ['#4ade80', '#052e16', 'Reenviado'] };
    const [c, bg, label] = map[f.estado] || ['#94a3b8', '#1e2535', f.estado];
    return <span style={{ background: bg, color: c, padding: '2px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600 }}>{label}</span>;
  };

  const totales = { docs: facturas.length, pendientes: facturas.filter(f => f.estado === 'pendiente').length, valor: facturas.reduce((a, f) => a + Math.abs(parseFloat(f.total || 0)), 0) };

  return (
    <div style={{ padding: 24 }}>
      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
        {[
          { label: tipo === 'FE' ? 'Facturas' : 'Notas crédito', val: totales.docs, sub: 'documentos', color: '#3b82f6' },
          { label: 'Pendientes', val: totales.pendientes, sub: 'sin procesar', color: '#f59e0b' },
          { label: 'Valor total', val: fmt(totales.valor), sub: 'acumulado', color: '#22c55e' },
        ].map(s => (
          <div key={s.label} style={card}>
            <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.color, display: 'inline-block' }} />
              {s.label}
            </div>
            <div style={{ fontSize: typeof s.val === 'string' ? 16 : 24, fontWeight: 700, color: '#e2e8f0' }}>{s.val}</div>
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <input style={{ ...inputSt, flex: 1, minWidth: 200 }} placeholder="Buscar proveedor o número..." value={search} onChange={e => setSearch(e.target.value)} />
        <select style={inputSt} value={filterEstado} onChange={e => setFilterEstado(e.target.value)}>
          <option value="">Todos los estados</option>
          <option value="pendiente">Pendiente</option>
          <option value="procesado">Procesado</option>
          <option value="reenviado">Reenviado</option>
        </select>
        {isAdmin && selected.size > 0 && (
          <button style={btnDanger} onClick={handleEliminarSeleccionados}>🗑 Eliminar ({selected.size})</button>
        )}
        {isAdmin && (
          <button style={btnDanger} onClick={() => setModal('deleteRange')}>📅 Borrar por fechas</button>
        )}
        <button style={{ ...btnGhost, ...(syncing ? { color: '#3b82f6' } : {}) }} onClick={handleSync} disabled={syncing}>
          {syncing ? '⟳ Sincronizando...' : '⟳ Sincronizar'}
        </button>
      </div>

      {/* Tabla */}
      <div style={{ background: '#1e2535', border: '1px solid #2a3348', borderRadius: 10, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 48, color: '#64748b' }}>Cargando facturas...</div>
        ) : facturas.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 48, color: '#64748b' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📄</div>
            <p>No hay {tipo === 'FE' ? 'facturas' : 'notas crédito'} registradas</p>
            <p style={{ fontSize: 12, marginTop: 6 }}>Sincroniza tu Gmail para importarlas automáticamente</p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 800 }}>
              <thead>
                <tr style={{ background: '#161b27', borderBottom: '1px solid #2a3348' }}>
                  <th style={th}><input type="checkbox" checked={selected.size === facturas.length && facturas.length > 0} onChange={toggleAll} /></th>
                  <th style={th}>Tipo</th>
                  <th style={th}>Número</th>
                  <th style={th}>Proveedor</th>
                  <th style={th}>Fecha</th>
                  <th style={th}>Total</th>
                  <th style={th}>Estado</th>
                  <th style={th}>Responsable</th>
                  <th style={th}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {facturas.map(f => (
                  <tr key={f.id} style={{ borderBottom: '1px solid rgba(42,51,72,.7)', cursor: 'pointer', background: selected.has(f.id) ? 'rgba(59,130,246,.08)' : 'transparent' }}
                    onClick={() => openModal('ver', f)}>
                    <td style={td} onClick={e => e.stopPropagation()}><input type="checkbox" checked={selected.has(f.id)} onChange={() => toggleSelect(f.id)} /></td>
                    <td style={td}><span style={{ background: f.tipo === 'FE' ? '#1e3a5f' : '#052e16', color: f.tipo === 'FE' ? '#60a5fa' : '#4ade80', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 700 }}>{f.tipo}</span></td>
                    <td style={{ ...td, fontFamily: 'monospace', fontSize: 11, color: '#94a3b8' }}>{f.numero}</td>
                    <td style={td}>
                      <div style={{ fontWeight: 500, color: '#e2e8f0' }}>{f.proveedor_nombre}</div>
                      <div style={{ fontSize: 11, color: '#64748b' }}>NIT: {f.proveedor_nit}</div>
                    </td>
                    <td style={{ ...td, color: '#94a3b8' }}>{fmtDate(f.fecha_emision)}</td>
                    <td style={{ ...td, fontWeight: 600, color: parseFloat(f.total) < 0 ? '#f87171' : '#e2e8f0' }}>{fmt(f.total)}</td>
                    <td style={td}>{estadoBadge(f)}</td>
                    <td style={td}>
                      {f.reenviado_a
                        ? <span style={{ fontSize: 11, color: '#4ade80' }}>✓ {f.reenviado_a}</span>
                        : f.responsables?.length > 0
                          ? <span style={{ fontSize: 11, color: '#94a3b8' }}>{f.responsables.length} asignado(s)</span>
                          : <span style={{ fontSize: 11, color: '#64748b' }}>Sin asignar</span>
                      }
                    </td>
                    <td style={td} onClick={e => e.stopPropagation()}>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button style={iconBtn} title="Ver detalle" onClick={() => openModal('ver', f)}>👁</button>
                        <button style={iconBtn} title="Responsables" onClick={() => openModal('responsables', f)}>👤</button>
                        <button style={iconBtn} title="Reenviar" onClick={() => openModal('reenviar', f)}>📤</button>
                        <a href={urlPDF(f.id)} target="_blank" rel="noreferrer" style={{ ...iconBtn, textDecoration: 'none' }} title="PDF">📄</a>
                        <a href={urlXML(f.id)} target="_blank" rel="noreferrer" style={{ ...iconBtn, textDecoration: 'none' }} title="XML">📋</a>
                        {isAdmin && <button style={{ ...iconBtn, color: '#f87171' }} title="Eliminar" onClick={() => handleEliminar(f.id)}>🗑</button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* MODAL VER */}
      {modal === 'ver' && activeF && (
        <Modal title={`${activeF.tipo} ${activeF.numero}`} onClose={closeModal} footer={
          <>
            <button style={btnGhost} onClick={closeModal}>Cerrar</button>
            <button style={btnPrimary} onClick={() => { closeModal(); openModal('reenviar', activeF); }}>📤 Reenviar</button>
          </>
        }>
          <Section title="Información del documento">
            <Grid2>
              <Item label="Proveedor" val={activeF.proveedor_nombre} />
              <Item label="NIT" val={activeF.proveedor_nit} />
              <Item label="Número" val={activeF.numero} />
              <Item label="CUFE" val={activeF.cufe ? activeF.cufe.substring(0, 20) + '...' : '—'} />
              <Item label="Fecha emisión" val={fmtDate(activeF.fecha_emision)} />
              <Item label="Fecha vencimiento" val={fmtDate(activeF.fecha_vencimiento)} />
              <Item label="Estado" val={estadoBadge(activeF)} />
              {activeF.reenviado_a && <Item label="Reenviado a" val={<span style={{ color: '#4ade80' }}>{activeF.reenviado_a}</span>} />}
            </Grid2>
          </Section>
          <Section title="Productos / Servicios">
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
              <thead><tr>{['Código', 'Descripción', 'Cant.', 'P. Unit.', 'Total'].map(h => <th key={h} style={{ padding: '6px 8px', textAlign: 'left', color: '#64748b', borderBottom: '1px solid #2a3348', fontSize: 10, textTransform: 'uppercase' }}>{h}</th>)}</tr></thead>
              <tbody>
                {(activeF.productos || []).map((p, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid rgba(42,51,72,.5)' }}>
                    <td style={{ padding: '8px', color: '#64748b', fontFamily: 'monospace', fontSize: 11 }}>{p.codigo || '—'}</td>
                    <td style={{ padding: '8px' }}>{p.descripcion}</td>
                    <td style={{ padding: '8px', textAlign: 'right', color: '#94a3b8' }}>{p.cantidad}</td>
                    <td style={{ padding: '8px', textAlign: 'right', color: '#94a3b8' }}>{fmt(p.precioUnitario || p.precio_unitario)}</td>
                    <td style={{ padding: '8px', textAlign: 'right', fontWeight: 600 }}>{fmt(p.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
          <Section title="Totales">
            <TotalRow label="Subtotal" val={fmt(activeF.subtotal)} />
            <TotalRow label="IVA" val={fmt(activeF.iva)} />
            <TotalRow label="Total" val={<span style={{ color: parseFloat(activeF.total) < 0 ? '#f87171' : '#4ade80', fontSize: 16 }}>{fmt(activeF.total)}</span>} grand />
          </Section>
        </Modal>
      )}

      {/* MODAL RESPONSABLES */}
      {modal === 'responsables' && activeF && (
        <Modal title={`Responsables — ${activeF.numero}`} onClose={closeModal} footer={
          <>
            <button style={btnGhost} onClick={closeModal}>Cancelar</button>
            <button style={btnPrimary} onClick={guardarResponsables} disabled={actionLoading}>{actionLoading ? 'Guardando...' : 'Guardar'}</button>
          </>
        }>
          <p style={{ fontSize: 12, color: '#94a3b8', marginBottom: 12 }}>Ingresa el correo y presiona Enter para agregar</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, background: '#0f1117', border: '1px solid #2a3348', borderRadius: 6, padding: 8, minHeight: 44, marginBottom: 16 }}>
            {respEmails.map(e => (
              <span key={e} style={{ background: 'rgba(59,130,246,.15)', color: '#60a5fa', padding: '2px 8px', borderRadius: 4, fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                {e} <span style={{ cursor: 'pointer', color: '#64748b' }} onClick={() => setRespEmails(respEmails.filter(x => x !== e))}>×</span>
              </span>
            ))}
            <input style={{ background: 'none', border: 'none', outline: 'none', color: '#e2e8f0', fontSize: 13, flex: 1, minWidth: 160 }} type="email" placeholder="correo@empresa.com" value={newEmail} onChange={e => setNewEmail(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && newEmail.includes('@')) { setRespEmails([...respEmails, newEmail.trim()]); setNewEmail(''); } }} />
          </div>
          <InfoBox>Al guardar, el estado reflejará a quién se reenvió más recientemente.</InfoBox>
        </Modal>
      )}

      {/* MODAL REENVIAR */}
      {modal === 'reenviar' && activeF && (
        <Modal title="Reenviar factura" onClose={closeModal} footer={
          <>
            <button style={btnGhost} onClick={closeModal}>Cancelar</button>
            <button style={btnPrimary} onClick={confirmarReenvio} disabled={actionLoading}>{actionLoading ? 'Enviando...' : '📤 Enviar ahora'}</button>
          </>
        }>
          <div style={{ background: '#0f1117', borderRadius: 8, padding: '10px 12px', marginBottom: 16 }}>
            <div style={{ fontWeight: 500 }}>{activeF.proveedor_nombre}</div>
            <div style={{ color: '#64748b', fontSize: 12 }}>{activeF.numero} · {fmt(activeF.total)}</div>
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={labelSt}>Destinatarios</label>
            {activeF.responsables?.length > 0 ? activeF.responsables.map(r => (
              <label key={r} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid #2a3348', fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox" checked={reenvioEmails.includes(r)} onChange={e => setReenvioEmails(e.target.checked ? [...reenvioEmails, r] : reenvioEmails.filter(x => x !== r))} /> {r}
              </label>
            )) : <p style={{ fontSize: 12, color: '#64748b' }}>No hay responsables. Agrega uno adicional abajo.</p>}
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={labelSt}>Destinatario adicional</label>
            <input style={inputSt} type="email" placeholder="correo@empresa.com" onKeyDown={e => { if (e.key === 'Enter' && e.target.value.includes('@')) { setReenvioEmails([...reenvioEmails, e.target.value]); e.target.value = ''; } }} />
          </div>
          <div>
            <label style={labelSt}>Mensaje (opcional)</label>
            <textarea style={{ ...inputSt, resize: 'vertical', minHeight: 80 }} value={reenvioMsg} onChange={e => setReenvioMsg(e.target.value)} placeholder="Adjunto encontrará la factura electrónica..." />
          </div>
        </Modal>
      )}

      {/* MODAL BORRAR POR FECHAS */}
      {modal === 'deleteRange' && (
        <Modal title="Borrar por rango de fechas" onClose={closeModal} footer={
          <>
            <button style={btnGhost} onClick={closeModal}>Cancelar</button>
            <button style={btnDanger} onClick={handleBorrarPorFechas} disabled={actionLoading}>{actionLoading ? 'Eliminando...' : '🗑 Eliminar'}</button>
          </>
        }>
          <div style={{ background: 'rgba(245,158,11,.08)', border: '1px solid rgba(245,158,11,.3)', borderRadius: 6, padding: '10px 12px', fontSize: 12, color: '#fbbf24', marginBottom: 16 }}>
            ⚠️ Esta acción es permanente. Se eliminarán los PDFs y XMLs adjuntos.
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={labelSt}>Fecha desde</label>
            <input style={inputSt} type="date" value={deleteRange.desde} onChange={e => setDeleteRange({ ...deleteRange, desde: e.target.value })} />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={labelSt}>Fecha hasta</label>
            <input style={inputSt} type="date" value={deleteRange.hasta} onChange={e => setDeleteRange({ ...deleteRange, hasta: e.target.value })} />
          </div>
          <div>
            <label style={labelSt}>Tipo de documento</label>
            <select style={inputSt} value={deleteRange.tipo} onChange={e => setDeleteRange({ ...deleteRange, tipo: e.target.value })}>
              <option value="">Todos</option>
              <option value="FE">Solo facturas electrónicas</option>
              <option value="NC">Solo notas crédito</option>
            </select>
          </div>
        </Modal>
      )}
    </div>
  );
}

// Componentes auxiliares
const Modal = ({ title, children, onClose, footer }) => (
  <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={e => e.target === e.currentTarget && onClose()}>
    <div style={{ background: '#161b27', border: '1px solid #374460', borderRadius: 14, width: 600, maxWidth: '95vw', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '18px 20px', borderBottom: '1px solid #2a3348', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontWeight: 600, fontSize: 15 }}>{title}</span>
        <button style={{ background: '#1e2535', border: 'none', color: '#94a3b8', borderRadius: 6, width: 28, height: 28, cursor: 'pointer', fontSize: 16 }} onClick={onClose}>×</button>
      </div>
      <div style={{ padding: 20, overflowY: 'auto', flex: 1 }}>{children}</div>
      {footer && <div style={{ padding: '14px 20px', borderTop: '1px solid #2a3348', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>{footer}</div>}
    </div>
  </div>
);

const Section = ({ title, children }) => (
  <div style={{ marginBottom: 20 }}>
    <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 10, paddingBottom: 6, borderBottom: '1px solid #2a3348' }}>{title}</div>
    {children}
  </div>
);
const Grid2 = ({ children }) => <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>{children}</div>;
const Item = ({ label, val }) => <div><div style={{ fontSize: 11, color: '#64748b' }}>{label}</div><div style={{ fontSize: 13, fontWeight: 500, marginTop: 2 }}>{val}</div></div>;
const TotalRow = ({ label, val, grand }) => <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', fontSize: grand ? 14 : 13, fontWeight: grand ? 600 : 400, color: grand ? '#e2e8f0' : '#94a3b8', borderTop: grand ? '1px solid #2a3348' : 'none', marginTop: grand ? 4 : 0 }}><span>{label}</span><span>{val}</span></div>;
const InfoBox = ({ children }) => <div style={{ background: 'rgba(59,130,246,.08)', border: '1px solid rgba(59,130,246,.2)', borderRadius: 6, padding: '10px 12px', fontSize: 12, color: '#94a3b8' }}>{children}</div>;

// Estilos compartidos
const card = { background: '#1e2535', border: '1px solid #2a3348', borderRadius: 10, padding: '14px 16px' };
const th = { padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: '#64748b', letterSpacing: '.06em', textTransform: 'uppercase' };
const td = { padding: '11px 14px', fontSize: 13, color: '#e2e8f0', verticalAlign: 'middle' };
const inputSt = { width: '100%', background: '#1e2535', border: '1px solid #2a3348', borderRadius: 6, padding: '8px 12px', color: '#e2e8f0', fontSize: 13, outline: 'none', boxSizing: 'border-box' };
const labelSt = { display: 'block', fontSize: 12, fontWeight: 500, color: '#94a3b8', marginBottom: 6 };
const btnPrimary = { background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, padding: '7px 14px', fontSize: 12, fontWeight: 500, cursor: 'pointer' };
const btnGhost = { background: '#1e2535', color: '#94a3b8', border: '1px solid #2a3348', borderRadius: 6, padding: '7px 14px', fontSize: 12, cursor: 'pointer' };
const btnDanger = { background: 'rgba(239,68,68,.1)', color: '#f87171', border: '1px solid rgba(239,68,68,.3)', borderRadius: 6, padding: '7px 14px', fontSize: 12, cursor: 'pointer' };
const iconBtn = { background: 'none', border: 'none', cursor: 'pointer', padding: '4px 5px', borderRadius: 4, fontSize: 14 };

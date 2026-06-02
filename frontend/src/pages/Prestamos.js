import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import * as XLSX from 'xlsx';

// ─── Constantes ────────────────────────────────────────────────────────────────

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

// Los primeros 6 dígitos del código de producto determinan el grupo contable
const GRUPOS_CONTABLES = {
  '010101': { cuenta: '14150501', categoria: 'Medicamentos' },
  '010102': { cuenta: '14150501', categoria: 'Medicamentos' },
  '010103': { cuenta: '14150501', categoria: 'Medicamentos' },
  '010104': { cuenta: '14150501', categoria: 'Medicamentos' },
  '010105': { cuenta: '14150501', categoria: 'Medicamentos' },
  '010106': { cuenta: '14150501', categoria: 'Medicamentos' },
  '010107': { cuenta: '14150501', categoria: 'Medicamentos' },
  '010108': { cuenta: '14150501', categoria: 'Medicamentos' },
  '010201': { cuenta: '14150501', categoria: 'Medicamentos' },
  '010202': { cuenta: '14150501', categoria: 'Medicamentos' },
  '010203': { cuenta: '14150501', categoria: 'Medicamentos' },
  '010204': { cuenta: '14150501', categoria: 'Medicamentos' },
  '010205': { cuenta: '14150501', categoria: 'Medicamentos' },
  '010206': { cuenta: '14150501', categoria: 'Medicamentos' },
  '010207': { cuenta: '14150501', categoria: 'Medicamentos' },
  '010208': { cuenta: '14150501', categoria: 'Medicamentos' },
  '020101': { cuenta: '14200501', categoria: 'Dispositivos médicos' },
  '020102': { cuenta: '14200501', categoria: 'Dispositivos médicos' },
  '020103': { cuenta: '14200501', categoria: 'Dispositivos médicos' },
  '150101': { cuenta: '14230501', categoria: 'Glóbulos rojos' },
  '150202': { cuenta: '14230502', categoria: 'Plasma' },
  '150303': { cuenta: '14230503', categoria: 'Plaquetas' },
  '150401': { cuenta: '14230504', categoria: 'Crioprecipitados' },
  '030101': { cuenta: '14151001', categoria: 'Complementos nutricionales' },
  '030201': { cuenta: '14151001', categoria: 'Complementos nutricionales' },
  '070101': { cuenta: '14210101', categoria: 'Gases medicinales' },
  '070202': { cuenta: '14210201', categoria: 'Gases arteriales' },
  '070303': { cuenta: '14210301', categoria: 'Laboratorio clínico' },
};

const CATEGORIAS_COLORES = {
  'Medicamentos':             { bg: '#E6F1FB', color: '#0C447C' },
  'Dispositivos médicos':     { bg: '#E1F5EE', color: '#085041' },
  'Glóbulos rojos':           { bg: '#FBEAF0', color: '#72243E' },
  'Plasma':                   { bg: '#FBEAF0', color: '#72243E' },
  'Plaquetas':                { bg: '#FBEAF0', color: '#72243E' },
  'Crioprecipitados':         { bg: '#FBEAF0', color: '#72243E' },
  'Complementos nutricionales':{ bg: '#FAEEDA', color: '#633806' },
  'Gases medicinales':        { bg: '#EEEDFE', color: '#3C3489' },
  'Gases arteriales':         { bg: '#EEEDFE', color: '#3C3489' },
  'Laboratorio clínico':      { bg: '#F1EFE8', color: '#444441' },
};

function getCategoriaFromCodigo(codigo) {
  if (!codigo || codigo.length < 6) return null;
  const grupo = String(codigo).substring(0, 6);
  return GRUPOS_CONTABLES[grupo] || null;
}

function fmt(n) {
  return '$' + Number(n || 0).toLocaleString('es-CO');
}

function Badge({ tipo }) {
  const estilos = {
    ingreso: { bg: '#E6F1FB', color: '#185FA5', label: 'Ingreso' },
    egreso:  { bg: '#FBEAF0', color: '#993556', label: 'Egreso' },
    abierto: { bg: '#FAEEDA', color: '#854F0B', label: 'Abierto' },
    parcial: { bg: '#FAECE7', color: '#993C1D', label: 'Parcial' },
    cerrado: { bg: '#EAF3DE', color: '#3B6D11', label: 'Cerrado' },
    devolucion: { bg: '#F1EFE8', color: '#444441', label: 'Devolución' },
  };
  const e = estilos[tipo] || estilos.abierto;
  return (
    <span style={{
      display: 'inline-block', padding: '2px 9px', borderRadius: 20,
      fontSize: 11, fontWeight: 500, background: e.bg, color: e.color,
    }}>{e.label}</span>
  );
}

function CatTag({ categoria }) {
  const c = CATEGORIAS_COLORES[categoria] || { bg: '#F1EFE8', color: '#444441' };
  return (
    <span style={{
      fontSize: 11, padding: '2px 8px', borderRadius: 20, fontWeight: 500,
      background: c.bg, color: c.color,
    }}>{categoria || '—'}</span>
  );
}

// ─── Supabase helpers ───────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL;
const SUPABASE_KEY = process.env.REACT_APP_SUPABASE_ANON_KEY;

async function sbFetch(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
      ...options.headers,
    },
    ...options,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// ─── Componente principal ───────────────────────────────────────────────────────

export default function Prestamos() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('resumen');

  // Datos globales
  const [prestamos, setPrestamos] = useState([]);
  const [devoluciones, setDevoluciones] = useState([]);
  const [productos, setProductos] = useState([]);
  const [clinicas, setClinicas] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { cargarDatos(); }, []);

  async function cargarDatos() {
    setLoading(true);
    try {
      const [p, d, prod, cl] = await Promise.all([
        sbFetch('prestamos?order=created_at.desc'),
        sbFetch('prestamo_devoluciones?order=fecha.desc'),
        sbFetch('prestamo_productos?order=nombre.asc'),
        sbFetch('prestamo_clinicas?order=nombre.asc'),
      ]);
      setPrestamos(p || []);
      setDevoluciones(d || []);
      setProductos(prod || []);
      setClinicas(cl || []);
    } catch (e) {
      console.error('Error cargando datos de préstamos:', e);
    }
    setLoading(false);
  }

  const tabs = [
    { id: 'resumen',     label: 'Resumen' },
    { id: 'movimientos', label: 'Movimientos' },
    { id: 'nuevo',       label: 'Nuevo préstamo' },
    { id: 'productos',   label: 'Productos' },
    { id: 'reportes',    label: 'Reportes' },
  ];

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--t-text-primary)' }}>Préstamos</h1>
        <p style={{ fontSize: 13, color: 'var(--t-text-muted)', marginTop: 2 }}>
          Ingreso y egreso de medicamentos, dispositivos médicos y hemocomponentes
        </p>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--t-border)', marginBottom: 20, gap: 0 }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
            padding: '9px 16px', fontSize: 13, cursor: 'pointer', background: 'none', border: 'none',
            borderBottom: activeTab === t.id ? '2px solid var(--t-accent)' : '2px solid transparent',
            color: activeTab === t.id ? 'var(--t-text-primary)' : 'var(--t-text-muted)',
            fontWeight: activeTab === t.id ? 600 : 400, whiteSpace: 'nowrap',
          }}>{t.label}</button>
        ))}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--t-text-muted)', fontSize: 13 }}>
          Cargando…
        </div>
      ) : (
        <>
          {activeTab === 'resumen'     && <TabResumen prestamos={prestamos} devoluciones={devoluciones} />}
          {activeTab === 'movimientos' && <TabMovimientos prestamos={prestamos} devoluciones={devoluciones} clinicas={clinicas} onRefresh={cargarDatos} />}
          {activeTab === 'nuevo'       && <TabNuevo clinicas={clinicas} productos={productos} onSaved={() => { cargarDatos(); setActiveTab('movimientos'); }} />}
          {activeTab === 'productos'   && <TabProductos productos={productos} onRefresh={cargarDatos} />}
          {activeTab === 'reportes'    && <TabReportes prestamos={prestamos} devoluciones={devoluciones} />}
        </>
      )}
    </div>
  );
}

// ─── TAB RESUMEN ────────────────────────────────────────────────────────────────

function TabResumen({ prestamos, devoluciones }) {
  function saldoPendiente(p) {
    const totalPrestado = (p.items || []).reduce((s, i) => s + i.cantidad * i.precio_unitario, 0);
    const totalDevuelto = devoluciones
      .filter(d => d.prestamo_id === p.id)
      .flatMap(d => d.items || [])
      .reduce((s, i) => s + i.cantidad * i.precio_unitario, 0);
    return Math.max(0, totalPrestado - totalDevuelto);
  }

  const abiertos = prestamos.filter(p => p.estado !== 'cerrado');
  const egresos  = abiertos.filter(p => p.tipo === 'egreso');
  const ingresos = abiertos.filter(p => p.tipo === 'ingreso');

  const totalEgreso  = egresos.reduce((s, p) => s + saldoPendiente(p), 0);
  const totalIngreso = ingresos.reduce((s, p) => s + saldoPendiente(p), 0);

  // Agrupar egresos abiertos por categoría
  const porCategoria = {};
  egresos.forEach(p => {
    (p.items || []).forEach(item => {
      const cat = item.categoria || 'Otro';
      if (!porCategoria[cat]) porCategoria[cat] = { valor: 0, cuenta: item.cuenta_contable };
      porCategoria[cat].valor += item.cantidad * item.precio_unitario;
    });
  });

  const statStyle = {
    background: 'var(--t-bg-card)', borderRadius: 10, padding: '14px 16px', border: '1px solid var(--t-border)',
  };

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 24 }}>
        <div style={statStyle}>
          <div style={{ fontSize: 11, color: 'var(--t-text-muted)', marginBottom: 4 }}>Prestado a clínicas (egreso)</div>
          <div style={{ fontSize: 20, fontWeight: 600, color: '#BA7517' }}>{fmt(totalEgreso)}</div>
          <div style={{ fontSize: 11, color: 'var(--t-text-muted)', marginTop: 3 }}>{egresos.length} abierto{egresos.length !== 1 ? 's' : ''}</div>
        </div>
        <div style={statStyle}>
          <div style={{ fontSize: 11, color: 'var(--t-text-muted)', marginBottom: 4 }}>Pendiente de recibir</div>
          <div style={{ fontSize: 20, fontWeight: 600, color: '#BA7517' }}>{fmt(totalEgreso)}</div>
        </div>
        <div style={statStyle}>
          <div style={{ fontSize: 11, color: 'var(--t-text-muted)', marginBottom: 4 }}>Recibido de clínicas (ingreso)</div>
          <div style={{ fontSize: 20, fontWeight: 600, color: '#185FA5' }}>{fmt(totalIngreso)}</div>
          <div style={{ fontSize: 11, color: 'var(--t-text-muted)', marginTop: 3 }}>{ingresos.length} abierto{ingresos.length !== 1 ? 's' : ''}</div>
        </div>
        <div style={statStyle}>
          <div style={{ fontSize: 11, color: 'var(--t-text-muted)', marginBottom: 4 }}>Pendiente de devolver</div>
          <div style={{ fontSize: 20, fontWeight: 600, color: '#185FA5' }}>{fmt(totalIngreso)}</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--t-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
            Por categoría — egreso abierto
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>{['Categoría','Cuenta contable','Valor'].map(h => (
                <th key={h} style={{ textAlign: 'left', padding: '7px 10px', fontSize: 11, color: 'var(--t-text-muted)', borderBottom: '1px solid var(--t-border)', fontWeight: 500 }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {Object.entries(porCategoria).map(([cat, info]) => (
                <tr key={cat}>
                  <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--t-border)' }}><CatTag categoria={cat} /></td>
                  <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--t-border)', fontSize: 12, color: 'var(--t-text-muted)' }}>{info.cuenta}</td>
                  <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--t-border)', fontWeight: 500 }}>{fmt(info.valor)}</td>
                </tr>
              ))}
              {Object.keys(porCategoria).length === 0 && (
                <tr><td colSpan={3} style={{ padding: '20px 10px', color: 'var(--t-text-muted)', fontSize: 12, textAlign: 'center' }}>Sin egresos abiertos</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--t-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
            Últimos movimientos
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>{['Fecha','Clínica','Tipo','Estado'].map(h => (
                <th key={h} style={{ textAlign: 'left', padding: '7px 10px', fontSize: 11, color: 'var(--t-text-muted)', borderBottom: '1px solid var(--t-border)', fontWeight: 500 }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {prestamos.slice(0, 6).map(p => (
                <tr key={p.id}>
                  <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--t-border)', fontSize: 12 }}>{p.fecha}</td>
                  <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--t-border)' }}>{p.clinica_nombre}</td>
                  <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--t-border)' }}><Badge tipo={p.tipo} /></td>
                  <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--t-border)' }}><Badge tipo={p.estado} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── TAB MOVIMIENTOS ────────────────────────────────────────────────────────────

function TabMovimientos({ prestamos, devoluciones, clinicas, onRefresh }) {
  const [busqueda, setBusqueda] = useState('');
  const [filtroTipo, setFiltroTipo] = useState('');
  const [filtroEstado, setFiltroEstado] = useState('');
  const [filtroBodega, setFiltroBodega] = useState('');
  const [detalle, setDetalle] = useState(null);         // préstamo seleccionado para ver detalle
  const [devModal, setDevModal] = useState(null);       // préstamo seleccionado para registrar devolución

  const filtrados = prestamos.filter(p => {
    const q = busqueda.toLowerCase();
    const matchQ = !q || p.documento_contable?.toLowerCase().includes(q) || p.clinica_nombre?.toLowerCase().includes(q);
    const matchTipo   = !filtroTipo   || p.tipo   === filtroTipo;
    const matchEstado = !filtroEstado || p.estado === filtroEstado;
    const matchBodega = !filtroBodega || p.bodega_codigo === filtroBodega;
    return matchQ && matchTipo && matchEstado && matchBodega;
  });

  async function exportar() {
    const rows = filtrados.map(p => ({
      Documento: p.documento_contable,
      Fecha: p.fecha,
      Clínica: p.clinica_nombre,
      Bodega: p.bodega_nombre,
      Tipo: p.tipo,
      Estado: p.estado,
      'Valor total': (p.items || []).reduce((s, i) => s + i.cantidad * i.precio_unitario, 0),
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Prestamos');
    XLSX.writeFile(wb, 'prestamos.xlsx');
  }

  const thStyle = { textAlign: 'left', padding: '8px 10px', fontSize: 11, color: 'var(--t-text-muted)', borderBottom: '1px solid var(--t-border)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' };
  const tdStyle = { padding: '9px 10px', borderBottom: '1px solid var(--t-border)', verticalAlign: 'middle', fontSize: 13 };

  return (
    <div>
      {/* Filtros */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <input value={busqueda} onChange={e => setBusqueda(e.target.value)}
          placeholder="Buscar por documento o clínica…"
          style={{ flex: 1, minWidth: 180, padding: '7px 10px', border: '1px solid var(--t-border)', borderRadius: 7, fontSize: 13, background: 'var(--t-bg-inner)', color: 'var(--t-text-primary)' }} />
        <select value={filtroTipo} onChange={e => setFiltroTipo(e.target.value)}
          style={{ padding: '7px 10px', border: '1px solid var(--t-border)', borderRadius: 7, fontSize: 13, background: 'var(--t-bg-inner)', color: 'var(--t-text-primary)' }}>
          <option value=''>Todos los tipos</option>
          <option value='ingreso'>Ingreso</option>
          <option value='egreso'>Egreso</option>
        </select>
        <select value={filtroBodega} onChange={e => setFiltroBodega(e.target.value)}
          style={{ padding: '7px 10px', border: '1px solid var(--t-border)', borderRadius: 7, fontSize: 13, background: 'var(--t-bg-inner)', color: 'var(--t-text-primary)' }}>
          <option value=''>Todas las bodegas</option>
          {BODEGAS.map(b => <option key={b.codigo} value={b.codigo}>{b.nombre} ({b.codigo})</option>)}
        </select>
        <select value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)}
          style={{ padding: '7px 10px', border: '1px solid var(--t-border)', borderRadius: 7, fontSize: 13, background: 'var(--t-bg-inner)', color: 'var(--t-text-primary)' }}>
          <option value=''>Todos los estados</option>
          <option value='abierto'>Abierto</option>
          <option value='parcial'>Parcial</option>
          <option value='cerrado'>Cerrado</option>
        </select>
        <button onClick={exportar} style={{ padding: '7px 13px', border: '1px solid var(--t-border)', borderRadius: 7, fontSize: 13, cursor: 'pointer', background: 'var(--t-bg-inner)', color: 'var(--t-text-primary)' }}>
          ↓ Exportar
        </button>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              {['Documento','Fecha','Clínica','Bodega','Tipo','Valor total','Soporte','Estado',''].map(h => (
                <th key={h} style={thStyle}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtrados.map(p => {
              const total = (p.items || []).reduce((s, i) => s + i.cantidad * i.precio_unitario, 0);
              const devs  = devoluciones.filter(d => d.prestamo_id === p.id);
              return (
                <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => setDetalle(p)}>
                  <td style={{ ...tdStyle, fontWeight: 500 }}>{p.documento_contable}</td>
                  <td style={tdStyle}>{p.fecha}</td>
                  <td style={tdStyle}>{p.clinica_nombre}</td>
                  <td style={{ ...tdStyle, fontSize: 12, color: 'var(--t-text-muted)' }}>{p.bodega_nombre} ({p.bodega_codigo})</td>
                  <td style={tdStyle}><Badge tipo={p.tipo} /></td>
                  <td style={{ ...tdStyle, fontWeight: 500 }}>{fmt(total)}</td>
                  <td style={{ ...tdStyle, textAlign: 'center' }}>
                    {p.soporte_url ? (
                      <a href={p.soporte_url} target='_blank' rel='noreferrer' onClick={e => e.stopPropagation()}
                        style={{ color: 'var(--t-accent)', fontSize: 12 }}>PDF</a>
                    ) : <span style={{ color: 'var(--t-text-muted)', fontSize: 12 }}>—</span>}
                  </td>
                  <td style={tdStyle}><Badge tipo={p.estado} /></td>
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
                    {p.estado !== 'cerrado' && (
                      <button onClick={() => setDevModal(p)}
                        title='Registrar devolución'
                        style={{ padding: '4px 10px', fontSize: 12, border: '1px solid var(--t-border)', borderRadius: 6, cursor: 'pointer', background: 'var(--t-bg-inner)', color: 'var(--t-text-primary)' }}>
                        ↩ Devolución
                      </button>
                    )}
                    {devs.length > 0 && (
                      <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--t-text-muted)' }}>{devs.length} dev.</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {filtrados.length === 0 && (
              <tr><td colSpan={9} style={{ padding: '30px 10px', textAlign: 'center', color: 'var(--t-text-muted)', fontSize: 13 }}>Sin resultados</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Modal detalle */}
      {detalle && (
        <Modal onClose={() => setDetalle(null)} titulo={`Préstamo ${detalle.documento_contable}`}>
          <DetallePrestamoModal prestamo={detalle} devoluciones={devoluciones.filter(d => d.prestamo_id === detalle.id)} />
        </Modal>
      )}

      {/* Modal devolución */}
      {devModal && (
        <Modal onClose={() => setDevModal(null)} titulo={`Registrar devolución — ${devModal.documento_contable}`}>
          <FormDevolucion
            prestamo={devModal}
            devoluciones={devoluciones.filter(d => d.prestamo_id === devModal.id)}
            onSaved={() => { setDevModal(null); onRefresh(); }}
          />
        </Modal>
      )}
    </div>
  );
}

// ─── DETALLE PRÉSTAMO ───────────────────────────────────────────────────────────

function DetallePrestamoModal({ prestamo, devoluciones }) {
  const thS = { textAlign: 'left', padding: '7px 10px', fontSize: 11, color: 'var(--t-text-muted)', borderBottom: '1px solid var(--t-border)', fontWeight: 500 };
  const tdS = { padding: '8px 10px', borderBottom: '1px solid var(--t-border)', fontSize: 13 };

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16, fontSize: 13 }}>
        <div><span style={{ color: 'var(--t-text-muted)', fontSize: 12 }}>Clínica: </span>{prestamo.clinica_nombre}</div>
        <div><span style={{ color: 'var(--t-text-muted)', fontSize: 12 }}>Bodega: </span>{prestamo.bodega_nombre} ({prestamo.bodega_codigo})</div>
        <div><span style={{ color: 'var(--t-text-muted)', fontSize: 12 }}>Fecha: </span>{prestamo.fecha}</div>
        <div><span style={{ color: 'var(--t-text-muted)', fontSize: 12 }}>Tipo: </span><Badge tipo={prestamo.tipo} /></div>
        <div><span style={{ color: 'var(--t-text-muted)', fontSize: 12 }}>Estado: </span><Badge tipo={prestamo.estado} /></div>
        {prestamo.soporte_url && <div><a href={prestamo.soporte_url} target='_blank' rel='noreferrer' style={{ color: 'var(--t-accent)', fontSize: 12 }}>Ver PDF soporte</a></div>}
      </div>

      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--t-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>Productos prestados</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 20 }}>
        <thead><tr>{['Código','Categoría','Nombre','Cant.','Precio unit.','Total'].map(h => <th key={h} style={thS}>{h}</th>)}</tr></thead>
        <tbody>
          {(prestamo.items || []).map((item, i) => (
            <tr key={i}>
              <td style={{ ...tdS, fontFamily: 'monospace', fontSize: 12 }}>{item.codigo}</td>
              <td style={tdS}><CatTag categoria={item.categoria} /></td>
              <td style={tdS}>{item.nombre}</td>
              <td style={tdS}>{item.cantidad}</td>
              <td style={tdS}>{fmt(item.precio_unitario)}</td>
              <td style={{ ...tdS, fontWeight: 500 }}>{fmt(item.cantidad * item.precio_unitario)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {devoluciones.length > 0 && (
        <>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--t-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>Devoluciones</div>
          {devoluciones.map((d, idx) => (
            <div key={d.id} style={{ border: '1px solid var(--t-border)', borderRadius: 8, marginBottom: 10, overflow: 'hidden' }}>
              <div style={{ background: 'var(--t-bg-card)', padding: '8px 12px', display: 'flex', gap: 12, alignItems: 'center', fontSize: 13 }}>
                <span style={{ fontWeight: 500 }}>Dev. {idx + 1}</span>
                <span style={{ color: 'var(--t-text-muted)', fontSize: 12 }}>{d.fecha}</span>
                <span style={{ color: 'var(--t-text-muted)', fontSize: 12 }}>Doc: {d.documento_contable}</span>
                {d.soporte_url && <a href={d.soporte_url} target='_blank' rel='noreferrer' style={{ color: 'var(--t-accent)', fontSize: 12 }}>PDF</a>}
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>{['Nombre','Cant. devuelta','Valor'].map(h => <th key={h} style={thS}>{h}</th>)}</tr></thead>
                <tbody>
                  {(d.items || []).map((item, i) => (
                    <tr key={i}>
                      <td style={tdS}>{item.nombre}</td>
                      <td style={tdS}>{item.cantidad}</td>
                      <td style={{ ...tdS, fontWeight: 500 }}>{fmt(item.cantidad * item.precio_unitario)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

// ─── FORM DEVOLUCIÓN ────────────────────────────────────────────────────────────

function FormDevolucion({ prestamo, devoluciones, onSaved }) {
  const [fecha, setFecha]   = useState(new Date().toISOString().split('T')[0]);
  const [docContable, setDocContable] = useState('');
  const [soporteFile, setSoporteFile] = useState(null);
  const [cantidades, setCantidades]   = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  // Calcular saldo pendiente por ítem
  const saldos = (prestamo.items || []).map(item => {
    const devuelto = devoluciones.flatMap(d => d.items || [])
      .filter(i => i.codigo === item.codigo)
      .reduce((s, i) => s + i.cantidad, 0);
    return { ...item, pendiente: item.cantidad - devuelto };
  }).filter(i => i.pendiente > 0);

  async function guardar() {
    setError('');
    if (!fecha) return setError('La fecha es requerida');
    if (!docContable) return setError('El documento contable es requerido');
    const items = saldos.filter(i => cantidades[i.codigo] > 0).map(i => ({
      codigo: i.codigo, nombre: i.nombre, cantidad: Number(cantidades[i.codigo]),
      precio_unitario: i.precio_unitario, categoria: i.categoria,
    }));
    if (items.length === 0) return setError('Debes ingresar al menos una cantidad a devolver');

    setSaving(true);
    try {
      // Subir PDF si hay
      let soporte_url = null;
      if (soporteFile) {
        soporte_url = await subirPDF(soporteFile, `dev_${prestamo.id}_${Date.now()}`);
      }

      await sbFetch('prestamo_devoluciones', {
        method: 'POST',
        body: JSON.stringify({
          prestamo_id: prestamo.id,
          fecha, documento_contable: docContable,
          soporte_url, items,
        }),
      });

      // Recalcular estado del préstamo
      const totalPrestado = (prestamo.items || []).reduce((s, i) => s + i.cantidad, 0);
      const totalDevueltoAntes = devoluciones.flatMap(d => d.items || []).reduce((s, i) => s + i.cantidad, 0);
      const totalDevueltoNow = totalDevueltoAntes + items.reduce((s, i) => s + i.cantidad, 0);
      const nuevoEstado = totalDevueltoNow >= totalPrestado ? 'cerrado' : 'parcial';

      await sbFetch(`prestamos?id=eq.${prestamo.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ estado: nuevoEstado }),
      });

      onSaved();
    } catch (e) {
      setError('Error guardando: ' + e.message);
    }
    setSaving(false);
  }

  return (
    <div>
      <p style={{ fontSize: 13, color: 'var(--t-text-muted)', marginBottom: 16 }}>
        Registra la devolución parcial o total. Cada devolución tiene su propio PDF de soporte.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
        <div>
          <label style={{ fontSize: 12, color: 'var(--t-text-muted)', fontWeight: 500 }}>Fecha de devolución</label>
          <input type='date' value={fecha} onChange={e => setFecha(e.target.value)}
            style={{ display: 'block', width: '100%', marginTop: 5, padding: '7px 10px', border: '1px solid var(--t-border)', borderRadius: 7, fontSize: 13, background: 'var(--t-bg-inner)', color: 'var(--t-text-primary)' }} />
        </div>
        <div>
          <label style={{ fontSize: 12, color: 'var(--t-text-muted)', fontWeight: 500 }}>Documento contable de devolución</label>
          <input value={docContable} onChange={e => setDocContable(e.target.value)}
            placeholder='Ej: DEV-2026-001'
            style={{ display: 'block', width: '100%', marginTop: 5, padding: '7px 10px', border: '1px solid var(--t-border)', borderRadius: 7, fontSize: 13, background: 'var(--t-bg-inner)', color: 'var(--t-text-primary)' }} />
        </div>
      </div>

      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--t-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 10 }}>
        Cantidades a devolver (saldo pendiente)
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 16 }}>
        <thead>
          <tr>{['Código','Nombre','Pendiente','Cantidad a devolver'].map(h => (
            <th key={h} style={{ textAlign: 'left', padding: '7px 10px', fontSize: 11, color: 'var(--t-text-muted)', borderBottom: '1px solid var(--t-border)', fontWeight: 500 }}>{h}</th>
          ))}</tr>
        </thead>
        <tbody>
          {saldos.map(item => (
            <tr key={item.codigo}>
              <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--t-border)', fontFamily: 'monospace', fontSize: 12 }}>{item.codigo}</td>
              <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--t-border)', fontSize: 13 }}>{item.nombre}</td>
              <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--t-border)', fontSize: 13 }}>{item.pendiente}</td>
              <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--t-border)' }}>
                <input type='number' min={0} max={item.pendiente}
                  value={cantidades[item.codigo] || ''}
                  onChange={e => setCantidades(prev => ({ ...prev, [item.codigo]: e.target.value }))}
                  style={{ width: 80, padding: '5px 8px', border: '1px solid var(--t-border)', borderRadius: 6, fontSize: 13, background: 'var(--t-bg-inner)', color: 'var(--t-text-primary)' }} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ marginBottom: 16 }}>
        <label style={{ fontSize: 12, color: 'var(--t-text-muted)', fontWeight: 500, display: 'block', marginBottom: 6 }}>PDF soporte de devolución</label>
        <input type='file' accept='.pdf' onChange={e => setSoporteFile(e.target.files[0])}
          style={{ fontSize: 13, color: 'var(--t-text-primary)' }} />
        {soporteFile && <div style={{ fontSize: 12, color: 'var(--t-text-muted)', marginTop: 4 }}>✓ {soporteFile.name}</div>}
      </div>

      {error && <div style={{ color: '#c0392b', fontSize: 13, marginBottom: 12 }}>{error}</div>}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button onClick={onSaved} style={{ padding: '8px 16px', border: '1px solid var(--t-border)', borderRadius: 7, fontSize: 13, cursor: 'pointer', background: 'transparent', color: 'var(--t-text-primary)' }}>
          Cancelar
        </button>
        <button onClick={guardar} disabled={saving}
          style={{ padding: '8px 16px', border: 'none', borderRadius: 7, fontSize: 13, cursor: 'pointer', background: 'var(--t-accent)', color: '#fff', fontWeight: 500 }}>
          {saving ? 'Guardando…' : 'Guardar devolución'}
        </button>
      </div>
    </div>
  );
}

// ─── TAB NUEVO PRÉSTAMO ─────────────────────────────────────────────────────────

function TabNuevo({ clinicas, productos, onSaved }) {
  const [tipo, setTipo]           = useState('ingreso');
  const [clinicaId, setClinicaId] = useState('');
  const [bodega, setBodega]       = useState('');
  const [fecha, setFecha]         = useState(new Date().toISOString().split('T')[0]);
  const [docContable, setDocContable] = useState('');
  const [observaciones, setObs]   = useState('');
  const [items, setItems]         = useState([]);
  const [soporteFile, setSoporteFile] = useState(null);
  const [busqProd, setBusqProd]   = useState('');
  const [excelData, setExcelData] = useState(null); // datos del Excel maestro cargado
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState('');

  // Buscar en excel por documento contable
  async function buscarEnExcel() {
    if (!excelData || !docContable) return;
    const filas = excelData.filter(r => String(r['Documento'] || '').trim() === docContable.trim());
    if (filas.length === 0) { setError('Documento no encontrado en el Excel'); return; }
    setError('');
    const nuevosItems = filas.map(r => {
      const codigo = String(r['Código producto'] || '');
      const grupo  = getCategoriaFromCodigo(codigo);
      return {
        codigo,
        nombre: r['Nombre producto'] || '',
        cantidad: Number(r['Cantidad'] || 0),
        precio_unitario: Number(r['Precio unitario'] || 0),
        categoria: grupo?.categoria || '',
        cuenta_contable: grupo?.cuenta || '',
      };
    });
    setItems(prev => [...prev, ...nuevosItems]);
  }

  function cargarExcel(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const wb = XLSX.read(ev.target.result, { type: 'binary' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json(ws);
      setExcelData(data);
    };
    reader.readAsBinaryString(file);
  }

  const prodsFiltrados = productos.filter(p => {
    const q = busqProd.toLowerCase();
    return !q || p.codigo?.toLowerCase().includes(q) || p.nombre?.toLowerCase().includes(q);
  }).slice(0, 8);

  function agregarProducto(prod) {
    if (items.find(i => i.codigo === prod.codigo)) return;
    const grupo = getCategoriaFromCodigo(prod.codigo);
    setItems(prev => [...prev, {
      codigo: prod.codigo, nombre: prod.nombre,
      cantidad: 1, precio_unitario: prod.precio_unitario,
      categoria: grupo?.categoria || prod.categoria || '',
      cuenta_contable: grupo?.cuenta || '',
    }]);
    setBusqProd('');
  }

  function actualizarCantidad(codigo, val) {
    setItems(prev => prev.map(i => i.codigo === codigo ? { ...i, cantidad: Number(val) } : i));
  }

  function quitarItem(codigo) {
    setItems(prev => prev.filter(i => i.codigo !== codigo));
  }

  const total = items.reduce((s, i) => s + i.cantidad * i.precio_unitario, 0);

  async function guardar() {
    setError('');
    if (!clinicaId) return setError('Selecciona una clínica');
    if (!bodega)    return setError('Selecciona una bodega');
    if (!fecha)     return setError('Ingresa la fecha');
    if (!docContable) return setError('Ingresa el documento contable');
    if (items.length === 0) return setError('Agrega al menos un producto');
    setSaving(true);
    try {
      let soporte_url = null;
      if (soporteFile) {
        soporte_url = await subirPDF(soporteFile, `prestamo_${Date.now()}`);
      }
      const clinica = clinicas.find(c => c.id === clinicaId);
      const bod     = BODEGAS.find(b => b.codigo === bodega);
      await sbFetch('prestamos', {
        method: 'POST',
        body: JSON.stringify({
          tipo, clinica_id: clinicaId, clinica_nombre: clinica?.nombre,
          bodega_codigo: bodega, bodega_nombre: bod?.nombre,
          fecha, documento_contable: docContable,
          observaciones, soporte_url, items, estado: 'abierto',
        }),
      });
      onSaved();
    } catch (e) {
      setError('Error guardando: ' + e.message);
    }
    setSaving(false);
  }

  const inputS = { display: 'block', width: '100%', marginTop: 5, padding: '7px 10px', border: '1px solid var(--t-border)', borderRadius: 7, fontSize: 13, background: 'var(--t-bg-inner)', color: 'var(--t-text-primary)', boxSizing: 'border-box' };
  const labelS = { fontSize: 12, color: 'var(--t-text-muted)', fontWeight: 500 };

  return (
    <div style={{ maxWidth: 820 }}>
      {/* Tipo */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 20 }}>
        {['ingreso','egreso'].map(t => (
          <div key={t} onClick={() => setTipo(t)} style={{
            border: `${tipo === t ? '2px' : '1px'} solid ${tipo === t ? 'var(--t-accent)' : 'var(--t-border)'}`,
            borderRadius: 9, padding: '12px 16px', cursor: 'pointer',
            background: tipo === t ? 'var(--t-bg-card)' : 'transparent',
          }}>
            <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 3 }}>
              <Badge tipo={t} /> {t === 'ingreso' ? 'Recibimos préstamo' : 'Damos préstamo'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--t-text-muted)' }}>
              {t === 'ingreso' ? 'Una clínica nos presta a nosotros' : 'Nosotros prestamos a una clínica'}
            </div>
          </div>
        ))}
      </div>

      {/* Autocomplete por documento */}
      <div style={{ background: 'var(--t-bg-card)', border: '1px solid var(--t-border)', borderRadius: 9, padding: '12px 16px', marginBottom: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--t-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>
          Cargar productos desde Excel maestro
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label style={labelS}>Subir Excel de préstamos</label>
            <input type='file' accept='.xlsx,.csv,.xlsm' onChange={cargarExcel}
              style={{ display: 'block', marginTop: 5, fontSize: 12, color: 'var(--t-text-primary)' }} />
          </div>
          <div style={{ flex: 1, minWidth: 180 }}>
            <label style={labelS}>Documento contable a buscar</label>
            <input value={docContable} onChange={e => setDocContable(e.target.value)}
              placeholder='Ej: 0010101026000123' style={{ ...inputS }} />
          </div>
          <button onClick={buscarEnExcel} style={{ padding: '7px 14px', border: '1px solid var(--t-border)', borderRadius: 7, fontSize: 13, cursor: 'pointer', background: 'var(--t-bg-inner)', color: 'var(--t-text-primary)', whiteSpace: 'nowrap' }}>
            🔍 Buscar y cargar
          </button>
        </div>
        {excelData && <div style={{ fontSize: 11, color: 'var(--t-text-muted)', marginTop: 6 }}>✓ Excel cargado — {excelData.length} filas</div>}
      </div>

      {/* Datos generales */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
        <div>
          <label style={labelS}>Clínica</label>
          <select value={clinicaId} onChange={e => setClinicaId(e.target.value)} style={inputS}>
            <option value=''>— seleccionar —</option>
            {clinicas.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </div>
        <div>
          <label style={labelS}>Bodega</label>
          <select value={bodega} onChange={e => setBodega(e.target.value)} style={inputS}>
            <option value=''>— seleccionar —</option>
            {BODEGAS.map(b => <option key={b.codigo} value={b.codigo}>{b.nombre} ({b.codigo})</option>)}
          </select>
        </div>
        <div>
          <label style={labelS}>Fecha</label>
          <input type='date' value={fecha} onChange={e => setFecha(e.target.value)} style={inputS} />
        </div>
        <div>
          <label style={labelS}>Documento contable</label>
          <input value={docContable} onChange={e => setDocContable(e.target.value)} placeholder='0010101026000123' style={inputS} />
        </div>
        <div style={{ gridColumn: '2 / -1' }}>
          <label style={labelS}>Observaciones</label>
          <input value={observaciones} onChange={e => setObs(e.target.value)} placeholder='Opcional' style={inputS} />
        </div>
      </div>

      {/* Buscador de productos */}
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--t-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>Productos</div>
      <div style={{ position: 'relative', marginBottom: 10 }}>
        <input value={busqProd} onChange={e => setBusqProd(e.target.value)}
          placeholder='Buscar por código (10 dígitos) o nombre…'
          style={{ ...inputS, paddingRight: 10 }} />
        {busqProd && prodsFiltrados.length > 0 && (
          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--t-bg-card)', border: '1px solid var(--t-border)', borderRadius: 8, zIndex: 50, maxHeight: 220, overflowY: 'auto', boxShadow: '0 4px 20px rgba(0,0,0,.3)' }}>
            {prodsFiltrados.map(p => (
              <div key={p.codigo} onClick={() => agregarProducto(p)}
                style={{ padding: '9px 12px', cursor: 'pointer', fontSize: 13, borderBottom: '1px solid var(--t-border)', display: 'flex', gap: 10, alignItems: 'center' }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--t-bg-inner)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--t-text-muted)' }}>{p.codigo}</span>
                <span style={{ flex: 1 }}>{p.nombre}</span>
                <CatTag categoria={getCategoriaFromCodigo(p.codigo)?.categoria || p.categoria} />
                <span style={{ color: 'var(--t-text-muted)', fontSize: 12 }}>{fmt(p.precio_unitario)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Tabla de items */}
      <div style={{ border: '1px solid var(--t-border)', borderRadius: 9, overflow: 'hidden', marginBottom: 10 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead style={{ background: 'var(--t-bg-card)' }}>
            <tr>{['Código','Grupo','Categoría','Nombre','Cant.','Precio unit.','Total',''].map(h => (
              <th key={h} style={{ textAlign: 'left', padding: '8px 10px', fontSize: 11, color: 'var(--t-text-muted)', borderBottom: '1px solid var(--t-border)', fontWeight: 500 }}>{h}</th>
            ))}</tr>
          </thead>
          <tbody>
            {items.map(item => (
              <tr key={item.codigo}>
                <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--t-border)', fontFamily: 'monospace', fontSize: 12 }}>{item.codigo}</td>
                <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--t-border)', fontSize: 11, color: 'var(--t-text-muted)' }}>{String(item.codigo).substring(0, 6)}</td>
                <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--t-border)' }}><CatTag categoria={item.categoria} /></td>
                <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--t-border)' }}>{item.nombre}</td>
                <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--t-border)' }}>
                  <input type='number' min={1} value={item.cantidad} onChange={e => actualizarCantidad(item.codigo, e.target.value)}
                    style={{ width: 65, padding: '4px 7px', border: '1px solid var(--t-border)', borderRadius: 6, fontSize: 12, background: 'var(--t-bg-inner)', color: 'var(--t-text-primary)' }} />
                </td>
                <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--t-border)' }}>{fmt(item.precio_unitario)}</td>
                <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--t-border)', fontWeight: 500 }}>{fmt(item.cantidad * item.precio_unitario)}</td>
                <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--t-border)' }}>
                  <button onClick={() => quitarItem(item.codigo)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--t-text-muted)', fontSize: 16 }}>✕</button>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr><td colSpan={8} style={{ padding: '20px 10px', textAlign: 'center', color: 'var(--t-text-muted)', fontSize: 13 }}>Sin productos — busca arriba o carga desde Excel</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div style={{ textAlign: 'right', fontSize: 13, marginBottom: 16 }}>
        Total: <span style={{ fontWeight: 600, fontSize: 15 }}>{fmt(total)}</span>
      </div>

      {/* PDF soporte */}
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--t-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>Soporte (oficio PDF)</div>
      <div style={{ border: '1px dashed var(--t-border)', borderRadius: 9, padding: 16, textAlign: 'center', marginBottom: 20, cursor: 'pointer' }}
        onClick={() => document.getElementById('pdf-input').click()}>
        <div style={{ fontSize: 20, marginBottom: 5 }}>📄</div>
        <div style={{ fontSize: 13, color: 'var(--t-text-muted)' }}>
          {soporteFile ? `✓ ${soporteFile.name}` : 'Arrastra el PDF del oficio aquí o haz clic'}
        </div>
        <input id='pdf-input' type='file' accept='.pdf' style={{ display: 'none' }} onChange={e => setSoporteFile(e.target.files[0])} />
      </div>

      {error && <div style={{ color: '#c0392b', fontSize: 13, marginBottom: 12 }}>{error}</div>}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button onClick={onSaved} style={{ padding: '8px 16px', border: '1px solid var(--t-border)', borderRadius: 7, fontSize: 13, cursor: 'pointer', background: 'transparent', color: 'var(--t-text-primary)' }}>
          Cancelar
        </button>
        <button onClick={guardar} disabled={saving}
          style={{ padding: '8px 18px', border: 'none', borderRadius: 7, fontSize: 13, cursor: 'pointer', background: 'var(--t-accent)', color: '#fff', fontWeight: 500 }}>
          {saving ? 'Guardando…' : 'Guardar préstamo'}
        </button>
      </div>
    </div>
  );
}

// ─── TAB PRODUCTOS ──────────────────────────────────────────────────────────────

function TabProductos({ productos, onRefresh }) {
  const [busqueda, setBusqueda] = useState('');
  const [filtroCat, setFiltroCat] = useState('');
  const [saving, setSaving] = useState(false);

  const filtrados = productos.filter(p => {
    const q = busqueda.toLowerCase();
    const matchQ = !q || p.codigo?.toLowerCase().includes(q) || p.nombre?.toLowerCase().includes(q);
    const matchC = !filtroCat || (getCategoriaFromCodigo(p.codigo)?.categoria || '').includes(filtroCat);
    return matchQ && matchC;
  });

  async function cargarExcel(e) {
    const file = e.target.files[0];
    if (!file) return;
    setSaving(true);
    const reader = new FileReader();
    reader.onload = async ev => {
      try {
        const wb = XLSX.read(ev.target.result, { type: 'binary' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(ws);
        for (const row of data) {
          const codigo = String(row['Código'] || row['codigo'] || '');
          if (!codigo) continue;
          const grupo = getCategoriaFromCodigo(codigo);
          await sbFetch('prestamo_productos', {
            method: 'POST',
            headers: { 'Prefer': 'resolution=merge-duplicates' },
            body: JSON.stringify({
              codigo, nombre: row['Nombre'] || row['nombre'] || '',
              unidad: row['Unidad'] || row['unidad'] || '',
              precio_unitario: Number(row['Precio unitario'] || row['precio_unitario'] || 0),
              categoria: grupo?.categoria || '',
              cuenta_contable: grupo?.cuenta || '',
            }),
          });
        }
        onRefresh();
      } catch (err) { console.error(err); }
      setSaving(false);
    };
    reader.readAsBinaryString(file);
  }

  async function descargarPlantilla() {
    const ws = XLSX.utils.json_to_sheet([{ Código: '0101050001', Nombre: 'Ejemplo producto', Unidad: 'Tab', 'Precio unitario': 8500 }]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Productos');
    XLSX.writeFile(wb, 'plantilla_productos.xlsx');
  }

  const thS = { textAlign: 'left', padding: '8px 10px', fontSize: 11, color: 'var(--t-text-muted)', borderBottom: '1px solid var(--t-border)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em' };
  const tdS = { padding: '9px 10px', borderBottom: '1px solid var(--t-border)', fontSize: 13 };

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <input value={busqueda} onChange={e => setBusqueda(e.target.value)}
          placeholder='Buscar por código o nombre…'
          style={{ flex: 1, minWidth: 200, padding: '7px 10px', border: '1px solid var(--t-border)', borderRadius: 7, fontSize: 13, background: 'var(--t-bg-inner)', color: 'var(--t-text-primary)' }} />
        <select value={filtroCat} onChange={e => setFiltroCat(e.target.value)}
          style={{ padding: '7px 10px', border: '1px solid var(--t-border)', borderRadius: 7, fontSize: 13, background: 'var(--t-bg-inner)', color: 'var(--t-text-primary)' }}>
          <option value=''>Todas las categorías</option>
          <option value='Medicamentos'>Medicamentos</option>
          <option value='Dispositivos'>Dispositivos médicos</option>
          <option value='rojos'>Glóbulos rojos</option>
          <option value='Plasma'>Plasma</option>
          <option value='Plaquetas'>Plaquetas</option>
          <option value='nutricionales'>Complementos nutricionales</option>
          <option value='Gases'>Gases medicinales</option>
        </select>
        <label style={{ padding: '7px 13px', border: '1px solid var(--t-border)', borderRadius: 7, fontSize: 13, cursor: 'pointer', background: 'var(--t-bg-inner)', color: 'var(--t-text-primary)', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          ↑ {saving ? 'Cargando…' : 'Cargar Excel/CSV'}
          <input type='file' accept='.xlsx,.csv,.xlsm' style={{ display: 'none' }} onChange={cargarExcel} />
        </label>
        <button onClick={descargarPlantilla}
          style={{ padding: '7px 13px', border: '1px solid var(--t-border)', borderRadius: 7, fontSize: 13, cursor: 'pointer', background: 'var(--t-bg-inner)', color: 'var(--t-text-primary)' }}>
          ↓ Plantilla
        </button>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr>{['Código (10 díg.)','Grupo (6 díg.)','Cuenta contable','Categoría','Nombre','Unidad','Precio unitario'].map(h => (
            <th key={h} style={thS}>{h}</th>
          ))}</tr>
        </thead>
        <tbody>
          {filtrados.map(p => {
            const grupo = getCategoriaFromCodigo(p.codigo);
            return (
              <tr key={p.id}>
                <td style={{ ...tdS, fontFamily: 'monospace', fontSize: 12 }}>{p.codigo}</td>
                <td style={{ ...tdS, fontFamily: 'monospace', fontSize: 12, color: 'var(--t-text-muted)' }}>{String(p.codigo).substring(0, 6)}</td>
                <td style={{ ...tdS, fontSize: 12, color: 'var(--t-text-muted)' }}>{grupo?.cuenta || '—'}</td>
                <td style={tdS}><CatTag categoria={grupo?.categoria || p.categoria} /></td>
                <td style={tdS}>{p.nombre}</td>
                <td style={tdS}>{p.unidad}</td>
                <td style={{ ...tdS, fontWeight: 500 }}>{fmt(p.precio_unitario)}</td>
              </tr>
            );
          })}
          {filtrados.length === 0 && (
            <tr><td colSpan={7} style={{ padding: '30px 10px', textAlign: 'center', color: 'var(--t-text-muted)', fontSize: 13 }}>Sin productos — carga un Excel con la plantilla</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ─── TAB REPORTES ───────────────────────────────────────────────────────────────

function TabReportes({ prestamos, devoluciones }) {
  function exportar(filtro, nombre) {
    const datos = prestamos.filter(filtro).map(p => ({
      Documento: p.documento_contable,
      Fecha: p.fecha,
      Clínica: p.clinica_nombre,
      Bodega: `${p.bodega_nombre} (${p.bodega_codigo})`,
      Tipo: p.tipo,
      Estado: p.estado,
      'Valor total': (p.items || []).reduce((s, i) => s + i.cantidad * i.precio_unitario, 0),
      'Devoluciones': devoluciones.filter(d => d.prestamo_id === p.id).length,
    }));
    const ws = XLSX.utils.json_to_sheet(datos);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, nombre);
    XLSX.writeFile(wb, `${nombre}.xlsx`);
  }

  const cardStyle = {
    background: 'var(--t-bg-card)', border: '1px solid var(--t-border)', borderRadius: 10,
    padding: '14px 16px', cursor: 'pointer',
  };

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
        <div style={cardStyle} onClick={() => exportar(p => p.estado !== 'cerrado', 'prestamos_abiertos')}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 5 }}>
            <span style={{ fontSize: 18 }}>🕐</span>
            <span style={{ fontWeight: 500, fontSize: 13 }}>Préstamos abiertos</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--t-text-muted)' }}>Abiertos y parciales — exporta a Excel</div>
        </div>
        <div style={cardStyle} onClick={() => exportar(() => true, 'historial_completo')}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 5 }}>
            <span style={{ fontSize: 18 }}>📋</span>
            <span style={{ fontWeight: 500, fontSize: 13 }}>Historial completo</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--t-text-muted)' }}>Todos los movimientos — exporta a Excel</div>
        </div>
        <div style={cardStyle} onClick={() => exportar(p => p.tipo === 'egreso' && p.estado !== 'cerrado', 'egresos_pendientes')}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 5 }}>
            <span style={{ fontSize: 18 }}>🏥</span>
            <span style={{ fontWeight: 500, fontSize: 13 }}>Egresos pendientes de devolución</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--t-text-muted)' }}>Lo que clínicas nos deben devolver</div>
        </div>
        <div style={cardStyle} onClick={() => exportar(p => p.tipo === 'ingreso' && p.estado !== 'cerrado', 'ingresos_por_devolver')}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 5 }}>
            <span style={{ fontSize: 18 }}>📦</span>
            <span style={{ fontWeight: 500, fontSize: 13 }}>Ingresos por devolver</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--t-text-muted)' }}>Lo que nosotros debemos devolver</div>
        </div>
      </div>
    </div>
  );
}

// ─── MODAL genérico ─────────────────────────────────────────────────────────────

function Modal({ onClose, titulo, children }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: 'var(--t-bg-app)', border: '1px solid var(--t-border)', borderRadius: 12, width: '100%', maxWidth: 760, maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: '1px solid var(--t-border)' }}>
          <span style={{ fontWeight: 600, fontSize: 15 }}>{titulo}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--t-text-muted)', fontSize: 20, lineHeight: 1 }}>✕</button>
        </div>
        <div style={{ padding: '18px 20px', overflowY: 'auto', flex: 1 }}>{children}</div>
      </div>
    </div>
  );
}

// ─── Helpers Supabase Storage ───────────────────────────────────────────────────

async function subirPDF(file, nombre) {
  const path = `prestamos/${nombre}.pdf`;
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/documentos/${path}`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/pdf',
    },
    body: file,
  });
  if (!res.ok) throw new Error('Error subiendo PDF');
  return `${SUPABASE_URL}/storage/v1/object/public/documentos/${path}`;
}

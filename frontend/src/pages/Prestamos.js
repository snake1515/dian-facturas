import React, { useState, useEffect, useRef, useMemo } from 'react';
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
  if (!codigo) return null;
  const cod10 = String(codigo).padStart(10, '0');
  const grupo = cod10.substring(0, 6);
  return GRUPOS_CONTABLES[grupo] || null;
}

function fmt(n) {
  return '$' + Number(n || 0).toLocaleString('es-CO');
}

// ─── API helper — mismo patrón que Facturas.js ─────────────────────────────────

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';

async function apiFetch(path, options = {}) {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      ...options.headers,
    },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err || `Error ${res.status}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// Para subir archivos con FormData (PDF)
function fmtFecha(f) {
  if (!f) return '—';
  return String(f).substring(0, 10);
}

async function apiUpload(path, formData) {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body: formData,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err || `Error ${res.status}`);
  }
  return res.json();
}

// ─── Badges ───────────────────────────────────────────────────────────────────

function Badge({ tipo }) {
  const estilos = {
    ingreso:    { bg: '#E6F1FB', color: '#185FA5', label: 'Ingreso' },
    egreso:     { bg: '#FBEAF0', color: '#993556', label: 'Egreso' },
    abierto:    { bg: '#FAEEDA', color: '#854F0B', label: 'Abierto' },
    parcial:    { bg: '#FAECE7', color: '#993C1D', label: 'Parcial' },
    cerrado:    { bg: '#EAF3DE', color: '#3B6D11', label: 'Cerrado' },
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

// Muestra el/los soporte(s) de un cruce. Para cruces totales hay un único PDF
// (soporte_url); para cruces parciales puede haber un PDF por producto
// (soporte_items, guardado como { [codigo]: soporte_url }).
function CruceSoportes({ cruce }) {
  const linkS = { color: 'var(--t-accent)', fontSize: 11, textDecoration: 'none', display: 'block' };

  if (cruce.tipo_cruce === 'parcial' && cruce.soporte_items && Object.keys(cruce.soporte_items).length > 0) {
    const entradas = Object.entries(cruce.soporte_items).filter(([, url]) => url);
    if (entradas.length === 0) return <span style={{ color: 'var(--t-text-muted)', fontSize: 11 }}>—</span>;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {entradas.map(([codigo, url]) => {
          const item = (cruce.devolucion_items || []).find(i => i.codigo === codigo);
          const nombre = item?.nombre || codigo;
          return (
            <a key={codigo} href={`${API_BASE}/prestamos/soporte/${url}`} target="_blank" rel="noreferrer"
              title={nombre} style={linkS}>
              📄 {nombre.length > 22 ? nombre.substring(0, 22) + '…' : nombre}
            </a>
          );
        })}
      </div>
    );
  }

  if (cruce.soporte_url) {
    return (
      <a href={`${API_BASE}/prestamos/soporte/${cruce.soporte_url}`} target="_blank" rel="noreferrer" style={linkS}>
        📄 Ver
      </a>
    );
  }

  // Fallback: mostrar los soportes originales del préstamo (IPE/EPO) y de la devolución (IDP/ED)
  const enlaces = [];
  if (cruce.prestamo_soporte_url) {
    enlaces.push(
      <a key="prestamo" href={`${API_BASE}/prestamos/soporte/${cruce.prestamo_soporte_url}`} target="_blank" rel="noreferrer" style={linkS}>
        📄 {cruce.prestamo_doc}
      </a>
    );
  }
  if (cruce.devolucion_soporte_url) {
    enlaces.push(
      <a key="devolucion" href={`${API_BASE}/prestamos/soporte/${cruce.devolucion_soporte_url}`} target="_blank" rel="noreferrer" style={linkS}>
        📄 {cruce.devolucion_doc}
      </a>
    );
  }
  if (enlaces.length > 0) {
    return <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>{enlaces}</div>;
  }

  return <span style={{ color: 'var(--t-text-muted)', fontSize: 11 }}>—</span>;
}

// ─── Componente principal ───────────────────────────────────────────────────────

export default function Prestamos() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('resumen');

  const [prestamos,   setPrestamos]   = useState([]);
  const [devoluciones, setDevoluciones] = useState([]);
  const [productos,   setProductos]   = useState([]);
  const [clinicas,    setClinicas]    = useState([]);
  const [cruces,      setCruces]      = useState([]);
  const [loading,     setLoading]     = useState(true);

  useEffect(() => { cargarDatos(); }, []);

  async function cargarDatos() {
    setLoading(true);
    try {
      const [p, d, prod, cl, cr] = await Promise.all([
        apiFetch('/prestamos'),
        apiFetch('/prestamos/devoluciones'),
        apiFetch('/prestamos/productos'),
        apiFetch('/prestamos/clinicas'),
        apiFetch('/prestamos/cruces'),
      ]);
      setPrestamos(p   || []);
      setDevoluciones(d || []);
      setProductos(prod || []);
      setClinicas(cl    || []);
      setCruces(cr      || []);
    } catch (e) {
      console.error('Error cargando datos de préstamos:', e);
    }
    setLoading(false);
  }

  const tabs = [
    { id: 'resumen',     label: 'Resumen' },
    { id: 'movimientos', label: 'Movimientos' },
    { id: 'nuevo',       label: 'Nuevo préstamo' },
    { id: 'cruces',      label: 'Cruces' },
    { id: 'historial_cruces', label: 'Historial de Cruces' },
    { id: 'productos',   label: 'Productos' },
    { id: 'reportes',    label: 'Reportes' },
    { id: 'dashboard',   label: 'Dashboard' },
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
          {activeTab === 'resumen'     && <TabResumen prestamos={prestamos} devoluciones={devoluciones} onRefresh={cargarDatos} />}
          {activeTab === 'movimientos' && <TabMovimientos prestamos={prestamos} devoluciones={devoluciones} clinicas={clinicas} productos={productos} cruces={cruces} onRefresh={cargarDatos} />}
          {activeTab === 'nuevo'       && <TabNuevo clinicas={clinicas} productos={productos} onSaved={() => { cargarDatos(); setActiveTab('movimientos'); }} onRefreshClinicas={cargarDatos} />}
          {activeTab === 'productos'   && <TabProductos productos={productos} onRefresh={cargarDatos} />}
          {activeTab === 'cruces'      && <TabCruces prestamos={prestamos} cruces={cruces} productos={productos} clinicas={clinicas} onRefresh={cargarDatos} />}
          {activeTab === 'historial_cruces' && <TabHistorialCruces prestamos={prestamos} cruces={cruces} productos={productos} clinicas={clinicas} onRefresh={cargarDatos} />}
          {activeTab === 'reportes'    && <TabReportes prestamos={prestamos} devoluciones={devoluciones} cruces={cruces} clinicas={clinicas} />}
          {activeTab === 'dashboard'   && (
            <div style={{ maxWidth: 1100, margin: '0 auto' }}>
              <DashboardPrestamosInteractivo prestamos={prestamos} devoluciones={devoluciones} cruces={cruces} clinicas={clinicas} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── TAB RESUMEN ────────────────────────────────────────────────────────────────

function TabResumen({ prestamos, devoluciones, onRefresh }) {
  const [confirmPurga, setConfirmPurga] = React.useState(false);
  const [purgando,     setPurgando]     = React.useState(false);

  async function purgarTodo() {
    if (!confirmPurga) { setConfirmPurga(true); return; }
    setPurgando(true);
    try {
      await apiFetch('/prestamos/purgar', { method: 'DELETE' });
      onRefresh();
      setConfirmPurga(false);
    } catch (e) { alert('Error: ' + e.message); }
    setPurgando(false);
  }

  function saldoPendiente(p) {
    const totalPrestado = (p.items || []).reduce((s, i) => s + i.cantidad * i.precio_unitario, 0);
    const totalDevuelto = devoluciones
      .filter(d => d.prestamo_id === p.id)
      .flatMap(d => d.items || [])
      .reduce((s, i) => s + i.cantidad * i.precio_unitario, 0);
    return Math.max(0, totalPrestado - totalDevuelto);
  }

  const abiertos     = prestamos.filter(p => p.estado !== 'cerrado');
  const egresos      = abiertos.filter(p => p.tipo === 'egreso');
  const ingresos     = abiertos.filter(p => p.tipo === 'ingreso');
  const totalEgreso  = egresos.reduce((s, p) => s + saldoPendiente(p), 0);
  const totalIngreso = ingresos.reduce((s, p) => s + saldoPendiente(p), 0);

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
      {/* Botón purga */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        {!confirmPurga ? (
          <button onClick={purgarTodo} style={{ padding: '6px 14px', fontSize: 12, borderRadius: 6, border: '1px solid #ef4444', background: 'transparent', color: '#ef4444', cursor: 'pointer' }}>
            🗑 Purgar todos los documentos
          </button>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: '#ef4444' }}>⚠️ ¿Confirmas? Se borrarán TODOS los préstamos, devoluciones y cruces.</span>
            <button onClick={purgarTodo} disabled={purgando} style={{ padding: '6px 14px', fontSize: 12, borderRadius: 6, border: 'none', background: '#ef4444', color: '#fff', cursor: 'pointer', fontWeight: 600 }}>
              {purgando ? 'Borrando…' : 'Sí, purgar todo'}
            </button>
            <button onClick={() => setConfirmPurga(false)} style={{ padding: '6px 14px', fontSize: 12, borderRadius: 6, border: '1px solid var(--t-border)', background: 'var(--t-bg-inner)', color: 'var(--t-text-primary)', cursor: 'pointer' }}>
              Cancelar
            </button>
          </div>
        )}
      </div>
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
                  <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--t-border)', fontSize: 12 }}>{fmtFecha(p.fecha)}</td>
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

function TabMovimientos({ prestamos, devoluciones, clinicas, productos = [], cruces = [], onRefresh }) {
  const { isAdmin } = useAuth();

  function saldoPend(p) {
    const totalPrestado = (p.items || []).reduce((s, i) => s + i.cantidad * i.precio_unitario, 0);
    const totalDevuelto = devoluciones
      .filter(d => d.prestamo_id === p.id)
      .flatMap(d => d.items || [])
      .reduce((s, i) => s + i.cantidad * i.precio_unitario, 0);
    return Math.max(0, totalPrestado - totalDevuelto);
  }

  // Un documento puede participar en un cruce como el préstamo original o
  // como la devolución que lo cierra — se busca en ambos lados.
  function crucesDe(p) {
    if (!p) return [];
    return cruces.filter(c => c.prestamo_id === p.id || c.devolucion_id === p.id);
  }

  async function borrarMovimiento(p, e) {
    e.stopPropagation();
    if (!window.confirm(`¿Borrar el movimiento ${p.documento_contable}? Esta acción es irreversible.`)) return;
    try {
      await apiFetch(`/prestamos/${p.id}`, { method: 'DELETE' });
      onRefresh();
    } catch (err) {
      alert('Error: ' + err.message);
    }
  }

  async function subirSoportePrestamo(prestamo_id, file) {
    if (!file) return;
    try {
      const formData = new FormData();
      formData.append('soporte', file);
      await apiFetch(`/prestamos/${prestamo_id}/soporte`, {
        method: 'PATCH',
        body: formData,
        headers: {},
      });
      onRefresh();
    } catch (err) {
      alert('Error al subir soporte: ' + err.message);
    }
  }

  async function eliminarSoporte(prestamo_id) {
    if (!window.confirm('¿Eliminar el soporte?')) return;
    try {
      await apiFetch(`/prestamos/${prestamo_id}/soporte`, { method: 'DELETE' });
      onRefresh();
    } catch (err) {
      alert('Error al eliminar soporte: ' + err.message);
    }
  }

  // Normaliza un texto de código (documento_contable o nombre de archivo)
  // dejando solo letras/números en mayúscula, para poder comparar
  // "EPO851" (documento) con "EPO-851" (nombre de archivo).
  function normalizarCodigo(txt) {
    return String(txt || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  const [subiendoLote, setSubiendoLote] = useState(false);
  const [resultadoLote, setResultadoLote] = useState(null); // { subidos: [], noEncontrados: [] }

  async function subirSoportesLote(fileList) {
    const files = Array.from(fileList || []).filter(f => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
    if (files.length === 0) return;

    setSubiendoLote(true);
    setResultadoLote(null);
    const subidos = [];
    const noEncontrados = [];

    for (const file of files) {
      const nombreBase = file.name.replace(/\.pdf$/i, '');
      const codigoArchivo = normalizarCodigo(nombreBase);
      const match = prestamos.find(p => normalizarCodigo(p.documento_contable) === codigoArchivo);

      if (!match) {
        noEncontrados.push(file.name);
        continue;
      }

      try {
        const formData = new FormData();
        formData.append('soporte', file);
        await apiFetch(`/prestamos/${match.id}/soporte`, {
          method: 'PATCH',
          body: formData,
          headers: {},
        });
        subidos.push(`${file.name} → ${match.documento_contable}`);
      } catch (err) {
        noEncontrados.push(`${file.name} (error: ${err.message})`);
      }
    }

    setSubiendoLote(false);
    setResultadoLote({ subidos, noEncontrados });

    // Aviso nativo del navegador — no depende de estilos ni de que el modal
    // se renderice correctamente, siempre se ve.
    let resumen = `Carga de PDFs terminada.\n\n✓ Subidos correctamente: ${subidos.length}`;
    if (subidos.length > 0) resumen += `\n${subidos.map(s => '  • ' + s).join('\n')}`;
    resumen += `\n\n✕ Sin coincidencia: ${noEncontrados.length}`;
    if (noEncontrados.length > 0) resumen += `\n${noEncontrados.map(s => '  • ' + s).join('\n')}`;
    window.alert(resumen);

    onRefresh();
  }

  const [busqueda,    setBusqueda]    = useState('');
  const [filtroTipo,  setFiltroTipo]  = useState('');
  const [filtroEstado,setFiltroEstado]= useState('');
  const [filtroBodega,setFiltroBodega]= useState('');
  const [filtroMes,   setFiltroMes]   = useState('');
  const [filtroAnio,  setFiltroAnio]  = useState('');
  const [detalle,     setDetalle]     = useState(null);
  const [devModal,    setDevModal]    = useState(null);
  const [crucesModal, setCrucesModal] = useState(null); // array de cruces del documento clickeado
  const [editModal,   setEditModal]   = useState(null); // movimiento en edición (solo admin)

  const MESES = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
  ];

  const aniosDisponibles = [...new Set(
    prestamos.map(p => p.fecha && p.fecha.substring(0, 4)).filter(Boolean)
  )].sort((a, b) => b - a);

  const filtrados = prestamos.filter(p => {
    const q = busqueda.toLowerCase();
    const matchQ      = !q           || p.documento_contable?.toLowerCase().includes(q) || p.clinica_nombre?.toLowerCase().includes(q);
    const matchTipo   = !filtroTipo   || p.tipo          === filtroTipo;
    const matchEstado = !filtroEstado || p.estado         === filtroEstado;
    const matchBodega = !filtroBodega || p.bodega_codigo  === filtroBodega;
    const matchMes    = !filtroMes    || p.fecha?.substring(5, 7) === filtroMes;
    const matchAnio   = !filtroAnio   || p.fecha?.substring(0, 4) === filtroAnio;
    return matchQ && matchTipo && matchEstado && matchBodega && matchMes && matchAnio;
  });

  async function exportar() {
    const rows = filtrados.map(p => ({
      Documento: p.documento_contable,
      Fecha:     p.fecha,
      Clínica:   p.clinica_nombre,
      Bodega:    p.bodega_nombre,
      Tipo:      p.tipo,
      Estado:    p.estado,
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
        <select value={filtroMes} onChange={e => setFiltroMes(e.target.value)}
          style={{ padding: '7px 10px', border: '1px solid var(--t-border)', borderRadius: 7, fontSize: 13, background: 'var(--t-bg-inner)', color: 'var(--t-text-primary)' }}>
          <option value=''>Todos los meses</option>
          {MESES.map((m, i) => (
            <option key={m} value={String(i + 1).padStart(2, '0')}>{m}</option>
          ))}
        </select>
        <select value={filtroAnio} onChange={e => setFiltroAnio(e.target.value)}
          style={{ padding: '7px 10px', border: '1px solid var(--t-border)', borderRadius: 7, fontSize: 13, background: 'var(--t-bg-inner)', color: 'var(--t-text-primary)' }}>
          <option value=''>Todos los años</option>
          {aniosDisponibles.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <button onClick={exportar} style={{ padding: '7px 13px', border: '1px solid var(--t-border)', borderRadius: 7, fontSize: 13, cursor: 'pointer', background: 'var(--t-bg-inner)', color: 'var(--t-text-primary)' }}>
          ↓ Exportar
        </button>
        <input id="lote-soporte-input" type="file" accept=".pdf" multiple style={{ display: 'none' }}
          onChange={e => { subirSoportesLote(e.target.files); e.target.value = ''; }} />
        <button onClick={() => document.getElementById('lote-soporte-input').click()}
          disabled={subiendoLote}
          style={{ padding: '7px 13px', border: '1px solid var(--t-border)', borderRadius: 7, fontSize: 13, cursor: subiendoLote ? 'default' : 'pointer', background: 'var(--t-bg-inner)', color: 'var(--t-text-primary)', opacity: subiendoLote ? 0.6 : 1 }}>
          {subiendoLote ? 'Subiendo…' : '📎 Subir PDFs por lote'}
        </button>
      </div>

      {resultadoLote && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
          onClick={() => setResultadoLote(null)}>
          <div style={{ background: 'var(--t-bg-card)', border: '1px solid var(--t-border)', borderRadius: 10, padding: 20, width: 460, maxWidth: '90vw', maxHeight: '80vh', overflowY: 'auto', boxShadow: '0 10px 40px rgba(0,0,0,0.4)' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <strong style={{ fontSize: 15, color: 'var(--t-text-primary)' }}>
                {resultadoLote.noEncontrados.length === 0 ? '✅ Carga de PDFs completa' : '⚠️ Carga de PDFs con avisos'}
              </strong>
              <span onClick={() => setResultadoLote(null)} style={{ cursor: 'pointer', color: 'var(--t-text-muted)', fontSize: 16 }}>✕</span>
            </div>
            <div style={{ fontSize: 13, color: 'var(--t-text-primary)', marginBottom: 12 }}>
              {resultadoLote.subidos.length} archivo(s) subido(s) correctamente · {resultadoLote.noEncontrados.length} sin coincidencia
            </div>
            {resultadoLote.subidos.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#22c55e', marginBottom: 6 }}>✓ Subidos correctamente</div>
                {resultadoLote.subidos.map((s, i) => (
                  <div key={i} style={{ fontSize: 12, color: 'var(--t-text-primary)', padding: '3px 0', borderBottom: '1px solid var(--t-border)' }}>{s}</div>
                ))}
              </div>
            )}
            {resultadoLote.noEncontrados.length > 0 && (
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#ef4444', marginBottom: 6 }}>✕ Sin coincidencia</div>
                {resultadoLote.noEncontrados.map((s, i) => (
                  <div key={i} style={{ fontSize: 12, color: 'var(--t-text-primary)', padding: '3px 0', borderBottom: '1px solid var(--t-border)' }}>{s}</div>
                ))}
              </div>
            )}
            <button onClick={() => setResultadoLote(null)}
              style={{ marginTop: 16, width: '100%', padding: '8px 0', border: '1px solid var(--t-border)', borderRadius: 7, fontSize: 13, cursor: 'pointer', background: 'var(--t-bg-inner)', color: 'var(--t-text-primary)' }}>
              Cerrar
            </button>
          </div>
        </div>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>

          <thead>
            <tr>
              {['Documento','Fecha','Clínica','Bodega','Tipo','Valor total','Saldo pend.','Soporte','Estado',''].map(h => (
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
                  <td style={tdStyle}>{fmtFecha(p.fecha)}</td>
                  <td style={tdStyle}>{p.clinica_nombre}</td>
                  <td style={{ ...tdStyle, fontSize: 12, color: 'var(--t-text-muted)' }}>{p.bodega_nombre} ({p.bodega_codigo})</td>
                  <td style={tdStyle}><Badge tipo={p.tipo} /></td>
                  <td style={{ ...tdStyle, fontWeight: 500 }}>{fmt(total)}</td>
                  <td style={{ ...tdStyle, fontWeight: 500, color: saldoPend(p) > 0 ? '#BA7517' : '#22c55e' }}>{fmt(saldoPend(p))}</td>
                  <td style={{ ...tdStyle, textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                    {p.soporte_url ? (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                        <span style={{ fontSize: 14 }}>
                          {p.soporte_url.includes('.jpg') || p.soporte_url.includes('.jpeg') ? '🖼️' : '📄'}
                        </span>
                        <a href={`${API_BASE}/prestamos/soporte/${p.soporte_url}`} target='_blank' rel='noreferrer'
                          style={{ color: 'var(--t-accent)', fontSize: 11, textDecoration: 'none' }}>Ver</a>
                        <button onClick={() => eliminarSoporte(p.id)}
                          title='Eliminar soporte'
                          style={{ padding: 0, background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: '#ef4444' }}>
                          ✕
                        </button>
                      </div>
                    ) : (
                      <div>
                        <input id={`file-soporte-${p.id}`} type='file' accept='.pdf,.jpg,.jpeg' 
                          onChange={e => subirSoportePrestamo(p.id, e.target.files[0])}
                          style={{ display: 'none' }} />
                        <button onClick={() => document.getElementById(`file-soporte-${p.id}`).click()}
                          style={{ color: 'var(--t-accent)', fontSize: 12, background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
                          + Soporte
                        </button>
                      </div>
                    )}
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
                    {isAdmin && (
                      <button onClick={e => { e.stopPropagation(); setEditModal(p); }}
                        title='Editar movimiento (solo admin)'
                        style={{ marginLeft: 6, padding: '4px 10px', fontSize: 12, border: '1px solid var(--t-border)', borderRadius: 6, cursor: 'pointer', background: 'var(--t-bg-inner)', color: 'var(--t-text-primary)' }}>
                        ✏️ Editar
                      </button>
                    )}
                    {devs.length > 0 && (
                      <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--t-text-muted)' }}>{devs.length} dev.</span>
                    )}
                    {crucesDe(p).length > 0 && (
                      <button onClick={e => { e.stopPropagation(); setCrucesModal(crucesDe(p)); }}
                        title='Ver detalle del cruce'
                        style={{ marginLeft: 6, padding: '4px 8px', fontSize: 11, border: '1px solid var(--t-accent)', borderRadius: 6, cursor: 'pointer', background: 'transparent', color: 'var(--t-accent)' }}>
                        🔗 Cruce{crucesDe(p).length > 1 ? ` (${crucesDe(p).length})` : ''}
                      </button>
                    )}
                    <button onClick={e => borrarMovimiento(p, e)}
                      title='Borrar movimiento'
                      style={{ marginLeft: 6, padding: '4px 8px', fontSize: 12, border: '1px solid #ef444455', borderRadius: 6, cursor: 'pointer', background: 'transparent', color: '#ef4444' }}>
                      🗑
                    </button>
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

      {detalle && (
        <Modal onClose={() => setDetalle(null)} titulo={`Préstamo ${detalle.documento_contable}`}>
          <DetallePrestamoModal prestamo={detalle} devoluciones={devoluciones.filter(d => d.prestamo_id === detalle.id)} cruces={crucesDe(detalle)} />
        </Modal>
      )}

      {crucesModal && (
        <Modal onClose={() => setCrucesModal(null)} titulo="Detalle del cruce">
          {crucesModal.map((c, idx) => (
            <div key={c.id} style={{ marginBottom: idx < crucesModal.length - 1 ? 20 : 0, paddingBottom: idx < crucesModal.length - 1 ? 20 : 0, borderBottom: idx < crucesModal.length - 1 ? '1px solid var(--t-border)' : 'none' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--t-text-primary)', marginBottom: 8 }}>
                {c.prestamo_doc} <span style={{ color: 'var(--t-text-muted)', fontWeight: 400 }}>↔</span> {c.devolucion_doc}
                <span style={{ marginLeft: 8, padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600, background: badgeEstado(c.estado_prestamo).bg, color: badgeEstado(c.estado_prestamo).color }}>
                  préstamo: {badgeEstado(c.estado_prestamo).label}
                </span>
                <span style={{ marginLeft: 4, padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600, background: badgeEstado(c.estado_devolucion).bg, color: badgeEstado(c.estado_devolucion).color }}>
                  devolución: {badgeEstado(c.estado_devolucion).label}
                </span>
              </div>
              {c.grupo_numero && (
                <div style={{ fontSize: 12, color: 'var(--t-text-muted)', marginBottom: 6 }}>
                  <span style={{ fontWeight: 600, color: 'var(--t-text-primary)' }}>Cruce: </span>
                  {c.grupo_numero}
                  {c.grupo_pdf_url && (
                    <a href={`${API_BASE}/prestamos/soporte/${c.grupo_pdf_url}`} target="_blank" rel="noreferrer"
                      style={{ marginLeft: 8, color: 'var(--t-accent)' }}>📄 Ver PDF del cruce</a>
                  )}
                </div>
              )}
              <div style={{ fontSize: 12, color: 'var(--t-text-muted)', marginBottom: 10 }}>
                <span style={{ fontWeight: 600, color: 'var(--t-text-primary)' }}>Descripción: </span>
                {c.observaciones || c.grupo_observaciones || 'Sin descripción'}
              </div>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--t-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
                Items cruzados
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr>
                    {['Código','Producto','Cantidad'].map(h => (
                      <th key={h} style={{ padding: '4px 8px', textAlign: 'left', color: 'var(--t-text-muted)', fontWeight: 600, borderBottom: '1px solid var(--t-border)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(c.devolucion_items || []).length === 0 ? (
                    <tr><td colSpan={3} style={{ padding: '6px 8px', color: 'var(--t-text-muted)' }}>Sin items registrados</td></tr>
                  ) : (c.devolucion_items || []).map(item => (
                    <tr key={item.codigo}>
                      <td style={{ padding: '4px 8px', color: 'var(--t-text-primary)', fontFamily: 'monospace' }}>{item.codigo}</td>
                      <td style={{ padding: '4px 8px', color: 'var(--t-text-primary)' }}>{item.nombre}</td>
                      <td style={{ padding: '4px 8px', color: 'var(--t-text-muted)' }}>{item.cantidad}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </Modal>
      )}

      {devModal && (
        <Modal onClose={() => setDevModal(null)} titulo={`Registrar devolución — ${devModal.documento_contable}`}>
          <FormDevolucion
            prestamo={devModal}
            devoluciones={devoluciones.filter(d => d.prestamo_id === devModal.id)}
            onSaved={() => { setDevModal(null); onRefresh(); }}
          />
        </Modal>
      )}

      {editModal && (
        <Modal onClose={() => setEditModal(null)} titulo={`Editar movimiento — ${editModal.documento_contable}`}>
          <FormEditarMovimiento
            movimiento={editModal}
            clinicas={clinicas}
            productos={productos}
            onSaved={() => { setEditModal(null); onRefresh(); }}
            onCancel={() => setEditModal(null)}
          />
        </Modal>
      )}
    </div>
  );
}

// ─── DETALLE PRÉSTAMO ───────────────────────────────────────────────────────────

function DetallePrestamoModal({ prestamo, devoluciones, cruces = [] }) {
  const thS = { textAlign: 'left', padding: '7px 10px', fontSize: 11, color: 'var(--t-text-muted)', borderBottom: '1px solid var(--t-border)', fontWeight: 500 };
  const tdS = { padding: '8px 10px', borderBottom: '1px solid var(--t-border)', fontSize: 13 };

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16, fontSize: 13 }}>
        <div><span style={{ color: 'var(--t-text-muted)', fontSize: 12 }}>Clínica: </span>{prestamo.clinica_nombre}</div>
        <div><span style={{ color: 'var(--t-text-muted)', fontSize: 12 }}>Bodega: </span>{prestamo.bodega_nombre} ({prestamo.bodega_codigo})</div>
        <div><span style={{ color: 'var(--t-text-muted)', fontSize: 12 }}>Fecha: </span>{fmtFecha(prestamo.fecha)}</div>
        <div><span style={{ color: 'var(--t-text-muted)', fontSize: 12 }}>Tipo: </span><Badge tipo={prestamo.tipo} /></div>
        <div><span style={{ color: 'var(--t-text-muted)', fontSize: 12 }}>Estado: </span><Badge tipo={prestamo.estado} /></div>
        {prestamo.soporte_url && <div><a href={`${API_BASE}/prestamos/soporte/${prestamo.soporte_url}`} target='_blank' rel='noreferrer' style={{ color: 'var(--t-accent)', fontSize: 12 }}>Ver PDF soporte</a></div>}
        {prestamo.observaciones && (
          <div style={{ gridColumn: '1 / -1', marginTop: 4, padding: '8px 10px', background: 'var(--t-bg-card)', borderRadius: 7, fontSize: 12, color: 'var(--t-text-secondary)', lineHeight: 1.5 }}>
            <span style={{ color: 'var(--t-text-muted)', fontWeight: 500 }}>Descripción: </span>{prestamo.observaciones}
          </div>
        )}
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
                <span style={{ fontWeight: 500 }}>Dev. #{idx + 1}</span>
                <span style={{ color: 'var(--t-text-muted)', fontSize: 12 }}>{fmtFecha(d.fecha)}</span>
                <span style={{ color: 'var(--t-text-muted)', fontSize: 12 }}>{d.documento_contable}</span>
                {d.soporte_url && <a href={`${API_BASE}/prestamos/soporte/${d.soporte_url}`} target='_blank' rel='noreferrer' style={{ color: 'var(--t-accent)', fontSize: 12, marginLeft: 'auto' }}>PDF</a>}
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  {(d.items || []).map((item, j) => (
                    <tr key={j}>
                      <td style={{ padding: '6px 12px', fontSize: 12, fontFamily: 'monospace', color: 'var(--t-text-muted)' }}>{item.codigo}</td>
                      <td style={{ padding: '6px 12px', fontSize: 13 }}>{item.nombre}</td>
                      <td style={{ padding: '6px 12px', fontSize: 13 }}>{item.cantidad} unid.</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </>
      )}

      {cruces.length > 0 && (
        <>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--t-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8, marginTop: 20 }}>Cruces</div>
          {cruces.map(c => {
            const esDevolucion = c.devolucion_id === prestamo.id;
            const docContraparte = esDevolucion ? c.prestamo_doc : c.devolucion_doc;
            return (
              <div key={c.id} style={{ border: '1px solid var(--t-border)', borderRadius: 8, marginBottom: 10, overflow: 'hidden' }}>
                <div style={{ background: 'var(--t-bg-card)', padding: '8px 12px', display: 'flex', gap: 12, alignItems: 'center', fontSize: 13, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 500 }}>🔗 {esDevolucion ? 'Cruce con préstamo' : 'Cruce con devolución'} {docContraparte}</span>
                  <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600, background: badgeEstado(c.estado_prestamo).bg, color: badgeEstado(c.estado_prestamo).color }}>
                    préstamo: {badgeEstado(c.estado_prestamo).label}
                  </span>
                  <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600, background: badgeEstado(c.estado_devolucion).bg, color: badgeEstado(c.estado_devolucion).color }}>
                    devolución: {badgeEstado(c.estado_devolucion).label}
                  </span>
                  <span style={{ color: 'var(--t-text-muted)', fontSize: 12 }}>{c.created_at?.substring(0, 10)}</span>
                </div>
                <div style={{ padding: '10px 12px' }}>
                  {c.observaciones && (
                    <div style={{ fontSize: 12, color: 'var(--t-text-secondary)', marginBottom: 8, lineHeight: 1.5 }}>
                      <span style={{ color: 'var(--t-text-muted)', fontWeight: 500 }}>Notas: </span>{c.observaciones}
                    </div>
                  )}
                  <CruceSoportes cruce={c} />
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

// ─── FORM DEVOLUCIÓN ────────────────────────────────────────────────────────────

function FormDevolucion({ prestamo, devoluciones, onSaved }) {
  const [fecha,       setFecha]       = useState(new Date().toISOString().split('T')[0]);
  const [docContable, setDocContable] = useState('');
  const [soporteFile, setSoporteFile] = useState(null);
  const [cantidades,  setCantidades]  = useState({});
  const [saving,      setSaving]      = useState(false);
  const [error,       setError]       = useState('');

  const saldos = (prestamo.items || []).map(item => {
    const devuelto = devoluciones.flatMap(d => d.items || [])
      .filter(i => i.codigo === item.codigo)
      .reduce((s, i) => s + i.cantidad, 0);
    return { ...item, pendiente: item.cantidad - devuelto };
  }).filter(i => i.pendiente > 0);

  async function guardar() {
    setError('');
    if (!fecha)       return setError('La fecha es requerida');
    if (!docContable) return setError('El documento contable es requerido');
    const items = saldos.filter(i => cantidades[i.codigo] > 0).map(i => ({
      codigo: i.codigo, nombre: i.nombre, cantidad: Number(cantidades[i.codigo]),
      precio_unitario: i.precio_unitario, categoria: i.categoria,
    }));
    if (items.length === 0) return setError('Debes ingresar al menos una cantidad a devolver');

    setSaving(true);
    try {
      const fd = new FormData();
      fd.append('prestamo_id',       prestamo.id);
      fd.append('fecha',             fecha);
      fd.append('documento_contable', docContable);
      fd.append('items',             JSON.stringify(items));
      if (soporteFile) fd.append('soporte', soporteFile);

      await apiUpload('/prestamos/devoluciones', fd);
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

// ─── EDITAR MOVIMIENTO (solo admin) ─────────────────────────────────────────────
// Permite modificar todos los campos de un movimiento ya registrado: tipo,
// clínica, bodega, fecha, documento contable, observaciones, y los productos
// (agregar, quitar, cambiar cantidad/precio). El backend valida que solo un
// usuario con rol admin pueda invocar este PATCH.

const TIPOS_MOVIMIENTO = [
  { value: 'ingreso',            label: 'Ingreso (IPE) — recibimos préstamo' },
  { value: 'egreso',             label: 'Egreso (EPO) — damos préstamo' },
  { value: 'devolucion_ingreso', label: 'Devolución de ingreso (IDP)' },
  { value: 'devolucion_egreso',  label: 'Devolución de egreso (ED)' },
];

function FormEditarMovimiento({ movimiento, clinicas, productos, onSaved, onCancel }) {
  const [tipo,          setTipo]          = useState(movimiento.tipo || 'ingreso');
  const [clinicaId,     setClinicaId]     = useState(movimiento.clinica_id != null ? String(movimiento.clinica_id) : '');
  const [bodega,        setBodega]        = useState(movimiento.bodega_codigo || '');
  const [fecha,         setFecha]         = useState(movimiento.fecha ? String(movimiento.fecha).substring(0, 10) : '');
  const [docContable,   setDocContable]   = useState(movimiento.documento_contable || '');
  const [observaciones, setObs]           = useState(movimiento.observaciones || '');
  const [items,         setItems]         = useState((movimiento.items || []).map(i => ({ ...i })));
  const [busqProd,      setBusqProd]      = useState('');
  const [saving,        setSaving]        = useState(false);
  const [error,         setError]         = useState('');

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
      categoria:       grupo?.categoria || prod.categoria || '',
      cuenta_contable: grupo?.cuenta || '',
    }]);
    setBusqProd('');
  }

  function actualizarItem(codigo, campo, val) {
    setItems(prev => prev.map(i => i.codigo === codigo
      ? { ...i, [campo]: campo === 'cantidad' || campo === 'precio_unitario' ? Number(val) : val }
      : i));
  }

  function quitarItem(codigo) {
    setItems(prev => prev.filter(i => i.codigo !== codigo));
  }

  const total = items.reduce((s, i) => s + Number(i.cantidad || 0) * Number(i.precio_unitario || 0), 0);

  async function guardar() {
    setError('');
    if (!fecha)       return setError('La fecha es requerida');
    if (!docContable) return setError('El documento contable es requerido');
    if (items.length === 0) return setError('Debe haber al menos un producto');

    setSaving(true);
    try {
      const clinica = clinicas.find(c => String(c.id) === String(clinicaId));
      const bod     = BODEGAS.find(b => b.codigo === bodega);

      await apiFetch(`/prestamos/${movimiento.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tipo,
          clinica_id:         clinicaId || null,
          clinica_nombre:     clinica?.nombre || movimiento.clinica_nombre || '',
          bodega_codigo:      bodega,
          bodega_nombre:      bod?.nombre || movimiento.bodega_nombre || '',
          fecha,
          documento_contable: docContable,
          observaciones,
          items,
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
    <div style={{ minWidth: 640, maxWidth: 820 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={labelS}>Tipo de movimiento</label>
          <select value={tipo} onChange={e => setTipo(e.target.value)} style={inputS}>
            {TIPOS_MOVIMIENTO.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
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
          <input value={docContable} onChange={e => setDocContable(e.target.value)} style={inputS} />
        </div>
        <div style={{ gridColumn: '2 / -1' }}>
          <label style={labelS}>Observaciones</label>
          <input value={observaciones} onChange={e => setObs(e.target.value)} placeholder='Opcional' style={inputS} />
        </div>
      </div>

      {/* Buscador de productos para agregar nuevos items */}
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--t-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>Productos</div>
      <div style={{ position: 'relative', marginBottom: 10 }}>
        <input value={busqProd} onChange={e => setBusqProd(e.target.value)}
          placeholder='Buscar por código (10 dígitos) o nombre para agregar…'
          style={{ ...inputS, marginTop: 0 }} />
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

      {/* Tabla de items — cantidad, precio y nombre editables directamente */}
      <div style={{ border: '1px solid var(--t-border)', borderRadius: 9, overflow: 'hidden', marginBottom: 10 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead style={{ background: 'var(--t-bg-card)' }}>
            <tr>{['Código','Categoría','Nombre','Cant.','Precio unit.','Total',''].map(h => (
              <th key={h} style={{ textAlign: 'left', padding: '8px 10px', fontSize: 11, color: 'var(--t-text-muted)', borderBottom: '1px solid var(--t-border)', fontWeight: 500 }}>{h}</th>
            ))}</tr>
          </thead>
          <tbody>
            {items.map(item => (
              <tr key={item.codigo}>
                <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--t-border)', fontFamily: 'monospace', fontSize: 12 }}>{item.codigo}</td>
                <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--t-border)' }}><CatTag categoria={item.categoria} /></td>
                <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--t-border)' }}>
                  <input value={item.nombre} onChange={e => actualizarItem(item.codigo, 'nombre', e.target.value)}
                    style={{ width: '100%', padding: '4px 7px', border: '1px solid var(--t-border)', borderRadius: 6, fontSize: 12, background: 'var(--t-bg-inner)', color: 'var(--t-text-primary)' }} />
                </td>
                <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--t-border)' }}>
                  <input type='number' min={1} value={item.cantidad} onChange={e => actualizarItem(item.codigo, 'cantidad', e.target.value)}
                    style={{ width: 65, padding: '4px 7px', border: '1px solid var(--t-border)', borderRadius: 6, fontSize: 12, background: 'var(--t-bg-inner)', color: 'var(--t-text-primary)' }} />
                </td>
                <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--t-border)' }}>
                  <input type='number' min={0} value={item.precio_unitario} onChange={e => actualizarItem(item.codigo, 'precio_unitario', e.target.value)}
                    style={{ width: 90, padding: '4px 7px', border: '1px solid var(--t-border)', borderRadius: 6, fontSize: 12, background: 'var(--t-bg-inner)', color: 'var(--t-text-primary)' }} />
                </td>
                <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--t-border)', fontWeight: 500 }}>{fmt(item.cantidad * item.precio_unitario)}</td>
                <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--t-border)' }}>
                  <button onClick={() => quitarItem(item.codigo)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--t-text-muted)', fontSize: 16 }}>✕</button>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr><td colSpan={7} style={{ padding: '20px 10px', textAlign: 'center', color: 'var(--t-text-muted)', fontSize: 13 }}>Sin productos — busca arriba para agregar</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div style={{ textAlign: 'right', fontSize: 13, marginBottom: 16 }}>
        Total: <span style={{ fontWeight: 600, fontSize: 15 }}>{fmt(total)}</span>
      </div>

      {error && <div style={{ color: '#c0392b', fontSize: 13, marginBottom: 12 }}>{error}</div>}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button onClick={onCancel} style={{ padding: '8px 16px', border: '1px solid var(--t-border)', borderRadius: 7, fontSize: 13, cursor: 'pointer', background: 'transparent', color: 'var(--t-text-primary)' }}>
          Cancelar
        </button>
        <button onClick={guardar} disabled={saving}
          style={{ padding: '8px 18px', border: 'none', borderRadius: 7, fontSize: 13, cursor: 'pointer', background: 'var(--t-accent)', color: '#fff', fontWeight: 500 }}>
          {saving ? 'Guardando…' : 'Guardar cambios'}
        </button>
      </div>
    </div>
  );
}

// ─── TAB NUEVO PRÉSTAMO ─────────────────────────────────────────────────────────

function TabNuevo({ clinicas, productos, onSaved, onRefreshClinicas }) {
  const [tipo,        setTipo]        = useState('ingreso');
  const [clinicaId,   setClinicaId]   = useState('');
  const [bodega,      setBodega]      = useState('');
  const [fecha,       setFecha]       = useState(new Date().toISOString().split('T')[0]);
  const [docContable, setDocContable] = useState('');
  const [observaciones, setObs]       = useState('');
  const [items,       setItems]       = useState([]);
  const [soporteFile, setSoporteFile] = useState(null);
  const [busqProd,    setBusqProd]    = useState('');
  const [excelData,   setExcelData]   = useState(null);
  const [saving,      setSaving]      = useState(false);
  const [error,       setError]       = useState('');
  const [importando,  setImportando]  = useState(false);
  const [importResult,setImportResult]= useState(null);

  // Nueva clínica rápida
  const [nuevaClinica, setNuevaClinica] = useState('');
  const [guardandoCl,  setGuardandoCl]  = useState(false);

  async function crearClinica() {
    if (!nuevaClinica.trim()) return;
    setGuardandoCl(true);
    try {
      await apiFetch('/prestamos/clinicas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre: nuevaClinica.trim() }),
      });
      setNuevaClinica('');
      onRefreshClinicas();
    } catch (e) { alert('Error creando clínica: ' + e.message); }
    setGuardandoCl(false);
  }

  // Convierte una celda de fecha de Excel a 'YYYY-MM-DD'. Las fechas pueden venir
  // como texto ('2020-12-09') o como número serial de Excel (días desde 1899-12-30,
  // ej. 46142) cuando la celda tiene formato de fecha nativo — sin esta conversión
  // el serial se guardaba tal cual y Postgres rechazaba el insert.
  function parseFechaExcel(val) {
    if (val === null || val === undefined || val === '') return '';
    if (typeof val === 'number') {
      const ms = Math.round((val - 25569) * 86400 * 1000);
      const d = new Date(ms);
      if (isNaN(d.getTime())) return '';
      return d.toISOString().substring(0, 10);
    }
    const s = String(val).trim();
    // Algunas celdas numéricas llegan como texto ("46142")
    if (/^\d{4,6}$/.test(s)) return parseFechaExcel(Number(s));
    return s.substring(0, 10);
  }

  function cargarExcel(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const wb   = XLSX.read(ev.target.result, { type: 'array' });
      const ws   = wb.Sheets[wb.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      setExcelData(data);
    };
    reader.readAsArrayBuffer(file);
  }

  function procesarExcelMasivo(data) {
    const documentos = {};
    const codigosNuevos = new Set();
    for (const r of data.slice(1)) {
      const prefijo = String(r[0] || '').trim().toUpperCase();
      const numero  = String(r[2] || '').trim();
      if (!prefijo || !numero) continue;
      const docKey = `${prefijo}${numero}`;
      const tipoMap = { IPE: 'ingreso', EPO: 'egreso', IDP: 'devolucion_ingreso', ED: 'devolucion_egreso' };
      const tipo = tipoMap[prefijo];
      if (!tipo) continue;
      if (!documentos[docKey]) {
        const fechaVal = parseFechaExcel(r[1]);
        const bodegaExcel = String(r[12] || '').trim().toUpperCase();
        const bodegaMatch = BODEGAS.find(b => bodegaExcel.includes(b.nombre.toUpperCase()) || bodegaExcel.includes(b.codigo));
        documentos[docKey] = {
          documento_contable: docKey, tipo, fecha: fechaVal,
          observaciones: String(r[3] || '').trim(),
          clinica_nombre: String(r[4] || '').trim(),
          bodega_codigo: bodegaMatch?.codigo || '',
          bodega_nombre: bodegaMatch?.nombre || String(r[12] || '').trim(),
          items: [],
        };
      }
      const codigoRaw = String(r[5] || '').trim();
      if (!codigoRaw) continue;
      const codigo    = codigoRaw.padStart(10, '0');
      const cantidad  = Number(r[6]) || 0;
      const totalCosto = Math.abs(Number(String(r[7]).replace(/[^0-9.-]/g, '')) || 0);
      const precioUnit = cantidad > 0 ? totalCosto / cantidad : 0;
      const nombre    = String(r[11] || '').trim();
      const lote      = String(r[19] || '').trim();
      const fechaVenc = parseFechaExcel(r[20]);
      const prodMaestro = productos.find(p => p.codigo === codigo);
      if (!prodMaestro) codigosNuevos.add(codigo);
      // Actualizar precio en maestro si difiere (igual que en buscarEnExcel)
      if (prodMaestro && precioUnit > 0 &&
          Math.abs(prodMaestro.precio_unitario - precioUnit) > 1) {
        apiFetch(`/prestamos/productos/${prodMaestro.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ precio_unitario: precioUnit }),
        }).catch(() => {});
      }
      // Un mismo código puede repetirse en varias filas cuando llega en distintos
      // lotes — sumamos la cantidad en vez de descartar las filas siguientes,
      // que antes se perdían silenciosamente.
      const itemExistente = documentos[docKey].items.find(i => i.codigo === codigo);
      if (itemExistente) {
        itemExistente.cantidad += cantidad;
      } else {
        documentos[docKey].items.push({
          codigo, nombre: nombre || prodMaestro?.nombre || '',
          cantidad, precio_unitario: precioUnit || prodMaestro?.precio_unitario || 0,
          categoria: prodMaestro?.categoria || '', cuenta_contable: prodMaestro?.cuenta_contable || '',
          lote, fecha_vencimiento: fechaVenc,
        });
      }
    }
    return { documentos: Object.values(documentos), codigosNuevos: [...codigosNuevos] };
  }

  async function importarMasivo() {
    if (!excelData) return;
    setImportando(true); setError('');
    try {
      const { documentos, codigosNuevos } = procesarExcelMasivo(excelData);
      if (documentos.length === 0) { setError('No se encontraron documentos válidos'); setImportando(false); return; }
      console.log('Documentos a importar:', documentos.length);
      if (documentos[0]) console.log('Primer doc:', JSON.stringify(documentos[0]).substring(0, 300));
      const result = await apiFetch('/prestamos/importar-masivo', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentos }),
      });
      setImportResult({ creados: result.creados, omitidos: result.omitidos, omitidos_docs: result.omitidos_docs || [], errores: result.errores || 0, errores_docs: result.errores_docs || [], codigosNuevos });
      onSaved();
    } catch (e) { setError('Error importando: ' + e.message); }
    setImportando(false);
  }

  async function buscarEnExcel() {
    if (!excelData || !docContable) return;
    const docBuscar = docContable.trim().toUpperCase();

    // Columnas (0-indexed): A=0 Prefijo, B=1 Fecha, C=2 Número, D=3 Descripción,
    // E=4 Tercero, F=5 Código, G=6 Cantidad, H=7 Total costo,
    // L=11 Producto, M=12 Bodega, T=19 Lote, U=20 Fecha venc,
    // AA=26 NIT préstamo, AD=29 NIT devolución
    const filas = excelData.slice(1).filter(r => {
      const prefijo = String(r[0] || '').trim().toUpperCase();
      const numero  = String(r[2] || '').trim();
      return `${prefijo}${numero}` === docBuscar;
    });

    console.log('Filas encontradas:', filas.length, 'Doc buscado:', docBuscar);
    if (filas.length > 0) console.log('Primera fila:', filas[0]);
    if (filas.length === 0) { setError('Documento no encontrado (ej: EPO958, IPE958, ED550, IDP467)'); return; }
    setError('');

    const prefijo = String(filas[0][0] || '').trim().toUpperCase();
    if (prefijo === 'IPE') setTipo('ingreso');
    if (prefijo === 'EPO') setTipo('egreso');

    // Auto-llenar fecha y observaciones
    const primeraFila = filas[0];
    const fechaRaw = String(primeraFila[1] || '').substring(0, 10);
    if (fechaRaw) setFecha(fechaRaw);
    setObs(String(primeraFila[3] || '').trim());

    // Auto-llenar clínica
    const terceroNombre = String(primeraFila[4] || '').trim();
    const terceroNit    = String(primeraFila[26] || primeraFila[29] || '').trim();
    const clinicaExist  = clinicas.find(c => c.nombre.toUpperCase() === terceroNombre.toUpperCase());
    if (clinicaExist) {
      setClinicaId(String(clinicaExist.id));
    } else if (terceroNombre) {
      try {
        const nueva = await apiFetch('/prestamos/clinicas', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nombre: terceroNombre }),
        });
        onRefreshClinicas();
        setClinicaId(String(nueva.id));
      } catch(e) { /* silenciar */ }
    }

    // Auto-llenar bodega
    const bodegaExcel = String(primeraFila[12] || '').trim().toUpperCase();
    const bodegaMatch = BODEGAS.find(b =>
      bodegaExcel.includes(b.nombre.toUpperCase()) || bodegaExcel.includes(b.codigo)
    );
    if (bodegaMatch) setBodega(bodegaMatch.codigo);

    // Procesar productos
    const codigosNuevos = [];
    const nuevosItemsPorCodigo = {};

    console.log('Procesando', filas.length, 'filas para productos');
    for (const r of filas) {
      const codigoRaw = String(r[5] || '').trim();
      if (!codigoRaw) continue;
      const codigo = codigoRaw.padStart(10, '0');

      const cantidad   = Number(r[6]) || 0;
      const totalCosto = Math.abs(Number(String(r[7]).replace(/[^0-9.-]/g, '')) || 0);
      const precioUnit = cantidad > 0 ? totalCosto / cantidad : 0;
      const nombre     = String(r[11] || '').trim();
      const lote       = String(r[19] || '').trim();
      const fechaVenc  = r[20] ? String(r[20]).substring(0, 10) : '';

      const prodMaestro = productos.find(p => p.codigo === codigo);
      if (!prodMaestro && !nuevosItemsPorCodigo[codigo]) codigosNuevos.push(codigo);

      // Actualizar precio en maestro si difiere
      if (prodMaestro && precioUnit > 0 &&
          Math.abs(prodMaestro.precio_unitario - precioUnit) > 1) {
        apiFetch(`/prestamos/productos/${prodMaestro.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ precio_unitario: precioUnit }),
        }).catch(() => {});
      }

      // Un mismo código puede repetirse en varias filas (distintos lotes) —
      // sumamos la cantidad en vez de descartar las filas repetidas.
      if (nuevosItemsPorCodigo[codigo]) {
        nuevosItemsPorCodigo[codigo].cantidad += cantidad;
      } else {
        nuevosItemsPorCodigo[codigo] = {
          codigo,
          nombre:            nombre || prodMaestro?.nombre || '',
          cantidad,
          precio_unitario:   precioUnit || prodMaestro?.precio_unitario || 0,
          categoria:         prodMaestro?.categoria || '',
          cuenta_contable:   prodMaestro?.cuenta_contable || '',
          lote,
          fecha_vencimiento: fechaVenc,
        };
      }
    }
    const nuevosItems = Object.values(nuevosItemsPorCodigo);

    if (codigosNuevos.length > 0) {
      setError(`⚠️ Códigos no registrados en maestro (asignar categoría/cuenta): ${codigosNuevos.join(', ')}`);
    }

    setItems(prev => {
      const existentes = new Set(prev.map(i => i.codigo));
      return [...prev, ...nuevosItems.filter(i => !existentes.has(i.codigo))];
    });
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
      categoria:       grupo?.categoria || prod.categoria || '',
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
    if (!clinicaId)    return setError('Selecciona una clínica');
    if (!bodega)       return setError('Selecciona una bodega');
    if (!fecha)        return setError('Ingresa la fecha');
    if (!docContable)  return setError('Ingresa el documento contable');
    if (items.length === 0) return setError('Agrega al menos un producto');

    setSaving(true);
    try {
      const clinica = clinicas.find(c => c.id === clinicaId || String(c.id) === String(clinicaId));
      const bod     = BODEGAS.find(b => b.codigo === bodega);

      const fd = new FormData();
      fd.append('tipo',               tipo);
      fd.append('clinica_id',         clinicaId);
      fd.append('clinica_nombre',     clinica?.nombre || '');
      fd.append('bodega_codigo',      bodega);
      fd.append('bodega_nombre',      bod?.nombre || '');
      fd.append('fecha',              fecha);
      fd.append('documento_contable', docContable);
      fd.append('observaciones',      observaciones);
      fd.append('items',              JSON.stringify(items));
      if (soporteFile) fd.append('soporte', soporteFile);

      await apiUpload('/prestamos', fd);
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

      {/* Autocomplete por Excel */}
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
        {excelData && (
          <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, color: 'var(--t-text-muted)' }}>✓ Excel cargado — {excelData.length - 1} filas</span>
            <button onClick={importarMasivo} disabled={importando} style={{
              padding: '5px 14px', fontSize: 12, cursor: 'pointer', borderRadius: 6,
              background: 'var(--t-accent)', color: '#fff', border: 'none', fontWeight: 600,
            }}>
              {importando ? 'Importando…' : '⚡ Importar todo'}
            </button>
          </div>
        )}
        {importResult && (
          <div style={{ marginTop: 8, fontSize: 12, padding: '8px 12px', borderRadius: 6, background: 'var(--t-bg-card)', border: '1px solid var(--t-border)' }}>
            ✅ <b>{importResult.creados}</b> documentos creados
            {importResult.omitidos > 0 && <span style={{ color: 'var(--t-text-muted)' }}> · {importResult.omitidos} ya existían ({importResult.omitidos_docs.join(', ')})</span>}
            {importResult.codigosNuevos?.length > 0 && <div style={{ color: '#f59e0b', marginTop: 4 }}>⚠️ Códigos sin categoría: {importResult.codigosNuevos.join(', ')}</div>}
            {importResult.errores > 0 && (
              <div style={{ color: '#ef4444', marginTop: 4 }}>
                ⚠️ {importResult.errores} documento(s) con datos inválidos, omitidos:
                <ul style={{ margin: '4px 0 0 18px', padding: 0 }}>
                  {importResult.errores_docs.map(err => (
                    <li key={err.documento_contable}>{err.documento_contable}: {err.motivo}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Datos generales */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
        <div>
          <label style={labelS}>Clínica</label>
          <select value={clinicaId} onChange={e => setClinicaId(e.target.value)} style={inputS}>
            <option value=''>— seleccionar —</option>
            {clinicas.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
          {/* Crear clínica rápida */}
          <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
            <input value={nuevaClinica} onChange={e => setNuevaClinica(e.target.value)}
              placeholder='Nueva clínica…'
              style={{ flex: 1, padding: '5px 8px', border: '1px solid var(--t-border)', borderRadius: 6, fontSize: 12, background: 'var(--t-bg-inner)', color: 'var(--t-text-primary)' }} />
            <button onClick={crearClinica} disabled={guardandoCl || !nuevaClinica.trim()}
              style={{ padding: '5px 9px', border: '1px solid var(--t-border)', borderRadius: 6, fontSize: 12, cursor: 'pointer', background: 'var(--t-bg-inner)', color: 'var(--t-text-primary)' }}>
              {guardandoCl ? '…' : '+ Agregar'}
            </button>
          </div>
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


// ─── TAB CRUCES ──────────────────────────────────────────────────────────────

// Badge de color/label reutilizable para el estado real (abierto/parcial/cerrado)
// de un documento — reemplaza al viejo tipo_cruce manual, que no reflejaba el
// estado real de cada documento en un multicruce.
function badgeEstado(estado) {
  const mapa = {
    cerrado: { bg: '#22c55e22', color: '#22c55e', label: 'cerrado' },
    parcial: { bg: '#f59e0b22', color: '#f59e0b', label: 'parcial' },
    abierto: { bg: '#94a3b822', color: '#64748b', label: 'abierto' },
  };
  return mapa[estado] || { bg: '#94a3b822', color: '#64748b', label: estado || '—' };
}

function TabCruces({ prestamos, cruces, productos, clinicas, onRefresh }) {
  const [selPrestamos,  setSelPrestamos]  = React.useState([]);
  const [selDevoluciones,setSelDevoluciones]= React.useState([]);
  const [obs,          setObs]          = React.useState('');
  const [saving,       setSaving]       = React.useState(false);
  const [error,        setError]        = React.useState('');
  const [soporteFile,  setSoporteFile]  = React.useState(null);

  // Asignación item por item: una fila por cada (devolución, código,
  // repetición) — cada fila indica cuánto de ese producto se paga a cuál
  // préstamo. Con un solo préstamo seleccionado no hace falta elegir destino
  // (es implícito); con varios (multicruce) aparece el desplegable para
  // decidir a cuál EPO/IPE va cada cantidad, y se puede repartir un mismo
  // producto en varias filas hacia distintos préstamos.
  const [filasAsignacion, setFilasAsignacion] = React.useState([]);

  // Se reconstruyen las filas por defecto cada vez que cambia el conjunto de
  // devoluciones elegidas (una fila por cada producto de cada devolución). No
  // se reconstruye solo por cambiar los préstamos elegidos, para no perder lo
  // que el usuario ya haya llenado si simplemente suma/quita un préstamo al
  // multicruce a mitad de camino.
  const idsDevolSeleccionadas = selDevoluciones.map(d => d.id).join(',');
  React.useEffect(() => {
    const nuevas = [];
    selDevoluciones.forEach(d => {
      (d.items || []).forEach(item => {
        nuevas.push({
          id: `${d.id}_${item.codigo}`,
          devolucion_id: d.id,
          devolucion_doc: d.documento_contable,
          codigo: item.codigo,
          nombre: item.nombre,
          precio_unitario: item.precio_unitario,
          cantidad_item: Number(item.cantidad),
          prestamo_id: selPrestamos.length === 1 ? selPrestamos[0].id : '',
          cantidad: selPrestamos.length === 1 ? Number(item.cantidad) : 0,
        });
      });
    });
    setFilasAsignacion(nuevas);
    // eslint-disable-next-line
  }, [idsDevolSeleccionadas]);

  function actualizarFila(id, campo, valor) {
    setFilasAsignacion(prev => prev.map(f => f.id === id ? { ...f, [campo]: valor } : f));
  }
  function agregarFilaExtra(filaBase) {
    setFilasAsignacion(prev => [...prev, { ...filaBase, id: `${filaBase.id}_${Date.now()}`, prestamo_id: '', cantidad: 0 }]);
  }
  function quitarFila(id) {
    setFilasAsignacion(prev => prev.filter(f => f.id !== id));
  }

  const [filtroPrest,  setFiltroPrest]  = React.useState('');
  const [filtroDevol,  setFiltroDevol]  = React.useState('');
  const [anioPrest,    setAnioPrest]    = React.useState('');
  const [fDesdePrest,  setFDesdePrest]  = React.useState('');
  const [fHastaPrest,  setFHastaPrest]  = React.useState('');
  const [estadoPrest,  setEstadoPrest]  = React.useState(''); // '' | abierto | parcial | cerrado
  const [anioDevol,    setAnioDevol]    = React.useState('');
  const [fDesdeDevol,  setFDesdeDevol]  = React.useState('');
  const [fHastaDevol,  setFHastaDevol]  = React.useState('');
  const [estadoDevol,  setEstadoDevol]  = React.useState(''); // '' | abierto | parcial | cerrado
  const [detalleCruce, setDetalleCruce] = React.useState(null);
  const [detalleCard,  setDetalleCard]  = React.useState(null);

  // Separar por tipo
  const prestamosBase  = prestamos.filter(p => ['ingreso','egreso'].includes(p.tipo));
  const devoluciones   = prestamos.filter(p => ['devolucion_ingreso','devolucion_egreso'].includes(p.tipo));

  // Años disponibles (para el selector rápido de año)
  const aniosDisponibles = React.useMemo(() => {
    const set = new Set();
    [...prestamosBase, ...devoluciones].forEach(p => {
      if (p.fecha) set.add(String(p.fecha).substring(0, 4));
    });
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [prestamosBase, devoluciones]);

  // Cruces ya realizados por prestamo_id
  const crucesPorPrestamo = React.useMemo(() => {
    const m = {};
    cruces.forEach(c => {
      if (!m[c.prestamo_id]) m[c.prestamo_id] = [];
      m[c.prestamo_id].push(c);
    });
    return m;
  }, [cruces]);

  function matchDoc(p, q) {
    if (!q) return true;
    const doc = (p.documento_contable || '').toLowerCase();
    const cli = (p.clinica_nombre || '').toLowerCase();
    const obs = (p.observaciones || '').toLowerCase();
    // Buscar en items: nombre y código de producto
    const itemsText = (p.items || []).map(i => 
      `${i.codigo || ''} ${i.nombre || ''}`.toLowerCase()
    ).join(' ');
    // Normalizar quitando guiones para buscar "IPE620" en "IPE-620"
    const obsNorm = obs.replace(/-/g, '');
    return doc.includes(q) || cli.includes(q) || obs.includes(q) ||
      obsNorm.includes(q.replace(/-/g, '')) ||
      itemsText.includes(q) ||
      doc.replace(/[^0-9]/g, '').includes(q) ||
      doc.replace(/[0-9]/g, '').includes(q) ||
      obs.replace(/[^0-9]/g, '').includes(q);  // número solo en observaciones
  }

  function matchFecha(p, anio, desde, hasta) {
    if (!anio && !desde && !hasta) return true;
    const f = p.fecha ? String(p.fecha).substring(0, 10) : '';
    if (!f) return false;
    if (anio && f.substring(0, 4) !== anio) return false;
    if (desde && f < desde) return false;
    if (hasta && f > hasta) return false;
    return true;
  }

  const prestFiltrados = prestamosBase.filter(p =>
    matchDoc(p, filtroPrest.toLowerCase()) && matchFecha(p, anioPrest, fDesdePrest, fHastaPrest) &&
    (!estadoPrest || p.estado === estadoPrest));

  function toggleSelPrestamo(p) {
    setSelPrestamos(prev => prev.some(x => x.id === p.id) ? prev.filter(x => x.id !== p.id) : [...prev, p]);
  }
  function toggleSelDevolucion(d) {
    setSelDevoluciones(prev => prev.some(x => x.id === d.id) ? prev.filter(x => x.id !== d.id) : [...prev, d]);
  }

  const devolFiltradas = devoluciones.filter(p => {
    if (selPrestamos.length > 0) {
      const tiposRequeridos = new Set(selPrestamos.map(sp =>
        sp.tipo === 'egreso' ? 'devolucion_ingreso' : 'devolucion_egreso'));
      if (!tiposRequeridos.has(p.tipo)) return false;
    }
    return matchDoc(p, filtroDevol.toLowerCase()) && matchFecha(p, anioDevol, fDesdeDevol, fHastaDevol) &&
      (!estadoDevol || p.estado === estadoDevol);
  });

  function totalItems(p) {
    return (p.items || []).reduce((s, i) => s + Number(i.cantidad), 0);
  }

  function estadoColor(e) {
    return e === 'cerrado' ? '#22c55e' : e === 'parcial' ? '#f59e0b' : 'var(--t-text-muted)';
  }

  async function cruzar() {
    if (selPrestamos.length === 0 || selDevoluciones.length === 0) {
      setError('Selecciona al menos un préstamo y una devolución'); return;
    }

    // Agrupar filas válidas (con préstamo destino y cantidad > 0) en pares
    // préstamo↔devolución, cada uno con exactamente los productos/cantidades
    // que el usuario asignó ahí — así un mismo producto puede terminar
    // repartido en varios pares distintos (multicruce item por item).
    const gruposMap = {};
    for (const f of filasAsignacion) {
      const cant = Number(f.cantidad) || 0;
      if (!f.prestamo_id || cant <= 0) continue;
      const key = `${f.prestamo_id}_${f.devolucion_id}`;
      if (!gruposMap[key]) gruposMap[key] = { prestamo_id: f.prestamo_id, devolucion_id: f.devolucion_id, items: [] };
      gruposMap[key].items.push({ codigo: f.codigo, nombre: f.nombre, cantidad: cant, precio_unitario: f.precio_unitario });
    }
    const pares = Object.values(gruposMap);
    if (pares.length === 0) {
      setError('Asigna una cantidad mayor a cero a algún préstamo'); return;
    }

    // Sobrante: por cada devolución, cuánto de cada producto quedó sin
    // asignar a ningún préstamo — no bloquea el registro, solo se marca.
    const sobranteDetalle = [];
    selDevoluciones.forEach(d => {
      (d.items || []).forEach(item => {
        const asignado = filasAsignacion
          .filter(f => f.devolucion_id === d.id && f.codigo === item.codigo)
          .reduce((s, f) => s + (Number(f.cantidad) || 0), 0);
        const sobra = Number(item.cantidad) - asignado;
        if (sobra > 0) {
          sobranteDetalle.push({ devolucion_id: d.id, devolucion_doc: d.documento_contable, codigo: item.codigo, nombre: item.nombre, cantidad_sobrante: sobra });
        }
      });
    });

    setSaving(true); setError('');
    try {
      const result = await apiFetch('/prestamos/cruces', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pares, observaciones: obs,
          tiene_sobrante: sobranteDetalle.length > 0,
          sobrante_detalle: sobranteDetalle.length > 0 ? sobranteDetalle : null,
        }),
      });

      // El soporte manual solo aplica cuando es un cruce simple 1 a 1
      // (para multicruce, el PDF generado ya anexa los soportes de cada documento)
      const cruceId = result?.cruces?.[0]?.id;
      if (cruceId && pares.length === 1 && soporteFile) {
        const fd = new FormData();
        fd.append('soporte', soporteFile);
        await apiUpload(`/prestamos/cruces/${cruceId}/soporte`, fd);
      }

      onRefresh();
      setSelPrestamos([]); setSelDevoluciones([]);
      setObs(''); setSoporteFile(null); setFilasAsignacion([]);
    } catch (e) { setError('Error: ' + e.message); }
    setSaving(false);
  }

  const cardS  = { background: 'var(--t-bg-card)', border: '1px solid var(--t-border)', borderRadius: 8, padding: 12, cursor: 'pointer', marginBottom: 8 };
  const selS   = { ...cardS, border: '2px solid var(--t-accent)', background: 'var(--t-bg-inner)' };
  const inputS = { width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid var(--t-border)', background: 'var(--t-bg-inner)', color: 'var(--t-text-primary)', fontSize: 13, boxSizing: 'border-box' };

  return (
    <div>
      {/* Los listados de préstamos y devoluciones quedan siempre visibles;
          ya no se contraen a un resumen al preseleccionar ambos lados. */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 }}>
        {/* Izquierda — préstamos */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--t-text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>
            Préstamos (EPO / IPE)
          </div>
          <input value={filtroPrest} onChange={e => setFiltroPrest(e.target.value)}
            placeholder="Buscar documento, clínica, producto o código…" style={{ ...inputS, marginBottom: 8 }} />
          <div style={{ display: 'flex', gap: 6, marginBottom: 10, alignItems: 'center' }}>
            <select value={anioPrest} onChange={e => setAnioPrest(e.target.value)}
              style={{ ...inputS, flex: '0 0 84px', padding: '6px 6px', fontSize: 12 }}>
              <option value="">Año</option>
              {aniosDisponibles.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
            <select value={estadoPrest} onChange={e => setEstadoPrest(e.target.value)}
              title="Filtrar por estado" style={{ ...inputS, flex: '0 0 100px', padding: '6px 6px', fontSize: 12 }}>
              <option value="">Estado: todos</option>
              <option value="abierto">Abierto</option>
              <option value="parcial">Parcial</option>
              <option value="cerrado">Cerrado</option>
            </select>
            <input type="date" value={fDesdePrest} onChange={e => setFDesdePrest(e.target.value)}
              title="Desde" style={{ ...inputS, padding: '6px 6px', fontSize: 12 }} />
            <input type="date" value={fHastaPrest} onChange={e => setFHastaPrest(e.target.value)}
              title="Hasta" style={{ ...inputS, padding: '6px 6px', fontSize: 12 }} />
            {(anioPrest || fDesdePrest || fHastaPrest || estadoPrest) && (
              <span onClick={() => { setAnioPrest(''); setFDesdePrest(''); setFHastaPrest(''); setEstadoPrest(''); }}
                title="Limpiar filtros"
                style={{ cursor: 'pointer', fontSize: 13, color: 'var(--t-text-muted)', padding: '0 4px', flex: '0 0 auto' }}>✕</span>
            )}
          </div>
          <div style={{ maxHeight: 400, overflowY: 'auto' }}>
            {prestFiltrados.length === 0 && <div style={{ fontSize: 12, color: 'var(--t-text-muted)', textAlign: 'center', padding: 20 }}>Sin préstamos</div>}
            {prestFiltrados.map(p => (
              <div key={p.id} onClick={() => toggleSelPrestamo(p)}
                style={selPrestamos.some(x => x.id === p.id) ? selS : cardS}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <input type="checkbox" checked={selPrestamos.some(x => x.id === p.id)} readOnly
                      style={{ marginRight: 6 }} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--t-text-primary)' }}>{p.documento_contable}</span>
                    <span style={{ marginLeft: 8, fontSize: 11, padding: '2px 7px', borderRadius: 10, background: p.tipo === 'egreso' ? '#ef4444' : '#3b82f6', color: '#fff' }}>
                      {p.tipo === 'egreso' ? 'EPO' : 'IPE'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 11, color: estadoColor(p.estado), fontWeight: 600 }}>{p.estado}</span>
                    <span onClick={e => { e.stopPropagation(); setDetalleCard(p); }}
                      title="Ver detalle" style={{ cursor: 'pointer', fontSize: 14, opacity: 0.6, lineHeight: 1 }}>🔍</span>
                  </div>
                </div>
                <div style={{ fontSize: 11, color: 'var(--t-text-muted)', marginTop: 4 }}>
                  {p.clinica_nombre} · {fmtFecha(p.fecha)} · {totalItems(p)} uds
                </div>
                {p.observaciones && (
                  <div style={{ fontSize: 10, color: 'var(--t-text-muted)', marginTop: 2, opacity: 0.7, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical' }}>
                    {p.observaciones}
                  </div>
                )}
                {crucesPorPrestamo[p.id]?.length > 0 && (
                  <div style={{ marginTop: 4 }}>
                    <div
                      onClick={e => { e.stopPropagation(); setDetalleCruce(detalleCruce === p.id ? null : p.id); }}
                      style={{ fontSize: 10, color: 'var(--t-accent)', cursor: 'pointer', userSelect: 'none' }}>
                      {detalleCruce === p.id ? '▾' : '▸'} {crucesPorPrestamo[p.id].length} cruce(s) registrado(s)
                    </div>
                    {detalleCruce === p.id && (
                      <div style={{ marginTop: 4, paddingLeft: 8, borderLeft: '2px solid var(--t-accent)' }}>
                        {crucesPorPrestamo[p.id].map(c => (
                          <div key={c.id} style={{ fontSize: 10, color: 'var(--t-text-muted)', marginBottom: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span>
                              <span style={{ color: 'var(--t-text-primary)', fontWeight: 600 }}>{c.devolucion_doc}</span>
                              {' · '}<span style={{ color: badgeEstado(c.estado_prestamo).color, fontWeight: 600 }}>{badgeEstado(c.estado_prestamo).label}</span>
                              {c.observaciones && <span style={{ opacity: 0.7 }}> · {c.observaciones.substring(0, 40)}</span>}
                            </span>
                            <span style={{ color: c.soporte_url ? 'var(--t-accent)' : 'var(--t-text-muted)', marginLeft: 6 }}>
                              {c.soporte_url
                                ? <a href={`${API_BASE}/prestamos/soporte/${c.soporte_url}`} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ color: 'var(--t-accent)' }}>📄</a>
                                : '—'}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Derecha — devoluciones */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--t-text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>
            Devoluciones (IDP / ED) {selPrestamos.length > 0 && <span style={{ color: 'var(--t-accent)' }}>— compatibles con {selPrestamos.map(p => p.documento_contable).join(', ')}</span>}
          </div>
          <input value={filtroDevol} onChange={e => setFiltroDevol(e.target.value)}
            placeholder="Buscar documento, clínica, producto o código…" style={{ ...inputS, marginBottom: 8 }} />
          <div style={{ display: 'flex', gap: 6, marginBottom: 10, alignItems: 'center' }}>
            <select value={anioDevol} onChange={e => setAnioDevol(e.target.value)}
              style={{ ...inputS, flex: '0 0 84px', padding: '6px 6px', fontSize: 12 }}>
              <option value="">Año</option>
              {aniosDisponibles.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
            <select value={estadoDevol} onChange={e => setEstadoDevol(e.target.value)}
              title="Filtrar por estado" style={{ ...inputS, flex: '0 0 100px', padding: '6px 6px', fontSize: 12 }}>
              <option value="">Estado: todos</option>
              <option value="abierto">Abierto</option>
              <option value="parcial">Parcial</option>
              <option value="cerrado">Cerrado</option>
            </select>
            <input type="date" value={fDesdeDevol} onChange={e => setFDesdeDevol(e.target.value)}
              title="Desde" style={{ ...inputS, padding: '6px 6px', fontSize: 12 }} />
            <input type="date" value={fHastaDevol} onChange={e => setFHastaDevol(e.target.value)}
              title="Hasta" style={{ ...inputS, padding: '6px 6px', fontSize: 12 }} />
            {(anioDevol || fDesdeDevol || fHastaDevol || estadoDevol) && (
              <span onClick={() => { setAnioDevol(''); setFDesdeDevol(''); setFHastaDevol(''); setEstadoDevol(''); }}
                title="Limpiar filtros"
                style={{ cursor: 'pointer', fontSize: 13, color: 'var(--t-text-muted)', padding: '0 4px', flex: '0 0 auto' }}>✕</span>
            )}
          </div>
          <div style={{ maxHeight: 400, overflowY: 'auto' }}>
            {devolFiltradas.length === 0 && <div style={{ fontSize: 12, color: 'var(--t-text-muted)', textAlign: 'center', padding: 20 }}>
              {selPrestamos.length > 0 ? 'Sin devoluciones compatibles' : 'Selecciona un préstamo para filtrar'}
            </div>}
            {devolFiltradas.map(d => (
              <div key={d.id} onClick={() => toggleSelDevolucion(d)}
                style={selDevoluciones.some(x => x.id === d.id) ? selS : cardS}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <input type="checkbox" checked={selDevoluciones.some(x => x.id === d.id)} readOnly
                      style={{ marginRight: 6 }} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--t-text-primary)' }}>{d.documento_contable}</span>
                    <span style={{ marginLeft: 8, fontSize: 11, padding: '2px 7px', borderRadius: 10, background: d.tipo === 'devolucion_ingreso' ? '#3b82f6' : '#ef4444', color: '#fff' }}>
                      {d.tipo === 'devolucion_ingreso' ? 'IDP' : 'ED'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 11, color: estadoColor(d.estado), fontWeight: 600 }}>{d.estado}</span>
                    <span onClick={e => { e.stopPropagation(); setDetalleCard(d); }}
                      title="Ver detalle" style={{ cursor: 'pointer', fontSize: 14, opacity: 0.6, lineHeight: 1 }}>🔍</span>
                  </div>
                </div>
                <div style={{ fontSize: 11, color: 'var(--t-text-muted)', marginTop: 4 }}>
                  {d.clinica_nombre} · {fmtFecha(d.fecha)} · {totalItems(d)} uds
                </div>
                {d.observaciones && (
                  <div style={{ fontSize: 10, color: 'var(--t-text-muted)', marginTop: 2, opacity: 0.7, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical' }}>
                    {d.observaciones}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Resumen de la selección actual + panel de acción. Queda fijo (sticky)
          al fondo de la pantalla para que "Registrar cruce" esté siempre
          visible sin necesidad de hacer scroll, incluso con los listados de
          préstamos/devoluciones abiertos arriba. */}
      {selPrestamos.length > 0 && selDevoluciones.length > 0 && (
        <div style={{
          position: 'sticky', bottom: 0, zIndex: 30,
          background: 'var(--t-bg-card)', border: '1px solid var(--t-accent)', borderRadius: 10, padding: 16, marginBottom: 24,
          boxShadow: '0 -6px 20px rgba(0,0,0,.45)',
        }}>
          <div style={{ fontSize: 11, color: 'var(--t-text-muted)', marginBottom: 8 }}>
            <span>Préstamo(s): </span>
            <b style={{ color: 'var(--t-text-primary)' }}>{selPrestamos.map(p => p.documento_contable).join(', ')}</b>
            <span style={{ margin: '0 8px' }}>↔</span>
            <span>Devolución(es): </span>
            <b style={{ color: 'var(--t-text-primary)' }}>{selDevoluciones.map(d => d.documento_contable).join(', ')}</b>
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12, color: 'var(--t-text-primary)' }}>
            {selPrestamos.length === 1 && selDevoluciones.length === 1 ? (
              <>Cruzar <b>{selPrestamos[0].documento_contable}</b> con <b>{selDevoluciones[0].documento_contable}</b></>
            ) : (
              <>Multicruce: <b>{selPrestamos.map(p => p.documento_contable).join(', ')}</b> ↔ <b>{selDevoluciones.map(d => d.documento_contable).join(', ')}</b>
                <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--t-text-muted)', fontWeight: 400 }}>
                  ({selPrestamos.length * selDevoluciones.length} par{selPrestamos.length * selDevoluciones.length > 1 ? 'es' : ''} de cruce)
                </span>
              </>
            )}
          </div>

          {/* Asignación item por item: por cada devolución seleccionada se listan
              sus productos; cada uno tiene una cantidad a pagar y, si hay más de
              un préstamo elegido (multicruce), un desplegable para decidir a
              cuál EPO/IPE va esa cantidad — con la opción de repartir el mismo
              producto en varias líneas hacia distintos préstamos. Con un solo
              préstamo elegido no hace falta el desplegable (es implícito), y
              basta con ajustar la cantidad si el pago es parcial. */}
          <div style={{ marginBottom: 12, maxHeight: 320, overflowY: 'auto' }}>
            {selDevoluciones.map(d => (
              <div key={d.id} style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--t-accent)', marginBottom: 6 }}>
                  {d.documento_contable} devuelve:
                </div>
                {(d.items || []).map(item => {
                  const filasItem = filasAsignacion.filter(f => f.devolucion_id === d.id && f.codigo === item.codigo);
                  const asignado = filasItem.reduce((s, f) => s + (Number(f.cantidad) || 0), 0);
                  const sobra = Number(item.cantidad) - asignado;
                  return (
                    <div key={item.codigo} style={{ marginBottom: 8, padding: '8px 10px', background: 'var(--t-bg-inner)', borderRadius: 6 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, marginBottom: 6 }}>
                        <span style={{ fontFamily: 'monospace', color: 'var(--t-text-muted)', minWidth: 90 }}>{item.codigo}</span>
                        <span style={{ flex: 1, color: 'var(--t-text-primary)' }}>{item.nombre}</span>
                        <span style={{ fontSize: 11, color: 'var(--t-text-muted)' }}>total: {item.cantidad}</span>
                      </div>
                      {filasItem.map((fila, idx) => (
                        <div key={fila.id} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4, marginLeft: 14, flexWrap: 'wrap' }}>
                          {selPrestamos.length > 1 && (
                            <select value={fila.prestamo_id}
                              onChange={e => actualizarFila(fila.id, 'prestamo_id', e.target.value ? Number(e.target.value) : '')}
                              style={{ padding: '4px 6px', fontSize: 11, borderRadius: 5, border: '1px solid var(--t-border)', background: 'var(--t-bg-card)', color: 'var(--t-text-primary)', minWidth: 150 }}>
                              <option value="">— elegir préstamo —</option>
                              {selPrestamos.map(p => <option key={p.id} value={p.id}>{p.documento_contable}</option>)}
                            </select>
                          )}
                          <input type="number" min={0} max={item.cantidad} value={fila.cantidad}
                            onChange={e => actualizarFila(fila.id, 'cantidad', Number(e.target.value))}
                            style={{ width: 64, padding: '4px 6px', fontSize: 11, borderRadius: 5, border: '1px solid var(--t-border)', background: 'var(--t-bg-card)', color: 'var(--t-text-primary)' }} />
                          <span style={{ fontSize: 11, color: 'var(--t-text-muted)' }}>uds</span>
                          {filasItem.length > 1 && (
                            <button onClick={() => quitarFila(fila.id)} title="Quitar esta línea"
                              style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 13 }}>✕</button>
                          )}
                          {selPrestamos.length > 1 && idx === filasItem.length - 1 && (
                            <button onClick={() => agregarFilaExtra(fila)}
                              style={{ fontSize: 11, color: 'var(--t-accent)', background: 'none', border: 'none', cursor: 'pointer' }}>
                              + repartir a otro préstamo
                            </button>
                          )}
                        </div>
                      ))}
                      {sobra > 0 && (
                        <div style={{ marginLeft: 14, marginTop: 4, fontSize: 11, color: '#f59e0b' }}>
                          ⚠ {sobra} unidad(es) de {item.nombre} sin asignar — quedará marcado como sobrante
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          {/* PDF soporte adicional — solo aplica en cruce simple 1 a 1; en
              multicruce el PDF generado ya anexa los soportes de cada documento */}
          {selPrestamos.length === 1 && selDevoluciones.length === 1 && (
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, color: 'var(--t-text-muted)', display: 'block', marginBottom: 4 }}>PDF soporte adicional (opcional)</label>
              <input type="file" accept=".pdf" onChange={e => setSoporteFile(e.target.files[0])}
                style={{ fontSize: 12, color: 'var(--t-text-primary)' }} />
            </div>
          )}

          {selPrestamos.length * selDevoluciones.length > 1 && (
            <div style={{ fontSize: 11, color: 'var(--t-text-muted)', marginBottom: 12, background: 'var(--t-bg-inner)', padding: '6px 10px', borderRadius: 6 }}>
              ℹ️ El PDF del cruce se genera automáticamente con un consecutivo y anexa el soporte ya cargado en cada uno de los documentos seleccionados.
            </div>
          )}

          <input value={obs} onChange={e => setObs(e.target.value)} placeholder="Descripción del cruce (opcional)" style={{ ...inputS, marginBottom: 12 }} />

          {error && <div style={{ color: '#ef4444', fontSize: 12, marginBottom: 8 }}>{error}</div>}

          <button onClick={cruzar} disabled={saving} style={{
            padding: '8px 20px', background: 'var(--t-accent)', color: '#fff',
            border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: 'pointer',
          }}>
            {saving ? 'Guardando…' : '🔗 Registrar cruce'}
          </button>
        </div>
      )}

      {detalleCard && (
        <Modal onClose={() => setDetalleCard(null)} titulo={`Detalle ${detalleCard.documento_contable}`}>
          <DetallePrestamoModal prestamo={detalleCard} devoluciones={[]} />
        </Modal>
      )}
    </div>
  );
}


function TabHistorialCruces({ prestamos, cruces, productos, clinicas, onRefresh }) {
  const { isAdmin } = useAuth();
  const inputS = { width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid var(--t-border)', background: 'var(--t-bg-inner)', color: 'var(--t-text-primary)', fontSize: 13, boxSizing: 'border-box' };

  async function revertirCruce(cruce, e) {
    e.stopPropagation();
    if (!window.confirm(`¿Revertir el cruce entre ${cruce.prestamo_doc} y ${cruce.devolucion_doc}? El préstamo volverá a estado abierto.`)) return;
    try {
      await apiFetch(`/prestamos/cruces/${cruce.id}`, { method: 'DELETE' });
      onRefresh();
    } catch (err) {
      alert('Error revirtiendo cruce: ' + err.message);
    }
  }

  const [expandedCruce,    setExpandedCruce]    = React.useState(null);
  const [reparando,        setReparando]        = React.useState(false);
  const [regenerandoPdfs,  setRegenerandoPdfs]   = React.useState(false);
  const [limpiandoHuerfanos, setLimpiandoHuerfanos] = React.useState(false);
  const [regenerandoPdfId, setRegenerandoPdfId]  = React.useState(null);
  async function regenerarPdfIndividual(c, e) {
    e.stopPropagation();
    setRegenerandoPdfId(c.id);
    try {
      await apiFetch(`/prestamos/cruces/${c.id}/regenerar-pdf`, { method: 'POST' });
      onRefresh();
    } catch (err) {
      alert('Error regenerando el PDF: ' + err.message);
    }
    setRegenerandoPdfId(null);
  }

  async function repararCrucesAntiguos() {
    setReparando(true);
    try {
      const r = await apiFetch('/prestamos/cruces/backfill', { method: 'POST' });
      alert(`Se repararon ${r.actualizados} cruce(s) antiguo(s): ahora tienen consecutivo, estado y PDF.`);
      onRefresh();
    } catch (e) {
      alert('Error reparando cruces: ' + e.message);
    }
    setReparando(false);
  }

  async function regenerarPdfs() {
    if (!window.confirm('¿Regenerar el PDF de todos los cruces ya emitidos con el formato actual? Los archivos existentes se sobrescriben (el enlace no cambia).')) return;
    setRegenerandoPdfs(true);
    try {
      const r = await apiFetch('/prestamos/cruces/regenerar-pdfs', { method: 'POST' });
      let msg = `Se regeneraron ${r.regenerados} PDF(s).`;
      if (r.errores > 0) {
        msg += ` ${r.errores} con error:\n\n`;
        // Mostrar el motivo real de cada falla (agrupado, para no repetir el mismo
        // mensaje 25 veces si todos comparten la misma causa raíz).
        const porMotivo = {};
        (r.detalle_errores || []).forEach(d => {
          if (!porMotivo[d.motivo]) porMotivo[d.motivo] = [];
          porMotivo[d.motivo].push(d.numero);
        });
        Object.entries(porMotivo).forEach(([motivo, numeros]) => {
          msg += `• ${motivo}\n  (${numeros.length}): ${numeros.slice(0, 10).join(', ')}${numeros.length > 10 ? '…' : ''}\n\n`;
        });
      }
      alert(msg);
      onRefresh();
    } catch (e) {
      alert('Error regenerando PDFs: ' + e.message);
    }
    setRegenerandoPdfs(false);
  }

  async function limpiarHuerfanos() {
    if (!window.confirm('¿Eliminar los grupos de cruce que quedaron sin documentos asociados (por ejemplo, tras revertir el único cruce de ese grupo)? Se borra el número CRU-xxxxx y su PDF; no afecta los préstamos ni devoluciones en sí.')) return;
    setLimpiandoHuerfanos(true);
    try {
      const r = await apiFetch('/prestamos/cruces/limpiar-huerfanos', { method: 'POST' });
      alert(r.eliminados > 0
        ? `Se eliminaron ${r.eliminados} cruce(s) huérfano(s): ${r.detalle.slice(0, 15).join(', ')}${r.detalle.length > 15 ? '…' : ''}`
        : 'No había cruces huérfanos.');
      onRefresh();
    } catch (e) {
      alert('Error limpiando huérfanos: ' + e.message);
    }
    setLimpiandoHuerfanos(false);
  }
  const [filtroCruces, setFiltroCruces] = React.useState('');
  const [editandoCruce, setEditandoCruce] = React.useState(null);
  const [editObs,        setEditObs]       = React.useState('');
  const [guardandoEdicion, setGuardandoEdicion] = React.useState(false);
  const [verKardex, setVerKardex] = React.useState(false);
  const [editandoDocumento, setEditandoDocumento] = React.useState(null);
  function abrirEditarDocumento(id, e) {
    e.stopPropagation();
    const doc = (prestamos || []).find(p => p.id === id);
    if (doc) setEditandoDocumento(doc);
  }

  function abrirEdicionCruce(c, e) {
    e.stopPropagation();
    setEditandoCruce(c);
    setEditObs(c.observaciones || c.grupo_observaciones || '');
  }

  async function guardarEdicionCruce() {
    setGuardandoEdicion(true);
    try {
      await apiFetch(`/prestamos/cruces/${editandoCruce.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ observaciones: editObs }),
      });
      setEditandoCruce(null);
      onRefresh();
    } catch (err) {
      alert('Error editando cruce: ' + err.message);
    }
    setGuardandoEdicion(false);
  }

  function matchCruce(c, texto) {
    if (!texto) return true;
    const t = texto.toLowerCase().trim();
    const campos = [c.grupo_numero, c.prestamo_doc, c.devolucion_doc, c.clinica_nombre, c.observaciones, c.grupo_observaciones]
      .filter(Boolean).map(x => String(x).toLowerCase());
    if (campos.some(x => x.includes(t))) return true;
    const items = [...(c.prestamo_items || []), ...(c.devolucion_items || [])];
    return items.some(i => (i.nombre || '').toLowerCase().includes(t) || (i.codigo || '').toLowerCase().includes(t));
  }

  // Devoluciones con sobrante: cruces cuyo grupo quedó marcado porque, al
  // repartir los productos de la devolución entre los préstamos elegidos, no
  // se asignó todo. Se deduplica por grupo (un multicruce puede tener varios
  // pares con el mismo grupo_numero) y se usa el detalle exacto guardado.
  const crucesConSobrante = React.useMemo(() => {
    const vistos = new Set();
    const resultado = [];
    cruces.forEach(c => {
      if (!c.grupo_tiene_sobrante || !c.grupo_numero || vistos.has(c.grupo_numero)) return;
      vistos.add(c.grupo_numero);
      resultado.push({
        grupo_numero: c.grupo_numero,
        grupo_pdf_url: c.grupo_pdf_url,
        created_at: c.created_at,
        detalle: c.grupo_sobrante_detalle || [],
      });
    });
    return resultado.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  }, [cruces]);
  const [verSobrantes, setVerSobrantes] = React.useState(false);

  return (
    <div>
    {cruces.length > 0 && (
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: '0 0 auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 12, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--t-text-primary)' }}>Cruces registrados</div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button onClick={() => setVerKardex(true)}
                title="Saldo por producto: cuánto se ha prestado y devuelto en total, sin depender de cómo se hicieron los cruces"
                style={{ padding: '5px 12px', fontSize: 11, border: '1px solid var(--t-accent)', borderRadius: 6, cursor: 'pointer', background: 'transparent', color: 'var(--t-accent)' }}>
                📒 Kárdex por producto
              </button>
              {crucesConSobrante.length > 0 && (
                <button onClick={() => setVerSobrantes(v => !v)}
                  title="Devoluciones donde, al repartir los productos entre los préstamos, quedaron unidades sin asignar"
                  style={{ padding: '5px 12px', fontSize: 11, border: '1px solid #f59e0b', borderRadius: 6, cursor: 'pointer', background: 'transparent', color: '#f59e0b', fontWeight: 600 }}>
                  ⚠ Devoluciones con sobrante ({crucesConSobrante.length})
                </button>
              )}
              {isAdmin && (
                <button onClick={regenerarPdfs} disabled={regenerandoPdfs}
                  title="Regenera el PDF de todos los cruces ya emitidos con el formato actual (código, cantidad y fecha por producto)"
                  style={{ padding: '5px 12px', fontSize: 11, border: '1px solid var(--t-accent)', borderRadius: 6, cursor: 'pointer', background: 'transparent', color: 'var(--t-accent)' }}>
                  {regenerandoPdfs ? 'Regenerando…' : '🔄 Actualizar PDFs al nuevo formato'}
                </button>
              )}
              {isAdmin && (
                <button onClick={limpiarHuerfanos} disabled={limpiandoHuerfanos}
                  title="Elimina cruces (número + PDF) que quedaron sin ningún documento asociado, normalmente tras revertir el único cruce de ese grupo"
                  style={{ padding: '5px 12px', fontSize: 11, border: '1px solid #c0392b', borderRadius: 6, cursor: 'pointer', background: 'transparent', color: '#c0392b' }}>
                  {limpiandoHuerfanos ? 'Limpiando…' : '🧹 Limpiar cruces huérfanos'}
                </button>
              )}
              {cruces.some(c => !c.grupo_numero) && (
                <button onClick={repararCrucesAntiguos} disabled={reparando}
                  title="Asigna consecutivo, recalcula el estado y genera el PDF de los cruces creados antes de esta función"
                  style={{ padding: '5px 12px', fontSize: 11, border: '1px solid var(--t-accent)', borderRadius: 6, cursor: 'pointer', background: 'transparent', color: 'var(--t-accent)' }}>
                  {reparando ? 'Reparando…' : '🔧 Reparar cruces antiguos'}
                </button>
              )}
            </div>
          </div>
          {verSobrantes && crucesConSobrante.length > 0 && (
            <div style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid #f59e0b', borderRadius: 8, padding: 12, marginBottom: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#f59e0b', marginBottom: 8 }}>
                ⚠ Devoluciones con sobrante — quedaron unidades sin asignar a ningún préstamo al registrar el cruce
              </div>
              {crucesConSobrante.map(g => (
                <div key={g.grupo_numero} style={{ marginBottom: 8, fontSize: 12, borderBottom: '1px solid var(--t-border)', paddingBottom: 8 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                    <b style={{ color: 'var(--t-accent)' }}>{g.grupo_numero}</b>
                    <span style={{ color: 'var(--t-text-muted)', fontSize: 11 }}>{g.created_at?.substring(0, 10)}</span>
                    {g.grupo_pdf_url && (
                      <a href={g.grupo_pdf_url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: 'var(--t-accent)' }}>Ver PDF</a>
                    )}
                  </div>
                  {g.detalle.map((s, i) => (
                    <div key={i} style={{ marginLeft: 10, color: 'var(--t-text-muted)' }}>
                      • {s.devolucion_doc}: {s.cantidad_sobrante} uds de {s.nombre} ({s.codigo}) sin asignar
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
          <input value={filtroCruces} onChange={e => setFiltroCruces(e.target.value)}
            placeholder="Buscar por Nº de cruce (ej. CRU-00092), documento (préstamo o devolución), producto o clínica…"
            style={{ ...inputS, marginBottom: 10 }} />
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: 'var(--t-bg-card)' }}>
                {['Cruce Nº','Préstamo','Devolución','Estado devol.','Clínica','Fecha','Estado prést.','Soporte',''].map(h => (
                  <th key={h} style={{ padding: '8px 10px', textAlign: 'left', color: 'var(--t-text-muted)', fontWeight: 600, borderBottom: '1px solid var(--t-border)', position: 'sticky', top: 0, background: 'var(--t-bg-card)', zIndex: 1 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cruces.filter(c => matchCruce(c, filtroCruces)).length === 0 && (
                <tr><td colSpan={9} style={{ padding: '20px 10px', textAlign: 'center', color: 'var(--t-text-muted)' }}>Sin resultados para "{filtroCruces}"</td></tr>
              )}
              {cruces.filter(c => matchCruce(c, filtroCruces)).map(c => (
                <React.Fragment key={c.id}>
                <tr onClick={() => setExpandedCruce(expandedCruce === c.id ? null : c.id)}
                  style={{ borderBottom: expandedCruce === c.id ? 'none' : '1px solid var(--t-border)', cursor: 'pointer' }}>
                  <td style={{ padding: '8px 10px' }} onClick={e => e.stopPropagation()}>
                    {c.grupo_numero ? (
                      c.grupo_pdf_url ? (
                        <a href={`${API_BASE}/prestamos/soporte/${c.grupo_pdf_url}`} target="_blank" rel="noreferrer"
                          style={{ color: 'var(--t-accent)', fontWeight: 600, fontSize: 11, textDecoration: 'none' }}>
                          📄 {c.grupo_numero}
                        </a>
                      ) : <span style={{ fontSize: 11, color: 'var(--t-text-muted)' }}>{c.grupo_numero}</span>
                    ) : <span style={{ color: 'var(--t-text-muted)' }}>—</span>}
                  </td>
                  <td style={{ padding: '8px 10px', color: 'var(--t-text-primary)', fontWeight: 600 }}>
                    <span style={{ display: 'inline-block', width: 12, color: 'var(--t-text-muted)', fontSize: 10 }}>
                      {expandedCruce === c.id ? '▼' : '▶'}
                    </span>
                    {c.prestamo_doc}
                    {isAdmin && (
                      <button onClick={e => abrirEditarDocumento(c.prestamo_id, e)}
                        title="Editar este documento (solo admin)"
                        style={{ marginLeft: 5, padding: '1px 5px', fontSize: 10, border: 'none', borderRadius: 4, cursor: 'pointer', background: 'transparent', color: 'var(--t-text-muted)' }}>
                        ✏️
                      </button>
                    )}
                  </td>
                  <td style={{ padding: '8px 10px', color: 'var(--t-text-primary)' }}>
                    {c.devolucion_doc}
                    {isAdmin && (
                      <button onClick={e => abrirEditarDocumento(c.devolucion_id, e)}
                        title="Editar este documento (solo admin)"
                        style={{ marginLeft: 5, padding: '1px 5px', fontSize: 10, border: 'none', borderRadius: 4, cursor: 'pointer', background: 'transparent', color: 'var(--t-text-muted)' }}>
                        ✏️
                      </button>
                    )}
                  </td>
                  <td style={{ padding: '8px 10px' }}>
                    <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600, background: badgeEstado(c.estado_devolucion).bg, color: badgeEstado(c.estado_devolucion).color }}>
                      {badgeEstado(c.estado_devolucion).label}
                    </span>
                    {c.grupo_tiene_sobrante && (
                      <div style={{ marginTop: 4, fontSize: 10, fontWeight: 600, color: '#f59e0b' }}>
                        ⚠ Devolución con sobrante
                      </div>
                    )}
                  </td>
                  <td style={{ padding: '8px 10px', color: 'var(--t-text-muted)' }}>{c.clinica_nombre}</td>
                  <td style={{ padding: '8px 10px', color: 'var(--t-text-muted)' }}>{c.created_at?.substring(0,10)}</td>
                  <td style={{ padding: '8px 10px' }}>
                    <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600, background: badgeEstado(c.estado_prestamo).bg, color: badgeEstado(c.estado_prestamo).color }}>
                      {badgeEstado(c.estado_prestamo).label}
                    </span>
                  </td>
                  <td style={{ padding: '8px 10px' }} onClick={e => e.stopPropagation()}>
                    <CruceSoportes cruce={c} />
                  </td>
                  <td style={{ padding: '8px 10px', display: 'flex', gap: 6 }} onClick={e => e.stopPropagation()}>
                    {isAdmin && (
                      <button onClick={e => abrirEdicionCruce(c, e)}
                        title="Editar cruce (solo admin)"
                        style={{ padding: '3px 8px', fontSize: 11, border: '1px solid var(--t-border)', borderRadius: 5, cursor: 'pointer', background: 'transparent', color: 'var(--t-text-primary)' }}>
                        ✏️ Editar
                      </button>
                    )}
                    {c.grupo_numero && (
                      <button onClick={e => regenerarPdfIndividual(c, e)} disabled={regenerandoPdfId === c.id}
                        title="Regenerar el PDF de este cruce (por si se editó algún documento después de emitirlo)"
                        style={{ padding: '3px 8px', fontSize: 11, border: '1px solid var(--t-border)', borderRadius: 5, cursor: 'pointer', background: 'transparent', color: 'var(--t-text-primary)' }}>
                        {regenerandoPdfId === c.id ? '…' : '🔄 PDF'}
                      </button>
                    )}
                    <button onClick={e => revertirCruce(c, e)}
                      title="Revertir cruce"
                      style={{ padding: '3px 8px', fontSize: 11, border: '1px solid #ef444455', borderRadius: 5, cursor: 'pointer', background: 'transparent', color: '#ef4444' }}>
                      ↺ Revertir
                    </button>
                  </td>
                </tr>
                {expandedCruce === c.id && (
                  <tr style={{ borderBottom: '1px solid var(--t-border)' }}>
                    <td colSpan={9} style={{ padding: '4px 10px 14px 30px', background: 'var(--t-bg-inner)' }}>
                      {c.grupo_numero && (
                        <div style={{ fontSize: 12, color: 'var(--t-text-muted)', marginBottom: 6 }}>
                          <span style={{ fontWeight: 600, color: 'var(--t-text-primary)' }}>Cruce: </span>
                          {c.grupo_numero}
                          {c.grupo_pdf_url && (
                            <a href={`${API_BASE}/prestamos/soporte/${c.grupo_pdf_url}`} target="_blank" rel="noreferrer"
                              style={{ marginLeft: 8, color: 'var(--t-accent)' }}>📄 Ver PDF del cruce</a>
                          )}
                        </div>
                      )}
                      <div style={{ fontSize: 12, color: 'var(--t-text-muted)', marginBottom: 10 }}>
                        <span style={{ fontWeight: 600, color: 'var(--t-text-primary)' }}>Descripción: </span>
                        {c.observaciones || c.grupo_observaciones || 'Sin descripción'}
                      </div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--t-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
                        Items cruzados
                      </div>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                        <thead>
                          <tr>
                            {['Código','Producto','Cantidad'].map(h => (
                              <th key={h} style={{ padding: '4px 8px', textAlign: 'left', color: 'var(--t-text-muted)', fontWeight: 600, borderBottom: '1px solid var(--t-border)' }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {(c.devolucion_items || []).length === 0 ? (
                            <tr><td colSpan={3} style={{ padding: '6px 8px', color: 'var(--t-text-muted)' }}>Sin items registrados</td></tr>
                          ) : (c.devolucion_items || []).map(item => (
                            <tr key={item.codigo}>
                              <td style={{ padding: '4px 8px', color: 'var(--t-text-primary)', fontFamily: 'monospace' }}>{item.codigo}</td>
                              <td style={{ padding: '4px 8px', color: 'var(--t-text-primary)' }}>{item.nombre}</td>
                              <td style={{ padding: '4px 8px', color: 'var(--t-text-muted)' }}>{item.cantidad}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      )}
      {editandoCruce && (
        <Modal onClose={() => setEditandoCruce(null)} titulo={`Editar cruce ${editandoCruce.grupo_numero || ''}`}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 320 }}>
            <div style={{ fontSize: 12, color: 'var(--t-text-muted)' }}>
              {editandoCruce.prestamo_doc} ↔ {editandoCruce.devolucion_doc}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600, background: badgeEstado(editandoCruce.estado_prestamo).bg, color: badgeEstado(editandoCruce.estado_prestamo).color }}>
                préstamo: {badgeEstado(editandoCruce.estado_prestamo).label}
              </span>
              <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600, background: badgeEstado(editandoCruce.estado_devolucion).bg, color: badgeEstado(editandoCruce.estado_devolucion).color }}>
                devolución: {badgeEstado(editandoCruce.estado_devolucion).label}
              </span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--t-text-muted)' }}>
              El estado se calcula solo a partir de las cantidades reales — no es editable.
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--t-text-muted)', fontWeight: 500 }}>Observaciones</label>
              <input value={editObs} onChange={e => setEditObs(e.target.value)}
                style={{ display: 'block', width: '100%', marginTop: 5, padding: '7px 10px', border: '1px solid var(--t-border)', borderRadius: 7, fontSize: 13, background: 'var(--t-bg-inner)', color: 'var(--t-text-primary)', boxSizing: 'border-box' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
              <button onClick={() => setEditandoCruce(null)}
                style={{ padding: '8px 16px', border: '1px solid var(--t-border)', borderRadius: 7, fontSize: 13, cursor: 'pointer', background: 'transparent', color: 'var(--t-text-primary)' }}>
                Cancelar
              </button>
              <button onClick={guardarEdicionCruce} disabled={guardandoEdicion}
                style={{ padding: '8px 18px', border: 'none', borderRadius: 7, fontSize: 13, cursor: 'pointer', background: 'var(--t-accent)', color: '#fff', fontWeight: 500 }}>
                {guardandoEdicion ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>
        </Modal>
      )}
      {verKardex && (
        <Modal onClose={() => setVerKardex(false)} titulo="📒 Kárdex por producto">
          <ModalKardexProducto prestamos={prestamos} productos={productos} clinicas={clinicas} />
        </Modal>
      )}
      {editandoDocumento && (
        <Modal onClose={() => setEditandoDocumento(null)} titulo={`Editar movimiento — ${editandoDocumento.documento_contable}`}>
          <FormEditarMovimiento
            movimiento={editandoDocumento}
            clinicas={clinicas}
            productos={productos}
            onSaved={() => { setEditandoDocumento(null); onRefresh(); }}
            onCancel={() => setEditandoDocumento(null)}
          />
        </Modal>
      )}
    </div>
  );
}

// ─── KÁRDEX POR PRODUCTO ──────────────────────────────────────────────────
// Saldo de un producto prestado/devuelto, calculado directamente de las
// cantidades reales (documentos de préstamo vs. documentos de devolución),
// sin depender de cómo quedaron armados los cruces. Es la fuente de verdad
// para "¿cuánto va pendiente de este producto en total?".
function ModalKardexProducto({ prestamos, productos, clinicas }) {
  const [busqueda, setBusqueda] = React.useState('');
  const [codigoSel, setCodigoSel] = React.useState(null);
  const [tipoMov, setTipoMov] = React.useState('otorgados'); // otorgados (EPO→IDP) | recibidos (IPE→ED)
  const [clinicaSel, setClinicaSel] = React.useState('todas');

  // Catálogo de productos para buscar: prioriza el maestro de productos,
  // pero también incluye cualquier código que aparezca en los documentos
  // aunque no esté en el maestro.
  const catalogo = React.useMemo(() => {
    const mapa = {};
    (productos || []).forEach(p => { mapa[p.codigo] = p.nombre; });
    (prestamos || []).forEach(p => (p.items || []).forEach(i => {
      if (i.codigo && !mapa[i.codigo]) mapa[i.codigo] = i.nombre || '';
    }));
    return Object.entries(mapa).map(([codigo, nombre]) => ({ codigo, nombre }));
  }, [productos, prestamos]);

  const sugerencias = React.useMemo(() => {
    if (!busqueda.trim()) return [];
    const q = busqueda.toLowerCase();
    return catalogo.filter(p => p.codigo.toLowerCase().includes(q) || (p.nombre || '').toLowerCase().includes(q)).slice(0, 12);
  }, [busqueda, catalogo]);

  const nombreSel = catalogo.find(p => p.codigo === codigoSel)?.nombre || '';

  const tipoSalida  = tipoMov === 'otorgados' ? 'egreso'            : 'ingreso';
  const tipoEntrada = tipoMov === 'otorgados' ? 'devolucion_ingreso' : 'devolucion_egreso';

  const movimientos = React.useMemo(() => {
    if (!codigoSel) return [];
    const filas = [];
    (prestamos || []).forEach(p => {
      if (clinicaSel !== 'todas' && p.clinica_nombre !== clinicaSel) return;
      const item = (p.items || []).find(i => i.codigo === codigoSel);
      if (!item || !Number(item.cantidad)) return;
      if (p.tipo === tipoSalida) {
        filas.push({
          fecha: p.fecha, documento: p.documento_contable, clinica: p.clinica_nombre,
          movimiento: tipoMov === 'otorgados' ? 'Préstamo otorgado' : 'Préstamo recibido',
          entra: Number(item.cantidad), sale: 0,
        });
      } else if (p.tipo === tipoEntrada) {
        filas.push({
          fecha: p.fecha, documento: p.documento_contable, clinica: p.clinica_nombre,
          movimiento: tipoMov === 'otorgados' ? 'Devolución recibida' : 'Devolución entregada',
          entra: 0, sale: Number(item.cantidad),
        });
      }
    });
    filas.sort((a, b) => (a.fecha || '').localeCompare(b.fecha || '') || a.documento.localeCompare(b.documento));
    let saldo = 0;
    return filas.map(f => {
      saldo += f.entra - f.sale;
      return { ...f, saldo };
    });
  }, [prestamos, codigoSel, clinicaSel, tipoSalida, tipoEntrada, tipoMov]);

  const totalPrestado = movimientos.reduce((s, m) => s + m.entra, 0);
  const totalDevuelto = movimientos.reduce((s, m) => s + m.sale, 0);
  const saldoFinal = totalPrestado - totalDevuelto;

  const inputS = { width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid var(--t-border)', background: 'var(--t-bg-inner)', color: 'var(--t-text-primary)', fontSize: 13, boxSizing: 'border-box' };

  return (
    <div style={{ minWidth: 480, maxWidth: 720 }}>
      <div style={{ display: 'flex', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        {['otorgados','recibidos'].map(t => (
          <button key={t} onClick={() => setTipoMov(t)} style={{
            padding: '6px 14px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
            background: tipoMov === t ? 'var(--t-accent)' : 'var(--t-bg-inner)',
            color: tipoMov === t ? '#fff' : 'var(--t-text-primary)',
            border: '1px solid var(--t-border)', fontWeight: tipoMov === t ? 600 : 400,
          }}>{t === 'otorgados' ? 'Préstamos que otorgamos (EPO/IDP)' : 'Préstamos que recibimos (IPE/ED)'}</button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <input value={codigoSel ? `${codigoSel} — ${nombreSel}` : busqueda}
            onChange={e => { setCodigoSel(null); setBusqueda(e.target.value); }}
            placeholder="Buscar producto por código o nombre…" style={inputS} />
          {!codigoSel && sugerencias.length > 0 && (
            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 5, background: 'var(--t-bg-card)', border: '1px solid var(--t-border)', borderRadius: 6, maxHeight: 220, overflowY: 'auto', marginTop: 2 }}>
              {sugerencias.map(p => (
                <div key={p.codigo} onClick={() => { setCodigoSel(p.codigo); setBusqueda(''); }}
                  style={{ padding: '7px 10px', fontSize: 12, cursor: 'pointer', borderBottom: '1px solid var(--t-border)' }}>
                  <span style={{ fontFamily: 'monospace', color: 'var(--t-accent)' }}>{p.codigo}</span>{' — '}{p.nombre}
                </div>
              ))}
            </div>
          )}
        </div>
        <select value={clinicaSel} onChange={e => setClinicaSel(e.target.value)} style={{ ...inputS, flex: '0 0 200px' }}>
          <option value="todas">Todas las clínicas</option>
          {(clinicas || []).map(c => <option key={c.id || c.nombre} value={c.nombre}>{c.nombre}</option>)}
        </select>
      </div>

      {!codigoSel ? (
        <div style={{ textAlign: 'center', padding: '40px 10px', color: 'var(--t-text-muted)', fontSize: 13 }}>
          Busca y selecciona un producto para ver su kárdex.
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 10, margin: '14px 0', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 120, background: 'var(--t-bg-card)', border: '1px solid var(--t-border)', borderRadius: 8, padding: 10, textAlign: 'center' }}>
              <div style={{ fontSize: 11, color: 'var(--t-text-muted)' }}>Total prestado</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--t-text-primary)' }}>{totalPrestado}</div>
            </div>
            <div style={{ flex: 1, minWidth: 120, background: 'var(--t-bg-card)', border: '1px solid var(--t-border)', borderRadius: 8, padding: 10, textAlign: 'center' }}>
              <div style={{ fontSize: 11, color: 'var(--t-text-muted)' }}>Total devuelto</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--t-text-primary)' }}>{totalDevuelto}</div>
            </div>
            <div style={{ flex: 1, minWidth: 120, background: 'var(--t-bg-card)', border: '1px solid var(--t-border)', borderRadius: 8, padding: 10, textAlign: 'center' }}>
              <div style={{ fontSize: 11, color: 'var(--t-text-muted)' }}>Saldo pendiente</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: saldoFinal > 0 ? '#f59e0b' : '#22c55e' }}>{saldoFinal}</div>
            </div>
          </div>

          {movimientos.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '30px 10px', color: 'var(--t-text-muted)', fontSize: 13 }}>
              No hay movimientos de este producto{clinicaSel !== 'todas' ? ' en esta clínica' : ''}.
            </div>
          ) : (
            <div style={{ maxHeight: 340, overflowY: 'auto', border: '1px solid var(--t-border)', borderRadius: 8 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: 'var(--t-bg-card)' }}>
                    {['Fecha','Documento','Clínica','Movimiento','Entra','Sale','Saldo'].map(h => (
                      <th key={h} style={{ padding: '7px 9px', textAlign: h === 'Entra' || h === 'Sale' || h === 'Saldo' ? 'right' : 'left', color: 'var(--t-text-muted)', fontWeight: 600, position: 'sticky', top: 0, background: 'var(--t-bg-card)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {movimientos.map((m, i) => (
                    <tr key={i} style={{ borderTop: '1px solid var(--t-border)' }}>
                      <td style={{ padding: '6px 9px', color: 'var(--t-text-muted)' }}>{(m.fecha || '').substring(0,10)}</td>
                      <td style={{ padding: '6px 9px', color: 'var(--t-text-primary)', fontWeight: 600 }}>{m.documento}</td>
                      <td style={{ padding: '6px 9px', color: 'var(--t-text-muted)' }}>{m.clinica}</td>
                      <td style={{ padding: '6px 9px' }}>{m.movimiento}</td>
                      <td style={{ padding: '6px 9px', textAlign: 'right', color: '#22c55e' }}>{m.entra > 0 ? `+${m.entra}` : ''}</td>
                      <td style={{ padding: '6px 9px', textAlign: 'right', color: '#ef4444' }}>{m.sale > 0 ? `-${m.sale}` : ''}</td>
                      <td style={{ padding: '6px 9px', textAlign: 'right', fontWeight: 700, color: 'var(--t-text-primary)' }}>{m.saldo}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── TAB PRODUCTOS ──────────────────────────────────────────────────────────────

function TabProductos({ productos: productosProp, onRefresh }) {
  const [busqueda,        setBusqueda]        = useState('');
  const [filtroCat,       setFiltroCat]        = useState('');
  const [saving,          setSaving]          = useState('');
  const [progreso,        setProgreso]        = React.useState(0);
  const [productosLocales, setProductosLocales] = useState(productosProp);

  const prevPropLen = useRef(productosProp.length);
  useEffect(() => {
    if (productosProp.length !== prevPropLen.current) {
      setProductosLocales(productosProp);
      prevPropLen.current = productosProp.length;
    }
  }, [productosProp]);

  const filtrados = productosLocales.filter(p => {
    const q      = busqueda.toLowerCase();
    const matchQ = !q       || p.codigo?.toLowerCase().includes(q) || p.nombre?.toLowerCase().includes(q);
    const matchC = !filtroCat || (getCategoriaFromCodigo(p.codigo)?.categoria || '').includes(filtroCat);
    return matchQ && matchC;
  });

  async function cargarExcel(e) {
    const file = e.target.files[0];
    if (!file) return;
    setSaving('cargando');
    const reader = new FileReader();
    reader.onload = async ev => {
      try {
        const wb   = XLSX.read(ev.target.result, { type: 'array' });
        const ws   = wb.Sheets[wb.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(ws);
        if (data.length > 0) console.log('HEADERS REALES:', Object.keys(data[0]), 'PRIMERA FILA:', data[0]);
        // Deduplicar por código
        const seen = new Set();
        const rows = data.map(row => {
          // Forzar código a string antes del padStart (puede venir como número desde Excel)
          const codigoRaw = row['Código'] || row['codigo'] || '';
          const codigo = String(codigoRaw).trim().padStart(10, '0');
          if (!codigo || codigo === '0000000000') return null;
          if (seen.has(codigo)) return null; // ignorar duplicados
          seen.add(codigo);
          // Leer cada columna de forma explícita sin fallback cruzado
          const nombre    = String(row['Nombre']          ?? row['nombre']          ?? '').trim();
          const unidad    = String(row['Unidad']          ?? row['unidad']          ?? '').trim();
          const precioRaw = row['Precio unitario']        ?? row['precio_unitario'] ?? 0;
          // En el Excel las columnas están invertidas: 'Categoría' trae la cuenta y 'Cuenta contable' trae la categoría
          const catRaw    = row['Cuenta contable']        ?? row['cuenta_contable'] ?? '';
          const cuentaRaw = row['Categoría']              ?? row['Categoria']       ?? '';
          const precio    = Number(String(precioRaw).replace(/[^0-9.]/g, '')) || 0;
          const catExcel    = String(catRaw).trim();
          const cuentaExcel = String(cuentaRaw).trim();
          if (!nombre) return null; // fila sin nombre se ignora
          return {
            codigo,
            nombre:          nombre.substring(0, 255),
            unidad:          unidad.substring(0, 50),
            precio_unitario: precio,
            categoria:       (catExcel    === 'NO APLICA' ? '' : catExcel).substring(0, 200),
            cuenta_contable: (cuentaExcel === 'NO APLICA' ? '' : cuentaExcel).substring(0, 50),
          };
        }).filter(Boolean);

        if (rows.length > 0) {
          // Limpiar tabla antes de recargar para evitar duplicados con distintos códigos
          await apiFetch('/prestamos/productos/clear', { method: 'DELETE' });
          // Enviar en lotes de 100 para evitar ERR_HTTP2_PROTOCOL_ERROR en Render
          const CHUNK = 50;
          const totalLotes = Math.ceil(rows.length / CHUNK);
          let actualizados = [];
          setProgreso(0);
          for (let i = 0; i < rows.length; i += CHUNK) {
            const chunk = rows.slice(i, i + CHUNK);
            actualizados = await apiFetch('/prestamos/productos/bulk', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ rows: chunk }),
            });
            setProgreso(Math.round(((i + CHUNK) / rows.length) * 100));
          }
          setProgreso(100);
          setProductosLocales(actualizados || []);
        }
        setSaving('listo'); setTimeout(() => { setSaving(''); setProgreso(0); }, 3000);
      } catch (err) {
        console.error('Error cargando Excel:', err);
        alert('ERROR: ' + err.message);
        setSaving('error');
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function descargarPlantilla() {
    const ws = XLSX.utils.json_to_sheet([{
      'Código': '0101050001',
      'Nombre': 'Ejemplo producto',
      'Unidad': 'Tab',
      'Precio unitario': 8500,
      'Categoría': 'Medicamentos',
      'Cuenta contable': '14150501',
    }]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Productos');
    XLSX.writeFile(wb, 'plantilla_productos.xlsx');
  }

  const thS = { textAlign: 'left', padding: '8px 10px', fontSize: 11, color: 'var(--t-text-muted)', borderBottom: '1px solid var(--t-border)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em' };
  const tdS = { padding: '9px 10px', borderBottom: '1px solid var(--t-border)', fontSize: 13 };

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <input value={busqueda} onChange={e => setBusqueda(e.target.value)}
          placeholder='Buscar por código o nombre…'
          style={{ flex: 1, minWidth: 200, padding: '7px 10px', border: '1px solid var(--t-border)', borderRadius: 7, fontSize: 13, background: 'var(--t-bg-inner)', color: 'var(--t-text-primary)' }} />
        <select value={filtroCat} onChange={e => setFiltroCat(e.target.value)}
          style={{ padding: '7px 10px', border: '1px solid var(--t-border)', borderRadius: 7, fontSize: 13, background: 'var(--t-bg-inner)', color: 'var(--t-text-primary)' }}>
          <option value=''>Todas las categorías</option>
          {[...new Set(productosLocales.map(p => p.categoria).filter(Boolean))].sort().map(c => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <label style={{ position: 'relative', padding: '7px 13px', border: '1px solid var(--t-border)', borderRadius: 7, fontSize: 13, cursor: 'pointer', background: saving === 'cargando' ? 'var(--t-bg-card)' : 'var(--t-bg-inner)', color: 'var(--t-text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', minWidth: 130, display: 'inline-block', textAlign: 'center' }}>
          {saving === 'cargando' && progreso > 0 && (
            <span style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${progreso}%`, background: 'var(--t-accent)', opacity: 0.25, transition: 'width 0.3s' }} />
          )}
          <span style={{ position: 'relative', zIndex: 1 }}>
            {saving === 'cargando' ? (progreso > 0 ? `Cargando… ${progreso}%` : 'Leyendo…') : saving === 'listo' ? '✓ Cargado' : saving === 'error' ? '✗ Error' : '↑ Cargar Excel'}
          </span>
          <input type='file' accept='.xlsx,.csv,.xlsm' onClick={e => { e.target.value = null; }} onChange={cargarExcel} style={{ display: 'none' }} />
        </label>
        <button onClick={descargarPlantilla} style={{ padding: '7px 13px', border: '1px solid var(--t-border)', borderRadius: 7, fontSize: 13, cursor: 'pointer', background: 'var(--t-bg-inner)', color: 'var(--t-text-primary)', whiteSpace: 'nowrap' }}>
          ↓ Plantilla
        </button>
      </div>

      {productosLocales.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '50px 20px', color: 'var(--t-text-muted)', fontSize: 13 }}>
          Sin productos — carga un Excel con la plantilla
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thS}>Código (10 díg.)</th>
                <th style={thS}>Grupo (6 díg.)</th>
                <th style={thS}>Cuenta contable</th>
                <th style={thS}>Categoría</th>
                <th style={thS}>Nombre</th>
                <th style={thS}>Unidad</th>
                <th style={thS}>Precio unitario</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map(p => {
                const g = getCategoriaFromCodigo(p.codigo);
                return (
                  <tr key={p.codigo}>
                    <td style={{ ...tdS, fontFamily: 'monospace', fontSize: 12 }}>{p.codigo}</td>
                    <td style={{ ...tdS, fontFamily: 'monospace', fontSize: 12, color: 'var(--t-text-muted)' }}>{String(p.codigo).substring(0, 6)}</td>
                    <td style={{ ...tdS, fontSize: 12, color: 'var(--t-text-muted)' }}>{g?.cuenta || p.cuenta_contable || '—'}</td>
                    <td style={tdS}><CatTag categoria={g?.categoria || p.categoria} /></td>
                    <td style={tdS}>{p.nombre}</td>
                    <td style={{ ...tdS, color: 'var(--t-text-muted)' }}>{p.unidad || '—'}</td>
                    <td style={{ ...tdS, fontWeight: 500 }}>{fmt(p.precio_unitario)}</td>
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

// ─── TAB REPORTES ───────────────────────────────────────────────────────────────

function TabReportes({ prestamos, devoluciones, cruces, clinicas }) {
  function exportar(filtro, nombre) {
    const datos = prestamos.filter(filtro).map(p => ({
      Documento:   p.documento_contable,
      Fecha:       p.fecha,
      Clínica:     p.clinica_nombre,
      Bodega:      `${p.bodega_nombre} (${p.bodega_codigo})`,
      Tipo:        p.tipo,
      Estado:      p.estado,
      Descripción: p.observaciones || '',
      'Valor total': (p.items || []).reduce((s, i) => s + i.cantidad * i.precio_unitario, 0),
      'Devoluciones': devoluciones.filter(d => d.prestamo_id === p.id).length,
    }));
    const ws = XLSX.utils.json_to_sheet(datos);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, nombre);
    XLSX.writeFile(wb, `${nombre}.xlsx`);
  }

  const [verPendientes, setVerPendientes] = useState(false);
  const [verPorPrestamo, setVerPorPrestamo] = useState(false);
  const [verCruces, setVerCruces] = useState(false);

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
        <div style={{ ...cardStyle, gridColumn: '1 / -1' }} onClick={() => setVerPendientes(true)}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 5 }}>
            <span style={{ fontSize: 18 }}>📊</span>
            <span style={{ fontWeight: 500, fontSize: 13 }}>Pendientes por devolver — detallado por producto y clínica</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--t-text-muted)' }}>
            Qué producto falta por devolver en cada clínica (y qué nos falta devolver a nosotros), con valor y filtro de fecha de corte
          </div>
        </div>
        <div style={{ ...cardStyle, gridColumn: '1 / -1' }} onClick={() => setVerPorPrestamo(true)}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 5 }}>
            <span style={{ fontSize: 18 }}>🔗</span>
            <span style={{ fontWeight: 500, fontSize: 13 }}>Préstamo por préstamo — devoluciones, pagos y pendientes</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--t-text-muted)' }}>
            Por cada IPE/EPO: qué devoluciones (IDP/ED) tiene cruzadas, qué productos ya se pagaron y qué falta
          </div>
        </div>
        <div style={{ ...cardStyle, gridColumn: '1 / -1' }} onClick={() => setVerCruces(true)}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 5 }}>
            <span style={{ fontSize: 18 }}>🧾</span>
            <span style={{ fontWeight: 500, fontSize: 13 }}>Cruces cronológicos y saldo pendiente por préstamo</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--t-text-muted)' }}>
            EPO/IPE con sus devoluciones cruzadas, cantidades y valores $, descontando el saldo en orden cronológico — marca devoluciones con sobrante para revisar, y exporta a Excel con hojas de saldo pendiente por EPO y por IPE
          </div>
        </div>
      </div>

      {verPendientes && (
        <ModalReportePendientes prestamos={prestamos} devoluciones={devoluciones} cruces={cruces} onClose={() => setVerPendientes(false)} />
      )}
      {verPorPrestamo && (
        <ModalReportePorPrestamo prestamos={prestamos} cruces={cruces} clinicas={clinicas} onClose={() => setVerPorPrestamo(false)} />
      )}
      {verCruces && (
        <ModalReporteCruces prestamos={prestamos} cruces={cruces} clinicas={clinicas} onClose={() => setVerCruces(false)} />
      )}
    </div>
  );
}

// ─── Dashboard interactivo (EPO e IPE por separado, por tercero/año/estado) ─────

const ESTADO_COLORES = { abierto: '#ef4444', parcial: '#f59e0b', cerrado: '#22c55e' };
const ESTADO_LABELS  = { abierto: 'Abierto', parcial: 'Parcial', cerrado: 'Cerrado / Total' };
const MESES_NOMBRES  = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

function valorPrestamoDoc(p, modo) {
  const items = p.items || [];
  if (modo === 'cantidad') return items.reduce((s, i) => s + Number(i.cantidad || 0), 0);
  return items.reduce((s, i) => s + Number(i.cantidad || 0) * Number(i.precio_unitario || 0), 0);
}

function formatearValorDash(v, modo) {
  if (modo === 'cantidad') return `${Math.round(v).toLocaleString('es-CO')} u.`;
  return v.toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
}

// Barra horizontal con 3 segmentos (abierto/parcial/cerrado) proporcional al total
function BarraTresEstados({ label, valores, max, modo }) {
  const total = valores.abierto + valores.parcial + valores.cerrado;
  if (total <= 0 && max <= 0) return null;
  const pct = (v) => (max > 0 ? (v / max) * 100 : 0);
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
        <span style={{ fontWeight: 500 }}>{label}</span>
        <span style={{ color: 'var(--t-text-muted)' }}>{formatearValorDash(total, modo)}</span>
      </div>
      <div style={{ display: 'flex', height: 16, borderRadius: 4, overflow: 'hidden', background: 'rgba(128,128,128,0.15)' }}>
        {(['abierto', 'parcial', 'cerrado']).map(k => valores[k] > 0 && (
          <div key={k} title={`${ESTADO_LABELS[k]}: ${formatearValorDash(valores[k], modo)}`}
               style={{ width: `${pct(valores[k])}%`, background: ESTADO_COLORES[k] }} />
        ))}
      </div>
    </div>
  );
}

function PanelDashboard({ titulo, filas, modo }) {
  const max = Math.max(1, ...filas.map(f => f.abierto + f.parcial + f.cerrado));
  const cardStyle = {
    background: 'var(--t-bg-card)', border: '1px solid var(--t-border)', borderRadius: 10,
    padding: '14px 16px',
  };
  return (
    <div style={{ ...cardStyle, cursor: 'default' }}>
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12 }}>{titulo}</div>
      {filas.length === 0 && <div style={{ fontSize: 12, color: 'var(--t-text-muted)' }}>Sin datos para este filtro.</div>}
      {filas.map(f => (
        <BarraTresEstados key={f.label} label={f.label} valores={f} max={max} modo={modo} />
      ))}
    </div>
  );
}

function DashboardPrestamosInteractivo({ prestamos, devoluciones, cruces, clinicas }) {
  const [tipoDoc,      setTipoDoc]      = useState('egreso');
  const [filtroClinica,setFiltroClinica]= useState('todas');
  const [filtroAnio,   setFiltroAnio]   = useState('todos');
  const [filtroEstado, setFiltroEstado] = useState('todos');
  const [modo,         setModo]         = useState('valor');
  // seccion activa: 'prestamos' | 'devoluciones' | 'eficiencia' | 'tendencia' | 'antiguedad' | 'productos'
  const [seccion, setSeccion] = useState('prestamos');

  // ── Datos de préstamos filtrados ──────────────────────────────────
  const porTipo = useMemo(() => (prestamos || []).filter(p => p.tipo === tipoDoc), [prestamos, tipoDoc]);

  const anios = useMemo(() => {
    const set = new Set(porTipo.map(p => String(new Date(p.fecha).getFullYear())));
    return Array.from(set).sort((a, b) => b - a);
  }, [porTipo]);

  const clinicasDelTipo = useMemo(() => {
    const set = new Set(porTipo.map(p => p.clinica_nombre || 'Sin clínica'));
    return Array.from(set).sort();
  }, [porTipo]);

  const filtrados = useMemo(() => porTipo.filter(p =>
    (filtroClinica === 'todas' || p.clinica_nombre === filtroClinica) &&
    (filtroAnio   === 'todos' || String(new Date(p.fecha).getFullYear()) === filtroAnio) &&
    (filtroEstado === 'todos' || p.estado === filtroEstado)
  ), [porTipo, filtroClinica, filtroAnio, filtroEstado]);

  // ── Devoluciones del tipo correspondiente ─────────────────────────
  // IDP = devoluciones de lo que prestamos (egreso → IDP)
  // ED  = devoluciones de lo que nos prestaron (ingreso → ED)
  // Ojo: los documentos IDP/ED NO viven en la tabla vieja "devoluciones" (esa
  // corresponde al flujo directo antiguo); son filas de `prestamos` con
  // tipo 'devolucion_ingreso' / 'devolucion_egreso', igual que las usa TabCruces.
  const tipoDevLabel   = tipoDoc === 'egreso' ? 'IDP' : 'ED';
  const tipoDevolucion = tipoDoc === 'egreso' ? 'devolucion_ingreso' : 'devolucion_egreso';
  const devsFiltradas = useMemo(() => {
    return (prestamos || []).filter(d => {
      const matchTipo    = d.tipo === tipoDevolucion;
      const matchClinica = filtroClinica === 'todas' || d.clinica_nombre === filtroClinica;
      const matchAnio    = filtroAnio   === 'todos'  || String(new Date(d.fecha).getFullYear()) === filtroAnio;
      return matchTipo && matchClinica && matchAnio;
    });
  }, [prestamos, tipoDevolucion, filtroClinica, filtroAnio]);

  function valorDoc(doc) {
    const items = doc.items || [];
    if (modo === 'cantidad') return items.reduce((s, i) => s + Number(i.cantidad || 0), 0);
    return items.reduce((s, i) => s + Number(i.cantidad || 0) * Number(i.precio_unitario || 0), 0);
  }

  function agrupar(lista, claveFn, valorFn) {
    const mapa = {};
    lista.forEach(p => {
      const key = claveFn(p);
      if (!key) return;
      if (!mapa[key]) mapa[key] = { label: key, abierto: 0, parcial: 0, cerrado: 0 };
      const v = (valorFn || valorDoc)(p);
      mapa[key][p.estado || 'cerrado'] = (mapa[key][p.estado || 'cerrado'] || 0) + v;
    });
    return Object.values(mapa).sort((a, b) => (b.abierto + b.parcial + b.cerrado) - (a.abierto + a.parcial + a.cerrado));
  }

  // ── Préstamos: agrupaciones ───────────────────────────────────────
  const porTercero = useMemo(() => agrupar(filtrados, p => p.clinica_nombre || 'Sin clínica'), [filtrados, modo]);
  const porAnio    = useMemo(() => agrupar(filtrados, p => String(new Date(p.fecha).getFullYear())).sort((a,b) => a.label.localeCompare(b.label)), [filtrados, modo]);
  const porMes     = useMemo(() => {
    const filas = agrupar(filtrados, p => {
      const d = new Date(p.fecha);
      return filtroAnio === 'todos' ? MESES_NOMBRES[d.getMonth()] : `${MESES_NOMBRES[d.getMonth()]} ${d.getFullYear()}`;
    });
    return filas.sort((a, b) => MESES_NOMBRES.findIndex(m => a.label.startsWith(m)) - MESES_NOMBRES.findIndex(m => b.label.startsWith(m)));
  }, [filtrados, modo, filtroAnio]);
  const porBodega  = useMemo(() => agrupar(filtrados, p => p.bodega_nombre || p.bodega_codigo || 'Sin bodega'), [filtrados, modo]);

  const totales = useMemo(() => {
    const t = { abierto: 0, parcial: 0, cerrado: 0 };
    filtrados.forEach(p => { t[p.estado] = (t[p.estado] || 0) + valorDoc(p); });
    return t;
  }, [filtrados, modo]);
  const totalGeneral = totales.abierto + totales.parcial + totales.cerrado;

  // ── Devoluciones: agrupaciones ────────────────────────────────────
  const devsPorClinica = useMemo(() => {
    const mapa = {};
    devsFiltradas.forEach(d => {
      const key = d.clinica_nombre || 'Sin clínica';
      if (!mapa[key]) mapa[key] = { label: key, abierto: 0, parcial: 0, cerrado: 0 };
      const v = valorDoc(d);
      mapa[key]['cerrado'] = (mapa[key]['cerrado'] || 0) + v; // devoluciones son siempre cerradas
    });
    return Object.values(mapa).sort((a, b) => b.cerrado - a.cerrado);
  }, [devsFiltradas, modo]);

  const devsPorAnio = useMemo(() => {
    const mapa = {};
    devsFiltradas.forEach(d => {
      const key = String(new Date(d.fecha).getFullYear());
      if (!mapa[key]) mapa[key] = { label: key, abierto: 0, parcial: 0, cerrado: 0 };
      mapa[key]['cerrado'] = (mapa[key]['cerrado'] || 0) + valorDoc(d);
    });
    return Object.values(mapa).sort((a, b) => a.label.localeCompare(b.label));
  }, [devsFiltradas, modo]);

  // ── Eficiencia por clínica ────────────────────────────────────────
  const eficienciaPorClinica = useMemo(() => {
    const mapa = {};
    // Valor total prestado por clínica
    porTipo.forEach(p => {
      const k = p.clinica_nombre || 'Sin clínica';
      if (!mapa[k]) mapa[k] = { label: k, prestado: 0, devuelto: 0 };
      mapa[k].prestado += valorPrestamoDoc(p, modo);
    });
    // Valor total devuelto por clínica (documentos IDP/ED, que son filas de `prestamos`)
    (prestamos || []).filter(d => d.tipo === tipoDevolucion).forEach(d => {
      const k = d.clinica_nombre || 'Sin clínica';
      if (!mapa[k]) mapa[k] = { label: k, prestado: 0, devuelto: 0 };
      mapa[k].devuelto += valorDoc(d);
    });
    return Object.values(mapa)
      .filter(e => e.prestado > 0)
      .sort((a, b) => b.prestado - a.prestado);
  }, [porTipo, prestamos, tipoDevolucion, modo]);

  // ── Tendencia mensual préstamos vs devoluciones ───────────────────
  const tendenciaMensual = useMemo(() => {
    const mapa = {};
    const addMes = (fecha, tipo, v) => {
      const d = new Date(fecha);
      if (isNaN(d)) return;
      const k = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      if (!mapa[k]) mapa[k] = { label: k, prestamos: 0, devoluciones: 0 };
      mapa[k][tipo] += v;
    };
    filtrados.forEach(p => addMes(p.fecha, 'prestamos', valorDoc(p)));
    devsFiltradas.forEach(d => addMes(d.fecha, 'devoluciones', valorDoc(d)));
    return Object.values(mapa).sort((a, b) => a.label.localeCompare(b.label));
  }, [filtrados, devsFiltradas, modo]);

  function valorPendienteDoc(p) {
    const pendientes = itemsPendientesDe(p, devoluciones, cruces);
    if (modo === 'cantidad') return pendientes.reduce((s, i) => s + Number(i.pendiente || 0), 0);
    return pendientes.reduce((s, i) => s + Number(i.pendiente || 0) * Number(i.precio_unitario || 0), 0);
  }

  // ── Antigüedad de documentos abiertos (saldo pendiente, no el valor total del documento) ──
  const rangoAntiguedad = useMemo(() => {
    const hoy = new Date();
    const rangos = { '0-30 días': 0, '31-60 días': 0, '61-90 días': 0, '+90 días': 0 };
    filtrados.filter(p => p.estado !== 'cerrado').forEach(p => {
      const dias = Math.floor((hoy - new Date(p.fecha)) / 86400000);
      const v = valorPendienteDoc(p);
      if      (dias <= 30) rangos['0-30 días']  += v;
      else if (dias <= 60) rangos['31-60 días'] += v;
      else if (dias <= 90) rangos['61-90 días'] += v;
      else                 rangos['+90 días']   += v;
    });
    return Object.entries(rangos).map(([label, cerrado]) => ({ label, abierto: 0, parcial: 0, cerrado }));
  }, [filtrados, modo, devoluciones, cruces]);

  // ── Semáforo de antigüedad por clínica ───────────────────────────
  const semaforoPorClinica = useMemo(() => {
    const hoy = new Date();
    const mapa = {};
    filtrados.filter(p => p.estado !== 'cerrado').forEach(p => {
      const k = p.clinica_nombre || 'Sin clínica';
      const dias = Math.floor((hoy - new Date(p.fecha)) / 86400000);
      if (!mapa[k]) mapa[k] = { label: k, max: 0, count: 0, valor: 0 };
      if (dias > mapa[k].max) mapa[k].max = dias;
      mapa[k].count++;
      mapa[k].valor += valorPendienteDoc(p);
    });
    return Object.values(mapa).sort((a, b) => b.max - a.max).map(e => ({
      ...e,
      color: e.max > 90 ? '#ef4444' : e.max > 30 ? '#f59e0b' : '#22c55e',
    }));
  }, [filtrados, modo, devoluciones, cruces]);

  // ── Top productos pendientes ────────────────────────────────────────────
  // Saldo neto GLOBAL por código (igual criterio que el Kárdex por producto):
  // total prestado del código (todos los documentos del tipo EPO/IPE que
  // caen en los filtros actuales) menos total devuelto del código (todos
  // los IDP/ED que caen en esos mismos filtros) — sin depender de si cada
  // devolución quedó formalmente "cruzada" contra un préstamo puntual. Así
  // coincide en unidades y saldo total con el Kárdex, en vez de sumar el
  // pendiente documento por documento (que sobreestima cuando hay
  // devoluciones aún no cruzadas contra un préstamo específico).
  const topProductosPendientes = useMemo(() => {
    const mapa = {}; // codigo -> { codigo, nombre, prestado, devuelto, precio_unitario, fechaPrecio }

    filtrados.forEach(p => {
      (p.items || []).forEach(i => {
        const k = i.codigo || i.nombre;
        if (!k) return;
        if (!mapa[k]) mapa[k] = { codigo: i.codigo, nombre: i.nombre, prestado: 0, devuelto: 0, precio_unitario: 0, fechaPrecio: '' };
        mapa[k].prestado += Number(i.cantidad || 0);
        // Precio de referencia: el del documento de préstamo más reciente que tenga este código
        if (Number(i.precio_unitario || 0) > 0 && (!mapa[k].fechaPrecio || String(p.fecha) > mapa[k].fechaPrecio)) {
          mapa[k].precio_unitario = Number(i.precio_unitario);
          mapa[k].fechaPrecio = String(p.fecha || '');
        }
      });
    });

    devsFiltradas.forEach(d => {
      (d.items || []).forEach(i => {
        const k = i.codigo || i.nombre;
        if (!k) return;
        if (!mapa[k]) mapa[k] = { codigo: i.codigo, nombre: i.nombre, prestado: 0, devuelto: 0, precio_unitario: 0, fechaPrecio: '' };
        mapa[k].devuelto += Number(i.cantidad || 0);
      });
    });

    return Object.values(mapa)
      .map(m => ({
        codigo: m.codigo, nombre: m.nombre,
        cantidad: Math.max(0, m.prestado - m.devuelto),
        valor: Math.max(0, m.prestado - m.devuelto) * m.precio_unitario,
      }))
      .filter(m => m.cantidad > 0)
      .sort((a, b) => b.valor - a.valor)
      .slice(0, 15);
  }, [filtrados, devsFiltradas]);

  // ── Descargar HTML ────────────────────────────────────────────────
  function descargarHTML() {
    const datos = filtrados.map(p => ({
      documento: p.documento_contable,
      clinica:   p.clinica_nombre || 'Sin clínica',
      bodega:    p.bodega_nombre  || p.bodega_codigo || 'Sin bodega',
      estado:    p.estado,
      fecha:     p.fecha,
      valor:     valorPrestamoDoc(p, 'valor'),
      cantidad:  valorPrestamoDoc(p, 'cantidad'),
    }));
    const devDatos = devsFiltradas.map(d => ({
      documento: d.documento_contable,
      clinica:   d.clinica_nombre || 'Sin clínica',
      fecha:     d.fecha,
      valor:     (d.items || []).reduce((s, i) => s + Number(i.cantidad||0)*Number(i.precio_unitario||0), 0),
      cantidad:  (d.items || []).reduce((s, i) => s + Number(i.cantidad||0), 0),
    }));
    const tipoLabel = tipoDoc === 'egreso' ? 'EPO (préstamos que hacemos)' : 'IPE (préstamos que nos hacen)';
    const html = generarHTMLDashboardPrestamos(datos, devDatos, tipoLabel, tipoDevLabel, eficienciaPorClinica, tendenciaMensual, topProductosPendientes, modo);
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `dashboard_prestamos_${tipoDoc === 'egreso' ? 'EPO' : 'IPE'}_${new Date().toISOString().slice(0,10)}.html`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const selectStyle = { padding: '6px 10px', borderRadius: 6, border: '1px solid var(--t-border)', background: 'var(--t-bg-card)', color: 'var(--t-text-primary)', fontSize: 12 };
  const btnSecStyle = (s) => ({ ...selectStyle, cursor: 'pointer', fontWeight: seccion === s ? 700 : 400, background: seccion === s ? 'var(--t-accent)' : 'var(--t-bg-card)', color: seccion === s ? '#fff' : 'var(--t-text-primary)' });

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ fontWeight: 600, fontSize: 15 }}>📊 Dashboard interactivo de préstamos</div>
        <button onClick={descargarHTML} style={{ ...selectStyle, cursor: 'pointer', fontWeight: 500 }}>⬇ Descargar HTML</button>
      </div>

      {/* Selector tipo doc */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <button onClick={() => { setTipoDoc('egreso');  setFiltroClinica('todas'); }} style={{ ...selectStyle, cursor: 'pointer', fontWeight: tipoDoc === 'egreso'  ? 700 : 400, background: tipoDoc === 'egreso'  ? 'var(--t-accent)' : 'var(--t-bg-card)', color: tipoDoc === 'egreso'  ? '#fff' : 'var(--t-text-primary)' }}>EPO — préstamos que hacemos</button>
        <button onClick={() => { setTipoDoc('ingreso'); setFiltroClinica('todas'); }} style={{ ...selectStyle, cursor: 'pointer', fontWeight: tipoDoc === 'ingreso' ? 700 : 400, background: tipoDoc === 'ingreso' ? 'var(--t-accent)' : 'var(--t-bg-card)', color: tipoDoc === 'ingreso' ? '#fff' : 'var(--t-text-primary)' }}>IPE — préstamos que nos hacen</button>
      </div>

      {/* Filtros */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        <select value={filtroClinica} onChange={e => setFiltroClinica(e.target.value)} style={selectStyle}>
          <option value="todas">Todas las clínicas</option>
          {clinicasDelTipo.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={filtroAnio} onChange={e => setFiltroAnio(e.target.value)} style={selectStyle}>
          <option value="todos">Todos los años</option>
          {anios.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <select value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)} style={selectStyle}>
          <option value="todos">Todos los estados</option>
          <option value="abierto">Abierto</option>
          <option value="parcial">Parcial</option>
          <option value="cerrado">Cerrado / Total</option>
        </select>
        <div style={{ display: 'flex', gap: 4 }}>
          <button onClick={() => setModo('valor')}    style={{ ...selectStyle, cursor: 'pointer', fontWeight: modo === 'valor'    ? 700 : 400 }}>$ Valor</button>
          <button onClick={() => setModo('cantidad')} style={{ ...selectStyle, cursor: 'pointer', fontWeight: modo === 'cantidad' ? 700 : 400 }}>Cantidad</button>
        </div>
      </div>

      {/* Totales resumen */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 10, marginBottom: 18 }}>
        {(['abierto','parcial','cerrado']).map(k => (
          <div key={k} style={{ background: 'var(--t-bg-card)', border: `1px solid ${ESTADO_COLORES[k]}44`, borderRadius: 8, padding: '10px 12px' }}>
            <div style={{ fontSize: 11, color: ESTADO_COLORES[k], fontWeight: 600, marginBottom: 4 }}>{ESTADO_LABELS[k]}</div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{formatearValorDash(totales[k] || 0, modo)}</div>
          </div>
        ))}
        <div style={{ background: 'var(--t-bg-card)', border: '1px solid var(--t-border)', borderRadius: 8, padding: '10px 12px' }}>
          <div style={{ fontSize: 11, color: 'var(--t-text-muted)', fontWeight: 600, marginBottom: 4 }}>Total {tipoDevLabel} devuelto</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#22c55e' }}>
            {formatearValorDash(devsFiltradas.reduce((s, d) => s + valorDoc(d), 0), modo)}
          </div>
        </div>
        <div style={{ background: 'var(--t-bg-card)', border: '1px solid var(--t-border)', borderRadius: 8, padding: '10px 12px' }}>
          <div style={{ fontSize: 11, color: 'var(--t-text-muted)', fontWeight: 600, marginBottom: 4 }}>Documentos</div>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{filtrados.length} / {devsFiltradas.length} {tipoDevLabel}</div>
        </div>
      </div>

      {/* Navegación de secciones */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16, borderBottom: '1px solid var(--t-border)', paddingBottom: 10 }}>
        <button onClick={() => setSeccion('prestamos')}   style={btnSecStyle('prestamos')}>📋 Préstamos</button>
        <button onClick={() => setSeccion('devoluciones')} style={btnSecStyle('devoluciones')}>↩ Devoluciones ({tipoDevLabel})</button>
        <button onClick={() => setSeccion('eficiencia')}  style={btnSecStyle('eficiencia')}>📈 Eficiencia por clínica</button>
        <button onClick={() => setSeccion('tendencia')}   style={btnSecStyle('tendencia')}>📉 Tendencia mensual</button>
        <button onClick={() => setSeccion('antiguedad')}  style={btnSecStyle('antiguedad')}>⏰ Antigüedad</button>
        <button onClick={() => setSeccion('productos')}   style={btnSecStyle('productos')}>💊 Top productos pendientes</button>
      </div>

      {/* ── SECCIÓN: PRÉSTAMOS ── */}
      {seccion === 'prestamos' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
          <PanelDashboard titulo="Por tercero (clínica)" filas={porTercero} modo={modo} />
          <PanelDashboard titulo="Por bodega"            filas={porBodega}  modo={modo} />
          <PanelDashboard titulo="Por año"               filas={porAnio}    modo={modo} />
          <PanelDashboard titulo="Por mes"               filas={porMes}     modo={modo} />
        </div>
      )}

      {/* ── SECCIÓN: DEVOLUCIONES ── */}
      {seccion === 'devoluciones' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
          <PanelDashboard titulo={`${tipoDevLabel} por clínica`} filas={devsPorClinica} modo={modo} />
          <PanelDashboard titulo={`${tipoDevLabel} por año`}     filas={devsPorAnio}    modo={modo} />
        </div>
      )}

      {/* ── SECCIÓN: EFICIENCIA ── */}
      {seccion === 'eficiencia' && (
        <div style={{ background: 'var(--t-bg-card)', border: '1px solid var(--t-border)', borderRadius: 10, padding: '14px 16px' }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>Eficiencia de devolución por clínica</div>
          <div style={{ fontSize: 11, color: 'var(--t-text-muted)', marginBottom: 14 }}>
            Verde = devolvió {'>'} 80% · Amarillo = 40-80% · Rojo = {'<'} 40%
          </div>
          {eficienciaPorClinica.length === 0 && <div style={{ fontSize: 12, color: 'var(--t-text-muted)' }}>Sin datos.</div>}
          {eficienciaPorClinica.map(e => {
            const pct = e.prestado > 0 ? Math.min(100, (e.devuelto / e.prestado) * 100) : 0;
            const color = pct >= 80 ? '#22c55e' : pct >= 40 ? '#f59e0b' : '#ef4444';
            return (
              <div key={e.label} style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                  <span style={{ fontWeight: 500 }}>{e.label}</span>
                  <span style={{ color: 'var(--t-text-muted)' }}>
                    {Math.round(pct)}% devuelto · Prestado: {formatearValorDash(e.prestado, modo)} · Devuelto: {formatearValorDash(e.devuelto, modo)}
                  </span>
                </div>
                <div style={{ height: 14, borderRadius: 4, background: 'rgba(128,128,128,0.15)', overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 4 }} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── SECCIÓN: TENDENCIA ── */}
      {seccion === 'tendencia' && (
        <div style={{ background: 'var(--t-bg-card)', border: '1px solid var(--t-border)', borderRadius: 10, padding: '14px 16px' }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>Tendencia mensual — préstamos vs devoluciones</div>
          <div style={{ fontSize: 11, color: 'var(--t-text-muted)', marginBottom: 14 }}>
            🔴 Préstamos &nbsp; 🟢 Devoluciones ({tipoDevLabel})
          </div>
          {tendenciaMensual.length === 0 && <div style={{ fontSize: 12, color: 'var(--t-text-muted)' }}>Sin datos.</div>}
          {tendenciaMensual.map(m => {
            const maxVal = Math.max(1, ...tendenciaMensual.map(x => Math.max(x.prestamos, x.devoluciones)));
            return (
              <div key={m.label} style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 4 }}>{m.label}</div>
                <div style={{ marginBottom: 3 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--t-text-muted)', marginBottom: 2 }}>
                    <span>Préstamos</span><span>{formatearValorDash(m.prestamos, modo)}</span>
                  </div>
                  <div style={{ height: 10, borderRadius: 3, background: 'rgba(128,128,128,0.15)', overflow: 'hidden' }}>
                    <div style={{ width: `${(m.prestamos/maxVal)*100}%`, height: '100%', background: '#ef4444', borderRadius: 3 }} />
                  </div>
                </div>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--t-text-muted)', marginBottom: 2 }}>
                    <span>Devoluciones ({tipoDevLabel})</span><span>{formatearValorDash(m.devoluciones, modo)}</span>
                  </div>
                  <div style={{ height: 10, borderRadius: 3, background: 'rgba(128,128,128,0.15)', overflow: 'hidden' }}>
                    <div style={{ width: `${(m.devoluciones/maxVal)*100}%`, height: '100%', background: '#22c55e', borderRadius: 3 }} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── SECCIÓN: ANTIGÜEDAD ── */}
      {seccion === 'antiguedad' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
          <PanelDashboard titulo="Valor pendiente por antigüedad" filas={rangoAntiguedad} modo={modo} />
          <div style={{ background: 'var(--t-bg-card)', border: '1px solid var(--t-border)', borderRadius: 10, padding: '14px 16px' }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>Semáforo por clínica</div>
            <div style={{ fontSize: 11, color: 'var(--t-text-muted)', marginBottom: 12 }}>
              🔴 {'>'} 90 días · 🟡 31-90 días · 🟢 0-30 días (doc. más antiguo abierto)
            </div>
            {semaforoPorClinica.length === 0 && <div style={{ fontSize: 12, color: 'var(--t-text-muted)' }}>Sin documentos abiertos.</div>}
            {semaforoPorClinica.map(e => (
              <div key={e.label} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, padding: '8px 10px', background: 'var(--t-bg-inner)', borderRadius: 7, border: `1px solid ${e.color}44` }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: e.color, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--t-text-muted)' }}>{e.count} doc. abiertos · más antiguo: {e.max} días · {formatearValorDash(e.valor, modo)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── SECCIÓN: TOP PRODUCTOS ── */}
      {seccion === 'productos' && (
        <div style={{ background: 'var(--t-bg-card)', border: '1px solid var(--t-border)', borderRadius: 10, padding: '14px 16px' }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>Top 15 productos con mayor saldo pendiente</div>
          <div style={{ fontSize: 11, color: 'var(--t-text-muted)', marginBottom: 14 }}>Solo documentos abiertos y parciales</div>
          {topProductosPendientes.length === 0 && <div style={{ fontSize: 12, color: 'var(--t-text-muted)' }}>Sin productos pendientes.</div>}
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                {['#','Código','Nombre','Cantidad','Valor pendiente'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--t-border)', color: 'var(--t-text-muted)', fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {topProductosPendientes.map((p, i) => {
                const maxVal = topProductosPendientes[0]?.valor || 1;
                return (
                  <tr key={p.codigo || i}>
                    <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--t-border)', color: 'var(--t-text-muted)' }}>{i+1}</td>
                    <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--t-border)', fontFamily: 'monospace', fontSize: 11 }}>{p.codigo}</td>
                    <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--t-border)' }}>
                      <div>{p.nombre}</div>
                      <div style={{ height: 6, borderRadius: 3, background: 'rgba(128,128,128,0.15)', marginTop: 3, overflow: 'hidden' }}>
                        <div style={{ width: `${(p.valor/maxVal)*100}%`, height: '100%', background: '#ef4444', borderRadius: 3 }} />
                      </div>
                    </td>
                    <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--t-border)', fontWeight: 500 }}>{p.cantidad.toLocaleString('es-CO')}</td>
                    <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--t-border)', fontWeight: 700, color: '#ef4444' }}>{formatearValorDash(p.valor, 'valor')}</td>
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

// ─── Reporte préstamo por préstamo (devoluciones cruzadas, pagos y pendientes) ──

function construirDetallePrestamo(prestamo, cruces) {
  const crucesDe = (cruces || []).filter(c => c.prestamo_id === prestamo.id);

  const devolucionesDoc = crucesDe.map(c => ({
    id: c.devolucion_id,
    documento: c.devolucion_doc,
    estado_devolucion: c.estado_devolucion,
    grupo_numero: c.grupo_numero || '',   // número de cruce CRU-xxxxx
    soporte_url: c.devolucion_soporte_url,
    items: c.devolucion_items || [],
  }));

  // Deduplicar por documento (una devolución puede tener varios cruces parciales)
  const pagadoPorCodigo = {};
  devolucionesDoc.forEach(d => {
    (d.items || []).forEach(i => {
      pagadoPorCodigo[i.codigo] = (pagadoPorCodigo[i.codigo] || 0) + Number(i.cantidad);
    });
  });

  // Mapear qué cruce y devolución cubrió cada producto (para el Excel)
  const crucePorCodigo = {};   // codigo -> { documento_devolucion, grupo_numero }
  devolucionesDoc.forEach(d => {
    (d.items || []).forEach(i => {
      if (!crucePorCodigo[i.codigo]) {
        crucePorCodigo[i.codigo] = { documento_devolucion: d.documento, grupo_numero: d.grupo_numero };
      }
    });
  });

  const productosPagados = [];
  const productosPendientes = [];
  (prestamo.items || []).forEach(i => {
    const disponible = pagadoPorCodigo[i.codigo] || 0;
    const pagado = Math.min(Number(i.cantidad), disponible);
    const pendiente = Math.max(0, Number(i.cantidad) - pagado);
    const info = crucePorCodigo[i.codigo] || {};
    if (pagado > 0) {
      productosPagados.push({
        codigo: i.codigo, nombre: i.nombre, cantidad: pagado, valor: pagado * Number(i.precio_unitario || 0),
        documento_devolucion: info.documento_devolucion || '',
        numero_cruce: info.grupo_numero || '',
      });
    }
    if (pendiente > 0) {
      productosPendientes.push({ codigo: i.codigo, nombre: i.nombre, cantidad: pendiente, valor: pendiente * Number(i.precio_unitario || 0) });
    }
  });

  // Documentos de devolución únicos, para mostrar en el encabezado
  const documentosDevolucion = Array.from(new Set(devolucionesDoc.map(d => d.documento).filter(Boolean)));

  return { devolucionesDoc, documentosDevolucion, productosPagados, productosPendientes };
}

function ModalReportePorPrestamo({ prestamos, cruces, clinicas, onClose }) {
  const [tipo, setTipo] = useState('todos');       // todos | egreso | ingreso
  const [clinica, setClinica] = useState('');
  const [estado, setEstado] = useState('todos');    // todos | abierto | parcial | cerrado
  const [texto, setTexto] = useState('');
  const [expandido, setExpandido] = useState(null);

  const inputS = { padding: '7px 10px', border: '1px solid var(--t-border)', borderRadius: 7, fontSize: 13, background: 'var(--t-bg-inner)', color: 'var(--t-text-primary)' };

  const base = (prestamos || []).filter(p => ['ingreso', 'egreso'].includes(p.tipo));

  const filtrados = base.filter(p => {
    if (tipo !== 'todos' && p.tipo !== tipo) return false;
    if (estado !== 'todos' && p.estado !== estado) return false;
    if (clinica && p.clinica_nombre !== clinica) return false;
    if (texto) {
      const t = texto.toLowerCase();
      const enDoc = (p.documento_contable || '').toLowerCase().includes(t);
      const enClinica = (p.clinica_nombre || '').toLowerCase().includes(t);
      const enItems = (p.items || []).some(i => (i.codigo || '').toLowerCase().includes(t) || (i.nombre || '').toLowerCase().includes(t));
      if (!enDoc && !enClinica && !enItems) return false;
    }
    return true;
  }).sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')));

  const clinicasDisponibles = Array.from(new Set(base.map(p => p.clinica_nombre).filter(Boolean))).sort();

  function exportarExcel() {
    const filas = [];
    filtrados.forEach(p => {
      const det = construirDetallePrestamo(p, cruces);
      const devolucionesTxt = det.documentosDevolucion.join(', ') || '—';

      const filaBase = {
        Documento: p.documento_contable,
        Tipo: p.tipo === 'egreso' ? 'EPO' : 'IPE',
        Clínica: p.clinica_nombre,
        Fecha: fmtFecha(p.fecha),
        Estado: p.estado,
        Devoluciones: devolucionesTxt,
      };

      if (det.productosPagados.length === 0 && det.productosPendientes.length === 0) {
        filas.push({ ...filaBase, Situación: 'Sin movimiento', Producto: '', Código: '', Cantidad: '', Valor: '', 'Doc. devolución': '', 'N° cruce': '' });
        return;
      }
      det.productosPagados.forEach(prod => {
        filas.push({ ...filaBase, Situación: 'Pagado', Producto: prod.nombre, Código: prod.codigo, Cantidad: prod.cantidad, Valor: prod.valor, 'Doc. devolución': prod.documento_devolucion || '', 'N° cruce': prod.numero_cruce || '' });
      });
      det.productosPendientes.forEach(prod => {
        filas.push({ ...filaBase, Situación: 'Pendiente', Producto: prod.nombre, Código: prod.codigo, Cantidad: prod.cantidad, Valor: prod.valor, 'Doc. devolución': '', 'N° cruce': '' });
      });
    });

    const ws = XLSX.utils.json_to_sheet(filas);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Prestamo por prestamo');
    XLSX.writeFile(wb, `prestamo_por_prestamo_${new Date().toISOString().substring(0, 10)}.xlsx`);
  }

  return (
    <Modal onClose={onClose} titulo="Préstamo por préstamo — devoluciones, pagos y pendientes">
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 11, color: 'var(--t-text-muted)', marginBottom: 3 }}>Tipo</div>
          <select value={tipo} onChange={e => setTipo(e.target.value)} style={inputS}>
            <option value="todos">Todos</option>
            <option value="egreso">EPO (dados)</option>
            <option value="ingreso">IPE (recibidos)</option>
          </select>
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--t-text-muted)', marginBottom: 3 }}>Clínica</div>
          <select value={clinica} onChange={e => setClinica(e.target.value)} style={inputS}>
            <option value="">Todas</option>
            {clinicasDisponibles.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--t-text-muted)', marginBottom: 3 }}>Estado</div>
          <select value={estado} onChange={e => setEstado(e.target.value)} style={inputS}>
            <option value="todos">Todos</option>
            <option value="abierto">Abierto</option>
            <option value="parcial">Parcial</option>
            <option value="cerrado">Cerrado</option>
          </select>
        </div>
        <div style={{ flex: 1, minWidth: 160 }}>
          <div style={{ fontSize: 11, color: 'var(--t-text-muted)', marginBottom: 3 }}>Buscar</div>
          <input value={texto} onChange={e => setTexto(e.target.value)} placeholder="Documento, clínica, producto o código…" style={{ ...inputS, width: '100%', boxSizing: 'border-box' }} />
        </div>
        <button onClick={exportarExcel}
          style={{ padding: '8px 14px', border: '1px solid var(--t-border)', borderRadius: 7, fontSize: 13, cursor: 'pointer', background: 'var(--t-bg-inner)', color: 'var(--t-text-primary)' }}>
          ↓ Exportar a Excel
        </button>
      </div>

      <div style={{ fontSize: 12, color: 'var(--t-text-muted)', marginBottom: 10 }}>{filtrados.length} préstamo(s)</div>

      {filtrados.length === 0 && (
        <div style={{ fontSize: 12, color: 'var(--t-text-muted)', padding: 20, textAlign: 'center' }}>Sin resultados para el filtro seleccionado</div>
      )}

      {filtrados.map(p => {
        const det = construirDetallePrestamo(p, cruces);
        const abierto = expandido === p.id;
        const badgeTipo = p.tipo === 'egreso' ? 'EPO' : 'IPE';
        const badgeDevol = p.tipo === 'egreso' ? 'IDP' : 'ED';
        return (
          <div key={p.id} style={{ border: '1px solid var(--t-border)', borderRadius: 8, marginBottom: 8, overflow: 'hidden' }}>
            <div onClick={() => setExpandido(abierto ? null : p.id)}
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', background: 'var(--t-bg-inner)', cursor: 'pointer' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 10, background: p.tipo === 'egreso' ? '#ef4444' : '#3b82f6', color: '#fff', fontWeight: 600 }}>{badgeTipo}</span>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{p.documento_contable}</span>
                <span style={{ fontSize: 12, color: 'var(--t-text-muted)' }}>{p.clinica_nombre} · {fmtFecha(p.fecha)}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: p.estado === 'cerrado' ? '#22c55e' : p.estado === 'parcial' ? '#f59e0b' : 'var(--t-text-muted)' }}>{p.estado}</span>
                <span style={{ fontSize: 12 }}>{abierto ? '▾' : '▸'}</span>
              </div>
            </div>

            {abierto && (
              <div style={{ padding: '10px 12px' }}>
                <div style={{ fontSize: 12, marginBottom: 10 }}>
                  <span style={{ color: 'var(--t-text-muted)' }}>Devoluciones ({badgeDevol}) cruzadas: </span>
                  {det.documentosDevolucion.length > 0
                    ? det.documentosDevolucion.map((d, i) => (
                        <span key={d} style={{ fontWeight: 600 }}>{d}{i < det.documentosDevolucion.length - 1 ? ', ' : ''}</span>
                      ))
                    : <span style={{ color: 'var(--t-text-muted)' }}>Sin devoluciones cruzadas</span>}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, color: '#22c55e' }}>✓ Productos pagados</div>
                    {det.productosPagados.length === 0 && <div style={{ fontSize: 11, color: 'var(--t-text-muted)' }}>Ninguno</div>}
                    {det.productosPagados.length > 0 && (
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                        <thead>
                          <tr style={{ color: 'var(--t-text-muted)', textAlign: 'left' }}>
                            <th style={{ padding: '3px 6px', fontWeight: 500 }}>Producto</th>
                            <th style={{ padding: '3px 6px', fontWeight: 500 }}>Código</th>
                            <th style={{ padding: '3px 6px', fontWeight: 500, textAlign: 'right' }}>Cant.</th>
                          </tr>
                        </thead>
                        <tbody>
                          {det.productosPagados.map((prod, i) => (
                            <tr key={i} style={{ borderTop: '1px solid var(--t-border)' }}>
                              <td style={{ padding: '3px 6px' }}>{prod.nombre}</td>
                              <td style={{ padding: '3px 6px', color: 'var(--t-text-muted)' }}>{prod.codigo}</td>
                              <td style={{ padding: '3px 6px', textAlign: 'right' }}>{prod.cantidad}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, color: '#f59e0b' }}>⏳ Productos pendientes</div>
                    {det.productosPendientes.length === 0 && <div style={{ fontSize: 11, color: 'var(--t-text-muted)' }}>Ninguno</div>}
                    {det.productosPendientes.length > 0 && (
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                        <thead>
                          <tr style={{ color: 'var(--t-text-muted)', textAlign: 'left' }}>
                            <th style={{ padding: '3px 6px', fontWeight: 500 }}>Producto</th>
                            <th style={{ padding: '3px 6px', fontWeight: 500 }}>Código</th>
                            <th style={{ padding: '3px 6px', fontWeight: 500, textAlign: 'right' }}>Cant.</th>
                          </tr>
                        </thead>
                        <tbody>
                          {det.productosPendientes.map((prod, i) => (
                            <tr key={i} style={{ borderTop: '1px solid var(--t-border)' }}>
                              <td style={{ padding: '3px 6px' }}>{prod.nombre}</td>
                              <td style={{ padding: '3px 6px', color: 'var(--t-text-muted)' }}>{prod.codigo}</td>
                              <td style={{ padding: '3px 6px', textAlign: 'right' }}>{prod.cantidad}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </Modal>
  );
}

// ─── Reporte de cruces en orden cronológico, con saldo descontado por préstamo ─

// Reporte de cruces en orden cronológico: recorre TODOS los cruces en el
// orden global en que se registraron (fecha del cruce) y va descontando el
// saldo pendiente de cada préstamo a medida que avanza, para que cada fila
// muestre cuánto quedó pendiente DESPUÉS de ese cruce puntual.
//
// Una misma devolución puede cruzarse contra varios préstamos distintos
// (ej. IDP5 repartida entre EPO1 y EPO2). El backend no guarda cuánta
// cantidad de cada producto se le asignó a cada préstamo en particular —
// cada cruce trae SIEMPRE el total de ítems del documento de devolución
// completo. Por eso el "sobrante" no puede calcularse cruce por cruce de
// forma aislada (eso duplicaría el mismo sobrante una vez por cada préstamo
// que comparte la devolución): se lleva un pool COMPARTIDO por devolución +
// código de producto, que se va descontando a medida que cada préstamo
// cruzado con esa devolución reclama su parte. Lo que sobra en el pool
// después de procesar todos los cruces de esa devolución es el sobrante
// real, y se anota una sola vez (en la última fila cronológica que tocó esa
// devolución+código), no una vez por préstamo.
function construirReporteCrucesCronologico(prestamos, cruces) {
  const base = (prestamos || []).filter(p => ['ingreso', 'egreso'].includes(p.tipo));
  const basePorId = new Map(base.map(p => [p.id, p]));

  // Todos los cruces relevantes (cuyo préstamo cae dentro del set filtrado),
  // en orden cronológico GLOBAL — no agrupados por préstamo — para que el
  // pool compartido de cada devolución se reparta en el orden real en que
  // se fue cruzando contra uno u otro préstamo.
  const crucesRelevantes = (cruces || [])
    .filter(c => basePorId.has(c.prestamo_id))
    .slice()
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  if (crucesRelevantes.length === 0) return [];

  // Estado por préstamo (saldo restante por código, precios, totales) — se
  // inicializa la primera vez que se toca ese préstamo.
  const estadoPrestamo = new Map();
  function getEstadoPrestamo(p) {
    if (!estadoPrestamo.has(p.id)) {
      const saldoPorCodigo = {}, precioPorCodigo = {}, nombrePorCodigo = {}, cantidadTotalPorCodigo = {}, valorTotalPorCodigo = {};
      (p.items || []).forEach(i => {
        saldoPorCodigo[i.codigo] = Number(i.cantidad);
        precioPorCodigo[i.codigo] = Number(i.precio_unitario || 0);
        nombrePorCodigo[i.codigo] = i.nombre;
        // Total prestado de ESTE producto puntual (no del documento completo).
        cantidadTotalPorCodigo[i.codigo] = Number(i.cantidad);
        valorTotalPorCodigo[i.codigo] = Number(i.cantidad) * Number(i.precio_unitario || 0);
      });
      estadoPrestamo.set(p.id, { saldoPorCodigo, precioPorCodigo, nombrePorCodigo, cantidadTotalPorCodigo, valorTotalPorCodigo });
    }
    return estadoPrestamo.get(p.id);
  }

  // Pool compartido por devolución + código: cuánto de esa devolución queda
  // sin aplicar a NINGÚN préstamo todavía. Se inicializa una sola vez con la
  // cantidad total del documento (es la misma para todos los cruces que
  // referencian esa devolución, ya que el backend siempre trae el total).
  const poolDevolucion = new Map();
  function getPoolDevolucion(c) {
    if (!poolDevolucion.has(c.devolucion_id)) {
      const pool = {};
      (c.devolucion_items || []).forEach(it => {
        pool[it.codigo] = (pool[it.codigo] || 0) + Number(it.cantidad);
      });
      poolDevolucion.set(c.devolucion_id, pool);
    }
    return poolDevolucion.get(c.devolucion_id);
  }

  const filas = [];
  // Última fila (por índice) que tocó cada combinación devolución+código —
  // para anotarle ahí el sobrante final una vez se sepa cuánto quedó sin
  // aplicar tras procesar TODOS los cruces de esa devolución.
  const ultimaFilaPorDevolucionCodigo = new Map();

  crucesRelevantes.forEach(c => {
    const p = basePorId.get(c.prestamo_id);
    const est = getEstadoPrestamo(p);
    const pool = getPoolDevolucion(c);
    const itemsDevueltos = c.devolucion_items || [];

    const tipoLabel = p.tipo === 'egreso' ? 'EPO' : 'IPE';
    const tipoLabelDevol = p.tipo === 'egreso' ? 'IDP' : 'ED';

    const detalleProductos = [];
    const filasProducto = [];

    itemsDevueltos.forEach(it => {
      const codigo = it.codigo;
      const perteneceAlPrestamo = Object.prototype.hasOwnProperty.call(est.saldoPorCodigo, codigo);
      const precio = est.precioPorCodigo[codigo] != null ? est.precioPorCodigo[codigo] : Number(it.precio_unitario || 0);

      // Lo que queda del pool compartido de esta devolución para este código,
      // topado por lo que este préstamo puntual todavía tiene pendiente.
      const poolDisponible = Math.max(pool[codigo] || 0, 0);
      const disponiblePrestamo = Math.max(est.saldoPorCodigo[codigo] || 0, 0);
      const aplicada = Math.min(poolDisponible, disponiblePrestamo);

      pool[codigo] = poolDisponible - aplicada;
      if (perteneceAlPrestamo) est.saldoPorCodigo[codigo] = disponiblePrestamo - aplicada;

      if (aplicada > 0) {
        detalleProductos.push(`${est.nombrePorCodigo[codigo] || it.nombre || codigo} (${aplicada})`);
      }

      // Producto del préstamo (EPO/IPE) que corresponde por código — sólo se
      // llena si el código de la devolución realmente existe en el préstamo.
      filasProducto.push({
        codigo_producto_prestamo: perteneceAlPrestamo ? codigo : '',
        descripcion_producto_prestamo: perteneceAlPrestamo ? (est.nombrePorCodigo[codigo] || '') : '',
        producto_devuelto: it.nombre || est.nombrePorCodigo[codigo] || codigo,
        codigo_producto_devuelto: codigo,
        cantidad_devuelta_producto: aplicada,
        valor_devuelto_producto: aplicada * precio,
        // El sobrante de este producto se completa DESPUÉS de procesar todos
        // los cruces (puede haber más de un préstamo compartiendo la misma
        // devolución) — ver el bloque de "sobrante final" más abajo.
        tiene_sobrante_producto: false,
        sobrante_cantidad_producto: 0,
        sobrante_valor_producto: 0,
        // Cantidad/valor total prestado de ESTE producto específico dentro
        // del préstamo (no del documento completo).
        cantidad_total_producto: perteneceAlPrestamo ? (est.cantidadTotalPorCodigo[codigo] || 0) : 0,
        valor_total_producto: perteneceAlPrestamo ? (est.valorTotalPorCodigo[codigo] || 0) : 0,
        // Saldo pendiente de ESTE producto puntual después de este cruce.
        saldo_pendiente_cantidad_producto: perteneceAlPrestamo ? Math.max(est.saldoPorCodigo[codigo] || 0, 0) : 0,
        saldo_pendiente_valor_producto: perteneceAlPrestamo ? Math.max(est.saldoPorCodigo[codigo] || 0, 0) * precio : 0,
        _codigo: codigo,
        _precio: precio,
      });
    });

    if (filasProducto.length === 0) {
      // Cruce sin ítems de devolución detallados (caso raro): fila vacía en
      // las columnas de producto para no perder el cruce del reporte.
      filasProducto.push({
        codigo_producto_prestamo: '', descripcion_producto_prestamo: '',
        producto_devuelto: '', codigo_producto_devuelto: '',
        cantidad_devuelta_producto: 0, valor_devuelto_producto: 0,
        tiene_sobrante_producto: false, sobrante_cantidad_producto: 0, sobrante_valor_producto: 0,
        cantidad_total_producto: 0, valor_total_producto: 0,
        saldo_pendiente_cantidad_producto: 0, saldo_pendiente_valor_producto: 0,
        _codigo: null, _precio: 0,
      });
    }

    const saldoPendienteDocCantidad = Object.values(est.saldoPorCodigo).reduce((s, v) => s + Math.max(v, 0), 0);
    const saldoPendienteDocValor = Object.entries(est.saldoPorCodigo)
      .reduce((s, [cod, v]) => s + Math.max(v, 0) * (est.precioPorCodigo[cod] || 0), 0);

    const descripcion = c.observaciones || c.grupo_observaciones
      || `Cruce ${tipoLabel} ${p.documento_contable} con ${tipoLabelDevol} ${c.devolucion_doc}`;

    // Una fila por producto cruzado (código igual entre préstamo y
    // devolución), conservando el resto de la información del cruce.
    filasProducto.forEach(fp => {
      const idx = filas.length;
      filas.push({
        documento_prestamo: p.documento_contable,
        tipo: tipoLabel,
        clinica: p.clinica_nombre || '—',
        fecha_prestamo: p.fecha,
        numero_cruce: c.grupo_numero || '',
        fecha_cruce: c.created_at,
        documento_devolucion: c.devolucion_doc,
        tipo_devolucion: tipoLabelDevol,
        estado_devolucion: c.estado_devolucion || '',
        descripcion,
        // ── 4 columnas: producto del préstamo (EPO/IPE) alineado con el
        // producto devuelto (IDP/ED) por coincidencia de código ──
        codigo_producto_prestamo: fp.codigo_producto_prestamo,
        descripcion_producto_prestamo: fp.descripcion_producto_prestamo,
        producto_devuelto: fp.producto_devuelto,
        codigo_producto_devuelto: fp.codigo_producto_devuelto,
        productos_devueltos: detalleProductos.join(', ') || '—',
        cantidad_devuelta: fp.cantidad_devuelta_producto,
        valor_devuelto: fp.valor_devuelto_producto,
        tiene_sobrante: fp.tiene_sobrante_producto,
        sobrante_cantidad: fp.sobrante_cantidad_producto,
        sobrante_valor: fp.sobrante_valor_producto,
        sobrante_detalle: '',
        // Saldo pendiente de ESTE producto puntual (no del documento
        // completo) — es lo que falta por devolver de este código
        // específico después de este cruce.
        saldo_pendiente_cantidad: fp.saldo_pendiente_cantidad_producto,
        saldo_pendiente_valor: fp.saldo_pendiente_valor_producto,
        // Se conserva aparte el saldo pendiente del documento completo
        // (todos los productos), por si sirve de referencia general.
        saldo_pendiente_documento_cantidad: saldoPendienteDocCantidad,
        saldo_pendiente_documento_valor: saldoPendienteDocValor,
        cantidad_total_prestamo: fp.cantidad_total_producto,
        valor_total_prestamo: fp.valor_total_producto,
        estado_prestamo: p.estado,
      });

      if (fp._codigo) {
        ultimaFilaPorDevolucionCodigo.set(`${c.devolucion_id}|${fp._codigo}`, { idx, precio: fp._precio, nombre: fp.producto_devuelto });
      }
    });
  });

  // ── Sobrante final por devolución+código ──────────────────────────
  // Ya se procesaron todos los cruces de todos los préstamos que comparten
  // cada devolución: lo que quede en el pool es lo que esa devolución trajo
  // de más y ningún préstamo pudo absorber. Se anota UNA sola vez, en la
  // última fila cronológica que tocó esa devolución+código — así no se
  // duplica el mismo sobrante en cada préstamo con el que se cruzó.
  poolDevolucion.forEach((porCodigo, devId) => {
    Object.entries(porCodigo).forEach(([codigo, sobrante]) => {
      if (sobrante <= 0) return;
      const ref = ultimaFilaPorDevolucionCodigo.get(`${devId}|${codigo}`);
      if (!ref) return;
      const fila = filas[ref.idx];
      fila.tiene_sobrante = true;
      fila.sobrante_cantidad = sobrante;
      fila.sobrante_valor = sobrante * ref.precio;
      fila.sobrante_detalle = `${ref.nombre} (+${sobrante})`;
    });
  });

  // Orden final: por préstamo (documento) y dentro de cada uno, cronológico
  return filas.sort((a, b) => {
    if (a.documento_prestamo !== b.documento_prestamo) return String(a.documento_prestamo).localeCompare(String(b.documento_prestamo));
    return new Date(a.fecha_cruce) - new Date(b.fecha_cruce);
  });
}

// Saldo pendiente por préstamo (para las hojas "Saldo pendiente EPO/IPE" del Excel)
function construirSaldoPorPrestamo(prestamos, cruces) {
  return (prestamos || [])
    .filter(p => ['ingreso', 'egreso'].includes(p.tipo))
    .map(p => {
      const det = construirDetallePrestamo(p, cruces);
      const cantidadTotal = (p.items || []).reduce((s, i) => s + Number(i.cantidad), 0);
      const valorTotal = (p.items || []).reduce((s, i) => s + Number(i.cantidad) * Number(i.precio_unitario || 0), 0);
      const cantidadPagada = det.productosPagados.reduce((s, x) => s + x.cantidad, 0);
      const valorPagado = det.productosPagados.reduce((s, x) => s + x.valor, 0);
      const cantidadPendiente = det.productosPendientes.reduce((s, x) => s + x.cantidad, 0);
      const valorPendiente = det.productosPendientes.reduce((s, x) => s + x.valor, 0);
      return {
        tipo: p.tipo,
        documento: p.documento_contable,
        clinica: p.clinica_nombre || 'Sin clínica',
        bodega: p.bodega_nombre || p.bodega_codigo || 'Sin bodega',
        fecha: p.fecha,
        estado: p.estado,
        cantidadTotal, cantidadPagada, cantidadPendiente,
        valorTotal, valorPagado, valorPendiente,
      };
    });
}

function ModalReporteCruces({ prestamos, cruces, clinicas, onClose }) {
  const [filtroTipo, setFiltroTipo] = useState('todos');       // todos | egreso | ingreso
  const [filtroClinica, setFiltroClinica] = useState('');
  const [filtroAnio, setFiltroAnio] = useState('');

  const inputS = { padding: '7px 10px', border: '1px solid var(--t-border)', borderRadius: 7, fontSize: 13, background: 'var(--t-bg-inner)', color: 'var(--t-text-primary)' };

  const base = (prestamos || []).filter(p => ['ingreso', 'egreso'].includes(p.tipo));
  const clinicasDisponibles = Array.from(new Set(base.map(p => p.clinica_nombre).filter(Boolean))).sort();
  const aniosDisponibles = Array.from(new Set(base.map(p => (p.fecha ? String(p.fecha).substring(0, 4) : null)).filter(Boolean))).sort().reverse();

  const baseFiltrada = base.filter(p => {
    if (filtroTipo !== 'todos' && p.tipo !== filtroTipo) return false;
    if (filtroClinica && p.clinica_nombre !== filtroClinica) return false;
    if (filtroAnio && !(String(p.fecha || '').startsWith(filtroAnio))) return false;
    return true;
  });

  const filasCronologicas = construirReporteCrucesCronologico(baseFiltrada, cruces);
  const datosSaldos = construirSaldoPorPrestamo(baseFiltrada, cruces);
  const saldoEPO = datosSaldos.filter(r => r.tipo === 'egreso').sort((a, b) => b.valorPendiente - a.valorPendiente);
  const saldoIPE = datosSaldos.filter(r => r.tipo === 'ingreso').sort((a, b) => b.valorPendiente - a.valorPendiente);

  function exportarExcel() {
    const hojaCruces = filasCronologicas.map(f => ({
      'Documento Préstamo': f.documento_prestamo,
      'Tipo': f.tipo,
      'Clínica': f.clinica,
      'Fecha Préstamo': fmtFecha(f.fecha_prestamo),
      'N° Cruce': f.numero_cruce,
      'Fecha Cruce': fmtFecha(f.fecha_cruce),
      'Documento Devolución': f.documento_devolucion,
      'Tipo Devolución': f.tipo_devolucion,
      'Estado Devolución': badgeEstado(f.estado_devolucion).label,
      'Descripción del Cruce': f.descripcion,
      'Código Producto Préstamo (EPO/IPE)': f.codigo_producto_prestamo,
      'Descripción Producto Préstamo (EPO/IPE)': f.descripcion_producto_prestamo,
      'Producto Devuelto (IDP/ED)': f.producto_devuelto,
      'Código Producto Devuelto': f.codigo_producto_devuelto,
      'Productos Devueltos en este Cruce': f.productos_devueltos,
      'Cantidad Devuelta (este producto)': f.cantidad_devuelta,
      'Valor Devuelto (este producto) $': f.valor_devuelto,
      '⚠ Sobrante (revisar)': f.tiene_sobrante ? 'SÍ' : '',
      'Cantidad Sobrante': f.sobrante_cantidad || '',
      'Valor Sobrante $': f.sobrante_valor || '',
      'Detalle del Sobrante': f.sobrante_detalle || '',
      'Saldo Pendiente Cantidad (este producto, tras este cruce)': f.saldo_pendiente_cantidad,
      'Saldo Pendiente Valor $ (este producto, tras este cruce)': f.saldo_pendiente_valor,
      'Saldo Pendiente Cantidad (documento completo, tras este cruce)': f.saldo_pendiente_documento_cantidad,
      'Saldo Pendiente Valor $ (documento completo, tras este cruce)': f.saldo_pendiente_documento_valor,
      'Cantidad Total del Préstamo': f.cantidad_total_prestamo,
      'Valor Total del Préstamo $': f.valor_total_prestamo,
      'Estado Actual del Préstamo': f.estado_prestamo,
    }));

    const filaSaldo = r => ({
      'Documento': r.documento,
      'Clínica': r.clinica,
      'Bodega': r.bodega,
      'Fecha': fmtFecha(r.fecha),
      'Estado': r.estado,
      'Cantidad Total': r.cantidadTotal,
      'Cantidad Pagada': r.cantidadPagada,
      'Cantidad Pendiente': r.cantidadPendiente,
      'Valor Total $': r.valorTotal,
      'Valor Pagado $': r.valorPagado,
      'Valor Pendiente $': r.valorPendiente,
    });

    const filasConSobrante = filasCronologicas.filter(f => f.tiene_sobrante);
    const hojaSobrantes = filasConSobrante.map(f => ({
      'Documento Préstamo': f.documento_prestamo,
      'Tipo': f.tipo,
      'Clínica': f.clinica,
      'Documento Devolución': f.documento_devolucion,
      'Fecha Cruce': fmtFecha(f.fecha_cruce),
      'Cantidad Sobrante': f.sobrante_cantidad,
      'Valor Sobrante $': f.sobrante_valor,
      'Detalle del Sobrante': f.sobrante_detalle,
      'Posible explicación': 'Esta devolución trajo más cantidad de la que el préstamo tenía pendiente en ese momento. Puede deberse a que también se cruzó (o debía cruzarse) contra otro préstamo del mismo tipo.',
    }));

    const hojaLeyenda = [
      { Columna: 'Sobrante', Explicación: 'Cantidad/valor de una devolución que NO se pudo descontar del saldo de este préstamo porque ya no tenía pendiente suficiente. No se pierde el dato: probablemente pertenece a otro préstamo cruzado con la misma devolución.' },
      { Columna: 'Saldo Pendiente (después de este cruce)', Explicación: 'Lo que le queda pendiente al préstamo justo después de aplicar ese cruce, en el orden cronológico en que se registraron los cruces (created_at).' },
      { Columna: 'Cantidad/Valor Devuelto (este cruce)', Explicación: 'Solo la porción de la devolución que sí se pudo aplicar al saldo del préstamo (tope: lo que quedaba pendiente).' },
      { Columna: '', Explicación: '' },
      { Columna: 'Revisar la hoja "Sobrantes a revisar"', Explicación: 'Contiene solo las filas donde hubo sobrante, para auditar más rápido sin recorrer todo el histórico.' },
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(hojaCruces), 'Cruces cronologico');
    if (hojaSobrantes.length > 0) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(hojaSobrantes), 'Sobrantes a revisar');
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(saldoEPO.map(filaSaldo)), 'Saldo pendiente EPO');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(saldoIPE.map(filaSaldo)), 'Saldo pendiente IPE');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(hojaLeyenda), 'Leyenda');
    XLSX.writeFile(wb, `cruces_saldo_prestamos_${new Date().toISOString().substring(0, 10)}.xlsx`);
  }

  const totalPendienteEPO = saldoEPO.reduce((s, r) => s + r.valorPendiente, 0);
  const totalPendienteIPE = saldoIPE.reduce((s, r) => s + r.valorPendiente, 0);
  const cantidadSobrantes = filasCronologicas.filter(f => f.tiene_sobrante).length;

  return (
    <Modal onClose={onClose} titulo="Cruces cronológicos y saldo pendiente por préstamo" maxWidth={1000}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 11, color: 'var(--t-text-muted)', marginBottom: 3 }}>Tipo</div>
          <select value={filtroTipo} onChange={e => setFiltroTipo(e.target.value)} style={inputS}>
            <option value="todos">EPO + IPE</option>
            <option value="egreso">Solo EPO (dados)</option>
            <option value="ingreso">Solo IPE (recibidos)</option>
          </select>
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--t-text-muted)', marginBottom: 3 }}>Clínica</div>
          <select value={filtroClinica} onChange={e => setFiltroClinica(e.target.value)} style={inputS}>
            <option value="">Todas</option>
            {clinicasDisponibles.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--t-text-muted)', marginBottom: 3 }}>Año</div>
          <select value={filtroAnio} onChange={e => setFiltroAnio(e.target.value)} style={inputS}>
            <option value="">Todos</option>
            {aniosDisponibles.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div style={{ flex: 1 }} />
        <button onClick={exportarExcel}
          style={{ padding: '8px 14px', border: '1px solid var(--t-border)', borderRadius: 7, fontSize: 13, cursor: 'pointer', background: 'var(--t-bg-inner)', color: 'var(--t-text-primary)' }}>
          ↓ Exportar a Excel
        </button>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        <div style={{ background: 'var(--t-bg-inner)', border: '1px solid var(--t-border)', borderRadius: 8, padding: '10px 14px', flex: 1, minWidth: 150 }}>
          <div style={{ fontSize: 11, color: 'var(--t-text-muted)', marginBottom: 4 }}>Cruces (filas)</div>
          <div style={{ fontSize: 17, fontWeight: 700 }}>{filasCronologicas.length}</div>
        </div>
        <div style={{ background: 'var(--t-bg-inner)', border: '1px solid var(--t-border)', borderRadius: 8, padding: '10px 14px', flex: 1, minWidth: 150 }}>
          <div style={{ fontSize: 11, color: 'var(--t-text-muted)', marginBottom: 4 }}>Pendiente EPO (dados)</div>
          <div style={{ fontSize: 17, fontWeight: 700, color: '#ef4444' }}>{fmt(totalPendienteEPO)}</div>
        </div>
        <div style={{ background: 'var(--t-bg-inner)', border: '1px solid var(--t-border)', borderRadius: 8, padding: '10px 14px', flex: 1, minWidth: 150 }}>
          <div style={{ fontSize: 11, color: 'var(--t-text-muted)', marginBottom: 4 }}>Pendiente IPE (recibidos)</div>
          <div style={{ fontSize: 17, fontWeight: 700, color: '#3b82f6' }}>{fmt(totalPendienteIPE)}</div>
        </div>
        <div style={{ background: cantidadSobrantes > 0 ? 'rgba(239,68,68,0.12)' : 'var(--t-bg-inner)', border: `1px solid ${cantidadSobrantes > 0 ? '#ef4444' : 'var(--t-border)'}`, borderRadius: 8, padding: '10px 14px', flex: 1, minWidth: 150 }}>
          <div style={{ fontSize: 11, color: 'var(--t-text-muted)', marginBottom: 4 }}>⚠ Cruces con sobrante</div>
          <div style={{ fontSize: 17, fontWeight: 700, color: cantidadSobrantes > 0 ? '#ef4444' : 'var(--t-text-primary)' }}>{cantidadSobrantes}</div>
        </div>
      </div>

      {cantidadSobrantes > 0 && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', background: 'rgba(239,68,68,0.1)', border: '1px solid #ef4444', borderRadius: 8, padding: '10px 12px', marginBottom: 14, fontSize: 12 }}>
          <span style={{ fontSize: 16 }}>⚠️</span>
          <div>
            <strong>Hay {cantidadSobrantes} cruce(s) con sobrante</strong> — la devolución trajo más cantidad de la que ese préstamo tenía pendiente en ese momento.
            Estas filas están marcadas abajo con ⚠ y se listan aparte en la hoja <strong>"Sobrantes a revisar"</strong> del Excel.
            Revisa si esa devolución también debía cruzarse contra otro préstamo.
          </div>
        </div>
      )}

      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Vista previa — cruces en orden cronológico</div>
      <div style={{ maxHeight: 380, overflow: 'auto', border: '1px solid var(--t-border)', borderRadius: 8 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead style={{ position: 'sticky', top: 0, background: 'var(--t-bg-inner)' }}>
            <tr style={{ textAlign: 'left', color: 'var(--t-text-muted)' }}>
              <th style={{ padding: '6px 8px' }}></th>
              <th style={{ padding: '6px 8px' }}>Préstamo</th>
              <th style={{ padding: '6px 8px' }}>Tipo</th>
              <th style={{ padding: '6px 8px' }}>Devolución</th>
              <th style={{ padding: '6px 8px' }}>Estado devolución</th>
              <th style={{ padding: '6px 8px' }}>Fecha cruce</th>
              <th style={{ padding: '6px 8px' }}>Descripción</th>
              <th style={{ padding: '6px 8px' }}>Cód. producto préstamo</th>
              <th style={{ padding: '6px 8px' }}>Descripción producto préstamo</th>
              <th style={{ padding: '6px 8px' }}>Producto devuelto</th>
              <th style={{ padding: '6px 8px' }}>Cód. producto devuelto</th>
              <th style={{ padding: '6px 8px', textAlign: 'right' }}>Cant. devuelta</th>
              <th style={{ padding: '6px 8px', textAlign: 'right' }}>Valor devuelto</th>
              <th style={{ padding: '6px 8px', textAlign: 'right' }} title="Saldo pendiente de este producto puntual, no del documento completo">Saldo pendiente (producto)</th>
            </tr>
          </thead>
          <tbody>
            {filasCronologicas.length === 0 && (
              <tr><td colSpan={14} style={{ padding: 20, textAlign: 'center', color: 'var(--t-text-muted)' }}>Sin cruces para este filtro</td></tr>
            )}
            {filasCronologicas.map((f, i) => {
              const codigosCoinciden = f.codigo_producto_prestamo && f.codigo_producto_prestamo === f.codigo_producto_devuelto;
              return (
              <tr key={i} style={{ borderTop: '1px solid var(--t-border)', background: f.tiene_sobrante ? 'rgba(239,68,68,0.08)' : 'transparent' }}
                title={f.tiene_sobrante ? `Sobrante: ${f.sobrante_detalle} — Valor sobrante: ${fmt(f.sobrante_valor)}` : undefined}>
                <td style={{ padding: '5px 8px', textAlign: 'center' }}>{f.tiene_sobrante ? '⚠️' : ''}</td>
                <td style={{ padding: '5px 8px', fontWeight: 600 }}>{f.documento_prestamo}</td>
                <td style={{ padding: '5px 8px' }}>{f.tipo}</td>
                <td style={{ padding: '5px 8px' }}>{f.documento_devolucion}</td>
                <td style={{ padding: '5px 8px' }}>
                  <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600, background: badgeEstado(f.estado_devolucion).bg, color: badgeEstado(f.estado_devolucion).color }}>
                    {f.tipo_devolucion}: {badgeEstado(f.estado_devolucion).label}
                  </span>
                </td>
                <td style={{ padding: '5px 8px' }}>{fmtFecha(f.fecha_cruce)}</td>
                <td style={{ padding: '5px 8px', color: 'var(--t-text-muted)' }}>{f.descripcion}</td>
                <td style={{ padding: '5px 8px', fontWeight: codigosCoinciden ? 600 : 400, color: codigosCoinciden ? '#22c55e' : 'var(--t-text-primary)' }}>{f.codigo_producto_prestamo || '—'}</td>
                <td style={{ padding: '5px 8px' }}>{f.descripcion_producto_prestamo || '—'}</td>
                <td style={{ padding: '5px 8px' }}>{f.producto_devuelto || '—'}</td>
                <td style={{ padding: '5px 8px', fontWeight: codigosCoinciden ? 600 : 400, color: codigosCoinciden ? '#22c55e' : 'var(--t-text-primary)' }}>{f.codigo_producto_devuelto || '—'}</td>
                <td style={{ padding: '5px 8px', textAlign: 'right' }}>{f.cantidad_devuelta}</td>
                <td style={{ padding: '5px 8px', textAlign: 'right' }}>{fmt(f.valor_devuelto)}</td>
                <td style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 600, color: f.saldo_pendiente_valor > 0 ? '#f59e0b' : '#22c55e' }}>
                  {fmt(f.saldo_pendiente_valor)}
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

// ─── Reporte detallado de pendientes por devolver (por producto y clínica) ─────

function itemsPendientesDe(p, devoluciones, cruces = []) {
  // Junta devoluciones por dos vías: el flujo directo (d.prestamo_id) y el
  // flujo de multicruce (prestamo_cruces), deduplicando por id de devolución
  // para no contar dos veces si una devolución aparece en ambas fuentes.
  const devMap = {};
  devoluciones.filter(d => d.prestamo_id === p.id).forEach(d => {
    devMap[d.id] = d.items || [];
  });
  (cruces || []).filter(c => c.prestamo_id === p.id).forEach(c => {
    devMap[c.devolucion_id] = c.devolucion_items || [];
  });

  const devueltoPorCodigo = {};
  Object.values(devMap).forEach(items => {
    (items || []).forEach(i => {
      devueltoPorCodigo[i.codigo] = (devueltoPorCodigo[i.codigo] || 0) + Number(i.cantidad);
    });
  });
  return (p.items || []).map(i => {
    const devuelto = devueltoPorCodigo[i.codigo] || 0;
    const pendiente = Math.max(0, Number(i.cantidad) - devuelto);
    return { ...i, devuelto, pendiente };
  }).filter(i => i.pendiente > 0);
}

function construirReportePendientes(prestamos, devoluciones, cruces, tipo, desde, hasta) {
  const filtrados = prestamos.filter(p => {
    if (p.tipo !== tipo) return false;
    if (p.estado === 'cerrado') return false;
    const f = String(p.fecha || '').substring(0, 10);
    if (desde && f && f < desde) return false;
    if (hasta && f && f > hasta) return false;
    return true;
  });

  const porClinica = {};
  let granTotal = 0;

  filtrados.forEach(p => {
    const pendientes = itemsPendientesDe(p, devoluciones, cruces);
    if (pendientes.length === 0) return;
    const clinica = p.clinica_nombre || 'Sin clínica';
    if (!porClinica[clinica]) porClinica[clinica] = { documentos: {}, valorTotal: 0 };

    const docKey = p.documento_contable || p.id;
    if (!porClinica[clinica].documentos[docKey]) {
      porClinica[clinica].documentos[docKey] = {
        documento: p.documento_contable, fecha: p.fecha, productos: [], valorTotal: 0,
      };
    }

    pendientes.forEach(i => {
      const valor = i.pendiente * Number(i.precio_unitario || 0);
      porClinica[clinica].documentos[docKey].productos.push({
        codigo: i.codigo, nombre: i.nombre, cantidad: i.pendiente, valor,
      });
      porClinica[clinica].documentos[docKey].valorTotal += valor;
      porClinica[clinica].valorTotal += valor;
      granTotal += valor;
    });
  });

  return { porClinica, granTotal };
}

function ModalReportePendientes({ prestamos, devoluciones, cruces, onClose }) {
  const [desde, setDesde] = useState('2020-01-01');
  const [hasta, setHasta] = useState(new Date().toISOString().substring(0, 10));

  const reporteEgresos = construirReportePendientes(prestamos, devoluciones, cruces, 'egreso', desde, hasta);
  const reporteIngresos = construirReportePendientes(prestamos, devoluciones, cruces, 'ingreso', desde, hasta);

  const inputS = { padding: '7px 10px', border: '1px solid var(--t-border)', borderRadius: 7, fontSize: 13, background: 'var(--t-bg-inner)', color: 'var(--t-text-primary)' };

  function bloque(titulo, icono, subtitulo, reporte) {
    const clinicas = Object.keys(reporte.porClinica).sort();
    return (
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{icono} {titulo}</div>
            <div style={{ fontSize: 12, color: 'var(--t-text-muted)' }}>{subtitulo}</div>
          </div>
          <div style={{ fontWeight: 700, fontSize: 14, color: '#BA7517' }}>{fmt(reporte.granTotal)}</div>
        </div>
        {clinicas.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--t-text-muted)', padding: 10, textAlign: 'center' }}>Sin pendientes en el rango seleccionado</div>
        )}
        {clinicas.map(clinica => {
          const data = reporte.porClinica[clinica];
          const documentos = Object.values(data.documentos).sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
          return (
            <div key={clinica} style={{ border: '1px solid var(--t-border)', borderRadius: 8, marginBottom: 8, overflow: 'hidden' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--t-bg-inner)' }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{clinica}</span>
                <span style={{ fontWeight: 600, fontSize: 13, color: '#BA7517' }}>{fmt(data.valorTotal)}</span>
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ color: 'var(--t-text-muted)', textAlign: 'left' }}>
                    <th style={{ padding: '5px 12px', fontWeight: 500 }}>Documento</th>
                    <th style={{ padding: '5px 12px', fontWeight: 500 }}>Fecha</th>
                    <th style={{ padding: '5px 12px', fontWeight: 500 }}>Producto</th>
                    <th style={{ padding: '5px 12px', fontWeight: 500 }}>Código</th>
                    <th style={{ padding: '5px 12px', fontWeight: 500, textAlign: 'right' }}>Cant. pendiente</th>
                    <th style={{ padding: '5px 12px', fontWeight: 500, textAlign: 'right' }}>Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {documentos.map((doc, di) => doc.productos.map((prod, pi) => (
                    <tr key={`${di}-${pi}`} style={{ borderTop: '1px solid var(--t-border)' }}>
                      {pi === 0 && (
                        <td rowSpan={doc.productos.length} style={{ padding: '5px 12px', fontWeight: 600, verticalAlign: 'top' }}>{doc.documento}</td>
                      )}
                      {pi === 0 && (
                        <td rowSpan={doc.productos.length} style={{ padding: '5px 12px', color: 'var(--t-text-muted)', verticalAlign: 'top' }}>{fmtFecha(doc.fecha)}</td>
                      )}
                      <td style={{ padding: '5px 12px' }}>{prod.nombre}</td>
                      <td style={{ padding: '5px 12px', color: 'var(--t-text-muted)' }}>{prod.codigo}</td>
                      <td style={{ padding: '5px 12px', textAlign: 'right' }}>{prod.cantidad}</td>
                      <td style={{ padding: '5px 12px', textAlign: 'right' }}>{fmt(prod.valor)}</td>
                    </tr>
                  )))}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    );
  }

  function exportarExcel() {
    const filas = (reporte, tipoLabel) => {
      const out = [];
      Object.keys(reporte.porClinica).sort().forEach(clinica => {
        Object.values(reporte.porClinica[clinica].documentos).forEach(doc => {
          doc.productos.forEach(prod => {
            out.push({
              Tipo: tipoLabel,
              Clínica: clinica,
              Documento: doc.documento,
              Fecha: fmtFecha(doc.fecha),
              Producto: prod.nombre,
              Código: prod.codigo,
              'Cantidad pendiente': prod.cantidad,
              'Valor pendiente': prod.valor,
            });
          });
        });
      });
      return out;
    };

    const datos = [
      ...filas(reporteEgresos, 'Clínica nos debe devolver'),
      ...filas(reporteIngresos, 'Nosotros debemos devolver'),
    ];

    const ws = XLSX.utils.json_to_sheet(datos);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Pendientes por devolver');
    XLSX.writeFile(wb, `pendientes_por_devolver_${desde}_a_${hasta}.xlsx`);
  }

  return (
    <Modal onClose={onClose} titulo="Pendientes por devolver — detallado por producto y clínica">
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <div style={{ fontSize: 11, color: 'var(--t-text-muted)', marginBottom: 3 }}>Desde</div>
          <input type="date" value={desde} onChange={e => setDesde(e.target.value)} style={inputS} />
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--t-text-muted)', marginBottom: 3 }}>Hasta</div>
          <input type="date" value={hasta} onChange={e => setHasta(e.target.value)} style={inputS} />
        </div>
        <button onClick={exportarExcel}
          style={{ marginTop: 16, padding: '8px 14px', border: '1px solid var(--t-border)', borderRadius: 7, fontSize: 13, cursor: 'pointer', background: 'var(--t-bg-inner)', color: 'var(--t-text-primary)' }}>
          ↓ Exportar a Excel
        </button>
      </div>

      {bloque('Egresos pendientes', '🏥', 'Lo que cada clínica nos debe devolver', reporteEgresos)}
      {bloque('Ingresos pendientes', '📦', 'Lo que nosotros debemos devolver a cada clínica', reporteIngresos)}
    </Modal>
  );
}

// ─── MODAL genérico ─────────────────────────────────────────────────────────────

function Modal({ onClose, titulo, children, maxWidth = 760 }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: 'var(--t-bg-app)', border: '1px solid var(--t-border)', borderRadius: 12, width: '100%', maxWidth, maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: '1px solid var(--t-border)' }}>
          <span style={{ fontWeight: 600, fontSize: 15 }}>{titulo}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--t-text-muted)', fontSize: 20, lineHeight: 1 }}>✕</button>
        </div>
        <div style={{ padding: '18px 20px', overflowY: 'auto', flex: 1 }}>{children}</div>
      </div>
    </div>
  );
}











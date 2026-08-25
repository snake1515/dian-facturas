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
    headers: {
      'Authorization': `Bearer ${token}`,
      ...options.headers,
    },
    ...options,
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
          {activeTab === 'resumen'     && <TabResumen prestamos={prestamos} devoluciones={devoluciones} onRefresh={cargarDatos} />}
          {activeTab === 'movimientos' && <TabMovimientos prestamos={prestamos} devoluciones={devoluciones} clinicas={clinicas} cruces={cruces} onRefresh={cargarDatos} />}
          {activeTab === 'nuevo'       && <TabNuevo clinicas={clinicas} productos={productos} onSaved={() => { cargarDatos(); setActiveTab('movimientos'); }} onRefreshClinicas={cargarDatos} />}
          {activeTab === 'productos'   && <TabProductos productos={productos} onRefresh={cargarDatos} />}
          {activeTab === 'cruces'      && <TabCruces prestamos={prestamos} cruces={cruces} onRefresh={cargarDatos} />}
          {activeTab === 'reportes'    && <TabReportes prestamos={prestamos} devoluciones={devoluciones} cruces={cruces} clinicas={clinicas} />}
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

function TabMovimientos({ prestamos, devoluciones, clinicas, cruces = [], onRefresh }) {
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
                <span style={{ marginLeft: 8, padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600, background: c.tipo_cruce === 'total' ? '#22c55e22' : '#f59e0b22', color: c.tipo_cruce === 'total' ? '#22c55e' : '#f59e0b' }}>
                  {c.tipo_cruce}
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
                  <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 11, background: c.tipo_cruce === 'total' ? '#22c55e22' : '#f59e0b22', color: c.tipo_cruce === 'total' ? '#22c55e' : '#f59e0b' }}>
                    {c.tipo_cruce}
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

function TabCruces({ prestamos, cruces, onRefresh }) {
  const { isAdmin } = useAuth();

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

  const [selPrestamos,  setSelPrestamos]  = React.useState([]);
  const [selDevoluciones,setSelDevoluciones]= React.useState([]);
  const [tipoCruce,    setTipoCruce]    = React.useState('total');
  const [obs,          setObs]          = React.useState('');
  const [saving,       setSaving]       = React.useState(false);
  const [error,        setError]        = React.useState('');
  const [soporteFile,  setSoporteFile]  = React.useState(null);
  const [soporteItemFiles, setSoporteItemFiles] = React.useState({});
  const [cantDevueltas,    setCantDevueltas]    = React.useState({});
  const [expandedCruce,    setExpandedCruce]    = React.useState(null);
  const [reparando,        setReparando]        = React.useState(false);
  const [regenerandoPdfs,  setRegenerandoPdfs]   = React.useState(false);

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
      alert(`Se regeneraron ${r.regenerados} PDF(s).${r.errores > 0 ? ` ${r.errores} con error.` : ''}`);
      onRefresh();
    } catch (e) {
      alert('Error regenerando PDFs: ' + e.message);
    }
    setRegenerandoPdfs(false);
  }
  const [filtroPrest,  setFiltroPrest]  = React.useState('');
  const [filtroDevol,  setFiltroDevol]  = React.useState('');
  const [anioPrest,    setAnioPrest]    = React.useState('');
  const [fDesdePrest,  setFDesdePrest]  = React.useState('');
  const [fHastaPrest,  setFHastaPrest]  = React.useState('');
  const [anioDevol,    setAnioDevol]    = React.useState('');
  const [fDesdeDevol,  setFDesdeDevol]  = React.useState('');
  const [fHastaDevol,  setFHastaDevol]  = React.useState('');
  const [detalleCruce, setDetalleCruce] = React.useState(null);
  const [detalleCard,  setDetalleCard]  = React.useState(null);
  const [filtroCruces, setFiltroCruces] = React.useState('');
  const [editandoCruce, setEditandoCruce] = React.useState(null);
  const [editTipo,       setEditTipo]      = React.useState('total');
  const [editObs,        setEditObs]       = React.useState('');
  const [guardandoEdicion, setGuardandoEdicion] = React.useState(false);

  function abrirEdicionCruce(c, e) {
    e.stopPropagation();
    setEditandoCruce(c);
    setEditTipo(c.tipo_cruce || 'total');
    setEditObs(c.observaciones || c.grupo_observaciones || '');
  }

  async function guardarEdicionCruce() {
    setGuardandoEdicion(true);
    try {
      await apiFetch(`/prestamos/cruces/${editandoCruce.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tipo_cruce: editTipo, observaciones: editObs }),
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
    matchDoc(p, filtroPrest.toLowerCase()) && matchFecha(p, anioPrest, fDesdePrest, fHastaPrest));

  // Inicializar cantidades al seleccionar devolución
  React.useEffect(() => {
    if (selDevoluciones.length === 1) {
      const init = {};
      (selDevoluciones[0].items || []).forEach(i => { init[i.codigo] = i.cantidad; });
      setCantDevueltas(init);
    }
  }, [selDevoluciones]);

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
    return matchDoc(p, filtroDevol.toLowerCase()) && matchFecha(p, anioDevol, fDesdeDevol, fHastaDevol);
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
    setSaving(true); setError('');
    try {
      // Multicruce: un documento con varios (o varios con varios) genera un par por cada combinación
      const pares = selPrestamos.flatMap(p => selDevoluciones.map(d => ({
        prestamo_id: p.id, devolucion_id: d.id, tipo_cruce: tipoCruce,
      })));

      const result = await apiFetch('/prestamos/cruces', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pares, observaciones: obs }),
      });

      // El soporte manual solo aplica cuando es un cruce simple 1 a 1
      // (para multicruce, el PDF generado ya anexa los soportes de cada documento)
      const cruceId = result?.cruces?.[0]?.id;
      if (cruceId && pares.length === 1) {
        if (tipoCruce === 'total' && soporteFile) {
          const fd = new FormData();
          fd.append('soporte', soporteFile);
          await apiUpload(`/prestamos/cruces/${cruceId}/soporte`, fd);
        } else if (tipoCruce === 'parcial') {
          for (const [codigo, file] of Object.entries(soporteItemFiles)) {
            if (file) {
              const fd = new FormData();
              fd.append('soporte', file);
              fd.append('item_codigo', codigo);
              await apiUpload(`/prestamos/cruces/${cruceId}/soporte`, fd);
            }
          }
        }
      }

      onRefresh();
      setSelPrestamos([]); setSelDevoluciones([]);
      setObs(''); setSoporteFile(null); setSoporteItemFiles({}); setCantDevueltas({});
    } catch (e) { setError('Error: ' + e.message); }
    setSaving(false);
  }

  const cardS  = { background: 'var(--t-bg-card)', border: '1px solid var(--t-border)', borderRadius: 8, padding: 12, cursor: 'pointer', marginBottom: 8 };
  const selS   = { ...cardS, border: '2px solid var(--t-accent)', background: 'var(--t-bg-inner)' };
  const inputS = { width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid var(--t-border)', background: 'var(--t-bg-inner)', color: 'var(--t-text-primary)', fontSize: 13, boxSizing: 'border-box' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 260px)', minHeight: 500 }}>
    <div style={{ overflowY: 'auto', flex: '1 1 50%', minHeight: 0, paddingRight: 4 }}>
      {/* Panel de cruce */}
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
            <input type="date" value={fDesdePrest} onChange={e => setFDesdePrest(e.target.value)}
              title="Desde" style={{ ...inputS, padding: '6px 6px', fontSize: 12 }} />
            <input type="date" value={fHastaPrest} onChange={e => setFHastaPrest(e.target.value)}
              title="Hasta" style={{ ...inputS, padding: '6px 6px', fontSize: 12 }} />
            {(anioPrest || fDesdePrest || fHastaPrest) && (
              <span onClick={() => { setAnioPrest(''); setFDesdePrest(''); setFHastaPrest(''); }}
                title="Limpiar filtros de fecha"
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
                              {' · '}{c.tipo_cruce}
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
            <input type="date" value={fDesdeDevol} onChange={e => setFDesdeDevol(e.target.value)}
              title="Desde" style={{ ...inputS, padding: '6px 6px', fontSize: 12 }} />
            <input type="date" value={fHastaDevol} onChange={e => setFHastaDevol(e.target.value)}
              title="Hasta" style={{ ...inputS, padding: '6px 6px', fontSize: 12 }} />
            {(anioDevol || fDesdeDevol || fHastaDevol) && (
              <span onClick={() => { setAnioDevol(''); setFDesdeDevol(''); setFHastaDevol(''); }}
                title="Limpiar filtros de fecha"
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

      {/* Panel de acción cuando ambos seleccionados */}
      {selPrestamos.length > 0 && selDevoluciones.length > 0 && (
        <div style={{ background: 'var(--t-bg-card)', border: '1px solid var(--t-border)', borderRadius: 10, padding: 16, marginBottom: 24 }}>
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

          {/* Tipo de cruce */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
            {['total','parcial'].map(t => (
              <button key={t} onClick={() => setTipoCruce(t)} style={{
                padding: '6px 16px', borderRadius: 6, fontSize: 13, cursor: 'pointer',
                background: tipoCruce === t ? 'var(--t-accent)' : 'var(--t-bg-inner)',
                color: tipoCruce === t ? '#fff' : 'var(--t-text-primary)',
                border: '1px solid var(--t-border)', fontWeight: tipoCruce === t ? 600 : 400,
              }}>{t.charAt(0).toUpperCase() + t.slice(1)}</button>
            ))}
          </div>

          {/* PDF total — solo aplica en cruce simple 1 a 1; en multicruce el PDF generado ya anexa los soportes de cada documento */}
          {tipoCruce === 'total' && selPrestamos.length === 1 && selDevoluciones.length === 1 && (
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, color: 'var(--t-text-muted)', display: 'block', marginBottom: 4 }}>PDF soporte adicional (opcional)</label>
              <input type="file" accept=".pdf" onChange={e => setSoporteFile(e.target.files[0])}
                style={{ fontSize: 12, color: 'var(--t-text-primary)' }} />
            </div>
          )}

          {/* PDF por producto (parcial) — solo aplica en cruce simple 1 a 1 */}
          {tipoCruce === 'parcial' && selPrestamos.length === 1 && selDevoluciones.length === 1 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: 'var(--t-text-muted)', marginBottom: 8 }}>PDF por producto devuelto:</div>
              {(selDevoluciones[0].items || []).map(item => (
                <div key={item.codigo} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 12, flexWrap: 'wrap' }}>
                  <span style={{ color: 'var(--t-text-primary)', minWidth: 110, fontFamily: 'monospace' }}>{item.codigo}</span>
                  <span style={{ color: 'var(--t-text-muted)', flex: 1, minWidth: 140 }}>{item.nombre}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ color: 'var(--t-text-muted)', fontSize: 11 }}>Cant:</span>
                    <input type="number" min={1} max={item.cantidad}
                      value={cantDevueltas[item.codigo] ?? item.cantidad}
                      onChange={e => setCantDevueltas(prev => ({ ...prev, [item.codigo]: Number(e.target.value) }))}
                      style={{ width: 58, padding: '3px 6px', borderRadius: 5, border: '1px solid var(--t-border)', background: 'var(--t-bg-inner)', color: 'var(--t-text-primary)', fontSize: 12 }} />
                    <span style={{ color: 'var(--t-text-muted)', fontSize: 11 }}>/{item.cantidad}</span>
                  </div>
                  <input type="file" accept=".pdf"
                    onChange={e => setSoporteItemFiles(prev => ({ ...prev, [item.codigo]: e.target.files[0] }))}
                    style={{ fontSize: 11, color: 'var(--t-text-muted)' }} />
                </div>
              ))}
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
    </div>

    {/* Historial de cruces — panel inferior fijo con scroll propio */}
    {cruces.length > 0 && (
      <div style={{ flex: '1 1 50%', minHeight: 0, display: 'flex', flexDirection: 'column', borderTop: '2px solid var(--t-border)', marginTop: 12 }}>
        <div style={{ flex: '0 0 auto', paddingTop: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 12, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--t-text-primary)' }}>Cruces registrados</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {isAdmin && (
                <button onClick={regenerarPdfs} disabled={regenerandoPdfs}
                  title="Regenera el PDF de todos los cruces ya emitidos con el formato actual (código, cantidad y fecha por producto)"
                  style={{ padding: '5px 12px', fontSize: 11, border: '1px solid var(--t-accent)', borderRadius: 6, cursor: 'pointer', background: 'transparent', color: 'var(--t-accent)' }}>
                  {regenerandoPdfs ? 'Regenerando…' : '🔄 Actualizar PDFs al nuevo formato'}
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
          <input value={filtroCruces} onChange={e => setFiltroCruces(e.target.value)}
            placeholder="Buscar por Nº de cruce (ej. CRU-00092), documento (préstamo o devolución), producto o clínica…"
            style={{ ...inputS, marginBottom: 10 }} />
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: 'var(--t-bg-card)' }}>
                {['Cruce Nº','Préstamo','Devolución','Tipo','Clínica','Fecha','Estado','Soporte',''].map(h => (
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
                  </td>
                  <td style={{ padding: '8px 10px', color: 'var(--t-text-primary)' }}>{c.devolucion_doc}</td>
                  <td style={{ padding: '8px 10px' }}>
                    <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 11, background: c.tipo_cruce === 'total' ? '#22c55e22' : '#f59e0b22', color: c.tipo_cruce === 'total' ? '#22c55e' : '#f59e0b' }}>
                      {c.tipo_cruce}
                    </span>
                  </td>
                  <td style={{ padding: '8px 10px', color: 'var(--t-text-muted)' }}>{c.clinica_nombre}</td>
                  <td style={{ padding: '8px 10px', color: 'var(--t-text-muted)' }}>{c.created_at?.substring(0,10)}</td>
                  <td style={{ padding: '8px 10px' }}>
                    <span style={{ color: estadoColor(c.estado_prestamo), fontWeight: 600 }}>
                      {c.estado_prestamo === 'cerrado' ? 'total' : (c.estado_prestamo || '—')}
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
      {detalleCard && (
        <Modal onClose={() => setDetalleCard(null)} titulo={`Detalle ${detalleCard.documento_contable}`}>
          <DetallePrestamoModal prestamo={detalleCard} devoluciones={[]} />
        </Modal>
      )}
      {editandoCruce && (
        <Modal onClose={() => setEditandoCruce(null)} titulo={`Editar cruce ${editandoCruce.grupo_numero || ''}`}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 320 }}>
            <div style={{ fontSize: 12, color: 'var(--t-text-muted)' }}>
              {editandoCruce.prestamo_doc} ↔ {editandoCruce.devolucion_doc}
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--t-text-muted)', fontWeight: 500 }}>Tipo</label>
              <select value={editTipo} onChange={e => setEditTipo(e.target.value)}
                style={{ display: 'block', width: '100%', marginTop: 5, padding: '7px 10px', border: '1px solid var(--t-border)', borderRadius: 7, fontSize: 13, background: 'var(--t-bg-inner)', color: 'var(--t-text-primary)' }}>
                <option value="total">total</option>
                <option value="parcial">parcial</option>
              </select>
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
      </div>

      {verPendientes && (
        <ModalReportePendientes prestamos={prestamos} devoluciones={devoluciones} cruces={cruces} onClose={() => setVerPendientes(false)} />
      )}
      {verPorPrestamo && (
        <ModalReportePorPrestamo prestamos={prestamos} cruces={cruces} clinicas={clinicas} onClose={() => setVerPorPrestamo(false)} />
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
    tipo_cruce: c.tipo_cruce,
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




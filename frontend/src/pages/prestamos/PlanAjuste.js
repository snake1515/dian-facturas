import React, { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { calcularPlanAjuste } from './planAjusteCalc';

// ─────────────────────────────────────────────────────────────────────────────
//  Plan de ajuste de saldos — todos los terceros.
//  Muestra, por tercero, el saldo real actual (según cruces), las correcciones
//  que lo llevan al valor correcto y el saldo que queda después. Las
//  correcciones se pueden aplicar desde aquí (solo las seleccionadas):
//    · Completar cruce registrado → PATCH /prestamos/cruces/:id
//    · Cruce nuevo / cruce manual  → POST  /prestamos/cruces (un CRU por tercero)
//  Las sugerencias de cruce manual (código distinto) vienen sin marcar: hay
//  que revisarlas una por una.
// ─────────────────────────────────────────────────────────────────────────────

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';
async function apiFetch(path, options = {}) {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers: { Authorization: `Bearer ${token}`, ...options.headers } });
  if (!res.ok) throw new Error((await res.text()) || `Error ${res.status}`);
  const t = await res.text();
  return t ? JSON.parse(t) : null;
}

const C_NOS = '#0F7B5F';
const C_DEB = '#B4442F';
const C_MAN = '#2563eb';
const cop = n => (n < 0 ? '-$' : '$') + Math.round(Math.abs(Number(n || 0))).toLocaleString('es-CO');
const num = n => Number(n || 0).toLocaleString('es-CO', { maximumFractionDigits: 2 });
const fechaDe = p => String(p?.fecha || '').substring(0, 10);

const card = { background: 'var(--t-bg-card)', border: '1px solid var(--t-border)', borderRadius: 10, padding: '14px 16px' };
const th = { padding: '8px 10px', fontSize: 11, fontWeight: 600, color: 'var(--t-text-muted)', textAlign: 'left', borderBottom: '1px solid var(--t-border)', whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: 0.3 };
const td = { padding: '7px 10px', fontSize: 13, borderBottom: '1px solid var(--t-border)', color: 'var(--t-text-primary)', verticalAlign: 'top' };
const r = { textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };
const btn = { padding: '7px 12px', fontSize: 12, borderRadius: 7, border: '1px solid var(--t-border)', background: 'var(--t-bg-inner)', color: 'var(--t-text-primary)', cursor: 'pointer', fontWeight: 600 };

const TIPOS = {
  completar: { titulo: 'Completar cruces ya registrados', desc: 'El cruce existe pero quedó sin estos productos (mismo código). Se corrige editando ese cruce.', color: C_NOS, porDefecto: true },
  nuevo:     { titulo: 'Cruces nuevos con el mismo código', desc: 'Devoluciones sin cruzar cuyo producto está pendiente en un préstamo del mismo tercero. Se asigna primero al préstamo que la devolución menciona en sus observaciones; si no menciona ninguno, al más antiguo.', color: '#b45309', porDefecto: true },
  manual:    { titulo: 'Sugerencias de cruce manual (revisar)', desc: 'El producto devuelto tiene un nombre muy parecido pero código distinto. Revisa cada una antes de marcarla.', color: C_MAN, porDefecto: false },
};

function Kpi({ titulo, antes, despues, color }) {
  return (
    <div style={card}>
      <div style={{ fontSize: 12, color: 'var(--t-text-muted)', marginBottom: 6 }}>{titulo}</div>
      <div style={{ fontSize: 13, color: 'var(--t-text-muted)' }}>Hoy: <b style={{ color: 'var(--t-text-primary)' }}>{cop(antes)}</b></div>
      <div style={{ fontSize: 22, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>{cop(despues)}</div>
      <div style={{ fontSize: 12, color: 'var(--t-text-muted)' }}>después del ajuste</div>
    </div>
  );
}

export default function PlanAjuste({ prestamos = [], cruces = [], onRefresh }) {
  const plan = useMemo(() => calcularPlanAjuste(prestamos, cruces), [prestamos, cruces]);
  const [q, setQ] = useState('');
  const [abierto, setAbierto] = useState(null);
  const [marcadas, setMarcadas] = useState({}); // id acción -> bool (si no está, usa el valor por defecto del tipo)
  const [aplicando, setAplicando] = useState('');
  const [resultado, setResultado] = useState(null);

  const estaMarcada = a => (marcadas[a.id] !== undefined ? marcadas[a.id] : TIPOS[a.tipo].porDefecto);
  const marcar = (a, v) => setMarcadas(m => ({ ...m, [a.id]: v }));

  // Saldo final de cada tercero según lo que está marcado
  const filas = useMemo(() => plan.map(t => {
    const fin = { nos: t.antes.nos, deb: t.antes.deb };
    t.acciones.forEach(a => { if (estaMarcada(a)) fin[a.lado] -= a.valor; });
    return { ...t, fin };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [plan, marcadas]);

  const totales = filas.reduce((s, t) => ({
    antesNos: s.antesNos + t.antes.nos, antesDeb: s.antesDeb + t.antes.deb,
    finNos: s.finNos + Math.max(0, t.fin.nos), finDeb: s.finDeb + Math.max(0, t.fin.deb),
    n: { completar: s.n.completar + t.acciones.filter(a => a.tipo === 'completar').length,
         nuevo: s.n.nuevo + t.acciones.filter(a => a.tipo === 'nuevo').length,
         manual: s.n.manual + t.acciones.filter(a => a.tipo === 'manual').length },
    sinCruzar: s.sinCruzar + t.devSinCruzar.reduce((a, d) => a + d.v, 0),
  }), { antesNos: 0, antesDeb: 0, finNos: 0, finDeb: 0, n: { completar: 0, nuevo: 0, manual: 0 }, sinCruzar: 0 });

  const qq = q.trim().toLowerCase();
  const lista = filas
    .filter(t => t.antes.nos > 0.5 || t.antes.deb > 0.5 || t.acciones.length || t.devSinCruzar.length)
    .filter(t => !qq || String(t.nombre).toLowerCase().includes(qq))
    .sort((a, b) => (b.antes.nos + b.antes.deb) - (a.antes.nos + a.antes.deb));

  // ── Aplicar las acciones marcadas de uno o varios terceros ──
  async function aplicar(terceros) {
    const acciones = terceros.flatMap(t => t.acciones.filter(estaMarcada).map(a => ({ a, t })));
    if (!acciones.length) { alert('No hay correcciones marcadas.'); return; }
    const nC = acciones.filter(x => x.a.tipo === 'completar').length;
    const nN = acciones.filter(x => x.a.tipo !== 'completar').length;
    if (!window.confirm(`Se van a aplicar ${acciones.length} corrección(es): ${nC} cruce(s) registrado(s) a completar y ${nN} cruce(s) nuevo(s) en ${terceros.length} tercero(s). ¿Continuar?`)) return;
    const errores = [];
    let ok = 0;
    // 1. Completar cruces existentes (PATCH), partiendo de lo que el cruce tiene hoy
    for (const { a } of acciones.filter(x => x.a.tipo === 'completar')) {
      setAplicando(`Completando cruce ${a.prestamo.documento_contable} ↔ ${a.devolucion.documento_contable}…`);
      const c = cruces.find(x => x.id === a.cruce_id);
      const items = ((c && c.items_cruzados) || []).map(it => ({ ...it }));
      a.lineas.forEach(l => {
        const ex = items.find(it => it.codigo === l.codigo && !it.codigo_prestamo);
        if (ex) ex.cantidad = Number(ex.cantidad) + l.cantidad;
        else items.push({ codigo: l.codigo, nombre: l.nombre, cantidad: l.cantidad, precio_unitario: l.precio_unitario });
      });
      try {
        await apiFetch(`/prestamos/cruces/${a.cruce_id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items_cruzados: items }) });
        ok++;
      } catch (e) { errores.push(`${a.prestamo.documento_contable} ↔ ${a.devolucion.documento_contable}: ${e.message}`); }
    }
    // 2. Cruces nuevos y manuales: un cruce agrupado (CRU) por tercero
    for (const t of terceros) {
      const sel = t.acciones.filter(a => a.tipo !== 'completar' && estaMarcada(a));
      if (!sel.length) continue;
      setAplicando(`Registrando cruces nuevos de ${t.nombre}…`);
      const pares = {};
      sel.forEach(a => {
        const k = a.prestamo.id + '|' + a.devolucion.id;
        if (!pares[k]) pares[k] = { prestamo_id: a.prestamo.id, devolucion_id: a.devolucion.id, items_cruzados: [] };
        a.lineas.forEach(l => {
          const it = { codigo: l.codigo, nombre: l.nombre, cantidad: l.cantidad, precio_unitario: l.precio_unitario };
          if (l.codigo_prestamo) { it.codigo_prestamo = l.codigo_prestamo; it.nombre_prestamo = l.nombre_prestamo; }
          pares[k].items_cruzados.push(it);
        });
      });
      try {
        await apiFetch('/prestamos/cruces', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pares: Object.values(pares), observaciones: `Plan de ajuste de saldos — ${t.nombre}`, tiene_sobrante: false, sobrante_detalle: null }) });
        ok += sel.length;
      } catch (e) { errores.push(`${t.nombre} (cruces nuevos): ${e.message}`); }
    }
    setAplicando('');
    setResultado({ ok, errores });
    setMarcadas({});
    if (onRefresh) onRefresh();
  }

  // ── Excel del plan completo ──
  function exportar() {
    const wb = XLSX.utils.book_new();
    const hoja = (nombre, cab, rows, anchos) => {
      const ws = XLSX.utils.aoa_to_sheet([cab, ...rows]);
      ws['!cols'] = anchos.map(w => ({ wch: w }));
      if (rows.length) ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: cab.length - 1 } }) };
      XLSX.utils.book_append_sheet(wb, ws, nombre);
    };
    hoja('Resumen por tercero',
      ['Tercero', 'Nos debe hoy', 'Nos debe después', 'Le debemos hoy', 'Le debemos después', 'Completar (n)', 'Completar ($)', 'Nuevos (n)', 'Nuevos ($)', 'Manuales sugeridos (n)', 'Manuales ($)', 'Devoluciones sin cruzar que quedan ($)'],
      lista.map(t => {
        const s = tipo => t.acciones.filter(a => a.tipo === tipo);
        const v = tipo => Math.round(s(tipo).reduce((a, x) => a + x.valor, 0));
        return [t.nombre, Math.round(t.antes.nos), Math.round(t.fin.nos), Math.round(t.antes.deb), Math.round(t.fin.deb),
          s('completar').length, v('completar'), s('nuevo').length, v('nuevo'), s('manual').length, v('manual'),
          Math.round(t.devSinCruzar.reduce((a, d) => a + d.v, 0))];
      }), [40, 15, 15, 15, 15, 10, 14, 10, 14, 12, 14, 18]);
    const acc = [];
    lista.forEach(t => t.acciones.forEach(a => a.lineas.forEach(l => acc.push([
      t.nombre, a.tipo === 'completar' ? 'Completar cruce registrado' : a.tipo === 'nuevo' ? 'Cruce nuevo (mismo código)' : 'Cruce manual (revisar)',
      estaMarcada(a) ? 'Sí' : 'No', a.lado === 'nos' ? 'Nos debe' : 'Le debemos',
      a.prestamo.documento_contable, fechaDe(a.prestamo), a.devolucion.documento_contable, fechaDe(a.devolucion), a.grupo_numero || '',
      l.codigo, l.nombre, l.codigo_prestamo || l.codigo, l.nombre_prestamo || l.nombre, Number(l.cantidad), Math.round(l.valor),
      a.similitud ? Math.round(a.similitud * 100) + '%' : '']))));
    hoja('Correcciones', ['Tercero', 'Tipo', 'Marcada', 'Lado', 'Préstamo', 'Fecha préstamo', 'Devolución', 'Fecha devolución', 'Cruce', 'Código devuelto', 'Producto devuelto', 'Código préstamo', 'Producto préstamo', 'Cantidad', 'Valor ($)', 'Parecido'],
      acc, [34, 26, 8, 11, 10, 11, 11, 11, 11, 13, 40, 13, 40, 9, 13, 8]);
    const deuda = [];
    lista.forEach(t => t.pendientes.forEach(pp => pp.items.forEach(i => deuda.push([t.nombre, pp.lado === 'nos' ? 'Nos debe' : 'Le debemos', pp.prestamo.documento_contable, fechaDe(pp.prestamo), i.codigo, i.nombre, Number(i.q), Math.round(i.v)]))));
    hoja('Saldo que queda', ['Tercero', 'Lado', 'Préstamo', 'Fecha', 'Código', 'Producto', 'Cantidad', 'Valor ($)'], deuda, [36, 11, 10, 11, 13, 46, 9, 13]);
    const dev = [];
    lista.forEach(t => t.devSinCruzar.forEach(d => d.items.forEach(i => dev.push([t.nombre, d.devolucion.documento_contable, fechaDe(d.devolucion), i.codigo, i.nombre, Number(i.q), Math.round(i.v)]))));
    hoja('Devoluciones sin cruzar', ['Tercero', 'Devolución', 'Fecha', 'Código', 'Producto', 'Cantidad', 'Valor ($)'], dev, [36, 11, 11, 13, 46, 9, 13]);
    XLSX.writeFile(wb, `plan_ajuste_saldos_${new Date().toISOString().substring(0, 10)}.xlsx`);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ ...card, fontSize: 13, color: 'var(--t-text-secondary, var(--t-text-primary))', lineHeight: 1.5 }}>
        <b>Plan de ajuste de saldos.</b> Revisa todos los terceros y propone las correcciones que llevan el saldo al valor real.
        Primero completa los cruces ya registrados que quedaron sin productos. Después cruza las devoluciones que siguen sin cruzar y tienen el mismo producto pendiente en un préstamo del mismo tercero.
        Por último sugiere cruces manuales cuando el código es distinto pero el nombre es casi igual.
        Las dos primeras vienen marcadas; las sugerencias manuales hay que revisarlas y marcarlas a mano. Nada se aplica hasta que pulses <b>Aplicar</b>.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12 }}>
        <Kpi titulo="Nos deben (todos los terceros)" antes={totales.antesNos} despues={totales.finNos} color={C_NOS} />
        <Kpi titulo="Le debemos (todos los terceros)" antes={totales.antesDeb} despues={totales.finDeb} color={C_DEB} />
        <div style={card}>
          <div style={{ fontSize: 12, color: 'var(--t-text-muted)', marginBottom: 6 }}>Correcciones encontradas</div>
          <div style={{ fontSize: 13, lineHeight: 1.7 }}>
            <div><b style={{ color: C_NOS }}>{totales.n.completar}</b> cruces registrados a completar</div>
            <div><b style={{ color: '#b45309' }}>{totales.n.nuevo}</b> cruces nuevos (mismo código)</div>
            <div><b style={{ color: C_MAN }}>{totales.n.manual}</b> sugerencias de cruce manual</div>
          </div>
        </div>
        <div style={card}>
          <div style={{ fontSize: 12, color: 'var(--t-text-muted)', marginBottom: 6 }}>Devoluciones que siguen sin cruzar</div>
          <div style={{ fontSize: 22, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{cop(totales.sinCruzar)}</div>
          <div style={{ fontSize: 12, color: 'var(--t-text-muted)' }}>sin préstamo que coincida: revisar a mano</div>
        </div>
      </div>

      {(aplicando || resultado) && (
        <div style={{ ...card, borderColor: aplicando ? 'var(--t-accent)' : (resultado.errores.length ? '#ef4444' : '#22c55e') }}>
          {aplicando ? <b>⏳ {aplicando}</b> : (
            <div>
              <b>Se aplicaron {resultado.ok} corrección(es).</b>
              {resultado.errores.length > 0 && (
                <div style={{ color: '#ef4444', fontSize: 12, marginTop: 6 }}>
                  {resultado.errores.length} con error (no se aplicaron):
                  {resultado.errores.map((e, i) => <div key={i}>• {e}</div>)}
                </div>
              )}
              <button style={{ ...btn, marginTop: 8 }} onClick={() => setResultado(null)}>Cerrar</button>
            </div>
          )}
        </div>
      )}

      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>Terceros <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--t-text-muted)' }}>· clic para ver y aplicar sus correcciones</span></div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar tercero…"
              style={{ padding: '7px 9px', fontSize: 13, border: '1px solid var(--t-border)', borderRadius: 7, background: 'var(--t-bg-inner)', color: 'var(--t-text-primary)' }} />
            <button style={btn} onClick={exportar}>⇣ Excel del plan</button>
            <button style={{ ...btn, background: 'var(--t-accent)', color: '#fff', border: 'none' }} disabled={!!aplicando}
              onClick={() => aplicar(lista.filter(t => t.acciones.some(estaMarcada)))}>Aplicar todo lo marcado</button>
          </div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th}>Tercero</th>
              <th style={{ ...th, ...r, color: C_NOS }}>Nos debe hoy</th><th style={{ ...th, ...r, color: C_NOS }}>Después</th>
              <th style={{ ...th, ...r, color: C_DEB }}>Le debemos hoy</th><th style={{ ...th, ...r, color: C_DEB }}>Después</th>
              <th style={{ ...th, ...r }}>Completar</th><th style={{ ...th, ...r }}>Nuevos</th><th style={{ ...th, ...r }}>Manuales</th>
              <th style={{ ...th, ...r }}>Sin cruzar</th>
            </tr></thead>
            <tbody>
              {lista.map(t => {
                const n = tipo => t.acciones.filter(a => a.tipo === tipo).length;
                const sc = t.devSinCruzar.reduce((a, d) => a + d.v, 0);
                const ab = abierto === t.k;
                return (
                  <React.Fragment key={t.k}>
                    <tr onClick={() => setAbierto(ab ? null : t.k)} style={{ cursor: 'pointer', background: ab ? 'var(--t-bg-inner)' : undefined }}>
                      <td style={{ ...td, fontWeight: 600 }}>{ab ? '▾' : '▸'} {t.nombre}</td>
                      <td style={{ ...td, ...r }}>{t.antes.nos > 0.5 ? cop(t.antes.nos) : '—'}</td>
                      <td style={{ ...td, ...r, fontWeight: 700, color: C_NOS }}>{t.antes.nos > 0.5 ? cop(Math.max(0, t.fin.nos)) : '—'}</td>
                      <td style={{ ...td, ...r }}>{t.antes.deb > 0.5 ? cop(t.antes.deb) : '—'}</td>
                      <td style={{ ...td, ...r, fontWeight: 700, color: C_DEB }}>{t.antes.deb > 0.5 ? cop(Math.max(0, t.fin.deb)) : '—'}</td>
                      <td style={{ ...td, ...r }}>{n('completar') || '—'}</td>
                      <td style={{ ...td, ...r }}>{n('nuevo') || '—'}</td>
                      <td style={{ ...td, ...r, color: n('manual') ? C_MAN : undefined }}>{n('manual') || '—'}</td>
                      <td style={{ ...td, ...r, color: 'var(--t-text-muted)' }}>{sc > 0.5 ? cop(sc) : '—'}</td>
                    </tr>
                    {ab && (
                      <tr><td colSpan={9} style={{ padding: 0 }}>
                        <div style={{ ...card, borderColor: 'var(--t-accent)', margin: '4px 0 12px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
                            <div style={{ fontSize: 13 }}>
                              <b style={{ fontSize: 15 }}>{t.nombre}</b><br />
                              <span style={{ color: C_NOS, fontWeight: 700 }}>Nos debe {cop(t.antes.nos)} → {cop(Math.max(0, t.fin.nos))}</span>
                              <span style={{ color: 'var(--t-text-muted)' }}> · </span>
                              <span style={{ color: C_DEB, fontWeight: 700 }}>Le debemos {cop(t.antes.deb)} → {cop(Math.max(0, t.fin.deb))}</span>
                            </div>
                            <button style={{ ...btn, background: 'var(--t-accent)', color: '#fff', border: 'none' }} disabled={!!aplicando || !t.acciones.some(estaMarcada)}
                              onClick={() => aplicar([t])}>Aplicar lo marcado de este tercero</button>
                          </div>

                          {['completar', 'nuevo', 'manual'].map(tipo => {
                            const acs = t.acciones.filter(a => a.tipo === tipo);
                            if (!acs.length) return null;
                            const todas = acs.every(estaMarcada);
                            return (
                              <div key={tipo} style={{ marginBottom: 14 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                                  <input type="checkbox" checked={todas} onChange={e => acs.forEach(a => marcar(a, e.target.checked))} />
                                  <b style={{ color: TIPOS[tipo].color, fontSize: 13 }}>{TIPOS[tipo].titulo} ({acs.length})</b>
                                </div>
                                <div style={{ fontSize: 12, color: 'var(--t-text-muted)', marginBottom: 6, marginLeft: 24 }}>{TIPOS[tipo].desc}</div>
                                <div style={{ overflowX: 'auto', maxHeight: 360, overflowY: 'auto' }}>
                                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                    <thead><tr><th style={th}></th><th style={th}>Préstamo</th><th style={th}>Devolución</th><th style={th}>Producto</th><th style={{ ...th, ...r }}>Cant.</th><th style={{ ...th, ...r }}>Valor</th></tr></thead>
                                    <tbody>
                                      {acs.map(a => (
                                        <tr key={a.id} style={{ opacity: estaMarcada(a) ? 1 : 0.6 }}>
                                          <td style={td}><input type="checkbox" checked={estaMarcada(a)} onChange={e => marcar(a, e.target.checked)} /></td>
                                          <td style={{ ...td, whiteSpace: 'nowrap' }}><b>{a.prestamo.documento_contable}</b><div style={{ fontSize: 11, color: 'var(--t-text-muted)' }}>{fechaDe(a.prestamo)}</div></td>
                                          <td style={{ ...td, whiteSpace: 'nowrap' }}><b>{a.devolucion.documento_contable}</b><div style={{ fontSize: 11, color: 'var(--t-text-muted)' }}>{fechaDe(a.devolucion)}{a.grupo_numero ? ` · ${a.grupo_numero}` : ''}</div></td>
                                          <td style={{ ...td, fontSize: 12 }}>{a.lineas.map((l, i) => (
                                            <div key={i}>
                                              <span style={{ color: 'var(--t-text-muted)', fontFamily: 'monospace' }}>{l.codigo}</span> {l.nombre}
                                              {l.codigo_prestamo && <div style={{ color: C_MAN }}>↔ {l.codigo_prestamo} {l.nombre_prestamo}{a.similitud ? ` · parecido ${Math.round(a.similitud * 100)}%` : ''}</div>}
                                            </div>
                                          ))}</td>
                                          <td style={{ ...td, ...r }}>{a.lineas.map((l, i) => <div key={i}>{num(l.cantidad)}</div>)}</td>
                                          <td style={{ ...td, ...r }}>{cop(a.valor)}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            );
                          })}

                          {t.pendientes.length > 0 && (
                            <div style={{ marginBottom: 14 }}>
                              <b style={{ fontSize: 13 }}>Saldo que queda si se aplica todo (incluidas las sugerencias manuales)</b>
                              <div style={{ overflowX: 'auto', maxHeight: 300, overflowY: 'auto', marginTop: 6 }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                  <thead><tr><th style={th}>Lado</th><th style={th}>Préstamo</th><th style={th}>Productos pendientes</th><th style={{ ...th, ...r }}>Valor</th></tr></thead>
                                  <tbody>
                                    {[...t.pendientes].sort((a, b) => a.lado.localeCompare(b.lado) || fechaDe(a.prestamo).localeCompare(fechaDe(b.prestamo))).map(pp => (
                                      <tr key={pp.prestamo.id}>
                                        <td style={{ ...td, color: pp.lado === 'nos' ? C_NOS : C_DEB, fontWeight: 600, whiteSpace: 'nowrap' }}>{pp.lado === 'nos' ? 'Nos debe' : 'Le debemos'}</td>
                                        <td style={{ ...td, whiteSpace: 'nowrap' }}><b>{pp.prestamo.documento_contable}</b><div style={{ fontSize: 11, color: 'var(--t-text-muted)' }}>{fechaDe(pp.prestamo)}</div></td>
                                        <td style={{ ...td, fontSize: 12 }}>{pp.items.map(i => <div key={i.codigo}>{i.nombre} <b>×{num(i.q)}</b></div>)}</td>
                                        <td style={{ ...td, ...r }}>{cop(pp.v)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}

                          {t.devSinCruzar.length > 0 && (
                            <div>
                              <b style={{ fontSize: 13, color: '#b45309' }}>Devoluciones que seguirían sin cruzar</b>
                              <div style={{ fontSize: 12, color: 'var(--t-text-muted)', margin: '2px 0 6px' }}>No coinciden con nada pendiente de este tercero: pueden ser devoluciones de más, de un préstamo no registrado o con un producto muy distinto.</div>
                              <div style={{ overflowX: 'auto', maxHeight: 240, overflowY: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                  <thead><tr><th style={th}>Devolución</th><th style={th}>Productos</th><th style={{ ...th, ...r }}>Valor</th></tr></thead>
                                  <tbody>
                                    {t.devSinCruzar.map(d => (
                                      <tr key={d.devolucion.id}>
                                        <td style={{ ...td, whiteSpace: 'nowrap' }}><b>{d.devolucion.documento_contable}</b><div style={{ fontSize: 11, color: 'var(--t-text-muted)' }}>{fechaDe(d.devolucion)}</div></td>
                                        <td style={{ ...td, fontSize: 12 }}>{d.items.map(i => <div key={i.codigo}>{i.nombre} <b>×{num(i.q)}</b></div>)}</td>
                                        <td style={{ ...td, ...r }}>{cop(d.v)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}
                        </div>
                      </td></tr>
                    )}
                  </React.Fragment>
                );
              })}
              {!lista.length && <tr><td colSpan={9} style={{ ...td, textAlign: 'center', color: 'var(--t-text-muted)', padding: 24 }}>No hay terceros con saldo.</td></tr>}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 11, color: 'var(--t-text-muted)', marginTop: 8 }}>
          "Después" se calcula con las correcciones marcadas. Completar cruces requiere usuario administrador. Los cruces nuevos de cada tercero se registran en un solo cruce agrupado (un consecutivo CRU y su PDF).
        </div>
      </div>
    </div>
  );
}

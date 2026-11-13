import React, { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';

// ─────────────────────────────────────────────────────────────────────────────
//  Saldos por tercero — dashboard calculado SOLO con los documentos de la
//  pestaña Movimientos (tabla `prestamos`):
//
//    EPO  (tipo 'egreso')             → le prestamos al tercero  → nos debe  (+)
//    IDP  (tipo 'devolucion_ingreso') → el tercero nos devuelve  → nos debe  (−)
//    IPE  (tipo 'ingreso')            → el tercero nos presta    → le debemos (+)
//    ED   (tipo 'devolucion_egreso')  → le devolvemos            → le debemos (−)
//
//  Mismo criterio del Kárdex: todo lo prestado menos todo lo devuelto, sin
//  depender de los cruces formales. Componente independiente: no modifica
//  nada de las demás pestañas.
// ─────────────────────────────────────────────────────────────────────────────

const TIPOS = {
  egreso:             { sigla: 'EPO', lado: 'nos', signo: +1, txt: 'Préstamo otorgado' },
  devolucion_ingreso: { sigla: 'IDP', lado: 'nos', signo: -1, txt: 'Devolución recibida' },
  ingreso:            { sigla: 'IPE', lado: 'deb', signo: +1, txt: 'Préstamo recibido' },
  devolucion_egreso:  { sigla: 'ED',  lado: 'deb', signo: -1, txt: 'Devolución entregada' },
};

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const C_NOS = '#0F7B5F';   // nos deben (verde)
const C_DEB = '#B4442F';   // le debemos (rojo ladrillo)
const TOL = 1e-6;

const cop = n => (n < 0 ? '-$' : '$') + Math.round(Math.abs(Number(n || 0))).toLocaleString('es-CO');
const num = n => Number(n || 0).toLocaleString('es-CO', { maximumFractionDigits: 2 });
const fechaDe = p => String(p.fecha || '').substring(0, 10);
const norm = s => String(s || '').trim().toUpperCase().replace(/\s+/g, ' ');

const card = { background: 'var(--t-bg-card)', border: '1px solid var(--t-border)', borderRadius: 10, padding: '14px 16px' };
const label = { fontSize: 11, color: 'var(--t-text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 4, display: 'block' };
const input = { padding: '7px 9px', fontSize: 13, border: '1px solid var(--t-border)', borderRadius: 7, background: 'var(--t-bg-inner)', color: 'var(--t-text-primary)', minWidth: 0 };
const th = { padding: '8px 10px', fontSize: 11, fontWeight: 600, color: 'var(--t-text-muted)', textAlign: 'left', borderBottom: '1px solid var(--t-border)', whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: 0.3 };
const td = { padding: '8px 10px', fontSize: 13, borderBottom: '1px solid var(--t-border)', color: 'var(--t-text-primary)', verticalAlign: 'top' };
const r = { textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };

function Seg({ value, onChange, opciones }) {
  return (
    <div style={{ display: 'inline-flex', border: '1px solid var(--t-border)', borderRadius: 7, overflow: 'hidden' }}>
      {opciones.map(([v, t]) => (
        <button key={v} type="button" onClick={() => onChange(v)} style={{
          padding: '7px 12px', fontSize: 12, border: 'none', cursor: 'pointer', fontWeight: 600,
          background: value === v ? 'var(--t-accent)' : 'var(--t-bg-inner)',
          color: value === v ? '#fff' : 'var(--t-text-muted)',
        }}>{t}</button>
      ))}
    </div>
  );
}

function Kpi({ titulo, valor, sub, color }) {
  return (
    <div style={card}>
      <div style={{ fontSize: 12, color: 'var(--t-text-muted)', marginBottom: 6 }}>{titulo}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: color || 'var(--t-text-primary)', fontVariantNumeric: 'tabular-nums' }}>{valor}</div>
      {sub && <div style={{ fontSize: 12, color: 'var(--t-text-muted)', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

// Barras horizontales simples (sin librerías).
function Barras({ filas, color, fmtV, onClick, vacio }) {
  const max = Math.max(...filas.map(f => f.v), 0) || 1;
  if (!filas.length) return <div style={{ fontSize: 13, color: 'var(--t-text-muted)', padding: '10px 0' }}>{vacio}</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {filas.map((f, i) => (
        <div key={f.k} onClick={onClick ? () => onClick(f.k) : undefined}
          style={{ cursor: onClick ? 'pointer' : 'default' }} title={f.label}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12, marginBottom: 3 }}>
            <span style={{ color: 'var(--t-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <b style={{ color: 'var(--t-text-muted)', marginRight: 6 }}>{i + 1}</b>{f.label}
            </span>
            <b style={{ ...r, color: 'var(--t-text-primary)' }}>{fmtV(f.v)}</b>
          </div>
          <div style={{ height: 8, background: 'var(--t-bg-inner)', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{ width: `${Math.max(1.5, (f.v / max) * 100)}%`, height: '100%', background: color, borderRadius: 4 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// Columnas por mes: cuánto se generó (préstamos) vs. cuánto se devolvió, por lado.
function Tendencia({ meses, fmtV }) {
  const max = Math.max(...meses.flatMap(m => [m.nos, m.deb]), 0) || 1;
  if (!meses.length) return <div style={{ fontSize: 13, color: 'var(--t-text-muted)' }}>Sin movimientos en el periodo.</div>;
  const H = 150;
  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, minWidth: meses.length * 46, height: H + 40, paddingTop: 6 }}>
        {meses.map(m => (
          <div key={m.k} style={{ flex: 1, minWidth: 36, display: 'flex', flexDirection: 'column', alignItems: 'center' }}
            title={`${m.label}\nVariación de lo que nos deben: ${fmtV(m.nos)}\nVariación de lo que debemos: ${fmtV(m.deb)}`}>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: H }}>
              {[['nos', C_NOS], ['deb', C_DEB]].map(([k, c]) => (
                <div key={k} style={{ width: 13, height: `${(Math.abs(m[k]) / max) * 100}%`, minHeight: m[k] ? 2 : 0,
                  background: c, opacity: m[k] < 0 ? 0.35 : 1, borderRadius: '3px 3px 0 0' }} />
              ))}
            </div>
            <div style={{ fontSize: 11, color: 'var(--t-text-muted)', marginTop: 6, whiteSpace: 'nowrap' }}>{m.label}</div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 11, color: 'var(--t-text-muted)', display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 4 }}>
        <span><i style={{ display: 'inline-block', width: 10, height: 10, background: C_NOS, borderRadius: 2, marginRight: 5 }} />Nos deben (EPO − IDP)</span>
        <span><i style={{ display: 'inline-block', width: 10, height: 10, background: C_DEB, borderRadius: 2, marginRight: 5 }} />Debemos (IPE − ED)</span>
        <span>Barra clara = ese mes se devolvió más de lo que se prestó</span>
      </div>
    </div>
  );
}

// Formatos de celda para los Excel
const FMT_COP = '"$"#,##0;[Red]-"$"#,##0';
const FMT_NUM = '#,##0.##;[Red]-#,##0.##';
const FMT_PCT = '0.0%';
const numDoc = d => { const m = String(d || '').match(/(\d+)/); return m ? parseInt(m[1], 10) : 0; };

// Agrega una hoja con encabezados, formato numérico por columna, anchos y autofiltro.
// cols: [{ h: encabezado, w: ancho, t: 'cop' | 'num' | 'pct' }]
function agregarHoja(wb, nombre, cols, filas, titulo, subtitulo) {
  const aoa = [];
  if (titulo) { aoa.push([titulo]); aoa.push(subtitulo ? [subtitulo] : []); if (subtitulo) aoa.push([]); }
  aoa.push(cols.map(c => c.h));
  filas.forEach(f => aoa.push(f));
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const off = titulo ? (subtitulo ? 4 : 3) : 1;
  filas.forEach((f, ri) => cols.forEach((c, ci) => {
    const cell = ws[XLSX.utils.encode_cell({ r: ri + off, c: ci })];
    if (cell && cell.t === 'n') cell.z = c.t === 'cop' ? FMT_COP : c.t === 'pct' ? FMT_PCT : c.t === 'num' ? FMT_NUM : undefined;
  }));
  ws['!cols'] = cols.map(c => ({ wch: c.w || 14 }));
  if (filas.length) ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: off - 1, c: 0 }, e: { r: off - 1 + filas.length, c: cols.length - 1 } }) };
  XLSX.utils.book_append_sheet(wb, ws, nombre.substring(0, 31));
}

// ─── Saldo real según cruces ─────────────────────────────────────────────────
// Por cada préstamo (EPO/IPE): lo prestado menos lo que ya se le abonó en los
// cruces (items_cruzados; si el cruce es viejo y no tiene detalle, los ítems
// de la devolución), más las devoluciones legadas ligadas directo al préstamo.
// En cruces manuales cuenta el código del préstamo al que se aplicó
// (codigo_prestamo). Solo cuentan devoluciones con fecha <= corte.
function abonadoPorCodigo(p, cruces, devPorId, devsLegado, fin) {
  const a = {};
  devsLegado.filter(d => d.prestamo_id === p.id && fechaDe(d) <= fin).forEach(d =>
    (d.items || []).forEach(i => { a[i.codigo] = (a[i.codigo] || 0) + Number(i.cantidad || 0); }));
  (cruces || []).filter(c => c.prestamo_id === p.id).forEach(c => {
    const d = devPorId[c.devolucion_id];
    if (d && fechaDe(d) > fin) return;
    const items = (c.items_cruzados !== null && c.items_cruzados !== undefined) ? c.items_cruzados : (c.devolucion_items || []);
    items.forEach(it => { const k = it.codigo_prestamo || it.codigo; a[k] = (a[k] || 0) + Number(it.cantidad || 0); });
  });
  return a;
}

// Unidades de una devolución (IDP/ED) que todavía no se han cruzado con ningún préstamo.
function disponibleDevolucion(d, cruces) {
  const asig = {};
  (cruces || []).filter(c => c.devolucion_id === d.id).forEach(c => {
    const items = (c.items_cruzados !== null && c.items_cruzados !== undefined) ? c.items_cruzados : (c.devolucion_items || []);
    items.forEach(it => { asig[it.codigo] = (asig[it.codigo] || 0) + Number(it.cantidad || 0); });
  });
  const tot = {};
  (d.items || []).forEach(i => {
    if (!tot[i.codigo]) tot[i.codigo] = { codigo: i.codigo, nombre: i.nombre, q: 0, v: 0 };
    tot[i.codigo].q += Number(i.cantidad || 0);
    tot[i.codigo].v += Number(i.cantidad || 0) * Number(i.precio_unitario || 0);
  });
  return Object.values(tot).map(t => {
    const q = Math.max(0, t.q - (asig[t.codigo] || 0));
    return { codigo: t.codigo, nombre: t.nombre, q, v: t.q ? q * (t.v / t.q) : 0 };
  }).filter(x => x.q > TOL);
}

export default function SaldosTerceros({ prestamos = [], clinicas = [], cruces = [] }) {
  const hoy = new Date().toISOString().substring(0, 10);
  // cruces = saldo real (préstamos menos lo abonado en cruces) · movs = todo lo prestado menos todo lo devuelto
  const [fuente, setFuente]   = useState('cruces');
  const esCruces = fuente === 'cruces';
  const [modo, setModo]       = useState('valor');     // valor | cantidad
  const [calculo, setCalculo] = useState('corte');     // corte (acumulado) | periodo
  const [anio, setAnio]       = useState('todos');
  const [desde, setDesde]     = useState('');
  const [hasta, setHasta]     = useState('');
  const [tercero, setTercero] = useState('todos');
  const [qProd, setQProd]     = useState('');
  const [verProd, setVerProd] = useState('nos');       // nos | deb
  const [qTer, setQTer]       = useState('');
  const [orden, setOrden]     = useState('nos');       // nos | deb | neto
  const [sel, setSel]         = useState(null);        // tercero abierto en detalle
  const [prodAbierto, setProdAbierto] = useState(null);

  // Solo los cuatro documentos que cuentan para el saldo.
  const movs = useMemo(() => (prestamos || []).filter(p => TIPOS[p.tipo] && fechaDe(p)), [prestamos]);

  const nombreTercero = useMemo(() => {
    const m = {};
    (clinicas || []).forEach(c => { if (c.id != null) m['id:' + c.id] = c.nombre; });
    return m;
  }, [clinicas]);
  const claveTercero = p => (p.clinica_id != null ? 'id:' + p.clinica_id : 'n:' + norm(p.clinica_nombre || 'SIN TERCERO'));
  const nomDe = (k, p) => nombreTercero[k] || p?.clinica_nombre || (k.startsWith('n:') ? k.slice(2) : 'Sin tercero');

  const anios = useMemo(() => [...new Set(movs.map(p => fechaDe(p).substring(0, 4)))].sort((a, b) => b - a), [movs]);

  function elegirAnio(a) {
    setAnio(a);
    if (a === 'todos') { setDesde(''); setHasta(''); }
    else { setDesde(`${a}-01-01`); setHasta(`${a}-12-31`); }
  }

  // Rango efectivo. En "saldo al corte" se toma todo lo anterior a "hasta".
  const ini = calculo === 'corte' ? '' : desde;
  const fin = hasta || '9999-12-31';

  const terceros = useMemo(() => {
    const m = {};
    movs.forEach(p => { const k = claveTercero(p); if (!m[k]) m[k] = nomDe(k, p); });
    return Object.entries(m).sort((a, b) => a[1].localeCompare(b[1]));
  }, [movs, nombreTercero]);

  const qp = qProd.trim().toLowerCase();
  const itemOk = i => !qp || String(i.codigo || '').toLowerCase().includes(qp) || String(i.nombre || '').toLowerCase().includes(qp);
  // ── Agregación principal (valor y unidades a la vez; "modo" solo elige qué se muestra) ──
  const base = useMemo(() => {
    const porTer = {};
    const porMes = {};
    const lineas = [];   // detalle a nivel de producto, para el Excel
    const enRango = movs.filter(p => {
      const f = fechaDe(p);
      return (!ini || f >= ini) && f <= fin && (tercero === 'todos' || claveTercero(p) === tercero);
    });
    const cero = () => ({ epo: 0, idp: 0, ipe: 0, ed: 0 });
    if (fuente === 'cruces') {
      const devPorId = {};
      const devsLegado = [];
      (prestamos || []).forEach(d => {
        if (d.tipo === 'devolucion_ingreso' || d.tipo === 'devolucion_egreso') { devPorId[d.id] = d; if (d.prestamo_id) devsLegado.push(d); }
      });
      const nuevoT = (k, p) => (porTer[k] = porTer[k] || { k, nombre: nomDe(k, p), V: cero(), Q: cero(), docs: [], prods: {}, ultima: '', devSinCruzar: [] });
      enRango.forEach(p => {
        const t = TIPOS[p.tipo];
        const k = claveTercero(p);
        const f = fechaDe(p);
        if (t.signo < 0) {
          // Devolución (IDP/ED): solo se usa para avisar lo que aún no se ha cruzado.
          const disp = disponibleDevolucion(p, cruces).filter(itemOk);
          if (disp.length) {
            const T = nuevoT(k, p);
            T.devSinCruzar.push({ id: p.id, fecha: f, doc: p.documento_contable, sigla: t.sigla, lado: t.lado,
              q: disp.reduce((a, x) => a + x.q, 0), v: disp.reduce((a, x) => a + x.v, 0),
              productos: disp.map(x => `${x.nombre || x.codigo} ×${num(x.q)}`).join('; ') });
          }
          return;
        }
        const abon = abonadoPorCodigo(p, cruces, devPorId, devsLegado, fin);
        const porCod = {};
        (p.items || []).filter(itemOk).forEach(i => {
          if (!porCod[i.codigo]) porCod[i.codigo] = { codigo: i.codigo, nombre: i.nombre, q: 0, v: 0 };
          porCod[i.codigo].q += Number(i.cantidad || 0);
          porCod[i.codigo].v += Number(i.cantidad || 0) * Number(i.precio_unitario || 0);
        });
        const lista = Object.values(porCod);
        if (qp && !lista.length) return;
        const T = nuevoT(k, p);
        const sk = t.sigla.toLowerCase();          // epo | ipe
        const skAb = sk === 'epo' ? 'idp' : 'ed';  // columna de lo abonado
        let presV = 0, presQ = 0, pendV = 0, pendQ = 0;
        const pendientes = [];
        lista.forEach(c => {
          const pu = c.q ? c.v / c.q : 0;
          const pq = Math.max(0, c.q - (abon[c.codigo] || 0));
          const pv = pq * pu;
          presV += c.v; presQ += c.q; pendV += pv; pendQ += pq;
          if (pq > TOL) {
            pendientes.push({ codigo: c.codigo, nombre: c.nombre, q: pq, v: pv });
            const pk = String(c.codigo || c.nombre || '—');
            if (!T.prods[pk]) T.prods[pk] = { codigo: c.codigo || '', nombre: c.nombre || '', nosQ: 0, nosV: 0, debQ: 0, debV: 0 };
            T.prods[pk][t.lado + 'Q'] += pq; T.prods[pk][t.lado + 'V'] += pv;
            lineas.push({ fecha: f, doc: p.documento_contable, sigla: t.sigla, txt: 'Pendiente', lado: t.lado, signo: 1,
              tercero: T.nombre, bodega: p.bodega_nombre || p.bodega_codigo || '', codigo: c.codigo || '', nombre: c.nombre || '',
              q: pq, pu, v: pv, lote: '' });
          }
        });
        T.V[sk] += presV; T.Q[sk] += presQ;
        T.V[skAb] += presV - pendV; T.Q[skAb] += presQ - pendQ;
        if (pendQ > TOL) {
          T.docs.push({ id: p.id, fecha: f, doc: p.documento_contable, sigla: t.sigla,
            txt: 'Pendiente: ' + pendientes.map(x => `${x.nombre || x.codigo} ×${num(x.q)}`).join('; '),
            lado: t.lado, signo: 1, valorV: pendV, valorQ: pendQ, prestadoV: presV, prestadoQ: presQ,
            estado: p.estado, pendientes, bodega: p.bodega_nombre || p.bodega_codigo || '', obs: p.observaciones || '' });
          if (!desde || f >= desde) {
            const mk = f.substring(0, 7);
            if (!porMes[mk]) porMes[mk] = { k: mk, label: `${MESES[Number(mk.substring(5, 7)) - 1]} ${mk.substring(2, 4)}`,
              V: { nos: 0, deb: 0, ...cero() }, Q: { nos: 0, deb: 0, ...cero() } };
            porMes[mk].V[t.lado] += pendV; porMes[mk].Q[t.lado] += pendQ;
            porMes[mk].V[sk] += pendV; porMes[mk].Q[sk] += pendQ;
          }
        }
        if (f > T.ultima) T.ultima = f;
      });
    } else
    enRango.forEach(p => {
      const t = TIPOS[p.tipo];
      const k = claveTercero(p);
      const f = fechaDe(p);
      const items = (p.items || []).filter(itemOk);
      if (qp && !items.length) return;
      if (!porTer[k]) porTer[k] = { k, nombre: nomDe(k, p), V: cero(), Q: cero(), docs: [], prods: {}, ultima: '', devSinCruzar: [] };
      const T = porTer[k];
      const sk = t.sigla.toLowerCase();
      let docV = 0, docQ = 0;
      items.forEach(i => {
        const q = Number(i.cantidad || 0);
        const pu = Number(i.precio_unitario || 0);
        const vv = q * pu;
        docV += vv; docQ += q;
        T.V[sk] += vv; T.Q[sk] += q;
        const pk = String(i.codigo || i.nombre || '—');
        if (!T.prods[pk]) T.prods[pk] = { codigo: i.codigo || '', nombre: i.nombre || '', nosQ: 0, nosV: 0, debQ: 0, debV: 0 };
        const P = T.prods[pk];
        if (!P.nombre && i.nombre) P.nombre = i.nombre;
        P[t.lado + 'Q'] += t.signo * q;
        P[t.lado + 'V'] += t.signo * vv;
        lineas.push({ fecha: f, doc: p.documento_contable, sigla: t.sigla, txt: t.txt, lado: t.lado, signo: t.signo,
          tercero: T.nombre, bodega: p.bodega_nombre || p.bodega_codigo || '', codigo: i.codigo || '', nombre: i.nombre || '',
          q, pu, v: vv, lote: i.lote || '' });
      });
      T.docs.push({ id: p.id, fecha: f, doc: p.documento_contable, sigla: t.sigla, txt: t.txt, lado: t.lado, signo: t.signo,
        valorV: docV, valorQ: docQ, bodega: p.bodega_nombre || p.bodega_codigo || '', obs: p.observaciones || '' });
      if (f > T.ultima) T.ultima = f;
      // Tendencia: solo dentro del periodo visible (en "corte" se muestra desde "desde" si lo hay)
      if (!desde || f >= desde) {
        const mk = f.substring(0, 7);
        if (!porMes[mk]) porMes[mk] = { k: mk, label: `${MESES[Number(mk.substring(5, 7)) - 1]} ${mk.substring(2, 4)}`,
          V: { nos: 0, deb: 0, ...cero() }, Q: { nos: 0, deb: 0, ...cero() } };
        porMes[mk].V[t.lado] += t.signo * docV; porMes[mk].Q[t.lado] += t.signo * docQ;
        porMes[mk].V[sk] += docV; porMes[mk].Q[sk] += docQ;
      }
    });
    const lista = Object.values(porTer).map(T => {
      const sal = S => ({ nos: S.epo - S.idp, deb: S.ipe - S.ed, neto: (S.epo - S.idp) - (S.ipe - S.ed) });
      return { ...T, sV: sal(T.V), sQ: sal(T.Q) };
    });
    // Productos: el saldo se mira por tercero + producto; lo que un tercero
    // devolvió de más de un producto no tapa la deuda de otro tercero.
    const prods = {};
    let sobrantes = 0;
    lista.forEach(T => Object.entries(T.prods).forEach(([pk, P]) => {
      if (!prods[pk]) prods[pk] = { codigo: P.codigo, nombre: P.nombre, nosQ: 0, nosV: 0, debQ: 0, debV: 0, terNos: [], terDeb: [] };
      const G = prods[pk];
      if (P.nosQ > TOL) { G.nosQ += P.nosQ; G.nosV += Math.max(0, P.nosV); G.terNos.push({ nombre: T.nombre, q: P.nosQ, v: Math.max(0, P.nosV) }); }
      if (P.debQ > TOL) { G.debQ += P.debQ; G.debV += Math.max(0, P.debV); G.terDeb.push({ nombre: T.nombre, q: P.debQ, v: Math.max(0, P.debV) }); }
      if (P.nosQ < -TOL || P.debQ < -TOL) sobrantes++;
    }));
    const meses = Object.values(porMes).sort((a, b) => a.k.localeCompare(b.k));
    return { lista, prods: Object.values(prods), meses, sobrantes, nDocs: enRango.length, lineas };
  }, [movs, ini, fin, desde, tercero, qp, nombreTercero, fuente, cruces, prestamos]);

  // Vista según el modo elegido (valor $ o unidades).
  const datos = useMemo(() => {
    const cant = modo === 'cantidad';
    const lista = base.lista.map(T => {
      const S = cant ? T.Q : T.V, s = cant ? T.sQ : T.sV;
      return { ...T, ...S, ...s, docs: T.docs.map(d => ({ ...d, valor: cant ? d.valorQ : d.valorV })) };
    });
    const meses = base.meses.map(m => ({ ...m, nos: (cant ? m.Q : m.V).nos, deb: (cant ? m.Q : m.V).deb }));
    return { ...base, lista, meses };
  }, [base, modo]);

  const fmtV = v => (modo === 'cantidad' ? num(v) + ' und' : cop(v));
  const totNos = datos.lista.reduce((s, t) => s + Math.max(0, t.nos), 0);
  const totDeb = datos.lista.reduce((s, t) => s + Math.max(0, t.deb), 0);
  const conNos = datos.lista.filter(t => t.nos > TOL).length;
  const conDeb = datos.lista.filter(t => t.deb > TOL).length;

  const topNos = [...datos.lista].filter(t => t.nos > TOL).sort((a, b) => b.nos - a.nos).slice(0, 10).map(t => ({ k: t.k, label: t.nombre, v: t.nos }));
  const topDeb = [...datos.lista].filter(t => t.deb > TOL).sort((a, b) => b.deb - a.deb).slice(0, 10).map(t => ({ k: t.k, label: t.nombre, v: t.deb }));

  const campoProd = verProd === 'nos' ? (modo === 'cantidad' ? 'nosQ' : 'nosV') : (modo === 'cantidad' ? 'debQ' : 'debV');
  const topProds = datos.prods.filter(p => p[campoProd] > TOL).sort((a, b) => b[campoProd] - a[campoProd]);

  const qt = qTer.trim().toLowerCase();
  const tabla = datos.lista
    .filter(t => !qt || t.nombre.toLowerCase().includes(qt))
    .filter(t => Math.abs(t.nos) > TOL || Math.abs(t.deb) > TOL || t.epo || t.ipe)
    .sort((a, b) => (orden === 'neto' ? Math.abs(b.neto) - Math.abs(a.neto) : b[orden] - a[orden]));

  const detalle = sel ? datos.lista.find(t => t.k === sel) : null;
  React.useEffect(() => {
    if (!sel) return;
    const el = document.getElementById(`tercero-${sel}`);
    if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }, [sel]);

  // ── Exportación a Excel: una hoja por cada bloque del dashboard ─────────
  function exportar() {
    const wb = XLSX.utils.book_new();
    // cols: [{ h: encabezado, w: ancho, t: 'cop' | 'num' | 'pct' | undefined }]
    const hoja = (...args) => agregarHoja(wb, ...args);
    const L = base.lista;
    const pos = x => Math.max(0, x);
    const tNosV = L.reduce((s, t) => s + pos(t.sV.nos), 0), tDebV = L.reduce((s, t) => s + pos(t.sV.deb), 0);
    const tNosQ = L.reduce((s, t) => s + pos(t.sQ.nos), 0), tDebQ = L.reduce((s, t) => s + pos(t.sQ.deb), 0);
    const nomTer = tercero === 'todos' ? 'Todos' : (terceros.find(([k]) => k === tercero) || [, tercero])[1];

    // 1. Resumen
    const topV = [...L].sort((a, b) => b.sV.nos - a.sV.nos)[0];
    const topD = [...L].sort((a, b) => b.sV.deb - a.sV.deb)[0];
    const resumen = [
      ['Generado', new Date().toLocaleString('es-CO')],
      ['Cálculo', calculo === 'corte' ? 'Saldo al corte (acumulado desde el inicio)' : 'Solo movimientos del periodo'],
      ['Año', anio === 'todos' ? 'Todos' : anio],
      ['Desde', calculo === 'corte' ? 'Inicio' : (desde || 'Inicio')],
      ['Hasta (corte)', hasta || hoy],
      ['Tercero', nomTer],
      ['Producto (filtro)', qProd || 'Todos'],
      [],
      ['Indicador', 'Valor ($)', 'Unidades'],
      ['Nos deben (EPO − IDP)', tNosV, tNosQ],
      ['Le debemos (IPE − ED)', tDebV, tDebQ],
      ['Saldo neto', tNosV - tDebV, tNosQ - tDebQ],
      ['Terceros que nos deben', L.filter(t => t.sV.nos > TOL).length, L.filter(t => t.sQ.nos > TOL).length],
      ['Terceros a los que debemos', L.filter(t => t.sV.deb > TOL).length, L.filter(t => t.sQ.deb > TOL).length],
      ['Quien más nos debe', topV && topV.sV.nos > TOL ? `${topV.nombre}` : '—', topV && topV.sV.nos > TOL ? topV.sV.nos : ''],
      ['A quien más le debemos', topD && topD.sV.deb > TOL ? `${topD.nombre}` : '—', topD && topD.sV.deb > TOL ? topD.sV.deb : ''],
      ['Documentos considerados', base.nDocs, ''],
      ['Combinaciones tercero-producto con devoluciones de más', base.sobrantes, ''],
      [],
      ['Criterio', 'Nos debe = EPO − IDP · Le debemos = IPE − ED. Los saldos negativos (devoluciones de más) no se suman en los totales de deuda.'],
    ];
    const wsR = XLSX.utils.aoa_to_sheet([['Saldos de préstamos por tercero'], [], ...resumen]);
    [11, 12, 13, 16, 17].forEach(r0 => {
      const c1 = wsR[XLSX.utils.encode_cell({ r: r0, c: 1 })]; if (c1 && c1.t === 'n') c1.z = FMT_COP;
      const c2 = wsR[XLSX.utils.encode_cell({ r: r0, c: 2 })]; if (c2 && c2.t === 'n') c2.z = r0 >= 16 ? FMT_COP : FMT_NUM;
    });
    wsR['!cols'] = [{ wch: 48 }, { wch: 40 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, wsR, 'Resumen');

    // 2. Saldos por tercero (valor y unidades)
    const filasT = [...L].sort((a, b) => b.sV.nos - a.sV.nos).map(t => [
      t.nombre, t.sV.nos, t.sV.deb, t.sV.neto, t.V.epo, t.V.idp, t.V.ipe, t.V.ed,
      t.sQ.nos, t.sQ.deb, t.Q.epo, t.Q.idp, t.Q.ipe, t.Q.ed,
      t.docs.length, t.ultima,
    ]);
    hoja('Saldos por tercero', [
      { h: 'Tercero', w: 38 }, { h: 'Nos debe ($)', t: 'cop', w: 16 }, { h: 'Le debemos ($)', t: 'cop', w: 16 }, { h: 'Neto ($)', t: 'cop', w: 16 },
      { h: 'Prestado EPO ($)', t: 'cop', w: 16 }, { h: 'Devuelto IDP ($)', t: 'cop', w: 16 }, { h: 'Recibido IPE ($)', t: 'cop', w: 16 }, { h: 'Devolvimos ED ($)', t: 'cop', w: 16 },
      { h: 'Nos debe (und)', t: 'num' }, { h: 'Le debemos (und)', t: 'num' },
      { h: 'Prestado EPO (und)', t: 'num' }, { h: 'Devuelto IDP (und)', t: 'num' }, { h: 'Recibido IPE (und)', t: 'num' }, { h: 'Devolvimos ED (und)', t: 'num' },
      { h: 'Documentos', t: 'num', w: 11 }, { h: 'Último movimiento', w: 16 },
    ], filasT);

    // 3 y 4. Rankings
    const ranking = (campo) => {
      const fil = L.filter(t => t.sV[campo] > TOL).sort((a, b) => b.sV[campo] - a.sV[campo]);
      const tot = fil.reduce((s, t) => s + t.sV[campo], 0) || 1;
      let acum = 0;
      return fil.map((t, i) => { acum += t.sV[campo]; return [i + 1, t.nombre, t.sV[campo], t.sQ[campo], t.sV[campo] / tot, acum / tot]; });
    };
    const colsRank = (tit) => [{ h: '#', w: 5 }, { h: 'Tercero', w: 38 }, { h: tit + ' ($)', t: 'cop', w: 16 }, { h: tit + ' (und)', t: 'num' }, { h: '% del total', t: 'pct', w: 11 }, { h: '% acumulado', t: 'pct', w: 12 }];
    hoja('Clínicas que más nos deben', colsRank('Nos debe'), ranking('nos'), 'Clínicas que más nos deben (EPO − IDP)');
    hoja('A quiénes más debemos', colsRank('Le debemos'), ranking('deb'), 'Terceros a los que más les debemos (IPE − ED)');

    // 5 y 6. Productos
    const hp = lado => {
      const fil = base.prods.filter(p => p[lado + 'Q'] > TOL).sort((a, b) => b[lado + 'V'] - a[lado + 'V']);
      const tot = fil.reduce((s, p) => s + p[lado + 'V'], 0) || 1;
      return fil.map((p, i) => {
        const ters = (lado === 'nos' ? p.terNos : p.terDeb).slice().sort((a, b) => b.v - a.v);
        return [i + 1, p.codigo, p.nombre, p[lado + 'Q'], p[lado + 'V'], p[lado + 'V'] / tot, ters.length, ters[0]?.nombre || '', ters.map(x => `${x.nombre} (${num(x.q)})`).join('; ')];
      });
    };
    const colsP = [{ h: '#', w: 5 }, { h: 'Código', w: 13 }, { h: 'Producto', w: 42 }, { h: 'Cantidad', t: 'num', w: 12 }, { h: 'Valor ($)', t: 'cop', w: 16 },
      { h: '% del valor', t: 'pct', w: 11 }, { h: 'N.º terceros', t: 'num', w: 11 }, { h: 'Tercero con más saldo', w: 32 }, { h: 'Terceros (cantidad)', w: 70 }];
    hoja('Productos que nos deben', colsP, hp('nos'), 'Productos que más nos deben');
    hoja('Productos que debemos', colsP, hp('deb'), 'Productos que más debemos');

    // 7. Detalle tercero-producto (lo que se ve al abrir cada tercero), con sobrantes
    const tp = [];
    L.forEach(t => Object.values(t.prods).forEach(p => {
      [['nos', 'Nos debe'], ['deb', 'Le debemos']].forEach(([lado, txt]) => {
        if (Math.abs(p[lado + 'Q']) > TOL || Math.abs(p[lado + 'V']) > TOL)
          tp.push([t.nombre, txt, p.codigo, p.nombre, p[lado + 'Q'], p[lado + 'V'], p[lado + 'Q'] < -TOL ? 'Devolvió de más' : (p[lado + 'Q'] > TOL ? 'Pendiente' : 'Saldado')]);
      });
    }));
    tp.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]) || b[5] - a[5]);
    hoja('Tercero - producto', [{ h: 'Tercero', w: 38 }, { h: 'Lado', w: 12 }, { h: 'Código', w: 13 }, { h: 'Producto', w: 42 },
      { h: 'Saldo (und)', t: 'num', w: 12 }, { h: 'Saldo ($)', t: 'cop', w: 16 }, { h: 'Estado', w: 16 }], tp);

    // 8. Variación mensual
    hoja('Variación mensual', [{ h: 'Mes', w: 10 }, { h: 'Prestado EPO ($)', t: 'cop', w: 16 }, { h: 'Devuelto IDP ($)', t: 'cop', w: 16 }, { h: 'Variación nos deben ($)', t: 'cop', w: 20 },
      { h: 'Recibido IPE ($)', t: 'cop', w: 16 }, { h: 'Devolvimos ED ($)', t: 'cop', w: 16 }, { h: 'Variación debemos ($)', t: 'cop', w: 20 },
      { h: 'Variación nos deben (und)', t: 'num', w: 20 }, { h: 'Variación debemos (und)', t: 'num', w: 20 }],
      base.meses.map(m => [m.k, m.V.epo, m.V.idp, m.V.nos, m.V.ipe, m.V.ed, m.V.deb, m.Q.nos, m.Q.deb]));

    // 9. Movimientos (documentos)
    const docs = [];
    L.forEach(t => t.docs.forEach(d => docs.push([d.fecha, d.doc, d.sigla, d.txt, t.nombre, d.bodega, d.valorQ, d.valorV,
      d.lado === 'nos' ? (d.signo > 0 ? 'Aumenta lo que nos deben' : 'Disminuye lo que nos deben') : (d.signo > 0 ? 'Aumenta lo que debemos' : 'Disminuye lo que debemos'), d.obs])));
    docs.sort((a, b) => a[0].localeCompare(b[0]) || String(a[1]).localeCompare(String(b[1])));
    hoja('Movimientos', [{ h: 'Fecha', w: 11 }, { h: 'Documento', w: 13 }, { h: 'Tipo', w: 6 }, { h: 'Movimiento', w: 20 }, { h: 'Tercero', w: 38 }, { h: 'Bodega', w: 24 },
      { h: 'Unidades', t: 'num', w: 11 }, { h: 'Valor ($)', t: 'cop', w: 16 }, { h: 'Efecto', w: 26 }, { h: 'Observaciones', w: 40 }], docs);

    // 10. Movimientos por producto (línea a línea)
    const lin = base.lineas.slice().sort((a, b) => a.fecha.localeCompare(b.fecha) || String(a.doc).localeCompare(String(b.doc)))
      .map(l => [l.fecha, l.doc, l.sigla, l.tercero, l.codigo, l.nombre, l.lote, l.q, l.pu, l.v, l.lado === 'nos' ? 'Nos deben' : 'Debemos', l.signo > 0 ? 'Suma' : 'Resta']);
    hoja('Movimientos por producto', [{ h: 'Fecha', w: 11 }, { h: 'Documento', w: 13 }, { h: 'Tipo', w: 6 }, { h: 'Tercero', w: 36 }, { h: 'Código', w: 13 }, { h: 'Producto', w: 40 },
      { h: 'Lote', w: 12 }, { h: 'Cantidad', t: 'num', w: 10 }, { h: 'Precio unit. ($)', t: 'cop', w: 15 }, { h: 'Valor ($)', t: 'cop', w: 15 }, { h: 'Lado', w: 11 }, { h: 'Efecto', w: 8 }], lin);

    XLSX.writeFile(wb, `saldos_por_tercero_${hasta || hoy}.xlsx`);
  }

  // Texto con los filtros aplicados (va en el encabezado de los reportes).
  function textoFiltrosExcel() {
    const nomTer = tercero === 'todos' ? 'Todos' : (terceros.find(([k]) => k === tercero) || [, tercero])[1];
    return `Corte: ${hasta || hoy} · ${calculo === 'corte' ? 'Saldo acumulado desde el inicio' : 'Solo el periodo desde ' + (desde || 'el inicio')}`
      + ` · Tercero: ${nomTer} · Producto: ${qProd || 'Todos'} · Generado: ${new Date().toLocaleString('es-CO')}`;
  }

  // ── Excel: documentos y productos de un tercero ─────────────────────────
  function exportarTerceroExcel(det) {
    const wb = XLSX.utils.book_new();
    const sub = textoFiltrosExcel()
      + ` · Nos debe: ${fmtV(det.nos)} · Le debemos: ${fmtV(det.deb)} · Neto: ${fmtV(det.neto)}`;
    const docs = [...det.docs].sort((a, b) => b.fecha.localeCompare(a.fecha));
    agregarHoja(wb, 'Documentos', [
      { h: 'Fecha elaboración', w: 13 }, { h: 'Documento', w: 13 }, { h: 'Tipo', w: 7 }, { h: 'Movimiento', w: 24 },
      { h: 'Bodega', w: 26 }, { h: 'Cantidad', t: 'num', w: 11 }, { h: 'Valor ($)', t: 'cop', w: 16 },
      { h: 'Efecto', w: 13 }, { h: 'Observaciones', w: 40 }],
      docs.map(d => [d.fecha, d.doc, d.sigla, d.txt, d.bodega || '', Number(d.valorQ || 0), Math.round(Number(d.valorV || 0)),
        `${d.signo > 0 ? 'Suma' : 'Resta'} · ${d.lado === 'nos' ? 'nos debe' : 'debemos'}`, d.obs || '']),
      `Documentos de ${det.nombre}`, sub);
    const prods = [];
    [['nos', 'Nos debe'], ['deb', 'Le debemos']].forEach(([lado, txt]) =>
      Object.values(det.prods).filter(p => Math.abs(p[lado + 'Q']) > TOL)
        .sort((a, b) => b[lado + 'V'] - a[lado + 'V'])
        .forEach(p => prods.push([txt, p.codigo, p.nombre, Number(p[lado + 'Q']), Math.round(Number(p[lado + 'V']))])));
    agregarHoja(wb, 'Productos', [{ h: 'Saldo', w: 12 }, { h: 'Código', w: 14 }, { h: 'Producto', w: 50 },
      { h: 'Cantidad', t: 'num', w: 11 }, { h: 'Valor ($)', t: 'cop', w: 16 }], prods, `Productos con saldo · ${det.nombre}`, sub);
    const nom = det.nombre.replace(/[\\/:*?"<>|]/g, '').trim().replace(/\s+/g, '_');
    XLSX.writeFile(wb, `documentos_${nom}_${hasta || hoy}.xlsx`);
  }

  // ── PDF: listado de documentos de un tercero ────────────────────────────
  // Arma una página lista para imprimir y abre el diálogo del navegador,
  // donde se elige "Guardar como PDF" (no requiere librerías adicionales).
  function imprimirDocsPdf(det) {
    const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const docs = [...det.docs].sort((a, b) => b.fecha.localeCompare(a.fecha));
    const filas = docs.map(d => `<tr>
      <td class="nw">${esc(d.fecha)}</td><td><b>${esc(d.doc)}</b></td>
      <td><span class="sig">${esc(d.sigla)}</span>${esc(d.txt)}</td><td>${esc(d.bodega)}</td>
      <td class="r nw">${esc(fmtV(d.valor))}</td>
      <td class="r nw" style="color:${d.lado === 'nos' ? C_NOS : C_DEB}">${d.signo > 0 ? '▲' : '▼'} ${d.lado === 'nos' ? 'nos debe' : 'debemos'}</td></tr>`).join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Documentos ${esc(det.nombre)}</title>
      <style>
        @page { size: letter; margin: 14mm 12mm 16mm; }
        body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 11px; margin: 0; }
        h1 { font-size: 16px; margin: 0 0 4px; } .f { color: #555; font-size: 10px; margin-bottom: 8px; }
        .tot { font-size: 12px; margin: 6px 0 12px; } .tot b { margin-right: 14px; }
        table { width: 100%; border-collapse: collapse; }
        th { background: #f1f5f9; text-align: left; font-size: 10px; text-transform: uppercase; padding: 6px; border-bottom: 1.5px solid #94a3b8; }
        td { padding: 5px 6px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
        thead { display: table-header-group; } tr { page-break-inside: avoid; }
        .r { text-align: right; } .nw { white-space: nowrap; }
        .sig { font-size: 9px; font-weight: 700; padding: 1px 5px; border-radius: 4px; background: #e2e8f0; margin-right: 5px; }
      </style></head><body>
      <h1>Documentos de ${esc(det.nombre)}</h1>
      <div class="f">${esc(textoFiltrosExcel())}</div>
      <div class="tot"><b style="color:${C_NOS}">Nos debe ${esc(fmtV(det.nos))}</b><b style="color:${C_DEB}">Le debemos ${esc(fmtV(det.deb))}</b><b>Neto ${esc(fmtV(det.neto))}</b></div>
      <div style="font-weight:700;margin-bottom:4px">Documentos (${docs.length}) · del más reciente al más antiguo</div>
      <table><thead><tr><th>Fecha elaboración</th><th>Documento</th><th>Movimiento</th><th>Bodega</th><th class="r">Valor</th><th class="r">Efecto</th></tr></thead>
      <tbody>${filas || '<tr><td colspan="6">Sin documentos</td></tr>'}</tbody></table>
      </body></html>`;
    // Iframe oculto: evita el bloqueo de ventanas emergentes
    const fr = document.createElement('iframe');
    fr.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    document.body.appendChild(fr);
    const w = fr.contentWindow;
    w.document.open(); w.document.write(html); w.document.close();
    const prevTitle = document.title;
    // El nombre sugerido del archivo PDF sale del título del documento
    document.title = `Documentos ${det.nombre}`.replace(/[\\/:*?"<>|]/g, '');
    setTimeout(() => {
      w.focus(); w.print();
      setTimeout(() => { document.title = prevTitle; fr.remove(); }, 1000);
    }, 250);
  }

  // ── Excel compacto: solo saldos por tercero ─────────────────────────────
  function exportarCompacto() {
    const filas = base.lista
      .filter(t => Math.abs(t.sV.nos) > 0.5 || Math.abs(t.sV.deb) > 0.5)
      .sort((a, b) => b.sV.neto - a.sV.neto);
    const aoa = [['Saldos de préstamos por tercero'], [textoFiltrosExcel()], [],
      ['Tercero', 'Nos debe ($)', 'Le debemos ($)', 'Diferencia ($)', 'A favor de']];
    filas.forEach(t => aoa.push([t.nombre, Math.round(t.sV.nos), Math.round(t.sV.deb), Math.round(t.sV.neto),
      t.sV.neto > 0.5 ? 'Nosotros' : (t.sV.neto < -0.5 ? 'El tercero' : 'Saldado')]));
    const r1 = 5, rN = 4 + filas.length;   // filas de datos en notación de Excel (1-based)
    aoa.push(['TOTAL']);
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const rt = rN; // índice 0-based de la fila TOTAL
    if (filas.length) {
      ws[XLSX.utils.encode_cell({ r: rt, c: 1 })] = { t: 'n', f: `SUMIF(B${r1}:B${rN},">0")` };
      ws[XLSX.utils.encode_cell({ r: rt, c: 2 })] = { t: 'n', f: `SUMIF(C${r1}:C${rN},">0")` };
      ws[XLSX.utils.encode_cell({ r: rt, c: 3 })] = { t: 'n', f: `B${rN + 1}-C${rN + 1}` };
    }
    for (let r = 4; r <= rt; r++) for (let c = 1; c <= 3; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })]; if (cell) cell.z = FMT_COP;
    }
    ws['!cols'] = [{ wch: 42 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 13 }];
    if (filas.length) ws['!autofilter'] = { ref: `A4:E${rN}` };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Saldos por tercero');
    XLSX.writeFile(wb, `saldos_terceros_compacto_${hasta || hoy}.xlsx`);
  }

  // ── Reporte de devoluciones de más (unidades y $) ──────────────────────
  // Se revisa cada tercero + producto en orden cronológico: préstamos suman y
  // devoluciones restan; el documento con el que el saldo queda por debajo de
  // cero es el que devolvió de más, y el exceso es la parte que sobrepasó.
  function analizarExcesos() {
    const grupos = {};
    base.lineas.forEach(l => {
      const g = `${l.tercero}|${l.lado}|${l.codigo || l.nombre}`;
      (grupos[g] = grupos[g] || []).push(l);
    });
    const pares = [], docs = [];
    Object.values(grupos).forEach(ls => {
      ls.sort((a, b) => a.fecha.localeCompare(b.fecha) || (b.signo - a.signo) || numDoc(a.doc) - numDoc(b.doc));
      let sq = 0, presQ = 0, devQ = 0, presV = 0, devV = 0, excQdocs = 0, excVdocs = 0;
      const docsPres = new Set(), docsDev = new Set(), docsPar = [];
      ls.forEach(l => {
        if (l.signo > 0) { presQ += l.q; presV += l.v; docsPres.add(l.doc); sq += l.q; return; }
        devQ += l.q; devV += l.v; docsDev.add(l.doc);
        const antes = sq; sq -= l.q;
        if (sq < -TOL) {
          const exc = Math.min(l.q, -sq);        // solo lo que pasó de cero en este documento
          excQdocs += exc; excVdocs += exc * l.pu;
          docsPar.push({ ...l, antes, exc, excV: exc * l.pu, despues: sq });
        }
      });
      const excQ = devQ - presQ, excV = devV - presV;
      // Solo se listan documentos de productos que siguen con exceso al corte
      // (si después se registró el préstamo que faltaba, ya no es exceso).
      if (excQ > TOL) docsPar.forEach(d => docs.push({ ...d, excFinal: excQ }));
      if (excQ > TOL || excV > 0.5) {
        const l0 = ls[0];
        pares.push({ tercero: l0.tercero, lado: l0.lado, codigo: l0.codigo, nombre: l0.nombre,
          presQ, devQ, excQ: Math.max(0, excQ), presV, devV, excV: Math.max(0, excV),
          causa: excQ > TOL ? 'Se devolvieron más unidades de las prestadas' : 'Mismas unidades, pero devueltas a mayor precio',
          docsPres: [...docsPres].join(', '), docsDev: [...docsDev].join(', ') });
      }
    });
    return { pares, docs };
  }

  function exportarExcesos() {
    const { pares, docs } = analizarExcesos();
    const wb = XLSX.utils.book_new();
    const hoja = (...a) => agregarHoja(wb, ...a);
    const ladoTxt = l => (l === 'nos' ? 'Nos devolvieron de más (IDP)' : 'Devolvimos de más (ED)');
    const aviso = calculo === 'periodo'
      ? ' · OJO: con "Solo el periodo" pueden aparecer devoluciones de préstamos hechos antes del periodo; para revisar excesos reales use "Saldo al corte".' : '';

    // Por tercero
    const pt = {};
    pares.forEach(p => {
      const k = p.tercero + '|' + p.lado;
      if (!pt[k]) pt[k] = { tercero: p.tercero, lado: p.lado, productos: 0, excQ: 0, excV: 0 };
      pt[k].productos++; pt[k].excQ += p.excQ; pt[k].excV += p.excV;
    });
    hoja('Por tercero', [{ h: 'Tercero', w: 40 }, { h: 'Caso', w: 30 }, { h: 'Productos con exceso', t: 'num', w: 12 },
      { h: 'Exceso (und)', t: 'num', w: 13 }, { h: 'Exceso ($)', t: 'cop', w: 16 }],
      Object.values(pt).sort((a, b) => b.excV - a.excV).map(x => [x.tercero, ladoTxt(x.lado), x.productos, x.excQ, x.excV]),
      'Devoluciones de más por tercero', textoFiltrosExcel() + aviso);

    // Por tercero y producto
    hoja('Por producto', [{ h: 'Tercero', w: 36 }, { h: 'Caso', w: 28 }, { h: 'Código', w: 13 }, { h: 'Producto', w: 40 },
      { h: 'Prestado (und)', t: 'num', w: 12 }, { h: 'Devuelto (und)', t: 'num', w: 12 }, { h: 'Exceso (und)', t: 'num', w: 12 },
      { h: 'Prestado ($)', t: 'cop', w: 15 }, { h: 'Devuelto ($)', t: 'cop', w: 15 }, { h: 'Exceso ($)', t: 'cop', w: 15 },
      { h: 'Causa', w: 40 }, { h: 'Documentos de préstamo', w: 34 }, { h: 'Documentos de devolución', w: 34 }],
      pares.sort((a, b) => b.excV - a.excV).map(p => [p.tercero, ladoTxt(p.lado), p.codigo, p.nombre, p.presQ, p.devQ, p.excQ,
        p.presV, p.devV, p.excV, p.causa, p.docsPres || '(sin préstamo registrado)', p.docsDev]),
      'Productos devueltos de más (tercero + producto)', textoFiltrosExcel() + aviso);

    // Documentos que generaron el exceso
    hoja('Documentos', [{ h: 'Fecha', w: 11 }, { h: 'Documento', w: 13 }, { h: 'Tipo', w: 6 }, { h: 'Tercero', w: 36 },
      { h: 'Código', w: 13 }, { h: 'Producto', w: 40 }, { h: 'Lote', w: 12 }, { h: 'Saldo antes (und)', t: 'num', w: 13 },
      { h: 'Cantidad devuelta', t: 'num', w: 12 }, { h: 'Saldo después (und)', t: 'num', w: 13 }, { h: 'Exceso en este doc. (und)', t: 'num', w: 14 },
      { h: 'Precio unit. ($)', t: 'cop', w: 14 }, { h: 'Valor devuelto ($)', t: 'cop', w: 15 }, { h: 'Exceso ($)', t: 'cop', w: 15 },
      { h: 'Exceso total del producto al corte (und)', t: 'num', w: 18 }],
      docs.sort((a, b) => a.fecha.localeCompare(b.fecha) || numDoc(a.doc) - numDoc(b.doc)).map(d => [d.fecha, d.doc, d.sigla, d.tercero,
        d.codigo, d.nombre, d.lote, d.antes, d.q, d.despues, d.exc, d.pu, d.v, d.excV, d.excFinal]),
      'Documentos con los que se devolvió de más', textoFiltrosExcel() + aviso);

    if (!pares.length) alert('No hay devoluciones de más con los filtros actuales. Se descarga el reporte vacío.');
    XLSX.writeFile(wb, `devoluciones_de_mas_${hasta || hoy}.xlsx`);
  }

  const textoCorte = calculo === 'corte'
    ? `Saldo acumulado al ${hasta || 'día de hoy'}: todos los movimientos hasta esa fecha.`
    : `Solo movimientos ${desde ? 'desde el ' + desde : 'desde el inicio'} ${hasta ? 'hasta el ' + hasta : 'hasta hoy'}.`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Filtros */}
      <div style={{ ...card, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, alignItems: 'end' }}>
        <div><span style={label}>Año</span>
          <select style={{ ...input, width: '100%' }} value={anio} onChange={e => elegirAnio(e.target.value)}>
            <option value="todos">Todos</option>{anios.map(a => <option key={a} value={a}>{a}</option>)}
          </select></div>
        <div><span style={label}>Desde</span>
          <input type="date" style={{ ...input, width: '100%', opacity: calculo === 'corte' ? 0.5 : 1 }} value={desde}
            onChange={e => { setDesde(e.target.value); setAnio('todos'); }} title={calculo === 'corte' ? 'En "Saldo al corte" se toma desde el inicio; la fecha solo limita la tendencia mensual' : ''} /></div>
        <div><span style={label}>Hasta (corte)</span>
          <input type="date" style={{ ...input, width: '100%' }} value={hasta} onChange={e => { setHasta(e.target.value); setAnio('todos'); }} /></div>
        <div><span style={label}>Tercero</span>
          <select style={{ ...input, width: '100%' }} value={tercero} onChange={e => { setTercero(e.target.value); setSel(null); }}>
            <option value="todos">Todos</option>{terceros.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
          </select></div>
        <div><span style={label}>Producto</span>
          <input style={{ ...input, width: '100%' }} value={qProd} onChange={e => setQProd(e.target.value)} placeholder="Código o nombre" /></div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Seg value={modo} onChange={setModo} opciones={[['valor', '$ Valor'], ['cantidad', 'Unidades']]} />
        </div>
        <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <Seg value={fuente} onChange={v => { setFuente(v); setSel(null); }} opciones={[['cruces', 'Saldo real (según cruces)'], ['movs', 'Prestado − devuelto']]} />
          <span style={{ fontSize: 12, color: 'var(--t-text-muted)' }}>
            {esCruces
              ? 'Cada préstamo menos lo que ya se le abonó en los cruces. Las devoluciones sin cruzar no descuentan: aparecen aparte al abrir cada tercero.'
              : 'Todo lo prestado menos todo lo devuelto, sin depender de los cruces.'}
          </span>
        </div>
        <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <Seg value={calculo} onChange={setCalculo} opciones={[['corte', 'Saldo al corte'], ['periodo', 'Solo el periodo']]} />
            <span style={{ fontSize: 12, color: 'var(--t-text-muted)' }}>{textoCorte}</span>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {(anio !== 'todos' || desde || hasta || tercero !== 'todos' || qProd) && (
              <button type="button" onClick={() => { elegirAnio('todos'); setTercero('todos'); setQProd(''); }}
                style={{ ...input, cursor: 'pointer', fontWeight: 600 }}>Limpiar filtros</button>)}
            <button type="button" onClick={exportarCompacto} title="Solo saldos por tercero: nos debe, le debemos y diferencia"
              style={{ ...input, cursor: 'pointer', fontWeight: 600 }}>⇣ Excel compacto</button>
            <button type="button" onClick={exportarExcesos} title="Documentos y productos donde se devolvió más de lo prestado"
              style={{ ...input, cursor: 'pointer', fontWeight: 600 }}>⇣ Devoluciones de más</button>
            <button type="button" onClick={exportar} title="Todos los datos del dashboard en 10 hojas"
              style={{ ...input, cursor: 'pointer', fontWeight: 600, background: 'var(--t-accent)', color: '#fff', border: 'none' }}>⇣ Excel completo</button>
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        <Kpi titulo="Nos deben" valor={fmtV(totNos)} color={C_NOS} sub={`${conNos} tercero${conNos === 1 ? '' : 's'} · ${esCruces ? 'EPO pendientes' : 'EPO − IDP'}`} />
        <Kpi titulo="Le debemos" valor={fmtV(totDeb)} color={C_DEB} sub={`${conDeb} tercero${conDeb === 1 ? '' : 's'} · ${esCruces ? 'IPE pendientes' : 'IPE − ED'}`} />
        <Kpi titulo="Saldo neto" valor={fmtV(totNos - totDeb)} color={totNos - totDeb >= 0 ? C_NOS : C_DEB}
          sub={totNos - totDeb >= 0 ? 'A favor nuestro' : 'En contra nuestra'} />
        <Kpi titulo="Quien más nos debe" valor={topNos[0] ? fmtV(topNos[0].v) : '—'} sub={topNos[0]?.label || 'Nadie nos debe'} />
      </div>

      {/* Rankings de terceros */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}>
        <div style={card}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12, color: 'var(--t-text-primary)' }}>Clínicas que más nos deben</div>
          <Barras filas={topNos} color={C_NOS} fmtV={fmtV} onClick={setSel} vacio="Ningún tercero nos debe con estos filtros." />
        </div>
        <div style={card}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12, color: 'var(--t-text-primary)' }}>A quiénes más les debemos</div>
          <Barras filas={topDeb} color={C_DEB} fmtV={fmtV} onClick={setSel} vacio="No le debemos a ningún tercero con estos filtros." />
        </div>
      </div>

      {/* Tabla por tercero */}
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--t-text-primary)' }}>Saldo por tercero <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--t-text-muted)' }}>· clic en un tercero para ver su detalle</span></div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input style={input} value={qTer} onChange={e => setQTer(e.target.value)} placeholder="Buscar tercero…" />
            <Seg value={orden} onChange={setOrden} opciones={[['nos', 'Más nos deben'], ['deb', 'Más debemos'], ['neto', 'Mayor neto']]} />
          </div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th}>Tercero</th>
              <th style={{ ...th, ...r, color: C_NOS }}>Nos debe</th>
              <th style={{ ...th, ...r, color: C_DEB }}>Le debemos</th>
              <th style={{ ...th, ...r }}>Neto</th>
              <th style={{ ...th, ...r }}>Prestado (EPO)</th><th style={{ ...th, ...r }}>{esCruces ? 'Abonado EPO' : 'Devuelto (IDP)'}</th>
              <th style={{ ...th, ...r }}>Recibido (IPE)</th><th style={{ ...th, ...r }}>{esCruces ? 'Abonado IPE' : 'Devolvimos (ED)'}</th>
              <th style={th}>Último mov.</th>
            </tr></thead>
            <tbody>
              {tabla.map(t => (
                <React.Fragment key={t.k}>
                <tr id={`tercero-${t.k}`} onClick={() => setSel(sel === t.k ? null : t.k)} style={{ cursor: 'pointer', background: sel === t.k ? 'var(--t-bg-inner)' : undefined }}>
                  <td style={{ ...td, fontWeight: 600 }}>{t.nombre}</td>
                  <td style={{ ...td, ...r, fontWeight: 700, color: t.nos > TOL ? C_NOS : 'var(--t-text-muted)' }}>{Math.abs(t.nos) > TOL ? fmtV(t.nos) : '—'}</td>
                  <td style={{ ...td, ...r, fontWeight: 700, color: t.deb > TOL ? C_DEB : 'var(--t-text-muted)' }}>{Math.abs(t.deb) > TOL ? fmtV(t.deb) : '—'}</td>
                  <td style={{ ...td, ...r, fontWeight: 600, color: t.neto > TOL ? C_NOS : (t.neto < -TOL ? C_DEB : 'var(--t-text-muted)') }}>{Math.abs(t.neto) > TOL ? fmtV(t.neto) : '—'}</td>
                  <td style={{ ...td, ...r, color: 'var(--t-text-muted)' }}>{t.epo ? fmtV(t.epo) : '—'}</td>
                  <td style={{ ...td, ...r, color: 'var(--t-text-muted)' }}>{t.idp ? fmtV(t.idp) : '—'}</td>
                  <td style={{ ...td, ...r, color: 'var(--t-text-muted)' }}>{t.ipe ? fmtV(t.ipe) : '—'}</td>
                  <td style={{ ...td, ...r, color: 'var(--t-text-muted)' }}>{t.ed ? fmtV(t.ed) : '—'}</td>
                  <td style={{ ...td, color: 'var(--t-text-muted)', whiteSpace: 'nowrap' }}>{t.ultima}</td>
                </tr>
                {/* Detalle del tercero: se despliega justo debajo de su fila */}
                {sel === t.k && detalle && (
                <tr><td colSpan={9} style={{ padding: 0 }}>
                    <div style={{ ...card, borderColor: 'var(--t-accent)', margin: '4px 0 10px', cursor: 'default' }} onClick={e => e.stopPropagation()}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--t-text-primary)' }}>{detalle.nombre}</div>
                          <div style={{ fontSize: 13, marginTop: 4 }}>
                            <span style={{ color: C_NOS, fontWeight: 700 }}>Nos debe {fmtV(detalle.nos)}</span>
                            <span style={{ color: 'var(--t-text-muted)' }}> · </span>
                            <span style={{ color: C_DEB, fontWeight: 700 }}>Le debemos {fmtV(detalle.deb)}</span>
                            <span style={{ color: 'var(--t-text-muted)' }}> · Neto {fmtV(detalle.neto)}</span>
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button type="button" onClick={() => imprimirDocsPdf(detalle)} disabled={!detalle.docs.length}
                            title="Abre la impresión: elija «Guardar como PDF»" style={{ ...input, cursor: 'pointer', fontWeight: 600 }}>🖨 Imprimir / PDF</button>
                          <button type="button" onClick={() => exportarTerceroExcel(detalle)} disabled={!detalle.docs.length}
                            title="Descarga los documentos y productos de este tercero en Excel" style={{ ...input, cursor: 'pointer', fontWeight: 600 }}>📊 Excel</button>
                          <button type="button" onClick={() => setSel(null)} style={{ ...input, cursor: 'pointer' }}>Cerrar ✕</button>
                        </div>
                      </div>
                      {esCruces && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 16 }}>
                          {[['nos', 'Documentos que nos debe (EPO con saldo)', C_NOS], ['deb', 'Documentos que le debemos (IPE con saldo)', C_DEB]].map(([lado, tit, col]) => {
                            const ds = detalle.docs.filter(d => d.lado === lado).sort((a, b) => a.fecha.localeCompare(b.fecha));
                            const tq = ds.reduce((a, d) => a + d.valorQ, 0), tv = ds.reduce((a, d) => a + d.valorV, 0);
                            return (
                              <div key={lado}>
                                <div style={{ fontWeight: 700, fontSize: 13, color: col, marginBottom: 6 }}>
                                  {tit} · {ds.length} doc{ds.length === 1 ? '' : 's'} · {num(tq)} und · {cop(tv)}
                                </div>
                                <div style={{ overflowX: 'auto', maxHeight: 340, overflowY: 'auto' }}>
                                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                    <thead><tr><th style={th}>Fecha</th><th style={th}>Documento</th><th style={th}>Estado</th><th style={th}>Productos pendientes</th><th style={{ ...th, ...r }}>Prestado</th><th style={{ ...th, ...r }}>Pend. und</th><th style={{ ...th, ...r }}>Pend. valor</th></tr></thead>
                                    <tbody>
                                      {ds.map(d => (
                                        <tr key={d.id}>
                                          <td style={{ ...td, whiteSpace: 'nowrap' }}>{d.fecha}</td>
                                          <td style={{ ...td, fontWeight: 600 }}>{d.doc}</td>
                                          <td style={{ ...td, fontSize: 12 }}>{d.estado}</td>
                                          <td style={{ ...td, fontSize: 12 }}>{d.pendientes.map(x => (
                                            <div key={x.codigo}>{x.nombre || x.codigo} <b>×{num(x.q)}</b> <span style={{ color: 'var(--t-text-muted)' }}>({cop(x.v)})</span></div>
                                          ))}</td>
                                          <td style={{ ...td, ...r, color: 'var(--t-text-muted)' }}>{cop(d.prestadoV)}</td>
                                          <td style={{ ...td, ...r }}>{num(d.valorQ)}</td>
                                          <td style={{ ...td, ...r, fontWeight: 700, color: col }}>{cop(d.valorV)}</td>
                                        </tr>
                                      ))}
                                      {!ds.length && <tr><td colSpan={7} style={{ ...td, color: 'var(--t-text-muted)' }}>Sin documentos con saldo.</td></tr>}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            );
                          })}
                          {(detalle.devSinCruzar || []).length > 0 && (
                            <div>
                              <div style={{ fontWeight: 700, fontSize: 13, color: '#b45309', marginBottom: 4 }}>
                                Devoluciones con unidades sin cruzar ({detalle.devSinCruzar.length})
                              </div>
                              <div style={{ fontSize: 12, color: 'var(--t-text-muted)', marginBottom: 6 }}>
                                Estas devoluciones existen pero todavía no se han cruzado (o no del todo) con ningún préstamo, así que no descuentan el saldo. Crúzalas en la pestaña Cruces.
                              </div>
                              <div style={{ overflowX: 'auto', maxHeight: 260, overflowY: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                  <thead><tr><th style={th}>Fecha</th><th style={th}>Documento</th><th style={th}>Productos sin cruzar</th><th style={{ ...th, ...r }}>Und</th><th style={{ ...th, ...r }}>Valor</th></tr></thead>
                                  <tbody>
                                    {[...detalle.devSinCruzar].sort((a, b) => a.fecha.localeCompare(b.fecha)).map(d => (
                                      <tr key={d.id}>
                                        <td style={{ ...td, whiteSpace: 'nowrap' }}>{d.fecha}</td>
                                        <td style={{ ...td, fontWeight: 600 }}><span style={{ fontSize: 11, fontWeight: 700, padding: '2px 6px', borderRadius: 5, background: 'var(--t-bg-inner)', marginRight: 6 }}>{d.sigla}</span>{d.doc}</td>
                                        <td style={{ ...td, fontSize: 12 }}>{d.productos}</td>
                                        <td style={{ ...td, ...r }}>{num(d.q)}</td>
                                        <td style={{ ...td, ...r }}>{cop(d.v)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                      {!esCruces && <>
                      <div style={{ fontWeight: 700, fontSize: 13, margin: '4px 0 6px', color: 'var(--t-text-primary)' }}>Documentos ({detalle.docs.length}) <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--t-text-muted)' }}>· del más reciente al más antiguo</span></div>
                      <div style={{ overflowX: 'auto', maxHeight: 340, overflowY: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                          <thead><tr><th style={th}>Fecha elaboración</th><th style={th}>Documento</th><th style={th}>Movimiento</th><th style={th}>Bodega</th><th style={{ ...th, ...r }}>Valor</th><th style={{ ...th, ...r }}>Efecto</th></tr></thead>
                          <tbody>
                            {[...detalle.docs].sort((a, b) => b.fecha.localeCompare(a.fecha)).map(d => (
                              <tr key={d.id}>
                                <td style={{ ...td, whiteSpace: 'nowrap' }}>{d.fecha}</td>
                                <td style={{ ...td, fontWeight: 600 }}>{d.doc}</td>
                                <td style={td}><span style={{ fontSize: 11, fontWeight: 700, padding: '2px 6px', borderRadius: 5, background: 'var(--t-bg-inner)', marginRight: 6 }}>{d.sigla}</span>{d.txt}</td>
                                <td style={{ ...td, color: 'var(--t-text-muted)' }}>{d.bodega}</td>
                                <td style={{ ...td, ...r }}>{fmtV(d.valor)}</td>
                                <td style={{ ...td, ...r, fontSize: 12, color: d.lado === 'nos' ? C_NOS : C_DEB }}>{d.signo > 0 ? '▲' : '▼'} {d.lado === 'nos' ? 'nos debe' : 'debemos'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div style={{ marginTop: 16 }} />
                      </>}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
                        {[['nos', 'Productos que nos debe', C_NOS], ['deb', 'Productos que le debemos', C_DEB]].map(([lado, tit, col]) => {
                          const filas = Object.values(detalle.prods).filter(p => Math.abs(p[lado + 'Q']) > TOL).sort((a, b) => b[lado + 'V'] - a[lado + 'V']);
                          return (
                            <div key={lado}>
                              <div style={{ fontWeight: 700, fontSize: 13, color: col, marginBottom: 6 }}>{tit}</div>
                              <div style={{ overflowX: 'auto', maxHeight: 320, overflowY: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                  <thead><tr><th style={th}>Producto</th><th style={{ ...th, ...r }}>Cant.</th><th style={{ ...th, ...r }}>Valor</th></tr></thead>
                                  <tbody>
                                    {filas.map(p => (
                                      <tr key={p.codigo + p.nombre}>
                                        <td style={td}><div style={{ fontWeight: 600 }}>{p.nombre || '—'}</div><div style={{ fontSize: 11, color: 'var(--t-text-muted)' }}>{p.codigo}</div></td>
                                        <td style={{ ...td, ...r, color: p[lado + 'Q'] < 0 ? 'var(--t-text-muted)' : undefined }}>{num(p[lado + 'Q'])}{p[lado + 'Q'] < 0 ? ' (devolvió de más)' : ''}</td>
                                        <td style={{ ...td, ...r }}>{cop(p[lado + 'V'])}</td>
                                      </tr>
                                    ))}
                                    {!filas.length && <tr><td colSpan={3} style={{ ...td, color: 'var(--t-text-muted)' }}>Sin saldo.</td></tr>}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                </td></tr>
                )}
                </React.Fragment>
              ))}
              {!tabla.length && <tr><td style={{ ...td, textAlign: 'center', color: 'var(--t-text-muted)', padding: 24 }} colSpan={9}>No hay movimientos con estos filtros.</td></tr>}
            </tbody>
            {tabla.length > 1 && (
              <tfoot><tr style={{ fontWeight: 700 }}>
                <td style={td}>Total</td>
                {['nos', 'deb', 'neto', 'epo', 'idp', 'ipe', 'ed'].map(c => {
                  // Nos debe / Le debemos: solo saldos a favor (igual que las tarjetas de arriba);
                  // lo devuelto de más por un tercero no reduce la deuda de otro.
                  const nosP = tabla.reduce((s, t) => s + Math.max(0, t.nos), 0);
                  const debP = tabla.reduce((s, t) => s + Math.max(0, t.deb), 0);
                  const v = c === 'nos' ? nosP : c === 'deb' ? debP : c === 'neto' ? nosP - debP : tabla.reduce((s, t) => s + t[c], 0);
                  return <td key={c} style={{ ...td, ...r, color: c === 'nos' ? C_NOS : c === 'deb' ? C_DEB : undefined }}>{fmtV(v)}</td>;
                })}<td style={td} />
              </tr></tfoot>
            )}
          </table>
        </div>
        <div style={{ fontSize: 11, color: 'var(--t-text-muted)', marginTop: 8 }}>
          Un valor negativo en «Nos debe» o «Le debemos» indica que se devolvió más de lo prestado en lo que cubre el filtro; esos valores no se suman en los totales de deuda.
        </div>
      </div>

      {/* Productos */}
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--t-text-primary)' }}>
            {verProd === 'nos' ? 'Productos que más nos deben' : 'Productos que más debemos'}
            <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--t-text-muted)' }}> · clic para ver a qué terceros</span>
          </div>
          <Seg value={verProd} onChange={v => { setVerProd(v); setProdAbierto(null); }} opciones={[['nos', 'Nos deben'], ['deb', 'Debemos']]} />
        </div>
        <div style={{ overflowX: 'auto', maxHeight: 520, overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>#</th><th style={th}>Producto</th><th style={{ ...th, ...r }}>Cantidad</th><th style={{ ...th, ...r }}>Valor</th><th style={{ ...th, ...r }}>Terceros</th><th style={th} /></tr></thead>
            <tbody>
              {topProds.slice(0, 100).map((p, i) => {
                const ters = (verProd === 'nos' ? p.terNos : p.terDeb).slice().sort((a, b) => b.v - a.v);
                const pk = p.codigo + '|' + p.nombre;
                const abierto = prodAbierto === pk;
                const maxP = topProds[0][campoProd] || 1;
                return (
                  <React.Fragment key={pk}>
                    <tr onClick={() => setProdAbierto(abierto ? null : pk)} style={{ cursor: 'pointer' }}>
                      <td style={{ ...td, color: 'var(--t-text-muted)' }}>{i + 1}</td>
                      <td style={td}>
                        <div style={{ fontWeight: 600 }}>{p.nombre || '—'}</div>
                        <div style={{ fontSize: 11, color: 'var(--t-text-muted)' }}>{p.codigo}</div>
                        <div style={{ height: 5, background: 'var(--t-bg-inner)', borderRadius: 3, marginTop: 4, maxWidth: 320 }}>
                          <div style={{ width: `${(p[campoProd] / maxP) * 100}%`, height: '100%', background: verProd === 'nos' ? C_NOS : C_DEB, borderRadius: 3 }} />
                        </div>
                      </td>
                      <td style={{ ...td, ...r }}>{num(p[verProd + 'Q'])}</td>
                      <td style={{ ...td, ...r, fontWeight: 700 }}>{cop(p[verProd + 'V'])}</td>
                      <td style={{ ...td, ...r }}>{ters.length}</td>
                      <td style={{ ...td, color: 'var(--t-text-muted)' }}>{abierto ? '▲' : '▼'}</td>
                    </tr>
                    {abierto && (
                      <tr><td colSpan={6} style={{ ...td, background: 'var(--t-bg-inner)' }}>
                        {ters.map(x => (
                          <div key={x.nombre} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12, padding: '3px 0' }}>
                            <span>{x.nombre}</span><span style={r}>{num(x.q)} und · <b>{cop(x.v)}</b></span>
                          </div>
                        ))}
                      </td></tr>
                    )}
                  </React.Fragment>
                );
              })}
              {!topProds.length && <tr><td colSpan={6} style={{ ...td, textAlign: 'center', color: 'var(--t-text-muted)', padding: 24 }}>Sin productos pendientes con estos filtros.</td></tr>}
            </tbody>
          </table>
        </div>
        {topProds.length > 100 && <div style={{ fontSize: 11, color: 'var(--t-text-muted)', marginTop: 6 }}>Se muestran los primeros 100 de {topProds.length}; el Excel trae todos.</div>}
        <div style={{ fontSize: 11, color: 'var(--t-text-muted)', marginTop: 8 }}>
          El saldo de cada producto se calcula por tercero: si un tercero devolvió de más un producto, eso no descuenta la deuda de otro tercero.
          {datos.sobrantes > 0 && ` Hay ${datos.sobrantes} combinación(es) tercero-producto con devoluciones de más.`}
        </div>
      </div>

      {/* Tendencia */}
      <div style={card}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10, color: 'var(--t-text-primary)' }}>Variación mensual del saldo</div>
        <Tendencia meses={datos.meses} fmtV={fmtV} />
      </div>
      <div style={{ fontSize: 11, color: 'var(--t-text-muted)' }}>
        {esCruces
          ? `Saldo real: ${datos.nDocs.toLocaleString('es-CO')} documentos; cada EPO/IPE menos lo abonado en sus cruces (devoluciones con fecha hasta el corte).`
          : `Calculado con ${datos.nDocs.toLocaleString('es-CO')} documentos EPO, IPE, IDP y ED de la pestaña Movimientos.`}
      </div>
    </div>
  );
}

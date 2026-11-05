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

export default function SaldosTerceros({ prestamos = [], clinicas = [] }) {
  const hoy = new Date().toISOString().substring(0, 10);
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
  const medida = i => (modo === 'cantidad' ? Number(i.cantidad || 0) : Number(i.cantidad || 0) * Number(i.precio_unitario || 0));

  // ── Agregación principal ──────────────────────────────────────────────
  const datos = useMemo(() => {
    const porTer = {};   // k -> { k, nombre, epo, idp, ipe, ed, docs:[] , prods:{} }
    const porMes = {};
    const enRango = movs.filter(p => {
      const f = fechaDe(p);
      return (!ini || f >= ini) && f <= fin && (tercero === 'todos' || claveTercero(p) === tercero);
    });
    enRango.forEach(p => {
      const t = TIPOS[p.tipo];
      const k = claveTercero(p);
      if (!porTer[k]) porTer[k] = { k, nombre: nomDe(k, p), epo: 0, idp: 0, ipe: 0, ed: 0, docs: [], prods: {}, ultima: '' };
      const T = porTer[k];
      let totalDoc = 0;
      (p.items || []).forEach(i => {
        if (!itemOk(i)) return;
        const v = medida(i);
        const vv = Number(i.cantidad || 0) * Number(i.precio_unitario || 0);
        const q = Number(i.cantidad || 0);
        totalDoc += v;
        T[t.sigla.toLowerCase()] += v;
        const pk = String(i.codigo || i.nombre || '—');
        if (!T.prods[pk]) T.prods[pk] = { codigo: i.codigo || '', nombre: i.nombre || '', nosQ: 0, nosV: 0, debQ: 0, debV: 0 };
        const P = T.prods[pk];
        if (!P.nombre && i.nombre) P.nombre = i.nombre;
        P[t.lado + 'Q'] += t.signo * q;
        P[t.lado + 'V'] += t.signo * vv;
      });
      if (qp && totalDoc === 0 && !(p.items || []).some(itemOk)) return;
      T.docs.push({ id: p.id, fecha: fechaDe(p), doc: p.documento_contable, sigla: t.sigla, txt: t.txt, lado: t.lado, signo: t.signo, valor: totalDoc, bodega: p.bodega_nombre || p.bodega_codigo || '' });
      if (fechaDe(p) > T.ultima) T.ultima = fechaDe(p);
      // Tendencia: solo dentro del periodo visible (en "corte" se muestra desde "desde" si lo hay)
      const f = fechaDe(p);
      if (!desde || f >= desde) {
        const mk = f.substring(0, 7);
        if (!porMes[mk]) porMes[mk] = { k: mk, label: `${MESES[Number(mk.substring(5, 7)) - 1]} ${mk.substring(2, 4)}`, nos: 0, deb: 0 };
        porMes[mk][t.lado] += t.signo * totalDoc;
      }
    });
    const lista = Object.values(porTer).map(T => ({
      ...T, nos: T.epo - T.idp, deb: T.ipe - T.ed, neto: (T.epo - T.idp) - (T.ipe - T.ed),
    }));
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
    return { lista, prods: Object.values(prods), meses, sobrantes, nDocs: enRango.length };
  }, [movs, ini, fin, desde, tercero, qp, modo, nombreTercero]);

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

  function exportar() {
    const wb = XLSX.utils.book_new();
    const u = modo === 'cantidad' ? ' (und)' : ' ($)';
    const hT = datos.lista.map(t => ({
      Tercero: t.nombre, ['Prestado EPO' + u]: t.epo, ['Devuelto IDP' + u]: t.idp, ['Nos debe' + u]: t.nos,
      ['Recibido IPE' + u]: t.ipe, ['Devolvimos ED' + u]: t.ed, ['Le debemos' + u]: t.deb, ['Neto' + u]: t.neto, 'Último movimiento': t.ultima,
    })).sort((a, b) => b['Nos debe' + u] - a['Nos debe' + u]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(hT), 'Saldos por tercero');
    const hp = lado => datos.prods.filter(p => p[lado + 'Q'] > TOL).sort((a, b) => b[lado + 'V'] - a[lado + 'V']).map(p => ({
      Código: p.codigo, Producto: p.nombre, Cantidad: p[lado + 'Q'], 'Valor ($)': p[lado + 'V'],
      Terceros: (lado === 'nos' ? p.terNos : p.terDeb).map(x => `${x.nombre} (${num(x.q)})`).join('; '),
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(hp('nos')), 'Productos que nos deben');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(hp('deb')), 'Productos que debemos');
    const hm = [];
    datos.lista.forEach(t => t.docs.forEach(d => hm.push({ Fecha: d.fecha, Documento: d.doc, Tipo: d.sigla, Movimiento: d.txt, Tercero: t.nombre, Bodega: d.bodega, ['Valor' + u]: d.valor })));
    hm.sort((a, b) => a.Fecha.localeCompare(b.Fecha));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(hm), 'Movimientos');
    XLSX.writeFile(wb, `saldos_por_tercero_${hasta || hoy}.xlsx`);
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
        <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <Seg value={calculo} onChange={setCalculo} opciones={[['corte', 'Saldo al corte'], ['periodo', 'Solo el periodo']]} />
            <span style={{ fontSize: 12, color: 'var(--t-text-muted)' }}>{textoCorte}</span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {(anio !== 'todos' || desde || hasta || tercero !== 'todos' || qProd) && (
              <button type="button" onClick={() => { elegirAnio('todos'); setTercero('todos'); setQProd(''); }}
                style={{ ...input, cursor: 'pointer', fontWeight: 600 }}>Limpiar filtros</button>)}
            <button type="button" onClick={exportar}
              style={{ ...input, cursor: 'pointer', fontWeight: 600, background: 'var(--t-accent)', color: '#fff', border: 'none' }}>⇣ Excel</button>
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        <Kpi titulo="Nos deben" valor={fmtV(totNos)} color={C_NOS} sub={`${conNos} tercero${conNos === 1 ? '' : 's'} · EPO − IDP`} />
        <Kpi titulo="Le debemos" valor={fmtV(totDeb)} color={C_DEB} sub={`${conDeb} tercero${conDeb === 1 ? '' : 's'} · IPE − ED`} />
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
              <th style={{ ...th, ...r }}>Prestado (EPO)</th><th style={{ ...th, ...r }}>Devuelto (IDP)</th>
              <th style={{ ...th, ...r }}>Recibido (IPE)</th><th style={{ ...th, ...r }}>Devolvimos (ED)</th>
              <th style={th}>Último mov.</th>
            </tr></thead>
            <tbody>
              {tabla.map(t => (
                <tr key={t.k} onClick={() => setSel(sel === t.k ? null : t.k)} style={{ cursor: 'pointer', background: sel === t.k ? 'var(--t-bg-inner)' : undefined }}>
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

      {/* Detalle del tercero */}
      {detalle && (
        <div style={{ ...card, borderColor: 'var(--t-accent)' }}>
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
            <button type="button" onClick={() => setSel(null)} style={{ ...input, cursor: 'pointer' }}>Cerrar ✕</button>
          </div>
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
          <div style={{ fontWeight: 700, fontSize: 13, margin: '16px 0 6px', color: 'var(--t-text-primary)' }}>Movimientos ({detalle.docs.length})</div>
          <div style={{ overflowX: 'auto', maxHeight: 340, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th}>Fecha</th><th style={th}>Documento</th><th style={th}>Movimiento</th><th style={th}>Bodega</th><th style={{ ...th, ...r }}>Valor</th><th style={{ ...th, ...r }}>Efecto</th></tr></thead>
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
        </div>
      )}

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
        Calculado con {datos.nDocs.toLocaleString('es-CO')} documentos EPO, IPE, IDP y ED de la pestaña Movimientos.
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Motor del "Plan de ajuste de saldos" (Préstamos).
//
//  A partir de los documentos (prestamos) y de los cruces registrados, arma
//  por cada tercero la lista de correcciones que llevan el saldo al valor
//  real, en este orden (cada paso trabaja sobre lo que dejó el anterior, así
//  una misma unidad nunca se propone dos veces):
//
//    A. completar  — cruce YA registrado entre un préstamo y una devolución que
//                    quedó sin (o con menos) productos que coinciden por código.
//                    Se corrige editando ese cruce (PATCH).
//    B. nuevo      — devolución con unidades sin cruzar cuyo mismo código está
//                    pendiente en un préstamo del mismo tercero y tipo
//                    compatible (IDP↔EPO, ED↔IPE). Se asigna al préstamo más
//                    antiguo primero. Se corrige registrando un cruce (POST).
//    C. manual     — lo que queda: devolución y préstamo del mismo tercero con
//                    productos de nombre muy parecido pero código distinto.
//                    Solo es sugerencia: se revisa antes de aplicarse (cruce
//                    manual con codigo_prestamo).
//
//  Lo que sigue pendiente después de A+B(+C) es la deuda real.
//  No depende de React: se puede probar suelto.
// ─────────────────────────────────────────────────────────────────────────────

const TOL = 1e-6;
const ES_PRESTAMO = { egreso: 'nos', ingreso: 'deb' };
const DEV_PARA = { egreso: 'devolucion_ingreso', ingreso: 'devolucion_egreso' };

const itemsDeCruce = c => ((c.items_cruzados !== null && c.items_cruzados !== undefined) ? c.items_cruzados : (c.devolucion_items || []));
const fechaDe = p => String(p.fecha || '').substring(0, 10);
export const claveTerceroDe = p => (p.clinica_id != null ? 'id:' + p.clinica_id : 'n:' + String(p.clinica_nombre || 'SIN TERCERO').trim().toUpperCase());

// Palabras significativas del nombre de un producto, para comparar nombres.
const RUIDO = new Set(['REG', 'DE', 'LA', 'EL', 'EN', 'Y', 'CON', 'X', 'POR', 'PARA', 'SOLUCION', 'INYECTABLE', 'UNIDAD', 'UNIDADES', 'AMP', 'AMPOLLA', 'TABLETA', 'TABLETAS', 'VIAL', 'FRASCO', 'A', 'D', 'AD', 'SOL', 'ORAL']);
function tokens(nombre) {
  return String(nombre || '').toUpperCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/(\d)\s+(MG|MCG|ML|G|UI|MEQ|FR|%)/g, '$1$2')
    .replace(/[^A-Z0-9%./ ]/g, ' ')
    .split(/\s+/).filter(t => t && !RUIDO.has(t));
}
// Parecido entre dos nombres: 0..1. Exige que compartan la primera palabra
// "fuerte" (el principio activo / insumo) y pondera el resto por Jaccard.
export function parecido(a, b) {
  const ta = tokens(a), tb = tokens(b);
  if (!ta.length || !tb.length) return 0;
  const fuerte = t => t.find(x => /[A-Z]{4,}/.test(x));
  const fa = fuerte(ta), fb = fuerte(tb);
  if (!fa || !fb || fa !== fb) return 0;
  const sa = new Set(ta), sb = new Set(tb);
  const inter = [...sa].filter(x => sb.has(x)).length;
  const union = new Set([...sa, ...sb]).size;
  // Concentraciones (números con unidad) distintas → muy probablemente otro producto
  const conc = t => t.filter(x => /\d/.test(x));
  const ca = conc(ta), cb = conc(tb);
  const concChoca = ca.length && cb.length && !ca.some(x => cb.includes(x));
  const j = inter / union;
  return concChoca ? j * 0.4 : j;
}

// Préstamos que una devolución menciona en sus observaciones ("PAGO DEL IPE 744",
// "EPO-123"...). Se usan para ponerlos primero al repartir la devolución.
function mencionados(d) {
  const set = new Set();
  const re = /\b(EPO|IPE)\s*[-#.:]?\s*(\d{1,6})\b/gi;
  let m;
  const txt = String(d.observaciones || '');
  while ((m = re.exec(txt))) set.add(m[1].toUpperCase() + Number(m[2]));
  return set;
}
const docNorm = p => String(p.documento_contable || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^([A-Z]+)0*(\d+)$/, '$1$2');
function candidatosOrdenados(d, lista) {
  const men = mencionados(d);
  if (!men.size) return lista;
  return [...lista.filter(p => men.has(docNorm(p))), ...lista.filter(p => !men.has(docNorm(p)))];
}

export function calcularPlanAjuste(prestamos = [], cruces = []) {
  const porId = {};
  (prestamos || []).forEach(p => { porId[p.id] = p; });
  const prestamosBase = (prestamos || []).filter(p => ES_PRESTAMO[p.tipo]);
  const devoluciones = (prestamos || []).filter(p => p.tipo === 'devolucion_ingreso' || p.tipo === 'devolucion_egreso');

  // ── Pendiente por préstamo y código (mutable, se va consumiendo) ──
  const pend = {};      // pid -> { codigo -> { q, nombre, pu } }
  const prestadoV = {}; // pid -> valor total prestado
  prestamosBase.forEach(p => {
    const m = {};
    let v = 0;
    (p.items || []).forEach(i => {
      if (!m[i.codigo]) m[i.codigo] = { q: 0, v: 0, nombre: i.nombre };
      m[i.codigo].q += Number(i.cantidad || 0);
      m[i.codigo].v += Number(i.cantidad || 0) * Number(i.precio_unitario || 0);
      v += Number(i.cantidad || 0) * Number(i.precio_unitario || 0);
    });
    Object.values(m).forEach(x => { x.pu = x.q ? x.v / x.q : 0; });
    pend[p.id] = m;
    prestadoV[p.id] = v;
  });
  devoluciones.filter(d => d.prestamo_id && pend[d.prestamo_id]).forEach(d =>
    (d.items || []).forEach(i => { const x = pend[d.prestamo_id][i.codigo]; if (x) x.q -= Number(i.cantidad || 0); }));
  (cruces || []).forEach(c => {
    if (!pend[c.prestamo_id]) return;
    itemsDeCruce(c).forEach(it => { const x = pend[c.prestamo_id][it.codigo_prestamo || it.codigo]; if (x) x.q -= Number(it.cantidad || 0); });
  });
  Object.values(pend).forEach(m => Object.values(m).forEach(x => { if (x.q < 0) x.q = 0; }));

  // ── Disponible por devolución y código (mutable) ──
  const disp = {};      // did -> { codigo -> { q, nombre, pu } }
  devoluciones.forEach(d => {
    const m = {};
    (d.items || []).forEach(i => {
      if (!m[i.codigo]) m[i.codigo] = { q: 0, v: 0, nombre: i.nombre, pu0: Number(i.precio_unitario || 0) };
      m[i.codigo].q += Number(i.cantidad || 0);
      m[i.codigo].v += Number(i.cantidad || 0) * Number(i.precio_unitario || 0);
    });
    Object.values(m).forEach(x => { x.pu = x.q ? x.v / x.q : x.pu0; });
    disp[d.id] = m;
  });
  (cruces || []).forEach(c => {
    if (!disp[c.devolucion_id]) return;
    itemsDeCruce(c).forEach(it => { const x = disp[c.devolucion_id][it.codigo]; if (x) x.q -= Number(it.cantidad || 0); });
  });
  // Devoluciones legadas ligadas directo a un préstamo ya están consumidas
  devoluciones.filter(d => d.prestamo_id).forEach(d => Object.values(disp[d.id]).forEach(x => { x.q = 0; }));
  Object.values(disp).forEach(m => Object.values(m).forEach(x => { if (x.q < 0) x.q = 0; }));

  const saldoDe = pid => Object.values(pend[pid] || {}).reduce((a, x) => ({ q: a.q + x.q, v: a.v + x.q * x.pu }), { q: 0, v: 0 });
  const saldoInicial = {};
  prestamosBase.forEach(p => { saldoInicial[p.id] = saldoDe(p.id); });

  const acciones = [];
  const mover = (pid, did, codigoDev, codigoPrest, q) => {
    pend[pid][codigoPrest].q -= q;
    disp[did][codigoDev].q -= q;
  };

  // ── A. Completar cruces ya registrados ──
  (cruces || []).forEach(c => {
    if (c.items_cruzados === null || c.items_cruzados === undefined) return;
    const p = porId[c.prestamo_id], d = porId[c.devolucion_id];
    if (!p || !d || !pend[p.id] || !disp[d.id]) return;
    const lineas = [];
    Object.entries(disp[d.id]).forEach(([cod, x]) => {
      const y = pend[p.id][cod];
      if (!y) return;
      const q = Math.min(x.q, y.q);
      if (q > TOL) {
        lineas.push({ codigo: cod, nombre: x.nombre, cantidad: q, precio_unitario: x.pu, valor: q * y.pu });
        mover(p.id, d.id, cod, cod, q);
      }
    });
    if (lineas.length) acciones.push({ tipo: 'completar', cruce_id: c.id, grupo_numero: c.grupo_numero || '', prestamo: p, devolucion: d, lineas });
  });

  // ── B. Cruces nuevos por mismo código (préstamo más antiguo primero) ──
  const porTerTipo = {};
  prestamosBase.forEach(p => {
    const k = claveTerceroDe(p) + '|' + DEV_PARA[p.tipo];
    (porTerTipo[k] = porTerTipo[k] || []).push(p);
  });
  Object.values(porTerTipo).forEach(l => l.sort((a, b) => fechaDe(a).localeCompare(fechaDe(b)) || a.id - b.id));
  const nuevos = {}; // pid|did -> accion
  devoluciones.slice().sort((a, b) => fechaDe(a).localeCompare(fechaDe(b)) || a.id - b.id).forEach(d => {
    const cands = candidatosOrdenados(d, porTerTipo[claveTerceroDe(d) + '|' + d.tipo] || []);
    Object.entries(disp[d.id]).forEach(([cod, x]) => {
      if (x.q <= TOL) return;
      for (const p of cands) {
        if (x.q <= TOL) break;
        const y = pend[p.id][cod];
        if (!y || y.q <= TOL) continue;
        const q = Math.min(x.q, y.q);
        const k = p.id + '|' + d.id;
        if (!nuevos[k]) {
          // Si ya existe un cruce para este par, se completa ese (PATCH) en vez de crear otro
          const existente = (cruces || []).find(c => c.prestamo_id === p.id && c.devolucion_id === d.id);
          nuevos[k] = existente
            ? { tipo: 'completar', cruce_id: existente.id, grupo_numero: existente.grupo_numero || '', prestamo: p, devolucion: d, lineas: [] }
            : { tipo: 'nuevo', prestamo: p, devolucion: d, lineas: [] };
          acciones.push(nuevos[k]);
        }
        nuevos[k].lineas.push({ codigo: cod, nombre: x.nombre, cantidad: q, precio_unitario: x.pu, valor: q * y.pu });
        mover(p.id, d.id, cod, cod, q);
      }
    });
  });

  // ── C. Sugerencias de cruce manual (código distinto, nombre parecido) ──
  devoluciones.slice().sort((a, b) => fechaDe(a).localeCompare(fechaDe(b)) || a.id - b.id).forEach(d => {
    const cands = candidatosOrdenados(d, porTerTipo[claveTerceroDe(d) + '|' + d.tipo] || []);
    const men = mencionados(d);
    Object.entries(disp[d.id]).forEach(([cod, x]) => {
      if (x.q <= TOL) return;
      const opciones = [];
      cands.forEach(p => Object.entries(pend[p.id]).forEach(([codP, y]) => {
        if (y.q <= TOL || codP === cod) return;
        const s = parecido(x.nombre, y.nombre);
        if (s >= 0.5) opciones.push({ p, codP, y, s });
      }));
      const menc = o => (men.has(docNorm(o.p)) ? 1 : 0);
      opciones.sort((a, b) => menc(b) - menc(a) || b.s - a.s || fechaDe(a.p).localeCompare(fechaDe(b.p)));
      for (const o of opciones) {
        if (x.q <= TOL) break;
        if (o.y.q <= TOL) continue;
        const q = Math.min(x.q, o.y.q);
        acciones.push({ tipo: 'manual', prestamo: o.p, devolucion: d, similitud: o.s, lineas: [{
          codigo: cod, nombre: x.nombre, codigo_prestamo: o.codP, nombre_prestamo: o.y.nombre,
          cantidad: q, precio_unitario: x.pu, valor: q * o.y.pu }] });
        mover(o.p.id, d.id, cod, o.codP, q);
      }
    });
  });

  // ── Resumen por tercero ──
  const terceros = {};
  const T = p => {
    const k = claveTerceroDe(p);
    if (!terceros[k]) terceros[k] = { k, nombre: p.clinica_nombre || 'Sin tercero',
      antes: { nos: 0, deb: 0 }, ajuste: { completar: 0, nuevo: 0, manual: 0 },
      despues: { nos: 0, deb: 0 }, acciones: [], pendientes: [], devSinCruzar: [] };
    return terceros[k];
  };
  prestamosBase.forEach(p => {
    const lado = ES_PRESTAMO[p.tipo];
    const t = T(p);
    t.antes[lado] += saldoInicial[p.id].v;
    const s = saldoDe(p.id);
    t.despues[lado] += s.v;
    if (s.q > TOL) {
      t.pendientes.push({ prestamo: p, lado, q: s.q, v: s.v,
        items: Object.entries(pend[p.id]).filter(([, y]) => y.q > TOL).map(([codigo, y]) => ({ codigo, nombre: y.nombre, q: y.q, v: y.q * y.pu })) });
    }
  });
  acciones.forEach(a => {
    a.valor = a.lineas.reduce((s, l) => s + l.valor, 0);
    a.unidades = a.lineas.reduce((s, l) => s + l.cantidad, 0);
    a.lado = ES_PRESTAMO[a.prestamo.tipo];
    a.id = `${a.tipo}|${a.prestamo.id}|${a.devolucion.id}|${a.lineas.map(l => l.codigo + '>' + (l.codigo_prestamo || '')).join(',')}`;
    const t = T(a.prestamo);
    t.acciones.push(a);
    t.ajuste[a.tipo] += a.valor;
  });
  devoluciones.forEach(d => {
    const items = Object.entries(disp[d.id]).filter(([, x]) => x.q > TOL).map(([codigo, x]) => ({ codigo, nombre: x.nombre, q: x.q, v: x.q * x.pu }));
    if (items.length) T(d).devSinCruzar.push({ devolucion: d, items, q: items.reduce((a, x) => a + x.q, 0), v: items.reduce((a, x) => a + x.v, 0) });
  });
  // "despues" incluye A+B+C. Sin las sugerencias manuales (C), el saldo sería despues + ajuste.manual del lado correspondiente.
  Object.values(terceros).forEach(t => {
    t.manualPorLado = { nos: 0, deb: 0 };
    t.acciones.filter(a => a.tipo === 'manual').forEach(a => { t.manualPorLado[a.lado] += a.valor; });
    t.despuesSinManual = { nos: t.despues.nos + t.manualPorLado.nos, deb: t.despues.deb + t.manualPorLado.deb };
  });
  return Object.values(terceros);
}

// Cruces registrados entre un préstamo y una devolución de TERCEROS DISTINTOS.
// Casi siempre son errores al elegir la devolución en la pestaña Cruces
// (descuadran el saldo de los dos terceros); se listan para revisarlos.
export function crucesEntreTerceros(prestamos = [], cruces = []) {
  const porId = {};
  (prestamos || []).forEach(p => { porId[p.id] = p; });
  return (cruces || []).map(c => {
    const p = porId[c.prestamo_id], d = porId[c.devolucion_id];
    if (!p || !d || claveTerceroDe(p) === claveTerceroDe(d)) return null;
    const items = itemsDeCruce(c);
    // Si la devolución menciona en sus observaciones el préstamo, es más probable que sea intencional
    const menciona = mencionados(d).has(docNorm(p));
    return { cruce: c, prestamo: p, devolucion: d, items, menciona,
      valor: items.reduce((s, it) => s + Number(it.cantidad || 0) * Number(it.precio_unitario || 0), 0) };
  }).filter(Boolean).sort((a, b) => String(a.prestamo.clinica_nombre).localeCompare(String(b.prestamo.clinica_nombre)) || fechaDe(a.prestamo).localeCompare(fechaDe(b.prestamo)));
}

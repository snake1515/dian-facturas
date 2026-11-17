// ─── Reporte de préstamos abiertos y parciales por tercero ───────────────────
// Excel con:
//   1. Resumen por tercero (fórmulas SUMIFS/COUNTIFS sobre "Datos TD")
//   2. Tabla dinámica real de Excel (tercero → documento × lado, suma del saldo)
//   3. Abiertos y parciales: cada préstamo con saldo y, al lado, las
//      devoluciones que ya se le aplicaron
//   4. Devoluciones aplicadas a los parciales (una fila por devolución)
//   5. Datos TD: la tabla de origen de la tabla dinámica
// El saldo es el real según los cruces (lo prestado menos lo abonado en cruces
// y devoluciones legadas), a la fecha de corte.
import * as XLSX from 'xlsx';

const TOL = 0.0001;
const LADO_NOS = 'Nos deben (EPO)';
const LADO_DEB = 'Le debemos (IPE)';
const FMT_COP = '"$"#,##0;[Red]-"$"#,##0';
const FMT_NUM = '#,##0.##;[Red]-#,##0.##';
const fechaDe = p => String(p.fecha || '').substring(0, 10);
const itemsDeCruce = c => ((c.items_cruzados !== null && c.items_cruzados !== undefined) ? c.items_cruzados : (c.devolucion_items || []));
const nf = n => Number(n || 0).toLocaleString('es-CO', { maximumFractionDigits: 2 });

// ── Cálculo ──────────────────────────────────────────────────────────────────
export function documentosAbiertos(prestamos = [], cruces = [], hasta = '') {
  const fin = hasta || '9999-12-31';
  const hoy = new Date(fin === '9999-12-31' ? Date.now() : fin + 'T12:00:00');
  const devPorId = {};
  const legado = [];
  (prestamos || []).forEach(d => {
    if (d.tipo === 'devolucion_ingreso' || d.tipo === 'devolucion_egreso') { devPorId[d.id] = d; if (d.prestamo_id) legado.push(d); }
  });
  const out = [];
  (prestamos || []).filter(p => (p.tipo === 'egreso' || p.tipo === 'ingreso') && fechaDe(p) && fechaDe(p) <= fin).forEach(p => {
    const porCod = {};
    (p.items || []).forEach(i => {
      if (!porCod[i.codigo]) porCod[i.codigo] = { codigo: i.codigo, nombre: i.nombre, q: 0, v: 0 };
      porCod[i.codigo].q += Number(i.cantidad || 0);
      porCod[i.codigo].v += Number(i.cantidad || 0) * Number(i.precio_unitario || 0);
    });
    const pu = c => (porCod[c] && porCod[c].q ? porCod[c].v / porCod[c].q : 0);
    const abon = {};
    const devs = [];
    legado.filter(d => d.prestamo_id === p.id && fechaDe(d) <= fin).forEach(d => {
      const its = (d.items || []).map(i => ({ codigo: i.codigo, nombre: i.nombre, cantidad: Number(i.cantidad || 0) }));
      its.forEach(i => { abon[i.codigo] = (abon[i.codigo] || 0) + i.cantidad; });
      devs.push({ doc: d.documento_contable, fecha: fechaDe(d), cru: '', items: its, valor: its.reduce((s, i) => s + i.cantidad * pu(i.codigo), 0) });
    });
    (cruces || []).filter(c => c.prestamo_id === p.id).forEach(c => {
      const d = devPorId[c.devolucion_id];
      if (d && fechaDe(d) > fin) return;
      const its = itemsDeCruce(c).map(i => ({ codigo: i.codigo_prestamo || i.codigo, nombre: i.nombre_prestamo || i.nombre, cantidad: Number(i.cantidad || 0) }));
      if (!its.length) return;
      its.forEach(i => { abon[i.codigo] = (abon[i.codigo] || 0) + i.cantidad; });
      devs.push({ doc: c.devolucion_doc || (d && d.documento_contable) || '', fecha: d ? fechaDe(d) : '', cru: c.grupo_numero || '',
        items: its, valor: its.reduce((s, i) => s + i.cantidad * pu(i.codigo), 0) });
    });
    let presQ = 0, presV = 0, pendQ = 0, pendV = 0;
    const pendientes = [];
    Object.values(porCod).forEach(c => {
      const q = Math.max(0, c.q - (abon[c.codigo] || 0));
      const v = q * pu(c.codigo);
      presQ += c.q; presV += c.v; pendQ += q; pendV += v;
      if (q > TOL) pendientes.push({ codigo: c.codigo, nombre: c.nombre, q, v, total: c.q });
    });
    if (pendQ <= TOL) return; // cerrado
    const estado = presQ - pendQ <= TOL ? 'Abierto' : 'Parcial';
    devs.sort((a, b) => a.fecha.localeCompare(b.fecha));
    out.push({
      id: p.id, tercero: p.clinica_nombre || 'Sin tercero', lado: p.tipo === 'egreso' ? LADO_NOS : LADO_DEB,
      doc: p.documento_contable, fecha: fechaDe(p), estado, presQ, presV, pendQ, pendV, devQ: presQ - pendQ, devV: presV - pendV,
      dias: Math.max(0, Math.floor((hoy - new Date(fechaDe(p) + 'T12:00:00')) / 86400000)),
      pendientes, devs, obs: p.observaciones || '',
    });
  });
  return out.sort((a, b) => a.tercero.localeCompare(b.tercero) || a.lado.localeCompare(b.lado) || a.fecha.localeCompare(b.fecha));
}

// ── Utilidades de hoja ──────────────────────────────────────────────────────
function hoja(wb, nombre, aoa, formatos = {}, anchos = [], filtro = null) {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  Object.entries(formatos).forEach(([col, z]) => {
    const c = Number(col);
    for (let r = 0; r < aoa.length; r++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell && cell.t === 'n') cell.z = z;
    }
  });
  if (anchos.length) ws['!cols'] = anchos.map(w => ({ wch: w }));
  if (filtro) ws['!autofilter'] = { ref: filtro };
  XLSX.utils.book_append_sheet(wb, ws, nombre);
  return ws;
}
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const colLetra = n => { let s = ''; n++; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };

// ── Construcción del libro ──────────────────────────────────────────────────
// Devuelve los bytes del .xlsx (Uint8Array) con la tabla dinámica incluida.
export function construirReporteAbiertos(prestamos, cruces, hasta = '') {
  const docs = documentosAbiertos(prestamos, cruces, hasta);
  const corte = hasta || new Date().toISOString().substring(0, 10);
  const generado = new Date().toLocaleString('es-CO');
  const wb = XLSX.utils.book_new();

  // Terceros ordenados y totales
  const terceros = [...new Set(docs.map(d => d.tercero))].sort((a, b) => a.localeCompare(b));
  const tot = t => {
    const ds = docs.filter(d => d.tercero === t);
    const nos = ds.filter(d => d.lado === LADO_NOS), deb = ds.filter(d => d.lado === LADO_DEB);
    return { nosV: nos.reduce((s, d) => s + Math.round(d.pendV), 0), nosN: nos.length, debV: deb.reduce((s, d) => s + Math.round(d.pendV), 0), debN: deb.length };
  };

  // 5. Datos TD (se arma primero para saber sus rangos; se agrega al final)
  const colsTD = ['Tercero', 'Lado', 'Documento', 'Fecha', 'Estado', 'Prestado ($)', 'Devuelto ($)', 'Saldo ($)', 'Saldo (und)', 'Días'];
  const filasTD = docs.map(d => [d.tercero, d.lado, d.doc, d.fecha, d.estado, Math.round(d.presV), Math.round(d.devV), Math.round(d.pendV), Number(d.pendQ.toFixed(2)), d.dias]);
  const nTD = filasTD.length + 1;

  // 1. Resumen por tercero (con fórmulas sobre Datos TD)
  const resumen = [
    ['Préstamos abiertos y parciales por tercero'],
    [`Corte: ${corte} · Saldo real según cruces · Generado: ${generado}`],
    [],
    ['Tercero', 'Nos deben ($)', 'Docs. nos deben', 'Le debemos ($)', 'Docs. le debemos', 'Neto ($) (+ a favor de UCIS)'],
  ];
  terceros.forEach(t => { const x = tot(t); resumen.push([t, x.nosV, x.nosN, x.debV, x.debN, x.nosV - x.debV]); });
  const T = terceros.reduce((a, t) => { const x = tot(t); return { nosV: a.nosV + x.nosV, nosN: a.nosN + x.nosN, debV: a.debV + x.debV, debN: a.debN + x.debN }; }, { nosV: 0, nosN: 0, debV: 0, debN: 0 });
  resumen.push(['TOTAL', T.nosV, T.nosN, T.debV, T.debN, T.nosV - T.debV]);
  const wsR = hoja(wb, 'Resumen por tercero', resumen, { 1: FMT_COP, 2: '0', 3: FMT_COP, 4: '0', 5: FMT_COP }, [46, 16, 10, 16, 10, 18],
    terceros.length ? `A4:F${4 + terceros.length}` : null);
  // Fórmulas (con el valor ya calculado, para que se vea igual sin recalcular)
  const rTD = c => `'Datos TD'!$${c}$2:$${c}$${nTD}`;
  terceros.forEach((t, i) => {
    const r = 5 + i; // fila Excel
    const set = (c, f) => { const cell = wsR[`${c}${r}`]; if (cell) cell.f = f; };
    set('B', `SUMIFS(${rTD('H')},${rTD('A')},$A${r},${rTD('B')},"${LADO_NOS}")`);
    set('C', `COUNTIFS(${rTD('A')},$A${r},${rTD('B')},"${LADO_NOS}")`);
    set('D', `SUMIFS(${rTD('H')},${rTD('A')},$A${r},${rTD('B')},"${LADO_DEB}")`);
    set('E', `COUNTIFS(${rTD('A')},$A${r},${rTD('B')},"${LADO_DEB}")`);
    set('F', `B${r}-D${r}`);
  });
  const rt = 5 + terceros.length;
  if (terceros.length) ['B', 'C', 'D', 'E'].forEach(c => { const cell = wsR[`${c}${rt}`]; if (cell) cell.f = `SUM(${c}5:${c}${rt - 1})`; });
  if (wsR[`F${rt}`]) wsR[`F${rt}`].f = `B${rt}-D${rt}`;

  // 2. Tabla dinámica: se escriben los valores ya calculados en el mismo
  // lugar donde Excel la dibuja (así se ve aunque no se actualice) y luego
  // se inyecta la definición real.
  const ladosPresentes = [LADO_DEB, LADO_NOS].filter(l => docs.some(d => d.lado === l)); // orden alfabético
  const docsOrd = [...docs].sort((a, b) => a.tercero.localeCompare(b.tercero) || a.doc.localeCompare(b.doc, 'es', { numeric: true }));
  const docNombres = [...new Set(docsOrd.map(d => d.doc))].sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
  const pv = [
    ['Tabla dinámica: saldo por tercero y documento'],
    ['Clic derecho → Actualizar para recalcular. Puedes expandir/contraer cada tercero, filtrar o mover campos.'],
    ['Suma de Saldo ($)', 'Etiquetas de columna'],
    ['Etiquetas de fila', ...ladosPresentes, 'Total general'],
  ];
  const filaPv = (label, ds) => [label, ...ladosPresentes.map(l => { const v = ds.filter(d => d.lado === l).reduce((s, d) => s + Math.round(d.pendV), 0); return ds.some(d => d.lado === l) ? v : ''; }),
    ds.reduce((s, d) => s + Math.round(d.pendV), 0)];
  terceros.forEach(t => {
    const ds = docsOrd.filter(d => d.tercero === t);
    pv.push(filaPv(t, ds));
    ds.forEach(d => pv.push(filaPv(d.doc, [d])));
  });
  pv.push(filaPv('Total general', docs));
  const fmtPv = {}; ladosPresentes.forEach((_, i) => { fmtPv[i + 1] = '#,##0'; }); fmtPv[ladosPresentes.length + 1] = '#,##0';
  hoja(wb, 'Tabla dinámica', pv, fmtPv, [40, 18, 18, 18]);

  // 3. Abiertos y parciales (documento por documento, con las devoluciones al lado)
  const det = [
    ['Préstamos abiertos y parciales — detalle por tercero'],
    [`Corte: ${corte} · Los parciales muestran al lado las devoluciones ya aplicadas · Generado: ${generado}`],
    [],
    ['Tercero', 'Lado', 'Documento', 'Fecha', 'Estado', 'Días', 'Prestado ($)', 'Devuelto ($)', 'Saldo ($)', 'Productos pendientes', 'Devoluciones aplicadas (doc · fecha · cruce: productos)'],
  ];
  terceros.forEach(t => {
    const ds = docs.filter(d => d.tercero === t);
    ds.forEach(d => det.push([d.tercero, d.lado, d.doc, d.fecha, d.estado, d.dias, Math.round(d.presV), Math.round(d.devV), Math.round(d.pendV),
      d.pendientes.map(x => `${x.nombre || x.codigo} ×${nf(x.q)}${x.q < x.total - TOL ? ` (de ${nf(x.total)})` : ''}`).join('; '),
      d.devs.length ? d.devs.map(v => `${v.doc} · ${v.fecha}${v.cru ? ' · ' + v.cru : ''}: ${v.items.map(i => `${i.nombre || i.codigo} ×${nf(i.cantidad)}`).join(', ')}`).join(' | ') : '—']));
    const x = tot(t);
    det.push([`Subtotal ${t}`, '', `${ds.length} doc.`, '', '', '', ds.reduce((s, d) => s + Math.round(d.presV), 0), ds.reduce((s, d) => s + Math.round(d.devV), 0),
      x.nosV - x.debV, `Nos deben ${x.nosV.toLocaleString('es-CO')} · Le debemos ${x.debV.toLocaleString('es-CO')}`, '']);
    det.push([]);
  });
  hoja(wb, 'Abiertos y parciales', det, { 5: '0', 6: FMT_COP, 7: FMT_COP, 8: FMT_COP }, [34, 16, 10, 11, 9, 7, 14, 14, 14, 60, 90]);

  // 4. Devoluciones aplicadas a los parciales
  const dv = [['Tercero', 'Lado', 'Préstamo', 'Fecha préstamo', 'Saldo préstamo ($)', 'Devolución', 'Fecha devolución', 'Cruce', 'Productos aplicados', 'Valor aplicado ($)']];
  docs.filter(d => d.estado === 'Parcial').forEach(d => d.devs.forEach(v => dv.push([d.tercero, d.lado, d.doc, d.fecha, Math.round(d.pendV), v.doc, v.fecha, v.cru,
    v.items.map(i => `${i.nombre || i.codigo} ×${nf(i.cantidad)}`).join(', '), Math.round(v.valor)])));
  hoja(wb, 'Devoluciones de parciales', dv, { 4: FMT_COP, 9: FMT_COP }, [34, 16, 10, 11, 14, 11, 11, 11, 70, 14], dv.length > 1 ? `A1:J${dv.length}` : null);

  // 5. Datos TD
  hoja(wb, 'Datos TD', [colsTD, ...filasTD], { 5: FMT_COP, 6: FMT_COP, 7: FMT_COP, 8: FMT_NUM, 9: '0' }, [40, 18, 11, 11, 9, 14, 14, 14, 10, 7],
    filasTD.length ? `A1:J${nTD}` : null);

  const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx', compression: true });
  if (!docs.length) return new Uint8Array(bytes);
  return agregarTablaDinamica(new Uint8Array(bytes), {
    hojaPivote: 2, hojaDatos: 'Datos TD', cols: colsTD, filas: filasTD, terceros, docNombres, lados: ladosPresentes, docs: docsOrd,
  });
}

// ── Inyección de la tabla dinámica (pivotCache + pivotTable) ────────────────
function agregarTablaDinamica(bytes, o) {
  const CFB = XLSX.CFB;
  const zip = CFB.read(bytes, { type: 'array' });
  const enc = s => new TextEncoder().encode(s);
  const dec = u => new TextDecoder().decode(u);
  const leer = p => { const e = CFB.find(zip, '/' + p); return e ? dec(e.content) : null; };
  const escribir = (p, s) => {
    const e = CFB.find(zip, '/' + p);
    if (e) e.content = enc(s); else CFB.utils.cfb_add(zip, '/' + p, enc(s));
  };
  const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';

  // Índices de campos (columnas de Datos TD)
  const F_TER = 0, F_LADO = 1, F_DOC = 2;
  const F_SALDO = 7;
  const numericos = new Set([5, 6, 7, 8, 9]);
  // Ítems compartidos: los campos de texto
  const shared = {};
  o.cols.forEach((_, ci) => {
    if (numericos.has(ci)) return;
    let vals = [...new Set(o.filas.map(f => String(f[ci])))];
    if (ci === F_TER) vals = o.terceros;
    else if (ci === F_DOC) vals = o.docNombres;
    else if (ci === F_LADO) vals = o.lados;
    else vals.sort();
    shared[ci] = vals;
  });
  const idx = {};
  Object.entries(shared).forEach(([ci, vals]) => { const m = new Map(); vals.forEach((v, i) => m.set(v, i)); idx[ci] = m; });

  const cacheFields = o.cols.map((h, ci) => {
    if (numericos.has(ci)) {
      const vs = o.filas.map(f => Number(f[ci]) || 0);
      const ints = vs.every(v => Number.isInteger(v));
      return `<cacheField name="${esc(h)}" numFmtId="0"><sharedItems containsSemiMixedTypes="0" containsString="0" containsNumber="1"${ints ? ' containsInteger="1"' : ''} minValue="${Math.min(...vs)}" maxValue="${Math.max(...vs)}"/></cacheField>`;
    }
    return `<cacheField name="${esc(h)}" numFmtId="0"><sharedItems count="${shared[ci].length}">${shared[ci].map(v => `<s v="${esc(v)}"/>`).join('')}</sharedItems></cacheField>`;
  }).join('');
  const nRef = o.filas.length + 1;
  const lastCol = colLetra(o.cols.length - 1);
  const cacheDef = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<pivotCacheDefinition xmlns="${MAIN}" xmlns:r="${REL}" r:id="rId1" refreshOnLoad="1" refreshedBy="FacturaDIAN" refreshedDate="${(Date.now() / 86400000 + 25569).toFixed(6)}" createdVersion="6" refreshedVersion="6" minRefreshableVersion="3" recordCount="${o.filas.length}"><cacheSource type="worksheet"><worksheetSource ref="A1:${lastCol}${nRef}" sheet="${esc(o.hojaDatos)}"/></cacheSource><cacheFields count="${o.cols.length}">${cacheFields}</cacheFields></pivotCacheDefinition>`;
  const records = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<pivotCacheRecords xmlns="${MAIN}" xmlns:r="${REL}" count="${o.filas.length}">${o.filas.map(f => '<r>' + f.map((v, ci) => numericos.has(ci) ? `<n v="${Number(v) || 0}"/>` : `<x v="${idx[ci].get(String(v))}"/>`).join('') + '</r>').join('')}</pivotCacheRecords>`;

  // Definición de la tabla dinámica
  const itemsDe = n => `<items count="${n + 1}">${Array.from({ length: n }, (_, i) => `<item x="${i}"/>`).join('')}<item t="default"/></items>`;
  const pivotFields = o.cols.map((_, ci) => {
    if (ci === F_TER || ci === F_DOC) return `<pivotField axis="axisRow" showAll="0">${itemsDe(shared[ci].length)}</pivotField>`;
    if (ci === F_LADO) return `<pivotField axis="axisCol" showAll="0">${itemsDe(shared[ci].length)}</pivotField>`;
    if (ci === F_SALDO) return '<pivotField dataField="1" numFmtId="3" showAll="0"/>';
    return '<pivotField showAll="0"/>';
  }).join('');
  const rowItems = [];
  o.terceros.forEach((t, ti) => {
    rowItems.push(`<i><x v="${ti}"/></i>`);
    [...new Set(o.docs.filter(d => d.tercero === t).map(d => d.doc))].forEach(dn => rowItems.push(`<i r="1"><x v="${idx[F_DOC].get(dn)}"/></i>`));
  });
  rowItems.push('<i t="grand"><x/></i>');
  const colItems = o.lados.map((_, i) => (i === 0 ? '<i><x/></i>' : `<i><x v="${i}"/></i>`)).join('') + '<i t="grand"><x/></i>';
  const nFilas = 2 + (rowItems.length);                // encabezados + filas + total
  const lastPivCol = colLetra(o.lados.length + 1);
  const pivotTable = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<pivotTableDefinition xmlns="${MAIN}" name="SaldosPorTercero" cacheId="1" applyNumberFormats="0" applyBorderFormats="0" applyFontFormats="0" applyPatternFormats="0" applyAlignmentFormats="0" applyWidthHeightFormats="1" dataCaption="Valores" updatedVersion="6" minRefreshableVersion="3" useAutoFormatting="1" itemPrintTitles="1" createdVersion="6" indent="0" outline="1" outlineData="1" multipleFieldFilters="0"><location ref="A3:${lastPivCol}${3 + nFilas - 1}" firstHeaderRow="1" firstDataRow="2" firstDataCol="1"/><pivotFields count="${o.cols.length}">${pivotFields}</pivotFields><rowFields count="2"><field x="${F_TER}"/><field x="${F_DOC}"/></rowFields><rowItems count="${rowItems.length}">${rowItems.join('')}</rowItems><colFields count="1"><field x="${F_LADO}"/></colFields><colItems count="${o.lados.length + 1}">${colItems}</colItems><dataFields count="1"><dataField name="Suma de Saldo ($)" fld="${F_SALDO}" baseField="0" baseItem="0" numFmtId="3"/></dataFields><pivotTableStyleInfo name="PivotStyleMedium9" showRowHeaders="1" showColHeaders="1" showRowStripes="0" showColStripes="0" showLastColumn="1"/></pivotTableDefinition>`;

  escribir('xl/pivotCache/pivotCacheDefinition1.xml', cacheDef);
  escribir('xl/pivotCache/pivotCacheRecords1.xml', records);
  escribir('xl/pivotCache/_rels/pivotCacheDefinition1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${REL}/pivotCacheRecords" Target="pivotCacheRecords1.xml"/></Relationships>`);
  escribir('xl/pivotTables/pivotTable1.xml', pivotTable);
  escribir('xl/pivotTables/_rels/pivotTable1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${REL}/pivotCacheDefinition" Target="../pivotCache/pivotCacheDefinition1.xml"/></Relationships>`);

  // Hoja que contiene la tabla dinámica
  const hojaRels = `xl/worksheets/_rels/sheet${o.hojaPivote}.xml.rels`;
  const relPiv = `<Relationship Id="rIdPv1" Type="${REL}/pivotTable" Target="../pivotTables/pivotTable1.xml"/>`;
  const existentes = leer(hojaRels);
  escribir(hojaRels, existentes ? existentes.replace('</Relationships>', relPiv + '</Relationships>')
    : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${PKG}">${relPiv}</Relationships>`);

  // Libro: relación y lista de cachés
  const wbRels = leer('xl/_rels/workbook.xml.rels');
  escribir('xl/_rels/workbook.xml.rels', wbRels.replace('</Relationships>',
    `<Relationship Id="rIdPc1" Type="${REL}/pivotCacheDefinition" Target="pivotCache/pivotCacheDefinition1.xml"/></Relationships>`));
  let wbXml = leer('xl/workbook.xml');
  if (!/xmlns:r=/.test(wbXml)) wbXml = wbXml.replace('<workbook ', `<workbook xmlns:r="${REL}" `);
  wbXml = wbXml.includes('<extLst>')
    ? wbXml.replace('<extLst>', '<pivotCaches><pivotCache cacheId="1" r:id="rIdPc1"/></pivotCaches><extLst>')
    : wbXml.replace('</workbook>', '<pivotCaches><pivotCache cacheId="1" r:id="rIdPc1"/></pivotCaches></workbook>');
  escribir('xl/workbook.xml', wbXml);

  // Tipos de contenido
  const ct = leer('[Content_Types].xml').replace('</Types>',
    '<Override PartName="/xl/pivotCache/pivotCacheDefinition1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.pivotCacheDefinition+xml"/>'
    + '<Override PartName="/xl/pivotCache/pivotCacheRecords1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.pivotCacheRecords+xml"/>'
    + '<Override PartName="/xl/pivotTables/pivotTable1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.pivotTable+xml"/></Types>');
  escribir('[Content_Types].xml', ct);

  const out = CFB.write(zip, { fileType: 'zip', type: 'array', compression: true });
  return out instanceof Uint8Array ? out : new Uint8Array(out);
}

// Descarga el reporte.
export function descargarReporteAbiertos(prestamos, cruces, hasta = '') {
  const bytes = construirReporteAbiertos(prestamos, cruces, hasta);
  const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `prestamos_abiertos_parciales_${hasta || new Date().toISOString().substring(0, 10)}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

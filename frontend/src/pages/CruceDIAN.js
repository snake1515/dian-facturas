import React, { useState, useCallback, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { listarFacturas } from '../services/api';
import api from '../services/api';

const fmt = (n) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n || 0);

const MESES = [
  { value: '01', label: 'Enero' },
  { value: '02', label: 'Febrero' },
  { value: '03', label: 'Marzo' },
  { value: '04', label: 'Abril' },
  { value: '05', label: 'Mayo' },
  { value: '06', label: 'Junio' },
  { value: '07', label: 'Julio' },
  { value: '08', label: 'Agosto' },
  { value: '09', label: 'Septiembre' },
  { value: '10', label: 'Octubre' },
  { value: '11', label: 'Noviembre' },
  { value: '12', label: 'Diciembre' },
];

const AÑOS = ['2024', '2025', '2026'];

export default function CruceDIAN() {
  const añoActual = String(new Date().getFullYear());
  const mesActual = String(new Date().getMonth() + 1).padStart(2, '0');

  const [archivo, setArchivo] = useState(null);
  const [procesando, setProcesando] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [tabActiva, setTabActiva] = useState('cruzadas');

  // Mes/año del archivo DIAN subido
  const [mesArchivo, setMesArchivo] = useState(mesActual);
  const [añoArchivo, setAñoArchivo] = useState(añoActual);

  // Mes/año de la app contra el que comparar
  const [mesApp, setMesApp] = useState(mesActual);
  const [añoApp, setAñoApp] = useState(añoActual);

  // Filtro de responsable (dinámico según el archivo cargado)
  const [responsables, setResponsables] = useState([]);
  const [filtroResponsable, setFiltroResponsable] = useState('');

  // Archivos guardados en Supabase
  const [archivosGuardados, setArchivosGuardados] = useState([]);
  const [cargandoArchivos, setCargandoArchivos] = useState(true);
  const [registrosDIAN, setRegistrosDIAN] = useState([]);
  const [nombreArchivoActual, setNombreArchivoActual] = useState('');
  const [mesActivo, setMesActivo] = useState(null); // clave "YYYY-MM" del mes activo

  // ── Cargar lista de meses guardados al iniciar ──────────────────────────────
  useEffect(() => {
    const cargarMeses = async () => {
      try {
        setCargandoArchivos(true);
        const res = await api.get('/cruces-dian');
        setArchivosGuardados(res.data || []);
      } catch (err) {
        console.error('Error cargando archivos guardados:', err);
      } finally {
        setCargandoArchivos(false);
      }
    };
    cargarMeses();
  }, []);

  // ── Parser del Excel DIAN ───────────────────────────────────────────────────
  // Col E (índice 4) = FACT (número completo: Prefijo+Folio)
  // Col O (índice 14) = VALOR (número, se formatea como COP)
  // Col S (índice 18) = RESPONSABLE
  const MESES_HOJA = {
    '01': 'FACT ENE', '02': 'FACT FEB', '03': 'FACT MAR', '04': 'FACT ABR',
    '05': 'FACT MAY', '06': 'FACT JUN', '07': 'FACT JUL', '08': 'FACT AGO',
    '09': 'FACT SEP', '10': 'FACT OCT', '11': 'FACT NOV', '12': 'FACT DIC',
  };

  const parseArchivoExcel = (arrayBuffer) => {
    const wb = XLSX.read(arrayBuffer, { type: 'array' });
    // Buscar hoja del mes (ej: "FACT MAY"), si no existe usar la primera hoja
    const hojaDelMes = MESES_HOJA[mesArchivo];
    const sheetName = (hojaDelMes && wb.SheetNames.includes(hojaDelMes))
      ? hojaDelMes
      : wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    const registros = [];
    for (let i = 1; i < rows.length; i++) {
      const cols = rows[i];
      const numero = String(cols[4] || '').trim(); // Col E
      if (!numero) continue;

      const valorNum = parseFloat(String(cols[14] || '0').replace(/[^0-9.-]/g, '')) || 0;

      registros.push({
        tipo:           String(cols[0]  || '').trim(),
        cufe:           String(cols[1]  || '').trim(),
        folio:          String(cols[2]  || '').trim(),
        prefijo:        String(cols[3]  || '').trim(),
        numero,
        mes:            String(cols[5]  || '').trim(),
        fechaEmision:   String(cols[5]  || '').trim(),
        nitEmisor:      String(cols[7]  || '').trim(),
        emisor:         String(cols[8]  || '').trim(),
        iva:            String(cols[12] || '').trim(),
        valor:          valorNum,
        valorFormato:   fmt(valorNum),
        estado:         String(cols[15] || '').trim(),
        responsable:    String(cols[17] || '').trim(),
        notas:          String(cols[18] || '').trim(),
      });
    }
    return registros;
  };

  // ── Cargar facturas de la app filtradas por mes ─────────────────────────────
  const cargarFacturasBD = useCallback(async (mes, año) => {
    try {
      const [fe, nc] = await Promise.all([
        listarFacturas({ tipo: 'FE' }),
        listarFacturas({ tipo: 'NC' }),
      ]);
      const todas = [...(fe.data || []), ...(nc.data || [])];
      const clave = `${año}-${mes}`;
      return todas.filter(f => String(f.fecha_emision || '').substring(0, 7) === clave);
    } catch (err) {
      console.error('Error cargando facturas:', err);
      return [];
    }
  }, []);

  // ── Cargar un mes guardado desde Supabase ───────────────────────────────────
  const cargarMesGuardado = async (año, mes) => {
    try {
      const res = await api.get(`/cruces-dian/${año}/${mes}`);
      const datos = res.data;
      const regs = datos.registros;
      setRegistrosDIAN(regs);
      setNombreArchivoActual(datos.nombre_archivo);
      setMesArchivo(mes);
      setAñoArchivo(año);
      setMesActivo(`${año}-${mes}`);
      const resp = [...new Set(regs.map(r => r.responsable).filter(Boolean))].sort();
      setResponsables(resp);
      setFiltroResponsable('');
      setArchivo(null);
      setResultado(null);
    } catch (err) {
      alert('Error cargando el archivo del mes: ' + (err.response?.data?.error || err.message));
    }
  };

  // ── Procesar cruce ──────────────────────────────────────────────────────────
  const procesarArchivo = async () => {
    if (!archivo && registrosDIAN.length === 0) return;
    setProcesando(true);
    setResultado(null);

    try {
      let regs = registrosDIAN;

      if (archivo) {
        const arrayBuffer = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = e => resolve(e.target.result);
          reader.onerror = reject;
          reader.readAsArrayBuffer(archivo);
        });

        regs = parseArchivoExcel(arrayBuffer);

        if (regs.length === 0) {
          alert('No se encontraron registros. Asegúrate de que sea el reporte DIAN correcto.');
          setProcesando(false);
          return;
        }

        // Guardar en Supabase (UPSERT — reemplaza si ya existe el mes)
        await api.post('/cruces-dian', {
          mes: mesArchivo,
          año: añoArchivo,
          nombre_archivo: archivo.name,
          registros: regs,
        });

        // Actualizar lista de meses guardados
        const listaRes = await api.get('/cruces-dian');
        setArchivosGuardados(listaRes.data || []);

        setRegistrosDIAN(regs);
        setNombreArchivoActual(archivo.name);
        setMesActivo(`${añoArchivo}-${mesArchivo}`);

        const resp = [...new Set(regs.map(r => r.responsable).filter(Boolean))].sort();
        setResponsables(resp);
      }

      // Filtrar por responsable si hay filtro activo
      const regsFiltrados = filtroResponsable
        ? regs.filter(r => r.responsable === filtroResponsable)
        : regs;

      // Cruzar contra facturas de la app del mes seleccionado
      const facturas = await cargarFacturasBD(mesApp, añoApp);
      const mapaFacturas = {};
      facturas.forEach(f => {
        mapaFacturas[(f.numero || '').trim().toUpperCase()] = f;
      });

      const cruzadas = [];
      const noCruzadas = [];
      regsFiltrados.forEach(reg => {
        const found = mapaFacturas[reg.numero.toUpperCase()];
        if (found) cruzadas.push({ dian: reg, factura: found });
        else noCruzadas.push({ dian: reg });
      });

      setResultado({ cruzadas, noCruzadas, total: regsFiltrados.length });
    } catch (err) {
      alert('Error procesando archivo: ' + err.message);
      console.error(err);
    } finally {
      setProcesando(false);
    }
  };

  // ── Exportar ────────────────────────────────────────────────────────────────
  const exportarReporte = (datos, nombre) => {
    const bom = '\uFEFF';
    let headers, rows;
    if (nombre === 'cruzadas') {
      headers = ['N° DIAN','Emisor DIAN','Valor DIAN','Estado','Notas','Responsable App','Responsable DIAN','N° App','Proveedor App','Total App','Estado Contable','Doc. Ingreso'];
      rows = datos.map(({ dian, factura }) => [
        dian.numero, dian.emisor, dian.valorFormato, dian.estado, dian.notas, dian.responsable,
        factura.numero, factura.proveedor_nombre, fmt(factura.total),
        factura.estado_contable || '', factura.documento_ingreso || '',
      ]);
    } else {
      headers = ['N° DIAN','Tipo','Emisor DIAN','Fecha Recepción','Valor DIAN','Estado','Notas','Responsable','Observación'];
      rows = datos.map(({ dian }) => [
        dian.numero, dian.tipo, dian.emisor, dian.fechaRecepcion,
        dian.valorFormato, dian.estado, dian.notas, dian.responsable, 'No encontrada en la app',
      ]);
    }
    const csv = bom + [headers, ...rows].map(row =>
      row.map(v => { const s = String(v || '').replace(/"/g, '""'); return s.includes(',') || s.includes('"') ? `"${s}"` : s; }).join(',')
    ).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `cruce_dian_${nombre}_${añoApp}-${mesApp}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const exportarCompleto = () => {
    if (!resultado) return;
    const bom = '\uFEFF';
    const headers = ['Estado Cruce','N° DIAN','Emisor DIAN','Valor DIAN','Estado DIAN','Notas','Responsable','N° App','Proveedor App','Total App','Estado Contable','Doc. Ingreso'];
    const rows = [
      ...resultado.cruzadas.map(({ dian, factura }) => [
        'ENCONTRADA', dian.numero, dian.emisor, dian.valorFormato, dian.estado, dian.notas, dian.responsable,
        factura.numero, factura.proveedor_nombre, fmt(factura.total),
        factura.estado_contable || '', factura.documento_ingreso || '',
      ]),
      ...resultado.noCruzadas.map(({ dian }) => [
        'NO ENCONTRADA', dian.numero, dian.emisor, dian.valorFormato, dian.estado, dian.notas, dian.responsable,
        '', '', '', '', '',
      ]),
    ];
    const csv = bom + [headers, ...rows].map(row =>
      row.map(v => { const s = String(v || '').replace(/"/g, '""'); return s.includes(',') || s.includes('"') ? `"${s}"` : s; }).join(',')
    ).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `cruce_dian_completo_${añoApp}-${mesApp}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const selectSt = {
    background: 'var(--t-bg-app)', border: '1px solid var(--t-border)', borderRadius: 6,
    color: 'var(--t-text-primary)', fontSize: 13, padding: '8px 10px', outline: 'none', cursor: 'pointer',
  };
  const mesAppLabel = MESES.find(m => m.value === mesApp)?.label || mesApp;

  return (
    <div style={{ padding: '20px 0', color: 'var(--t-text-primary)', fontFamily: 'system-ui, sans-serif' }}>

      {/* ── Selector mes de la app ── */}
      <div style={{ background: 'var(--t-bg-card)', border: '1px solid var(--t-border)', borderRadius: 10, padding: 20, marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--t-text-primary)', marginBottom: 12 }}>
          🗓️ ¿Contra qué mes de la app comparar?
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--t-text-muted)', marginBottom: 4 }}>Mes</div>
            <select style={selectSt} value={mesApp} onChange={e => { setMesApp(e.target.value); setResultado(null); }}>
              {MESES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--t-text-muted)', marginBottom: 4 }}>Año</div>
            <select style={selectSt} value={añoApp} onChange={e => { setAñoApp(e.target.value); setResultado(null); }}>
              {AÑOS.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          {responsables.length > 0 && (
            <div>
              <div style={{ fontSize: 11, color: 'var(--t-text-muted)', marginBottom: 4 }}>Responsable</div>
              <select style={selectSt} value={filtroResponsable} onChange={e => { setFiltroResponsable(e.target.value); setResultado(null); }}>
                <option value="">Todos los responsables</option>
                {responsables.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* ── Archivos guardados en Supabase ── */}
      <div style={{ background: 'var(--t-bg-card)', border: '1px solid var(--t-border)', borderRadius: 10, padding: 16, marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--t-text-primary)', marginBottom: 10 }}>
          📁 Archivos DIAN guardados
        </div>
        {cargandoArchivos ? (
          <div style={{ fontSize: 12, color: 'var(--t-text-muted)' }}>Cargando...</div>
        ) : archivosGuardados.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--t-text-muted)' }}>No hay archivos guardados aún. Sube el primer reporte DIAN abajo.</div>
        ) : (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {archivosGuardados.map(a => {
              const mesLabel = MESES.find(m => m.value === a.mes)?.label || a.mes;
              const esActivo = mesActivo === `${a.año}-${a.mes}`;
              const fechaSubida = a.fecha_subida ? new Date(a.fecha_subida).toLocaleDateString('es-CO') : '';
              return (
                <button key={`${a.año}-${a.mes}`} onClick={() => cargarMesGuardado(a.año, a.mes)}
                  style={{
                    background: esActivo ? 'rgba(59,130,246,.15)' : 'var(--t-bg-sidebar)',
                    border: `1px solid ${esActivo ? '#3b82f6' : 'var(--t-border)'}`,
                    borderRadius: 8, padding: '8px 14px', cursor: 'pointer',
                    color: esActivo ? '#60a5fa' : 'var(--t-text-secondary)', fontSize: 12, textAlign: 'left',
                  }}>
                  <div style={{ fontWeight: 600 }}>{mesLabel} {a.año}</div>
                  <div style={{ fontSize: 10, color: 'var(--t-text-muted)', marginTop: 2 }}>{a.nombre_archivo}</div>
                  <div style={{ fontSize: 10, color: 'var(--t-text-muted)' }}>{a.total_registros} registros · {fechaSubida}</div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Subir nuevo archivo DIAN ── */}
      <div style={{ background: 'var(--t-bg-card)', border: '1px solid var(--t-border)', borderRadius: 10, padding: 20, marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--t-text-primary)', marginBottom: 12 }}>
          📂 Subir nuevo reporte DIAN
        </div>
        <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--t-text-muted)', marginBottom: 4 }}>Mes del archivo</div>
            <select style={selectSt} value={mesArchivo} onChange={e => setMesArchivo(e.target.value)}>
              {MESES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--t-text-muted)', marginBottom: 4 }}>Año del archivo</div>
            <select style={selectSt} value={añoArchivo} onChange={e => setAñoArchivo(e.target.value)}>
              {AÑOS.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
        </div>

        <div
          style={{ border: '1.5px dashed #2a3348', borderRadius: 8, padding: '20px 16px', textAlign: 'center', cursor: 'pointer', marginBottom: 12, background: archivo ? 'rgba(59,130,246,.05)' : 'transparent' }}
          onClick={() => document.getElementById('dian-file').click()}
        >
          <div style={{ fontSize: 28, marginBottom: 6 }}>{archivo ? '✅' : '📊'}</div>
          <div style={{ fontSize: 13, color: archivo ? '#4ade80' : 'var(--t-text-muted)' }}>
            {archivo ? archivo.name : 'Clic para seleccionar el archivo Excel (.xlsx/.xlsm) de la DIAN'}
          </div>
          {archivo && <div style={{ fontSize: 11, color: 'var(--t-text-muted)', marginTop: 4 }}>{(archivo.size / 1024).toFixed(1)} KB</div>}
          <input id="dian-file" type="file" accept=".xlsx,.xlsm,.xls,.csv" style={{ display: 'none' }}
            onChange={e => {
              const f = e.target.files[0] || null;
              setArchivo(f);
              setResultado(null);
              setRegistrosDIAN([]);
              setResponsables([]);
              setFiltroResponsable('');
              setMesActivo(null);
            }} />
        </div>

        <div style={{ background: 'rgba(59,130,246,.08)', border: '1px solid rgba(59,130,246,.2)', borderRadius: 6, padding: '10px 12px', fontSize: 12, color: 'var(--t-text-secondary)', marginBottom: 14 }}>
          ℹ️ Compara la <strong style={{ color: '#60a5fa' }}>columna E (N° Factura)</strong> del reporte DIAN contra las facturas de <strong style={{ color: '#60a5fa' }}>{mesAppLabel} {añoApp}</strong> en la app. Si ya existe un archivo del mismo mes, será reemplazado por el más reciente.
        </div>

        <button
          onClick={procesarArchivo}
          disabled={(!archivo && registrosDIAN.length === 0) || procesando}
          style={{
            background: (archivo || registrosDIAN.length > 0) && !procesando ? '#3b82f6' : 'var(--t-border)',
            color: (archivo || registrosDIAN.length > 0) && !procesando ? '#fff' : 'var(--t-text-muted)',
            border: 'none', borderRadius: 6, padding: '10px 20px', fontSize: 13, fontWeight: 600,
            cursor: (archivo || registrosDIAN.length > 0) && !procesando ? 'pointer' : 'not-allowed',
          }}>
          {procesando ? '⟳ Procesando...' : '🔍 Iniciar cruce'}
        </button>

        {registrosDIAN.length > 0 && !archivo && (
          <span style={{ marginLeft: 12, fontSize: 12, color: 'var(--t-text-muted)' }}>
            Usando: <strong style={{ color: 'var(--t-text-secondary)' }}>{nombreArchivoActual}</strong> ({registrosDIAN.length} registros)
          </span>
        )}
      </div>

      {/* ── Resultados ── */}
      {resultado && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 16 }}>
            {[
              { label: 'Total DIAN', val: resultado.total, color: '#3b82f6' },
              { label: 'Encontradas', val: resultado.cruzadas.length, color: '#4ade80' },
              { label: 'No encontradas', val: resultado.noCruzadas.length, color: '#f87171' },
              { label: '% Cobertura', val: resultado.total > 0 ? Math.round(resultado.cruzadas.length / resultado.total * 100) + '%' : '0%', color: '#fbbf24' },
            ].map(s => (
              <div key={s.label} style={{ background: 'var(--t-bg-card)', border: '1px solid var(--t-border)', borderRadius: 8, padding: '12px 14px' }}>
                <div style={{ fontSize: 11, color: 'var(--t-text-muted)', marginBottom: 4 }}>{s.label}</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{s.val}</div>
              </div>
            ))}
          </div>

          <div style={{ fontSize: 12, color: 'var(--t-text-muted)', marginBottom: 12 }}>
            Comparando contra facturas de <strong style={{ color: '#60a5fa' }}>{mesAppLabel} {añoApp}</strong>
            {filtroResponsable && <> · Responsable: <strong style={{ color: '#fbbf24' }}>{filtroResponsable}</strong></>}
          </div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
            <button onClick={exportarCompleto} style={{ background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 14px', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>
              📥 Exportar reporte completo
            </button>
            <button onClick={() => exportarReporte(resultado.cruzadas, 'cruzadas')} style={{ background: 'var(--t-bg-card)', color: '#4ade80', border: '1px solid var(--t-border)', borderRadius: 6, padding: '8px 14px', fontSize: 13, cursor: 'pointer' }}>
              ✅ Encontradas ({resultado.cruzadas.length})
            </button>
            <button onClick={() => exportarReporte(resultado.noCruzadas, 'no_cruzadas')} style={{ background: 'var(--t-bg-card)', color: '#f87171', border: '1px solid var(--t-border)', borderRadius: 6, padding: '8px 14px', fontSize: 13, cursor: 'pointer' }}>
              ❌ No encontradas ({resultado.noCruzadas.length})
            </button>
          </div>

          <div style={{ display: 'flex', gap: 2, background: 'var(--t-bg-app)', padding: 3, borderRadius: 8, marginBottom: 12, width: 'fit-content' }}>
            {[
              { id: 'cruzadas', label: `✅ Encontradas (${resultado.cruzadas.length})` },
              { id: 'no_cruzadas', label: `❌ No encontradas (${resultado.noCruzadas.length})` },
            ].map(t => (
              <button key={t.id} onClick={() => setTabActiva(t.id)}
                style={{ padding: '6px 14px', borderRadius: 6, border: 'none', fontSize: 12, fontWeight: 500, cursor: 'pointer', background: tabActiva === t.id ? 'var(--t-bg-card)' : 'transparent', color: tabActiva === t.id ? 'var(--t-text-primary)' : 'var(--t-text-muted)' }}>
                {t.label}
              </button>
            ))}
          </div>

          {tabActiva === 'cruzadas' && (
            <div style={{ background: 'var(--t-bg-card)', border: '1px solid var(--t-border)', borderRadius: 10, overflow: 'hidden' }}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: 'var(--t-bg-sidebar)' }}>
                      {['N° DIAN','Emisor DIAN','Valor DIAN','Estado','Notas','Responsable','N° App','Proveedor App','Total App','Estado Contable','Doc. Ingreso'].map(h => (
                        <th key={h} style={{ padding: '10px 12px', textAlign: 'left', color: 'var(--t-text-muted)', fontWeight: 500, whiteSpace: 'nowrap', borderBottom: '1px solid var(--t-border)' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {resultado.cruzadas.map(({ dian, factura }, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid #1a2234' }}>
                        <td style={{ padding: '8px 12px', color: '#4ade80', fontFamily: 'monospace' }}>{dian.numero}</td>
                        <td style={{ padding: '8px 12px', color: 'var(--t-text-primary)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{dian.emisor}</td>
                        <td style={{ padding: '8px 12px', color: 'var(--t-text-primary)', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{dian.valorFormato}</td>
                        <td style={{ padding: '8px 12px' }}><span style={{ background: '#1e3a5f', color: '#60a5fa', padding: '2px 8px', borderRadius: 20, fontSize: 11 }}>{dian.estado}</span></td>
                        <td style={{ padding: '8px 12px', color: 'var(--t-text-secondary)', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{dian.notas}</td>
                        <td style={{ padding: '8px 12px' }}>
                          {factura.responsables?.length > 0
                            ? <span style={{ background: '#1e2a1e', color: '#4ade80', padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 600 }}>{factura.responsables.map(r => r.nombre || r.email).join(', ')}</span>
                            : <span style={{ color: 'var(--t-text-muted)', fontSize: 11 }}>—</span>}
                        </td>
                        <td style={{ padding: '8px 12px' }}>
                          {dian.responsable
                            ? <span style={{ background: '#1e2a3a', color: '#93c5fd', padding: '2px 8px', borderRadius: 20, fontSize: 11 }}>{dian.responsable}</span>
                            : <span style={{ color: 'var(--t-text-muted)', fontSize: 11 }}>—</span>}
                        </td>
                        <td style={{ padding: '8px 12px', color: '#60a5fa', fontFamily: 'monospace' }}>{factura.numero}</td>
                        <td style={{ padding: '8px 12px', color: 'var(--t-text-primary)', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{factura.proveedor_nombre}</td>
                        <td style={{ padding: '8px 12px', color: 'var(--t-text-primary)', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{fmt(factura.total)}</td>
                        <td style={{ padding: '8px 12px', color: 'var(--t-text-secondary)', fontSize: 11 }}>{factura.estado_contable || '—'}</td>
                        <td style={{ padding: '8px 12px', color: 'var(--t-text-secondary)' }}>{factura.documento_ingreso || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {resultado.cruzadas.length === 0 && (
                  <div style={{ textAlign: 'center', padding: 32, color: 'var(--t-text-muted)' }}>No hay facturas cruzadas</div>
                )}
              </div>
            </div>
          )}

          {tabActiva === 'no_cruzadas' && (
            <div style={{ background: 'var(--t-bg-card)', border: '1px solid var(--t-border)', borderRadius: 10, overflow: 'hidden' }}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: 'var(--t-bg-sidebar)' }}>
                      {['N° DIAN','CUFE','Tipo','NIT Emisor','Nombre Emisor','Fecha Emisión','Valor DIAN','Estado','Notas','Responsable'].map(h => (
                        <th key={h} style={{ padding: '10px 12px', textAlign: 'left', color: 'var(--t-text-muted)', fontWeight: 500, whiteSpace: 'nowrap', borderBottom: '1px solid var(--t-border)' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {resultado.noCruzadas.map(({ dian }, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid #1a2234' }}>
                        <td style={{ padding: '8px 12px', color: '#f87171', fontFamily: 'monospace' }}>{dian.numero}</td>
                        <td style={{ padding: '8px 12px' }}>
                          {dian.cufe ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--t-text-muted)', maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block' }} title={dian.cufe}>
                                {dian.cufe.substring(0, 12)}…
                              </span>
                              <button
                                onClick={() => { navigator.clipboard.writeText(dian.cufe); }}
                                title={'Copiar CUFE: ' + dian.cufe}
                                style={{ background: 'rgba(59,130,246,.15)', border: '1px solid rgba(59,130,246,.3)', borderRadius: 4, padding: '2px 7px', fontSize: 10, color: '#60a5fa', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                                📋 Copiar
                              </button>
                            </div>
                          ) : <span style={{ color: 'var(--t-text-muted)', fontSize: 11 }}>—</span>}
                        </td>
                        <td style={{ padding: '8px 12px', color: 'var(--t-text-secondary)', fontSize: 11 }}>{dian.tipo}</td>
                        <td style={{ padding: '8px 12px', color: 'var(--t-text-secondary)', fontFamily: 'monospace' }}>{dian.nitEmisor}</td>
                        <td style={{ padding: '8px 12px', color: 'var(--t-text-primary)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{dian.emisor}</td>
                        <td style={{ padding: '8px 12px', color: 'var(--t-text-secondary)' }}>{dian.fechaEmision}</td>
                        <td style={{ padding: '8px 12px', color: 'var(--t-text-primary)', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{dian.valorFormato}</td>
                        <td style={{ padding: '8px 12px' }}><span style={{ background: '#2a1a1a', color: '#f87171', padding: '2px 8px', borderRadius: 20, fontSize: 11 }}>{dian.estado}</span></td>
                        <td style={{ padding: '8px 12px', color: 'var(--t-text-secondary)', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{dian.notas}</td>
                        <td style={{ padding: '8px 12px' }}>
                          {factura.responsables?.length > 0
                            ? <span style={{ background: '#1e2a1e', color: '#4ade80', padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 600 }}>{factura.responsables.map(r => r.nombre || r.email).join(', ')}</span>
                            : <span style={{ color: 'var(--t-text-muted)', fontSize: 11 }}>—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {resultado.noCruzadas.length === 0 && (
                  <div style={{ textAlign: 'center', padding: 32, color: 'var(--t-text-muted)' }}>Todas las facturas DIAN están en la app ✅</div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}















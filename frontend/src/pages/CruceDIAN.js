import React, { useState, useCallback } from 'react';
import { listarFacturas } from '../services/api';

const fmt = (n) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n || 0);

export default function CruceDIAN() {
  const [archivo, setArchivo] = useState(null);
  const [procesando, setProcesando] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [tabActiva, setTabActiva] = useState('cruzadas');
  const [facturasBD, setFacturasBD] = useState([]);

  const cargarFacturasBD = useCallback(async () => {
    try {
      const [fe, nc] = await Promise.all([
        listarFacturas({ tipo: 'FE' }),
        listarFacturas({ tipo: 'NC' }),
      ]);
      return [...(fe.data || []), ...(nc.data || [])];
    } catch (err) {
      console.error('Error cargando facturas:', err);
      return [];
    }
  }, []);

  const parsearExcelDIAN = (texto) => {
    const lineas = texto.split('\n').filter(l => l.trim());
    if (lineas.length < 2) return [];
    // Skip header row, parse tab-separated
    const registros = [];
    for (let i = 1; i < lineas.length; i++) {
      const cols = lineas[i].split('\t');
      if (cols.length < 3) continue;
      const numero = (cols[2] || '').trim();
      if (!numero) continue;
      registros.push({
        tipo: (cols[0] || '').trim(),
        cufe: (cols[1] || '').trim(),
        numero: numero,
        fechaRecepcion: (cols[3] || '').trim(),
        emisor: (cols[4] || '').trim(),
        iva: (cols[5] || '').trim(),
        total: (cols[6] || '').trim(),
        estado: (cols[7] || '').trim(),
        novedad: (cols[8] || '').trim(),
      });
    }
    return registros;
  };

  const procesarArchivo = async () => {
    if (!archivo) return;
    setProcesando(true);
    setResultado(null);

    try {
      // Read file as text (CSV export or tab-separated)
      const texto = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target.result);
        reader.onerror = reject;
        // Try to read xlsx as binary and parse manually, or read as text if csv
        if (archivo.name.endsWith('.xlsx') || archivo.name.endsWith('.xls')) {
          reader.readAsArrayBuffer(archivo);
        } else {
          reader.readAsText(archivo, 'UTF-8');
        }
      });

      let registrosDIAN = [];

      if (archivo.name.endsWith('.xlsx') || archivo.name.endsWith('.xls')) {
        // Parse xlsx using SheetJS-like approach via API call to Claude
        // Since we can't use SheetJS directly, we'll use a FileReader with ArrayBuffer
        // and parse the OOXML manually - instead use a simpler approach:
        // Convert ArrayBuffer to base64 and use the API to parse
        const arr = new Uint8Array(texto);
        // Simple xlsx parsing: find shared strings and extract column C values
        registrosDIAN = await parseXlsxSimple(arr);
      } else {
        registrosDIAN = parsearExcelDIAN(texto);
      }

      if (registrosDIAN.length === 0) {
        alert('No se encontraron registros en el archivo. Asegúrate de que sea el reporte DIAN correcto.');
        setProcesando(false);
        return;
      }

      // Load facturas from DB
      const facturas = await cargarFacturasBD();
      setFacturasBD(facturas);

      // Build lookup map: numero -> factura
      const mapaFacturas = {};
      facturas.forEach(f => {
        const num = (f.numero || '').trim().toUpperCase();
        mapaFacturas[num] = f;
      });

      // Cross reference
      const cruzadas = [];
      const noCruzadas = [];

      registrosDIAN.forEach(reg => {
        const numDIAN = reg.numero.toUpperCase();
        const facturaEncontrada = mapaFacturas[numDIAN];
        if (facturaEncontrada) {
          cruzadas.push({ dian: reg, factura: facturaEncontrada });
        } else {
          noCruzadas.push({ dian: reg });
        }
      });

      setResultado({ cruzadas, noCruzadas, total: registrosDIAN.length });
    } catch (err) {
      alert('Error procesando archivo: ' + err.message);
      console.error(err);
    } finally {
      setProcesando(false);
    }
  };

  const parseXlsxSimple = async (arrayBuffer) => {
    // Use API to parse xlsx via Claude AI
    try {
      const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4000,
          messages: [{
            role: 'user',
            content: [{
              type: 'text',
              text: `Este es un archivo Excel DIAN de facturas pendientes en base64. Extrae TODOS los registros y devuelve SOLO un JSON array sin markdown, donde cada objeto tenga: {"tipo","cufe","numero","fechaRecepcion","emisor","iva","total","estado","novedad"}. La columna C es el número de factura. Ignora la fila de encabezado. Base64: ${base64.substring(0, 100)}...`
            }, {
              type: 'document',
              source: { type: 'base64', media_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', data: base64 }
            }]
          }]
        })
      });
      const data = await resp.json();
      const txt = (data.content || []).map(c => c.text || '').join('');
      const clean = txt.replace(/```json|```/g, '').trim();
      return JSON.parse(clean);
    } catch (err) {
      console.error('Error parsing xlsx with AI:', err);
      // Fallback: return empty
      return [];
    }
  };

  const exportarReporte = (datos, nombre) => {
    const bom = '\uFEFF';
    let headers, rows;

    if (nombre === 'cruzadas') {
      headers = ['N° DIAN','Emisor DIAN','Total DIAN','Estado DIAN','Novedad','N° App','Proveedor App','Total App','Estado Contable','Doc. Ingreso'];
      rows = datos.map(({ dian, factura }) => [
        dian.numero, dian.emisor, dian.total, dian.estado, dian.novedad,
        factura.numero, factura.proveedor_nombre, factura.total,
        factura.estado_contable || '', factura.documento_ingreso || '',
      ]);
    } else {
      headers = ['N° DIAN','Tipo','Emisor DIAN','Fecha Recepción','Total DIAN','Estado DIAN','Novedad','Observación'];
      rows = datos.map(({ dian }) => [
        dian.numero, dian.tipo, dian.emisor, dian.fechaRecepcion,
        dian.total, dian.estado, dian.novedad, 'No encontrada en la app',
      ]);
    }

    const csv = bom + [headers, ...rows].map(row =>
      row.map(v => {
        const s = String(v || '').replace(/"/g, '""');
        return s.includes(',') || s.includes('"') ? `"${s}"` : s;
      }).join(',')
    ).join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `cruce_dian_${nombre}_${new Date().toISOString().substring(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const exportarCompleto = () => {
    if (!resultado) return;
    const bom = '\uFEFF';
    const headers = ['Estado Cruce','N° DIAN','Emisor DIAN','Total DIAN','Estado DIAN','Novedad','N° App','Proveedor App','Total App','Estado Contable','Doc. Ingreso'];
    const rows = [
      ...resultado.cruzadas.map(({ dian, factura }) => [
        'ENCONTRADA', dian.numero, dian.emisor, dian.total, dian.estado, dian.novedad,
        factura.numero, factura.proveedor_nombre, factura.total,
        factura.estado_contable || '', factura.documento_ingreso || '',
      ]),
      ...resultado.noCruzadas.map(({ dian }) => [
        'NO ENCONTRADA', dian.numero, dian.tipo, dian.total, dian.estado, dian.novedad,
        '—', '—', '—', '—', '—',
      ]),
    ];

    const csv = bom + [headers, ...rows].map(row =>
      row.map(v => { const s = String(v||'').replace(/"/g,'""'); return s.includes(',')||s.includes('"') ? `"${s}"` : s; }).join(',')
    ).join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `cruce_dian_completo_${new Date().toISOString().substring(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div style={{ padding: '16px 8px' }}>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#e2e8f0', marginBottom: 4 }}>Cruce con Reporte DIAN</h2>
        <p style={{ fontSize: 13, color: '#64748b' }}>Sube el reporte de facturas pendientes de la DIAN y cruza la columna C (número de factura) con las facturas importadas en la app.</p>
      </div>

      {/* Upload area */}
      <div style={{ background: '#1e2535', border: '1px solid #2a3348', borderRadius: 10, padding: 24, marginBottom: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: '#e2e8f0', marginBottom: 12 }}>📂 Subir reporte DIAN</div>
        <div
          style={{ border: '1.5px dashed #2a3348', borderRadius: 8, padding: '24px 16px', textAlign: 'center', cursor: 'pointer', marginBottom: 12, background: archivo ? 'rgba(59,130,246,.05)' : 'transparent' }}
          onClick={() => document.getElementById('dian-file').click()}
        >
          <div style={{ fontSize: 28, marginBottom: 8 }}>{archivo ? '✅' : '📊'}</div>
          <div style={{ fontSize: 13, color: archivo ? '#4ade80' : '#64748b' }}>
            {archivo ? archivo.name : 'Clic para seleccionar el archivo Excel (.xlsx) de la DIAN'}
          </div>
          {archivo && <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>{(archivo.size / 1024).toFixed(1)} KB</div>}
          <input id="dian-file" type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }}
            onChange={e => setArchivo(e.target.files[0] || null)} />
        </div>

        <div style={{ background: 'rgba(59,130,246,.08)', border: '1px solid rgba(59,130,246,.2)', borderRadius: 6, padding: '10px 12px', fontSize: 12, color: '#94a3b8', marginBottom: 14 }}>
          ℹ️ El cruce compara la <strong style={{ color: '#60a5fa' }}>columna C (N° Factura)</strong> del reporte DIAN con los números de facturas importadas desde tu correo.
        </div>

        <button
          onClick={procesarArchivo}
          disabled={!archivo || procesando}
          style={{ background: archivo && !procesando ? '#3b82f6' : '#2a3348', color: archivo && !procesando ? '#fff' : '#64748b', border: 'none', borderRadius: 6, padding: '10px 20px', fontSize: 13, fontWeight: 600, cursor: archivo && !procesando ? 'pointer' : 'not-allowed' }}
        >
          {procesando ? '⟳ Procesando...' : '🔍 Iniciar cruce'}
        </button>
      </div>

      {/* Results */}
      {resultado && (
        <div>
          {/* Summary cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 16 }}>
            {[
              { label: 'Total DIAN', val: resultado.total, color: '#3b82f6' },
              { label: 'Encontradas', val: resultado.cruzadas.length, color: '#4ade80' },
              { label: 'No encontradas', val: resultado.noCruzadas.length, color: '#f87171' },
              { label: '% Cobertura', val: resultado.total > 0 ? Math.round(resultado.cruzadas.length / resultado.total * 100) + '%' : '0%', color: '#fbbf24' },
            ].map(s => (
              <div key={s.label} style={{ background: '#1e2535', border: '1px solid #2a3348', borderRadius: 8, padding: '12px 14px' }}>
                <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>{s.label}</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{s.val}</div>
              </div>
            ))}
          </div>

          {/* Export buttons */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
            <button onClick={exportarCompleto} style={{ background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 14px', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>
              📥 Exportar reporte completo
            </button>
            <button onClick={() => exportarReporte(resultado.cruzadas, 'cruzadas')} style={{ background: '#1e2535', color: '#4ade80', border: '1px solid #2a3348', borderRadius: 6, padding: '8px 14px', fontSize: 13, cursor: 'pointer' }}>
              ✅ Exportar encontradas ({resultado.cruzadas.length})
            </button>
            <button onClick={() => exportarReporte(resultado.noCruzadas, 'no_cruzadas')} style={{ background: '#1e2535', color: '#f87171', border: '1px solid #2a3348', borderRadius: 6, padding: '8px 14px', fontSize: 13, cursor: 'pointer' }}>
              ❌ Exportar no encontradas ({resultado.noCruzadas.length})
            </button>
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: 2, background: '#0f1117', padding: 3, borderRadius: 8, marginBottom: 12, width: 'fit-content' }}>
            {[
              { id: 'cruzadas', label: `✅ Encontradas (${resultado.cruzadas.length})` },
              { id: 'no_cruzadas', label: `❌ No encontradas (${resultado.noCruzadas.length})` },
            ].map(t => (
              <button key={t.id} onClick={() => setTabActiva(t.id)} style={{ padding: '6px 14px', borderRadius: 6, border: 'none', fontSize: 12, fontWeight: 500, cursor: 'pointer', background: tabActiva === t.id ? '#1e2535' : 'transparent', color: tabActiva === t.id ? '#e2e8f0' : '#64748b' }}>
                {t.label}
              </button>
            ))}
          </div>

          {/* Cruzadas table */}
          {tabActiva === 'cruzadas' && (
            <div style={{ background: '#1e2535', border: '1px solid #2a3348', borderRadius: 10, overflow: 'hidden' }}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: '#161b27' }}>
                      {['N° DIAN','Emisor DIAN','Total DIAN','Estado DIAN','Novedad','N° App','Proveedor App','Total App','Estado Contable','Doc. Ingreso'].map(h => (
                        <th key={h} style={{ padding: '10px 12px', textAlign: 'left', color: '#64748b', fontWeight: 500, whiteSpace: 'nowrap', borderBottom: '1px solid #2a3348' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {resultado.cruzadas.map(({ dian, factura }, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid #1a2234' }}>
                        <td style={{ padding: '8px 12px', color: '#4ade80', fontFamily: 'monospace' }}>{dian.numero}</td>
                        <td style={{ padding: '8px 12px', color: '#e2e8f0', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{dian.emisor}</td>
                        <td style={{ padding: '8px 12px', color: '#e2e8f0', fontFamily: 'monospace' }}>{dian.total}</td>
                        <td style={{ padding: '8px 12px' }}><span style={{ background: '#1e3a5f', color: '#60a5fa', padding: '2px 8px', borderRadius: 20, fontSize: 11 }}>{dian.estado}</span></td>
                        <td style={{ padding: '8px 12px', color: '#94a3b8', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{dian.novedad}</td>
                        <td style={{ padding: '8px 12px', color: '#60a5fa', fontFamily: 'monospace' }}>{factura.numero}</td>
                        <td style={{ padding: '8px 12px', color: '#e2e8f0', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{factura.proveedor_nombre}</td>
                        <td style={{ padding: '8px 12px', color: '#e2e8f0', fontFamily: 'monospace' }}>{fmt(factura.total)}</td>
                        <td style={{ padding: '8px 12px', color: '#94a3b8', fontSize: 11 }}>{factura.estado_contable || '—'}</td>
                        <td style={{ padding: '8px 12px', color: '#94a3b8' }}>{factura.documento_ingreso || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {resultado.cruzadas.length === 0 && (
                  <div style={{ textAlign: 'center', padding: 32, color: '#64748b' }}>No hay facturas cruzadas</div>
                )}
              </div>
            </div>
          )}

          {/* No cruzadas table */}
          {tabActiva === 'no_cruzadas' && (
            <div style={{ background: '#1e2535', border: '1px solid #2a3348', borderRadius: 10, overflow: 'hidden' }}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: '#161b27' }}>
                      {['N° DIAN','Tipo','Emisor','Fecha Recepción','IVA','Total','Estado','Novedad'].map(h => (
                        <th key={h} style={{ padding: '10px 12px', textAlign: 'left', color: '#64748b', fontWeight: 500, whiteSpace: 'nowrap', borderBottom: '1px solid #2a3348' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {resultado.noCruzadas.map(({ dian }, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid #1a2234' }}>
                        <td style={{ padding: '8px 12px', color: '#f87171', fontFamily: 'monospace' }}>{dian.numero}</td>
                        <td style={{ padding: '8px 12px', color: '#94a3b8', fontSize: 11 }}>{dian.tipo}</td>
                        <td style={{ padding: '8px 12px', color: '#e2e8f0', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{dian.emisor}</td>
                        <td style={{ padding: '8px 12px', color: '#94a3b8' }}>{dian.fechaRecepcion}</td>
                        <td style={{ padding: '8px 12px', color: '#94a3b8', fontFamily: 'monospace' }}>{dian.iva}</td>
                        <td style={{ padding: '8px 12px', color: '#e2e8f0', fontFamily: 'monospace' }}>{dian.total}</td>
                        <td style={{ padding: '8px 12px' }}><span style={{ background: '#2a1a1a', color: '#f87171', padding: '2px 8px', borderRadius: 20, fontSize: 11 }}>{dian.estado}</span></td>
                        <td style={{ padding: '8px 12px', color: '#94a3b8', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{dian.novedad}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {resultado.noCruzadas.length === 0 && (
                  <div style={{ textAlign: 'center', padding: 32, color: '#64748b' }}>Todas las facturas DIAN están en la app ✅</div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

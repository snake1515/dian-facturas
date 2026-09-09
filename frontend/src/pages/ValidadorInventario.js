import React, { useState, useEffect, useCallback, useRef, useContext } from 'react';
import * as XLSX from 'xlsx';
import api from '../services/api';
import AuthContext from '../context/AuthContext';

// ── Bodegas conocidas (mismo listado que usa Préstamos) ───────────────────────
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

// ── Parseo de números en formato colombiano (punto = miles, coma = decimal) ──
function parseNumCO(v) {
  if (v === null || v === undefined || v === '') return 0;
  const s = String(v).trim();
  if (s.includes(',')) return parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0;
  const partes = s.split('.');
  if (partes.length > 1 && partes[partes.length - 1].length === 3) {
    return parseFloat(s.replace(/\./g, '')) || 0;
  }
  return parseFloat(s) || 0;
}

function fmtFechaCorta(f) {
  if (!f) return '—';
  return String(f).substring(0, 10);
}

// Limita a máximo 2 decimales y quita ceros sobrantes (Postgres NUMERIC(14,3)
// devuelve valores como "46.000"; esto los deja en "46" o "11.5")
function fmtNum2(v) {
  if (v === null || v === undefined || v === '') return '';
  const n = Number(v);
  if (isNaN(n)) return '';
  return String(Number(n.toFixed(2)));
}

// Fecha + hora en horario de Colombia (America/Bogota), sin importar en qué
// zona horaria esté el navegador de quien esté viendo la pantalla
function fmtFechaHoraCO(f) {
  if (!f) return '—';
  const d = new Date(f);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('es-CO', {
    timeZone: 'America/Bogota',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

// Detecta si el sistema actualizó la existencia DESPUÉS de que el ítem ya
// había sido contado (por una carga de Excel posterior al conteo)
function fueActualizadoDespuesDeContar(it) {
  return !!(it.contado && it.actualizado_en && it.contado_en && new Date(it.actualizado_en) > new Date(it.contado_en));
}

// Clasificación de la diferencia: 'real' o 'actualizacion'. Prioriza SIEMPRE
// la elección manual guardada en tipo_diferencia (persiste entre cargas de
// Excel); si aún no se ha clasificado, usa la detección automática por fecha
// solo como sugerencia inicial hasta que el usuario la confirme o la cambie.
function getTipoDiferencia(it) {
  const tieneDiferencia = it.contado && Number(it.cantidad_fisica) !== Number(it.existencia_sistema);
  if (!tieneDiferencia) return null;
  if (it.tipo_diferencia === 'real' || it.tipo_diferencia === 'actualizacion') return it.tipo_diferencia;
  return fueActualizadoDespuesDeContar(it) ? 'actualizacion' : 'real';
}

export default function ValidadorInventario() {
  const { puede, isEditor, isAdmin } = useContext(AuthContext);
  const puedeEditarContado = isEditor || isAdmin; // solo editor/admin modifican cantidades ya guardadas
  const [bodega, setBodega] = useState('BV');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [importando, setImportando] = useState(false);
  const [busqueda, setBusqueda] = useState('');
  const [filtro, setFiltro] = useState('todos');
  const [sortCol, setSortCol] = useState(null);   // 'costo_unitario' | 'costo_total' | null
  const [sortDir, setSortDir] = useState('desc'); // 'asc' | 'desc'
  const [editValues, setEditValues] = useState({});
  const [guardandoId, setGuardandoId] = useState(null);
  const [editSobrante, setEditSobrante] = useState({});
  const [guardandoSobranteId, setGuardandoSobranteId] = useState(null);
  const [editNotas, setEditNotas] = useState({});
  const [guardandoNotasId, setGuardandoNotasId] = useState(null);
  const [editPresentacion, setEditPresentacion] = useState({});
  const [guardandoPresentacionId, setGuardandoPresentacionId] = useState(null);
  const [importandoPresentaciones, setImportandoPresentaciones] = useState(false);
  const fileInputPresentacionesRef = useRef(null);
  const [editCuenta, setEditCuenta] = useState({});
  const [guardandoCuentaId, setGuardandoCuentaId] = useState(null);
  const [importandoTipos, setImportandoTipos] = useState(false);
  const fileInputTiposRef = useRef(null);
  const [vista, setVista] = useState('inventario'); // 'inventario' | 'listas'
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);

  const cargar = useCallback(async (bod) => {
    setLoading(true);
    try {
      const res = await api.get('/validador-inventario', { params: { bodega: bod } });
      setItems(res.data || []);
    } catch (e) {
      console.error('Error cargando validador de inventario:', e);
      setError('No se pudo cargar el inventario guardado');
    }
    setLoading(false);
  }, []);

  useEffect(() => { cargar(bodega); }, [bodega, cargar]);

  // ── Cargar / actualizar Excel del sistema (SIIS) ────────────────────────────
  function handleArchivo(e) {
    const file = e.target.files[0];
    if (!file) return;
    setError('');
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const wb = XLSX.read(ev.target.result, { type: 'array', raw: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true });

        // Detectar bodega desde la cabecera del reporte (ej. "Bodega :  BV")
        let bodDetectada = bodega;
        const textoCabecera = String(data[0]?.[1] || '');
        const match = textoCabecera.match(/Bodega\s*:\s*([A-Za-z0-9]{2})/i);
        if (match) bodDetectada = match[1].toUpperCase();

        // Encontrar fila de encabezados (CODIGO, NOMBRE, ...)
        const idxHeader = data.findIndex(r => String(r[0]).trim().toUpperCase() === 'CODIGO');
        if (idxHeader === -1) {
          setError('No se encontró la columna CODIGO en el archivo. ¿Es el reporte correcto?');
          return;
        }

        const filas = data.slice(idxHeader + 1);
        const nuevosItems = [];
        let filasCorregidas = 0;

        // Detecta cuando la celda "nombre" trae pegado un fragmento de HTML roto
        // del reporte SIIS (ej. "...12”\n🔩/td>2045-06-11"). Cuando esto pasa, la
        // celda de fecha real "desaparece" de la fila y todas las columnas
        // siguientes (lote, existencia, costos) se corren una posición.
        const FRAGMENTO_ROTO_RE = /\/t[dr]>\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}-\d{1,2}-\d{1,2})\s*$/i;

        for (const r of filas) {
          const codigo = String(r[0] || '').trim();
          if (!codigo || codigo.toUpperCase().startsWith('TOTAL')) continue;

          let nombreRaw = String(r[1] || '');
          let fecha_vencimiento, lote, existencia_sistema, costo_unitario, costo_total;

          const roto = nombreRaw.match(FRAGMENTO_ROTO_RE);
          if (roto) {
            // Se recupera la fecha real desde dentro del nombre y se corrige
            // el corrimiento: lo que venía en r[2]/r[3]/r[4]/r[5] en realidad
            // corresponde a lote/existencia/costo_unitario/costo_total.
            fecha_vencimiento = roto[1];
            nombreRaw = nombreRaw.slice(0, roto.index);
            lote = String(r[2] || '').trim();
            existencia_sistema = parseNumCO(r[3]);
            costo_unitario = parseNumCO(r[4]);
            costo_total = parseNumCO(r[5]);
            filasCorregidas++;
          } else {
            fecha_vencimiento = String(r[2] || '').trim();
            lote = String(r[3] || '').trim();
            existencia_sistema = parseNumCO(r[4]);
            costo_unitario = parseNumCO(r[5]);
            costo_total = parseNumCO(r[6]);
          }

          // Limpieza general: quita tags HTML sueltos y saltos de línea que a
          // veces vienen pegados en la celda de nombre, sin importar si hubo
          // corrimiento de columnas o no
          const nombre = nombreRaw
            .replace(/<[^>]*>/g, ' ')
            .replace(/\/t[dr]>/gi, ' ')
            .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, ' ')
            .replace(/[\r\n]+/g, ' ')
            .replace(/\s{2,}/g, ' ')
            .trim();

          nuevosItems.push({ codigo, nombre, fecha_vencimiento, lote, existencia_sistema, costo_unitario, costo_total });
        }

        if (nuevosItems.length === 0) {
          setError('El archivo no tiene filas de inventario válidas');
          return;
        }

        if (filasCorregidas > 0) {
          console.warn(`Validador Inventario: se corrigieron ${filasCorregidas} fila(s) con corrimiento de columnas por HTML roto en el reporte SIIS.`);
        }

        setImportando(true);
        const res = await api.post('/validador-inventario/importar', { bodega: bodDetectada, items: nuevosItems });
        setBodega(bodDetectada);
        setItems(res.data || []);
        if (filasCorregidas > 0) {
          setError(`⚠️ Se corrigieron automáticamente ${filasCorregidas} fila(s) del Excel que tenían la fecha de vencimiento pegada al nombre (fragmento HTML roto del reporte SIIS). Revisa esos ítems para confirmar que quedaron bien.`);
        }
      } catch (err) {
        console.error(err);
        setError('Error procesando el archivo: ' + err.message);
      } finally {
        setImportando(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };
    reader.readAsArrayBuffer(file);
  }

  // ── Cargar Excel de Presentaciones (archivo APARTE, solo admin) ────────────
  // Detecta la columna de código y de presentación por nombre de encabezado
  // (sin importar el orden), para no depender de un layout fijo de columnas.
  function handleArchivoPresentaciones(e) {
    const file = e.target.files[0];
    if (!file) return;
    setError('');
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const wb = XLSX.read(ev.target.result, { type: 'array', raw: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true });

        // Buscar la fila de encabezados: una celda que empiece por "CODIGO"
        // y otra que empiece por "PRESENTACI", en cualquier columna/orden.
        let idxHeader = -1, colCodigo = -1, colPresentacion = -1;
        for (let i = 0; i < data.length; i++) {
          const fila = data[i].map(c => String(c).trim().toUpperCase());
          const cCod = fila.findIndex(c => c.startsWith('CODIGO'));
          const cPre = fila.findIndex(c => c.startsWith('PRESENTACI'));
          if (cCod !== -1 && cPre !== -1) {
            idxHeader = i; colCodigo = cCod; colPresentacion = cPre;
            break;
          }
        }
        if (idxHeader === -1) {
          setError('No se encontraron las columnas CODIGO y PRESENTACION en el archivo.');
          return;
        }

        const items = data.slice(idxHeader + 1)
          .map(r => ({
            codigo: String(r[colCodigo] || '').trim(),
            presentacion: String(r[colPresentacion] || '').trim(),
          }))
          .filter(it => it.codigo);

        if (items.length === 0) {
          setError('El archivo de presentaciones no tiene filas válidas');
          return;
        }

        setImportandoPresentaciones(true);
        await api.post('/validador-inventario/presentaciones/importar', { items });
        await cargar(bodega);
      } catch (err) {
        console.error(err);
        setError('Error procesando el archivo de presentaciones: ' + (err.response?.data?.error || err.message));
      } finally {
        setImportandoPresentaciones(false);
        if (fileInputPresentacionesRef.current) fileInputPresentacionesRef.current.value = '';
      }
    };
    reader.readAsArrayBuffer(file);
  }

  // ── Cargar Excel de Grupos de Inventario / Cuentas Contables (editor/admin) ─
  // Detecta las columnas CONCAT, CONTABLE y CUENTA por nombre de encabezado.
  function handleArchivoTipos(e) {
    const file = e.target.files[0];
    if (!file) return;
    setError('');
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const wb = XLSX.read(ev.target.result, { type: 'array', raw: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true });

        let idxHeader = -1, colConcat = -1, colContable = -1, colCuenta = -1;
        for (let i = 0; i < data.length; i++) {
          const fila = data[i].map(c => String(c).trim().toUpperCase());
          const cCon = fila.findIndex(c => c.startsWith('CONCAT'));
          const cCta = fila.findIndex(c => c.startsWith('CONTABLE'));
          const cNom = fila.findIndex(c => c.startsWith('CUENTA'));
          if (cCon !== -1 && cCta !== -1 && cNom !== -1) {
            idxHeader = i; colConcat = cCon; colContable = cCta; colCuenta = cNom;
            break;
          }
        }
        if (idxHeader === -1) {
          setError('No se encontraron las columnas CONCAT, CONTABLE y CUENTA en el archivo.');
          return;
        }

        const items = data.slice(idxHeader + 1)
          .map(r => ({
            concat: String(r[colConcat] || '').trim(),
            contable: String(r[colContable] || '').trim(),
            cuenta: String(r[colCuenta] || '').trim(),
          }))
          .filter(it => it.concat);

        if (items.length === 0) {
          setError('El archivo de grupos de inventario no tiene filas válidas');
          return;
        }

        setImportandoTipos(true);
        await api.post('/validador-inventario/tipos-inventario/importar', { items });
        await cargar(bodega);
      } catch (err) {
        console.error(err);
        setError('Error procesando el archivo de grupos de inventario: ' + (err.response?.data?.error || err.message));
      } finally {
        setImportandoTipos(false);
        if (fileInputTiposRef.current) fileInputTiposRef.current.value = '';
      }
    };
    reader.readAsArrayBuffer(file);
  }
  async function guardarConteo(item) {
    const valor = editValues[item.id];
    if (valor === undefined || valor === '') return;
    setGuardandoId(item.id);
    try {
      const res = await api.patch(`/validador-inventario/${item.id}`, { cantidad_fisica: parseNumCO(valor) });
      setItems(prev => prev.map(it => (it.id === item.id ? res.data : it)));
      setEditValues(prev => { const cp = { ...prev }; delete cp[item.id]; return cp; });
    } catch (e) {
      alert('Error guardando el conteo: ' + (e.response?.data?.error || e.message));
    }
    setGuardandoId(null);
  }

  // ── Guardar sobrante en libro (registro MANUAL, no calculado) ──────────────
  // Sobrantes antiguos que vienen de antes de que existiera el control de
  // inventario físico — no se calculan automáticamente porque las diferencias
  // reales suelen deberse a errores en salidas de consumo, no a un sobrante real.
  async function guardarSobrante(item) {
    const valor = editSobrante[item.id];
    if (valor === undefined || valor === '') return;
    setGuardandoSobranteId(item.id);
    try {
      const res = await api.patch(`/validador-inventario/${item.id}/sobrante`, { sobrante_libro: parseNumCO(valor) });
      setItems(prev => prev.map(it => (it.id === item.id ? res.data : it)));
      setEditSobrante(prev => { const cp = { ...prev }; delete cp[item.id]; return cp; });
    } catch (e) {
      alert('Error guardando el sobrante en libro: ' + (e.response?.data?.error || e.message));
    }
    setGuardandoSobranteId(null);
  }

  // ── Guardar notas (texto libre MANUAL de observaciones por ítem) ───────────
  async function guardarNotas(item) {
    const valor = editNotas[item.id];
    if (valor === undefined) return;
    setGuardandoNotasId(item.id);
    try {
      const res = await api.patch(`/validador-inventario/${item.id}/notas`, { notas: valor });
      setItems(prev => prev.map(it => (it.id === item.id ? res.data : it)));
      setEditNotas(prev => { const cp = { ...prev }; delete cp[item.id]; return cp; });
    } catch (e) {
      alert('Error guardando la nota: ' + (e.response?.data?.error || e.message));
    }
    setGuardandoNotasId(null);
  }

  // ── Guardar presentación (solo admin) ───────────────────────────────────────
  // Es por CÓDIGO, no por fila — así que al guardar se actualiza en todas las
  // filas visibles que compartan ese mismo código (otros lotes/bodegas).
  async function guardarPresentacion(item) {
    const valor = editPresentacion[item.id];
    if (valor === undefined) return;
    setGuardandoPresentacionId(item.id);
    try {
      await api.patch(`/validador-inventario/presentaciones/${encodeURIComponent(item.codigo)}`, { presentacion: valor });
      setItems(prev => prev.map(it => (it.codigo === item.codigo ? { ...it, presentacion: valor } : it)));
      setEditPresentacion(prev => { const cp = { ...prev }; delete cp[item.id]; return cp; });
    } catch (e) {
      alert('Error guardando la presentación: ' + (e.response?.data?.error || e.message));
    }
    setGuardandoPresentacionId(null);
  }

  // ── Guardar cuenta/grupo de inventario (editor o admin) ─────────────────────
  // Es por CONCAT (primeros 6 dígitos del código, o código alfa completo) —
  // así que al guardar se actualiza en todas las filas que compartan ese
  // mismo grupo, no solo la fila editada.
  async function guardarCuenta(item) {
    const valor = editCuenta[item.id];
    if (valor === undefined) return;
    setGuardandoCuentaId(item.id);
    try {
      await api.patch(`/validador-inventario/tipos-inventario/${encodeURIComponent(item.concat)}`, { contable: item.contable || '', cuenta: valor });
      setItems(prev => prev.map(it => (it.concat === item.concat ? { ...it, cuenta: valor } : it)));
      setEditCuenta(prev => { const cp = { ...prev }; delete cp[item.id]; return cp; });
    } catch (e) {
      alert('Error guardando la cuenta/grupo: ' + (e.response?.data?.error || e.message));
    }
    setGuardandoCuentaId(null);
  }

  // ── Clasificar manualmente la diferencia (real vs. por actualización) ──────
  // Persistente: se guarda en tipo_diferencia y el /importar nunca la toca,
  // así que sobrevive a nuevas cargas de Excel hasta que se cambie a mano.
  async function clasificarDiferencia(item, tipo) {
    try {
      const res = await api.patch(`/validador-inventario/${item.id}/tipo-diferencia`, { tipo_diferencia: tipo });
      setItems(prev => prev.map(it => (it.id === item.id ? res.data : it)));
    } catch (e) {
      alert('Error guardando la clasificación: ' + (e.response?.data?.error || e.message));
    }
  }

  async function deshacerConteo(item) {
    if (!window.confirm(`¿Deshacer el conteo de "${item.nombre}"?`)) return;
    try {
      const res = await api.patch(`/validador-inventario/${item.id}/reset`);
      setItems(prev => prev.map(it => (it.id === item.id ? res.data : it)));
    } catch (e) {
      alert('Error: ' + (e.response?.data?.error || e.message));
    }
  }

  // ── Eliminar manualmente un item sin existencias ────────────────────────────
  // Pide confirmar qué pasó con el producto antes de dejarlo borrar, así no se
  // elimina por error algo que en realidad solo cambió de lote/fecha
  async function eliminarItem(item) {
    const motivo = window.prompt(
      `"${item.nombre}" (código ${item.codigo}) no aparece en las últimas cargas del Excel.\n\n` +
      `¿Qué sucedió con este producto? (ej. agotado, dado de baja, reemplazado por otro lote)\n` +
      `Escribe el motivo para confirmar la eliminación, o cancela si no estás seguro:`
    );
    if (motivo === null || motivo.trim() === '') return; // canceló o no escribió nada
    if (!window.confirm(`¿Confirmas eliminar definitivamente "${item.nombre}"? Esta acción no se puede deshacer.`)) return;
    try {
      await api.delete(`/validador-inventario/${item.id}`);
      setItems(prev => prev.filter(it => it.id !== item.id));
    } catch (e) {
      alert('Error eliminando el item: ' + (e.response?.data?.error || e.message));
    }
  }

  // ── Ordenamiento por columna ─────────────────────────────────────────────────
  function toggleSort(col) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('desc'); }
  }

  // ── Formato moneda COP ────────────────────────────────────────────────────────
  const fmtPesos = (n) => Number(n || 0).toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });

  // ── Filtros y ordenamiento ───────────────────────────────────────────────────
  const itemsFiltrados = items.filter(it => {
    if (busqueda) {
      const q = busqueda.toUpperCase();
      if (!it.codigo.toUpperCase().includes(q) && !it.nombre.toUpperCase().includes(q)) return false;
    }
    if (filtro === 'contados' && !it.contado) return false;
    if (filtro === 'pendientes' && it.contado) return false;
    if (filtro === 'diferencias_reales' && getTipoDiferencia(it) !== 'real') return false;
    if (filtro === 'diferencias_actualizacion' && getTipoDiferencia(it) !== 'actualizacion') return false;
    if (filtro === 'sin_existencias' && !it.sin_existencias) return false;
    return true;
  });

  if (sortCol) {
    itemsFiltrados.sort((a, b) => {
      const va = Number(a[sortCol] || 0);
      const vb = Number(b[sortCol] || 0);
      return sortDir === 'asc' ? va - vb : vb - va;
    });
  }

  const totales = {
    total: items.length,
    contados: items.filter(it => it.contado).length,
    pendientes: items.filter(it => !it.contado).length,
    diferenciasReales: items.filter(it => getTipoDiferencia(it) === 'real').length,
    diferenciasPorActualizacion: items.filter(it => getTipoDiferencia(it) === 'actualizacion').length,
    sinExistencias: items.filter(it => it.sin_existencias).length,
  };
  const avance = totales.total > 0 ? Math.round((totales.contados / totales.total) * 100) : 0;

  // Fecha de la última vez que se subió un Excel para esta bodega (la más reciente entre todos los ítems)
  const ultimaCarga = items.reduce((max, it) => {
    if (!it.ultima_carga) return max;
    const f = new Date(it.ultima_carga);
    return (!max || f > max) ? f : max;
  }, null);
  const ultimaCargaTexto = ultimaCarga
    ? ultimaCarga.toLocaleString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '—';

  const inputStyle = {
    background: 'var(--t-bg-input)', border: '1px solid var(--t-border)', borderRadius: 6,
    color: 'var(--t-text-primary)', padding: '6px 10px', fontSize: 13,
  };

  const card = (label, value, color) => (
    <div style={{ background: 'var(--t-bg-card)', border: '1px solid var(--t-border)', borderRadius: 10, padding: '14px 16px', flex: 1, minWidth: 120 }}>
      <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 12, color: 'var(--t-text-muted)', marginTop: 2 }}>{label}</div>
    </div>
  );

  return (
    <div style={{ maxWidth: '100%', width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--t-text-primary)' }}>Validador de Inventarios</h1>
        <p style={{ fontSize: 13, color: 'var(--t-text-muted)', marginTop: 2 }}>
          Conteo físico de bodega contra el sistema — sube el Excel de SIIS cuando quieras actualizar existencias sin perder lo ya contado
        </p>
        <p style={{ fontSize: 12, color: 'var(--t-text-muted)', marginTop: 4 }}>
          Última carga de Excel para <strong>{bodega}</strong>: {ultimaCargaTexto}
        </p>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, borderBottom: '1px solid var(--t-border)' }}>
        {[
          { key: 'inventario', label: 'Inventario' },
          { key: 'listas', label: 'Listas de Conteo' },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setVista(t.key)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: '8px 14px', fontSize: 13, fontWeight: 600,
              color: vista === t.key ? 'var(--t-accent)' : 'var(--t-text-muted)',
              borderBottom: vista === t.key ? '2px solid var(--t-accent)' : '2px solid transparent',
              marginBottom: -1,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {vista === 'listas' ? (
        <ListasConteo bodega={bodega} BODEGAS={BODEGAS} isEditor={isEditor} inputStyle={inputStyle} fmtPesos={fmtPesos} />
      ) : (
      <>
      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={bodega} onChange={(e) => setBodega(e.target.value)} style={inputStyle}>
          {BODEGAS.map(b => <option key={b.codigo} value={b.codigo}>{b.codigo} — {b.nombre}</option>)}
        </select>

        <input ref={fileInputRef} type="file" accept=".xls,.xlsx" onChange={handleArchivo} style={{ display: 'none' }} id="input-excel-validador" />
        <label htmlFor="input-excel-validador" style={{
          background: 'var(--t-accent)', color: '#fff', border: 'none', borderRadius: 6,
          padding: '8px 14px', fontSize: 13, fontWeight: 500, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
        }}>
          📤 {importando ? 'Procesando…' : 'Cargar / Actualizar Excel'}
        </label>

        {isAdmin && (
          <>
            <input ref={fileInputPresentacionesRef} type="file" accept=".xls,.xlsx" onChange={handleArchivoPresentaciones} style={{ display: 'none' }} id="input-excel-presentaciones" />
            <label htmlFor="input-excel-presentaciones" title="Excel aparte con columnas CODIGO y PRESENTACION" style={{
              background: 'var(--t-bg-sidebar)', color: 'var(--t-text-primary)', border: '1px solid var(--t-border)', borderRadius: 6,
              padding: '8px 14px', fontSize: 13, fontWeight: 500, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
            }}>
              📤 {importandoPresentaciones ? 'Procesando…' : 'Cargar Presentaciones (Excel)'}
            </label>
          </>
        )}

        {isEditor && (
          <>
            <input ref={fileInputTiposRef} type="file" accept=".xls,.xlsx" onChange={handleArchivoTipos} style={{ display: 'none' }} id="input-excel-tipos" />
            <label htmlFor="input-excel-tipos" title="Excel aparte con columnas CONCAT, CONTABLE y CUENTA" style={{
              background: 'var(--t-bg-sidebar)', color: 'var(--t-text-primary)', border: '1px solid var(--t-border)', borderRadius: 6,
              padding: '8px 14px', fontSize: 13, fontWeight: 500, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
            }}>
              📤 {importandoTipos ? 'Procesando…' : 'Cargar Grupos/Cuentas (Excel)'}
            </label>
          </>
        )}

        <input
          type="text" placeholder="Buscar código o nombre…" value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          style={{ ...inputStyle, flex: 1, minWidth: 200 }}
        />

        <select value={filtro} onChange={(e) => setFiltro(e.target.value)} style={inputStyle}>
          <option value="todos">Todos</option>
          <option value="contados">✅ Contados</option>
          <option value="pendientes">⏳ Pendientes</option>
          <option value="diferencias_reales">⚠️ Diferencias reales</option>
          <option value="diferencias_actualizacion">🔄 Por actualización</option>
          <option value="sin_existencias">🚫 Sin existencias</option>
        </select>
      </div>

      {error && (
        <div style={{ background: '#3a1d1d', color: '#f87171', border: '1px solid #5c2626', borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* Resumen */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
        {card('Total ítems', totales.total, 'var(--t-text-primary)')}
        {card('Contados', totales.contados, '#4ade80')}
        {card('Pendientes', totales.pendientes, '#fbbf24')}
        {card('⚠️ Diferencias reales', totales.diferenciasReales, '#f87171')}
        {card('🔄 Por actualización', totales.diferenciasPorActualizacion, '#38bdf8')}
        {card('Sin existencias', totales.sinExistencias, '#94a3b8')}
        {card('% Avance', `${avance}%`, 'var(--t-accent)')}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--t-text-muted)', fontSize: 13 }}>Cargando…</div>
      ) : items.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--t-text-muted)', fontSize: 13 }}>
          No hay inventario cargado para la bodega <strong>{bodega}</strong>. Usa "Cargar / Actualizar Excel" para empezar.
        </div>
      ) : (
        <div style={{ background: 'var(--t-bg-card)', borderRadius: 10, border: '1px solid var(--t-border)', overflowX: 'auto', width: '100%', maxWidth: '100%' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--t-bg-sidebar)' }}>
                {[
                  { key: null,            label: 'Código' },
                  { key: null,            label: 'Nombre' },
                  { key: null,            label: 'Cuenta' },
                  { key: null,            label: 'Presentación' },
                  { key: null,            label: 'Lote' },
                  { key: null,            label: 'Fecha Venc.' },
                  { key: null,            label: 'Existencia' },
                  { key: 'costo_unitario', label: 'Costo Unit.' },
                  { key: 'costo_total',    label: 'Costo Total' },
                  { key: null,            label: 'Cant. Física' },
                  { key: null,            label: 'Diferencia' },
                  { key: null,            label: 'Notas' },
                  { key: null,            label: 'Sobrante en libro' },
                  { key: null,            label: 'Estado' },
                  { key: null,            label: '' },
                ].map(({ key, label }) => (
                  <th
                    key={label}
                    onClick={key ? () => toggleSort(key) : undefined}
                    style={{
                      padding: '8px 8px', textAlign: 'left', color: key ? 'var(--t-accent)' : 'var(--t-text-muted)',
                      fontWeight: 500, whiteSpace: 'nowrap', borderBottom: '1px solid var(--t-border)',
                      cursor: key ? 'pointer' : 'default', userSelect: 'none',
                    }}
                  >
                    {label}
                    {key && sortCol === key && (
                      <span style={{ marginLeft: 4 }}>{sortDir === 'asc' ? '▲' : '▼'}</span>
                    )}
                    {key && sortCol !== key && <span style={{ marginLeft: 4, opacity: 0.3 }}>⇅</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {itemsFiltrados.map(item => {
                const enEdicion = editValues[item.id] !== undefined;
                const yaContado = item.contado;
                // Si ya fue contado, solo editor/admin pueden modificar
                const puedeEditar = !yaContado || puedeEditarContado;
                const valorActual = enEdicion ? editValues[item.id] : fmtNum2(item.cantidad_fisica);
                const diferencia = yaContado ? Number(item.cantidad_fisica) - Number(item.existencia_sistema) : null;
                // Clasificación de la diferencia: prioriza SIEMPRE la elección
                // manual guardada (persiste entre cargas de Excel); si aún no
                // se ha clasificado, usa la detección automática por fecha
                // solo como sugerencia inicial.
                const tipoDif = getTipoDiferencia(item);
                return (
                  <tr key={item.id} style={{ borderBottom: '1px solid #1a2234', opacity: item.sin_existencias ? 0.6 : 1 }}>
                    <td style={{ padding: '6px 8px', fontFamily: 'monospace', color: 'var(--t-text-secondary)' }}>{item.codigo}</td>
                    <td style={{ padding: '6px 8px', color: 'var(--t-text-primary)', maxWidth: 240 }}>{item.nombre}</td>
                    <td style={{ padding: '6px 8px' }}>
                      {isEditor ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <input
                            type="text"
                            value={editCuenta[item.id] !== undefined ? editCuenta[item.id] : (item.cuenta || '')}
                            onChange={(e) => setEditCuenta(prev => ({ ...prev, [item.id]: e.target.value }))}
                            placeholder={item.cuenta ? '' : `Sin clasificar (${item.concat})`}
                            title={`Grupo de inventario: ${item.concat}. Cuenta contable derivada del código.`}
                            style={{ ...inputStyle, width: 130, fontSize: 12 }}
                          />
                          <button
                            onClick={() => guardarCuenta(item)}
                            disabled={editCuenta[item.id] === undefined || guardandoCuentaId === item.id}
                            title="Guardar cuenta/grupo"
                            style={{
                              background: editCuenta[item.id] !== undefined ? 'var(--t-accent)' : 'var(--t-bg-sidebar)',
                              color: editCuenta[item.id] !== undefined ? '#fff' : 'var(--t-text-muted)',
                              border: 'none', borderRadius: 6, padding: '5px 8px', fontSize: 12,
                              cursor: editCuenta[item.id] !== undefined ? 'pointer' : 'not-allowed',
                            }}
                          >
                            {guardandoCuentaId === item.id ? '…' : '💾'}
                          </button>
                        </div>
                      ) : (
                        <span style={{ color: item.cuenta ? 'var(--t-text-secondary)' : '#fbbf24' }}>{item.cuenta || '⚠️ Sin clasificar'}</span>
                      )}
                    </td>
                    <td style={{ padding: '6px 8px' }}>
                      {isAdmin ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <input
                            type="text"
                            value={editPresentacion[item.id] !== undefined ? editPresentacion[item.id] : (item.presentacion || '')}
                            onChange={(e) => setEditPresentacion(prev => ({ ...prev, [item.id]: e.target.value }))}
                            placeholder="—"
                            title="Presentación del artículo (ej. Caja x100). Se guarda por código, no por lote."
                            style={{ ...inputStyle, width: 110, fontSize: 12 }}
                          />
                          <button
                            onClick={() => guardarPresentacion(item)}
                            disabled={editPresentacion[item.id] === undefined || guardandoPresentacionId === item.id}
                            title="Guardar presentación"
                            style={{
                              background: editPresentacion[item.id] !== undefined ? 'var(--t-accent)' : 'var(--t-bg-sidebar)',
                              color: editPresentacion[item.id] !== undefined ? '#fff' : 'var(--t-text-muted)',
                              border: 'none', borderRadius: 6, padding: '5px 8px', fontSize: 12,
                              cursor: editPresentacion[item.id] !== undefined ? 'pointer' : 'not-allowed',
                            }}
                          >
                            {guardandoPresentacionId === item.id ? '…' : '💾'}
                          </button>
                        </div>
                      ) : (
                        <span style={{ color: 'var(--t-text-secondary)' }}>{item.presentacion || '—'}</span>
                      )}
                    </td>
                    <td style={{ padding: '6px 8px', color: 'var(--t-text-secondary)' }}>{item.lote || '—'}</td>
                    <td style={{ padding: '6px 8px', color: 'var(--t-text-secondary)', whiteSpace: 'nowrap' }}>{fmtFechaCorta(item.fecha_vencimiento)}</td>
                    <td style={{ padding: '6px 8px', color: 'var(--t-text-primary)', fontFamily: 'monospace' }}>{Number(item.existencia_sistema).toLocaleString('es-CO')}</td>
                    <td style={{ padding: '6px 8px', color: 'var(--t-text-secondary)', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{fmtPesos(item.costo_unitario)}</td>
                    <td style={{ padding: '6px 8px', color: 'var(--t-text-secondary)', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{fmtPesos(item.costo_total)}</td>
                    <td style={{ padding: '6px 8px' }}>
                      {puedeEditar ? (
                        <input
                          type="number" value={valorActual}
                          onChange={(e) => setEditValues(prev => ({ ...prev, [item.id]: e.target.value }))}
                          placeholder="—"
                          style={{
                            ...inputStyle,
                            width: 90,
                            fontFamily: 'monospace',
                            ...(yaContado ? { background: '#132018', borderColor: '#2f6d3f', color: '#4ade80' } : {}),
                          }}
                        />
                      ) : (
                        <span title="Solo editor/admin pueden modificar cantidades ya contadas"
                          style={{ color: yaContado ? '#4ade80' : 'var(--t-text-muted)', fontFamily: 'monospace' }}>
                          {item.cantidad_fisica !== null && item.cantidad_fisica !== undefined ? fmtNum2(item.cantidad_fisica) : '—'} 🔒
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '6px 8px', fontFamily: 'monospace' }}>
                      {diferencia === null ? (
                        <span style={{ color: 'var(--t-text-muted)' }}>—</span>
                      ) : diferencia === 0 ? (
                        <span style={{ color: '#4ade80', fontWeight: 600 }}>0</span>
                      ) : (
                        <div>
                          <div style={{ marginBottom: 3, color: tipoDif === 'actualizacion' ? '#38bdf8' : '#f87171', fontWeight: 600 }}>
                            {tipoDif === 'actualizacion' ? '🔄' : '⚠️'} {diferencia > 0 ? `+${fmtNum2(diferencia)}` : fmtNum2(diferencia)}
                          </div>
                          <div style={{ display: 'flex', gap: 3 }}>
                            <button
                              onClick={() => clasificarDiferencia(item, 'real')}
                              title="Marcar como diferencia real (error de conteo/consumo)"
                              style={{
                                background: tipoDif === 'real' ? '#3a1d1d' : 'var(--t-bg-sidebar)',
                                border: tipoDif === 'real' ? '1px solid #f87171' : '1px solid var(--t-border)',
                                color: tipoDif === 'real' ? '#f87171' : 'var(--t-text-muted)',
                                borderRadius: 4, padding: '2px 5px', fontSize: 10, cursor: 'pointer', fontWeight: tipoDif === 'real' ? 700 : 400,
                              }}
                            >
                              ⚠️ Real
                            </button>
                            <button
                              onClick={() => clasificarDiferencia(item, 'actualizacion')}
                              title="Marcar como diferencia por actualización posterior del sistema"
                              style={{
                                background: tipoDif === 'actualizacion' ? '#132433' : 'var(--t-bg-sidebar)',
                                border: tipoDif === 'actualizacion' ? '1px solid #38bdf8' : '1px solid var(--t-border)',
                                color: tipoDif === 'actualizacion' ? '#38bdf8' : 'var(--t-text-muted)',
                                borderRadius: 4, padding: '2px 5px', fontSize: 10, cursor: 'pointer', fontWeight: tipoDif === 'actualizacion' ? 700 : 400,
                              }}
                            >
                              🔄 Actual.
                            </button>
                          </div>
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '6px 8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <input
                          type="text"
                          value={editNotas[item.id] !== undefined ? editNotas[item.id] : (item.notas || '')}
                          onChange={(e) => setEditNotas(prev => ({ ...prev, [item.id]: e.target.value }))}
                          placeholder="—"
                          title="Observaciones (texto libre, no se borra al subir un Excel nuevo)"
                          style={{ ...inputStyle, width: 130, fontSize: 12 }}
                        />
                        <button
                          onClick={() => guardarNotas(item)}
                          disabled={editNotas[item.id] === undefined || guardandoNotasId === item.id}
                          title="Guardar nota"
                          style={{
                            background: editNotas[item.id] !== undefined ? 'var(--t-accent)' : 'var(--t-bg-sidebar)',
                            color: editNotas[item.id] !== undefined ? '#fff' : 'var(--t-text-muted)',
                            border: 'none', borderRadius: 6, padding: '5px 8px', fontSize: 12,
                            cursor: editNotas[item.id] !== undefined ? 'pointer' : 'not-allowed',
                          }}
                        >
                          {guardandoNotasId === item.id ? '…' : '💾'}
                        </button>
                      </div>
                    </td>
                    <td style={{ padding: '6px 8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <input
                          type="number"
                          value={editSobrante[item.id] !== undefined ? editSobrante[item.id] : fmtNum2(item.sobrante_libro)}
                          onChange={(e) => setEditSobrante(prev => ({ ...prev, [item.id]: e.target.value }))}
                          placeholder="—"
                          title="Registro manual: sobrante antiguo de antes del control de inventario (no se calcula solo)"
                          style={{ ...inputStyle, width: 80, fontFamily: 'monospace' }}
                        />
                        <button
                          onClick={() => guardarSobrante(item)}
                          disabled={editSobrante[item.id] === undefined || guardandoSobranteId === item.id}
                          title="Guardar sobrante en libro"
                          style={{
                            background: editSobrante[item.id] !== undefined ? 'var(--t-accent)' : 'var(--t-bg-sidebar)',
                            color: editSobrante[item.id] !== undefined ? '#fff' : 'var(--t-text-muted)',
                            border: 'none', borderRadius: 6, padding: '5px 8px', fontSize: 12,
                            cursor: editSobrante[item.id] !== undefined ? 'pointer' : 'not-allowed',
                          }}
                        >
                          {guardandoSobranteId === item.id ? '…' : '💾'}
                        </button>
                      </div>
                    </td>
                    <td style={{ padding: '6px 8px' }}>
                      {item.sin_existencias && (
                        <div style={{ marginBottom: 2 }}>
                          <span style={{ background: '#2a2a35', color: '#94a3b8', padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', display: 'inline-block' }}>
                            🚫 Sin existencias
                          </span>
                          {item.sin_existencias_desde && (
                            <div style={{ fontSize: 10, color: 'var(--t-text-muted)', marginTop: 2 }}>
                              desde {fmtFechaCorta(item.sin_existencias_desde)}
                            </div>
                          )}
                        </div>
                      )}
                      {yaContado ? (
                        <div>
                          <span style={{ background: '#1e2a1e', color: '#4ade80', padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>✅ Contado</span>
                          {item.contado_en && (
                            <div style={{ fontSize: 10, color: 'var(--t-text-muted)', marginTop: 2, whiteSpace: 'nowrap' }}>
                              {fmtFechaHoraCO(item.contado_en)}
                            </div>
                          )}
                          <div style={{ fontSize: 10, color: 'var(--t-text-secondary)', marginTop: 1 }}>
                            Cant: <strong>{fmtNum2(item.cantidad_fisica)}</strong>
                          </div>
                        </div>
                      ) : (
                        <span style={{ background: 'var(--t-bg-sidebar)', color: '#fbbf24', padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>⏳ Pendiente</span>
                      )}
                    </td>
                    <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
                      {puedeEditar && (
                        <button
                          onClick={() => guardarConteo(item)}
                          disabled={!enEdicion || guardandoId === item.id}
                          title="Guardar conteo"
                          style={{
                            background: enEdicion ? 'var(--t-accent)' : 'var(--t-bg-sidebar)',
                            color: enEdicion ? '#fff' : 'var(--t-text-muted)',
                            border: 'none', borderRadius: 6, padding: '5px 8px', fontSize: 12, fontWeight: 500,
                            cursor: enEdicion ? 'pointer' : 'not-allowed', marginRight: 4, minWidth: 30,
                          }}
                        >
                          {guardandoId === item.id ? '…' : '💾'}
                        </button>
                      )}
                      {yaContado && puedeEditarContado && (
                        <button
                          onClick={() => deshacerConteo(item)}
                          title="Deshacer conteo"
                          style={{ background: 'none', border: '1px solid var(--t-border)', borderRadius: 6, padding: '5px 8px', fontSize: 12, color: 'var(--t-text-muted)', cursor: 'pointer', marginRight: 4 }}
                        >
                          ↺
                        </button>
                      )}
                      {item.sin_existencias && puedeEditarContado && (
                        <button
                          onClick={() => eliminarItem(item)}
                          title="Eliminar definitivamente (solo disponible para ítems sin existencias)"
                          style={{ background: 'none', border: '1px solid #5c2626', borderRadius: 6, padding: '5px 8px', fontSize: 12, color: '#f87171', cursor: 'pointer' }}
                        >
                          🗑️
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      </>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// LISTAS DE CONTEO — sub-pestaña dentro de Validador de Inventarios
// ════════════════════════════════════════════════════════════════════════════

const LABEL_TIPO_LISTA = {
  general: 'Conteo general',
  cuenta_contable: 'Por cuenta contable',
  grupo_inventario: 'Por grupo de inventario',
  presentacion: 'Por presentación',
};

function ListasConteo({ bodega, isEditor, inputStyle, fmtPesos }) {
  const [vistaInterna, setVistaInterna] = useState('listado'); // 'listado' | 'crear' | 'detalle'
  const [listas, setListas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [formTipo, setFormTipo] = useState('general');
  const [formCriterio, setFormCriterio] = useState('');
  const [formSubclasificar, setFormSubclasificar] = useState(false);
  const [formConteo1Nombre, setFormConteo1Nombre] = useState('');
  const [formConteo2Nombre, setFormConteo2Nombre] = useState('');
  const [opciones, setOpciones] = useState([]);
  const [creando, setCreando] = useState(false);

  const [listaActual, setListaActual] = useState(null); // { ...lista, items }
  const [reporte, setReporte] = useState(null);
  const [editConteo, setEditConteo] = useState({}); // `${itemId}_${campo}` -> valor
  const [guardandoConteoKey, setGuardandoConteoKey] = useState(null);
  const [editCuentaItem, setEditCuentaItem] = useState({}); // itemId -> valor
  const [guardandoCuentaItemId, setGuardandoCuentaItemId] = useState(null);
  const [cerrando, setCerrando] = useState(false);
  const [descargando, setDescargando] = useState('');

  const cargarListas = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/validador-inventario/listas-conteo', { params: { bodega } });
      setListas(res.data || []);
    } catch (e) {
      setError('No se pudieron cargar las listas de conteo');
    }
    setLoading(false);
  }, [bodega]);

  useEffect(() => { cargarListas(); }, [cargarListas]);

  useEffect(() => {
    if (formTipo === 'general') { setOpciones([]); setFormCriterio(''); return; }
    api.get('/validador-inventario/listas-conteo/opciones', { params: { bodega, tipo: formTipo } })
      .then(res => setOpciones(res.data || []))
      .catch(() => setOpciones([]));
    setFormCriterio('');
  }, [formTipo, bodega]);

  async function crearLista() {
    if (formTipo !== 'general' && !formCriterio) {
      setError('Elige un criterio para este tipo de conteo');
      return;
    }
    setCreando(true);
    setError('');
    try {
      const res = await api.post('/validador-inventario/listas-conteo', {
        bodega, tipo: formTipo, criterio: formTipo === 'general' ? null : formCriterio,
        subclasificar_presentacion: formSubclasificar, conteo1_nombre: formConteo1Nombre, conteo2_nombre: formConteo2Nombre,
      });
      await cargarListas();
      await abrirLista(res.data.id);
      setFormTipo('general'); setFormCriterio(''); setFormSubclasificar(false); setFormConteo1Nombre(''); setFormConteo2Nombre('');
    } catch (e) {
      setError('Error creando la lista: ' + (e.response?.data?.error || e.message));
    }
    setCreando(false);
  }

  async function abrirLista(id) {
    setLoading(true);
    setReporte(null);
    try {
      const res = await api.get(`/validador-inventario/listas-conteo/${id}`);
      setListaActual(res.data);
      setVistaInterna('detalle');
    } catch (e) {
      setError('No se pudo abrir la lista');
    }
    setLoading(false);
  }

  async function cargarReporte(id) {
    try {
      const res = await api.get(`/validador-inventario/listas-conteo/${id}/reporte`);
      setReporte(res.data);
    } catch (e) {
      setError('No se pudo generar el reporte');
    }
  }

  async function guardarConteoItem(item, campo) {
    const key = `${item.id}_${campo}`;
    const valor = editConteo[key];
    if (valor === undefined || valor === '') return;
    setGuardandoConteoKey(key);
    try {
      const res = await api.patch(`/validador-inventario/listas-conteo/${listaActual.id}/items/${item.id}`, { campo, valor: parseNumCO(valor) });
      setListaActual(prev => ({ ...prev, items: prev.items.map(it => (it.id === item.id ? res.data : it)) }));
      setEditConteo(prev => { const cp = { ...prev }; delete cp[key]; return cp; });
    } catch (e) {
      alert('Error guardando el conteo: ' + (e.response?.data?.error || e.message));
    }
    setGuardandoConteoKey(null);
  }

  // ── Reclasificar un ítem "SIN CLASIFICAR" (o cambiar su cuenta) directo
  // desde la lista de conteo. Editor o admin. Queda guardado en el snapshot
  // de esta lista Y en la tabla maestra tipos_inventario.
  async function guardarCuentaItem(item) {
    const valor = editCuentaItem[item.id];
    if (valor === undefined || valor === '') return;
    setGuardandoCuentaItemId(item.id);
    try {
      const res = await api.patch(`/validador-inventario/listas-conteo/${listaActual.id}/items/${item.id}/cuenta`, { cuenta: valor });
      setListaActual(prev => ({ ...prev, items: prev.items.map(it => (it.id === item.id ? res.data : it)) }));
      setEditCuentaItem(prev => { const cp = { ...prev }; delete cp[item.id]; return cp; });
    } catch (e) {
      alert('Error guardando la clasificación: ' + (e.response?.data?.error || e.message));
    }
    setGuardandoCuentaItemId(null);
  }

  async function cerrarLista() {
    if (!window.confirm('¿Cerrar esta lista de conteo? Ya no se podrán modificar los conteos.')) return;
    setCerrando(true);
    try {
      const res = await api.post(`/validador-inventario/listas-conteo/${listaActual.id}/cerrar`);
      setListaActual(prev => ({ ...prev, ...res.data }));
      await cargarReporte(listaActual.id);
      await cargarListas();
    } catch (e) {
      alert('Error cerrando la lista: ' + (e.response?.data?.error || e.message));
    }
    setCerrando(false);
  }

  async function descargarArchivo(tipo) {
    setDescargando(tipo);
    try {
      const url = tipo === 'plantilla'
        ? `/validador-inventario/listas-conteo/${listaActual.id}/plantilla`
        : `/validador-inventario/listas-conteo/${listaActual.id}/reporte-excel`;
      const res = await api.get(url, { responseType: 'blob' });
      const blobUrl = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = tipo === 'plantilla' ? `lista_conteo_${listaActual.id}.xlsx` : `reporte_diferencias_${listaActual.id}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(blobUrl);
    } catch (e) {
      alert('Error descargando el archivo: ' + (e.response?.data?.error || e.message));
    }
    setDescargando('');
  }

  const puedeSubclasificar = formTipo === 'cuenta_contable' || formTipo === 'grupo_inventario';

  // ── Vista: listado de listas ────────────────────────────────────────────────
  if (vistaInterna === 'listado') {
    return (
      <div>
        {error && <div style={{ background: '#3a1d1d', color: '#f87171', border: '1px solid #5c2626', borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 13 }}>{error}</div>}
        <button
          onClick={() => setVistaInterna('crear')}
          style={{ background: 'var(--t-accent)', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 14px', fontSize: 13, fontWeight: 500, cursor: 'pointer', marginBottom: 16 }}
        >
          + Nueva lista de conteo
        </button>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--t-text-muted)', fontSize: 13 }}>Cargando…</div>
        ) : listas.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--t-text-muted)', fontSize: 13 }}>
            No hay listas de conteo para la bodega <strong>{bodega}</strong> todavía.
          </div>
        ) : (
          <div style={{ background: 'var(--t-bg-card)', borderRadius: 10, border: '1px solid var(--t-border)', overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'var(--t-bg-sidebar)' }}>
                  {['#', 'Tipo', 'Criterio', 'Estado', 'Ítems', 'Conteo 1', 'Conteo 2', 'Creada', ''].map(h => (
                    <th key={h} style={{ padding: '8px 8px', textAlign: 'left', color: 'var(--t-text-muted)', fontWeight: 500, borderBottom: '1px solid var(--t-border)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {listas.map(l => (
                  <tr key={l.id} style={{ borderBottom: '1px solid #1a2234' }}>
                    <td style={{ padding: '6px 8px' }}>{l.id}</td>
                    <td style={{ padding: '6px 8px' }}>{LABEL_TIPO_LISTA[l.tipo]}</td>
                    <td style={{ padding: '6px 8px' }}>{l.criterio || '—'}{l.subclasificar_presentacion ? ' (+ presentación)' : ''}</td>
                    <td style={{ padding: '6px 8px' }}>
                      <span style={{
                        background: l.estado === 'cerrada' ? '#1e2a1e' : 'var(--t-bg-sidebar)',
                        color: l.estado === 'cerrada' ? '#4ade80' : '#fbbf24',
                        padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                      }}>
                        {l.estado === 'cerrada' ? '🔒 Cerrada' : '🟢 Abierta'}
                      </span>
                    </td>
                    <td style={{ padding: '6px 8px' }}>{l.total_items}</td>
                    <td style={{ padding: '6px 8px' }}>{l.con_conteo_1}/{l.total_items}</td>
                    <td style={{ padding: '6px 8px' }}>{l.con_conteo_2}/{l.total_items}</td>
                    <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>{new Date(l.creado_en).toLocaleDateString('es-CO')}</td>
                    <td style={{ padding: '6px 8px' }}>
                      <button onClick={() => abrirLista(l.id)} style={{ background: 'none', border: '1px solid var(--t-border)', borderRadius: 6, padding: '5px 10px', fontSize: 12, color: 'var(--t-accent)', cursor: 'pointer' }}>
                        Abrir →
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  // ── Vista: crear lista ──────────────────────────────────────────────────────
  if (vistaInterna === 'crear') {
    return (
      <div style={{ maxWidth: 520 }}>
        <button onClick={() => setVistaInterna('listado')} style={{ background: 'none', border: 'none', color: 'var(--t-text-muted)', cursor: 'pointer', fontSize: 13, marginBottom: 14 }}>← Volver</button>
        <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>Nueva lista de conteo — bodega {bodega}</h3>
        {error && <div style={{ background: '#3a1d1d', color: '#f87171', border: '1px solid #5c2626', borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 13 }}>{error}</div>}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={{ fontSize: 12, color: 'var(--t-text-muted)' }}>
            Tipo de conteo
            <select value={formTipo} onChange={(e) => setFormTipo(e.target.value)} style={{ ...inputStyle, width: '100%', marginTop: 4 }}>
              <option value="general">General (toda la bodega)</option>
              <option value="cuenta_contable">Por cuenta contable</option>
              <option value="grupo_inventario">Por grupo de inventario</option>
              <option value="presentacion">Por presentación</option>
            </select>
          </label>

          {formTipo !== 'general' && (
            <label style={{ fontSize: 12, color: 'var(--t-text-muted)' }}>
              Criterio
              <select value={formCriterio} onChange={(e) => setFormCriterio(e.target.value)} style={{ ...inputStyle, width: '100%', marginTop: 4 }}>
                <option value="">— Selecciona —</option>
                {opciones.map(o => <option key={o.valor} value={o.valor}>{o.valor} ({o.items} ítems)</option>)}
              </select>
            </label>
          )}

          {puedeSubclasificar && (
            <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={formSubclasificar} onChange={(e) => setFormSubclasificar(e.target.checked)} />
              Subclasificar por presentación dentro de este grupo
            </label>
          )}

          <label style={{ fontSize: 12, color: 'var(--t-text-muted)' }}>
            Nombre de quien hace el Conteo 1 (opcional)
            <input type="text" value={formConteo1Nombre} onChange={(e) => setFormConteo1Nombre(e.target.value)} style={{ ...inputStyle, width: '100%', marginTop: 4 }} />
          </label>
          <label style={{ fontSize: 12, color: 'var(--t-text-muted)' }}>
            Nombre de quien hace el Conteo 2 (opcional)
            <input type="text" value={formConteo2Nombre} onChange={(e) => setFormConteo2Nombre(e.target.value)} style={{ ...inputStyle, width: '100%', marginTop: 4 }} />
          </label>

          <button
            onClick={crearLista}
            disabled={creando}
            style={{ background: 'var(--t-accent)', color: '#fff', border: 'none', borderRadius: 6, padding: '10px 14px', fontSize: 13, fontWeight: 600, cursor: creando ? 'not-allowed' : 'pointer', marginTop: 6 }}
          >
            {creando ? 'Creando…' : 'Crear lista y ver ítems'}
          </button>
        </div>
      </div>
    );
  }

  // ── Vista: detalle de una lista ─────────────────────────────────────────────
  if (vistaInterna === 'detalle' && listaActual) {
    const l = listaActual;
    const abierta = l.estado === 'abierta';
    return (
      <div>
        <button onClick={() => { setVistaInterna('listado'); cargarListas(); }} style={{ background: 'none', border: 'none', color: 'var(--t-text-muted)', cursor: 'pointer', fontSize: 13, marginBottom: 14 }}>← Volver a listas</button>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 700 }}>
              Lista #{l.id} — {LABEL_TIPO_LISTA[l.tipo]}{l.criterio ? `: ${l.criterio}` : ''}
              {l.subclasificar_presentacion ? ' (+ presentación)' : ''}
            </h3>
            <p style={{ fontSize: 12, color: 'var(--t-text-muted)', marginTop: 4 }}>
              Bodega {l.bodega} · Conteo 1: {l.conteo1_nombre || '—'} · Conteo 2: {l.conteo2_nombre || '—'} ·{' '}
              <span style={{ color: abierta ? '#fbbf24' : '#4ade80', fontWeight: 600 }}>{abierta ? '🟢 Abierta' : '🔒 Cerrada'}</span>
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={() => descargarArchivo('plantilla')} disabled={!!descargando} style={{ background: 'var(--t-bg-sidebar)', border: '1px solid var(--t-border)', borderRadius: 6, padding: '8px 12px', fontSize: 12, color: 'var(--t-text-primary)', cursor: 'pointer' }}>
              📥 {descargando === 'plantilla' ? 'Generando…' : 'Plantilla Excel'}
            </button>
            <button onClick={() => cargarReporte(l.id)} style={{ background: 'var(--t-bg-sidebar)', border: '1px solid var(--t-border)', borderRadius: 6, padding: '8px 12px', fontSize: 12, color: 'var(--t-text-primary)', cursor: 'pointer' }}>
              📊 Ver reporte de diferencias
            </button>
            {reporte && (
              <button onClick={() => descargarArchivo('reporte')} disabled={!!descargando} style={{ background: 'var(--t-bg-sidebar)', border: '1px solid var(--t-border)', borderRadius: 6, padding: '8px 12px', fontSize: 12, color: 'var(--t-text-primary)', cursor: 'pointer' }}>
                📥 {descargando === 'reporte' ? 'Generando…' : 'Reporte Excel'}
              </button>
            )}
            {abierta && isEditor && (
              <button onClick={cerrarLista} disabled={cerrando} style={{ background: '#3a1d1d', border: '1px solid #5c2626', borderRadius: 6, padding: '8px 12px', fontSize: 12, color: '#f87171', cursor: 'pointer' }}>
                🔒 {cerrando ? 'Cerrando…' : 'Cerrar lista'}
              </button>
            )}
          </div>
        </div>

        {reporte && (
          <div style={{ display: 'flex', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
            {[
              ['Total ítems', reporte.resumen.total_items, 'var(--t-text-primary)'],
              ['Contados', reporte.resumen.contados, '#4ade80'],
              ['Pendientes', reporte.resumen.pendientes, '#fbbf24'],
              ['Con diferencia', reporte.resumen.con_diferencia, '#f87171'],
              ['Diferencia en valor', fmtPesos(reporte.resumen.diferencia_valor_total), reporte.resumen.diferencia_valor_total < 0 ? '#f87171' : '#4ade80'],
            ].map(([label, value, color]) => (
              <div key={label} style={{ background: 'var(--t-bg-card)', border: '1px solid var(--t-border)', borderRadius: 10, padding: '14px 16px', flex: 1, minWidth: 120 }}>
                <div style={{ fontSize: 20, fontWeight: 700, color }}>{value}</div>
                <div style={{ fontSize: 12, color: 'var(--t-text-muted)', marginTop: 2 }}>{label}</div>
              </div>
            ))}
          </div>
        )}

        <div style={{ background: 'var(--t-bg-card)', borderRadius: 10, border: '1px solid var(--t-border)', overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--t-bg-sidebar)' }}>
                {['Código', 'Nombre', 'Cuenta', 'Presentación', 'Lote', 'F. Venc.', 'SIIS', 'Conteo 1', 'Conteo 2', 'Diferencia'].map(h => (
                  <th key={h} style={{ padding: '8px 8px', textAlign: 'left', color: 'var(--t-text-muted)', fontWeight: 500, borderBottom: '1px solid var(--t-border)', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {l.items.map(item => {
                const rep = reporte?.items.find(r => r.id === item.id);
                const campoInput = (campo, valorGuardado, guardadoPor) => {
                  const key = `${item.id}_${campo}`;
                  const yaTieneValor = valorGuardado !== null && valorGuardado !== undefined;
                  const puedeEditar = abierta && (!yaTieneValor || isEditor);
                  return puedeEditar ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <input
                        type="number"
                        value={editConteo[key] !== undefined ? editConteo[key] : (yaTieneValor ? fmtNum2(valorGuardado) : '')}
                        onChange={(e) => setEditConteo(prev => ({ ...prev, [key]: e.target.value }))}
                        placeholder="—"
                        style={{ ...inputStyle, width: 75, fontFamily: 'monospace' }}
                      />
                      <button
                        onClick={() => guardarConteoItem(item, campo)}
                        disabled={editConteo[key] === undefined || guardandoConteoKey === key}
                        style={{
                          background: editConteo[key] !== undefined ? 'var(--t-accent)' : 'var(--t-bg-sidebar)',
                          color: editConteo[key] !== undefined ? '#fff' : 'var(--t-text-muted)',
                          border: 'none', borderRadius: 6, padding: '5px 7px', fontSize: 12,
                          cursor: editConteo[key] !== undefined ? 'pointer' : 'not-allowed',
                        }}
                      >
                        {guardandoConteoKey === key ? '…' : '💾'}
                      </button>
                    </div>
                  ) : (
                    <span style={{ fontFamily: 'monospace', color: yaTieneValor ? '#4ade80' : 'var(--t-text-muted)' }}>
                      {yaTieneValor ? fmtNum2(valorGuardado) : '—'} {!abierta && '🔒'}
                    </span>
                  );
                };
                return (
                  <tr key={item.id} style={{ borderBottom: '1px solid #1a2234' }}>
                    <td style={{ padding: '6px 8px', fontFamily: 'monospace', color: 'var(--t-text-secondary)' }}>{item.codigo}</td>
                    <td style={{ padding: '6px 8px', maxWidth: 220 }}>{item.nombre}</td>
                    <td style={{ padding: '6px 8px' }}>
                      {isEditor ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <input
                            type="text"
                            value={editCuentaItem[item.id] !== undefined ? editCuentaItem[item.id] : (item.cuenta === 'SIN CLASIFICAR' ? '' : (item.cuenta || ''))}
                            onChange={(e) => setEditCuentaItem(prev => ({ ...prev, [item.id]: e.target.value }))}
                            placeholder={item.cuenta === 'SIN CLASIFICAR' ? 'Sin clasificar' : ''}
                            style={{ ...inputStyle, width: 110, fontSize: 12, ...(item.cuenta === 'SIN CLASIFICAR' ? { borderColor: '#fbbf24' } : {}) }}
                          />
                          <button
                            onClick={() => guardarCuentaItem(item)}
                            disabled={editCuentaItem[item.id] === undefined || guardandoCuentaItemId === item.id}
                            style={{
                              background: editCuentaItem[item.id] !== undefined ? 'var(--t-accent)' : 'var(--t-bg-sidebar)',
                              color: editCuentaItem[item.id] !== undefined ? '#fff' : 'var(--t-text-muted)',
                              border: 'none', borderRadius: 6, padding: '5px 7px', fontSize: 12,
                              cursor: editCuentaItem[item.id] !== undefined ? 'pointer' : 'not-allowed',
                            }}
                          >
                            {guardandoCuentaItemId === item.id ? '…' : '💾'}
                          </button>
                        </div>
                      ) : (
                        <span style={{ color: item.cuenta === 'SIN CLASIFICAR' ? '#fbbf24' : 'var(--t-text-secondary)' }}>
                          {item.cuenta === 'SIN CLASIFICAR' ? '⚠️ Sin clasificar' : item.cuenta}
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '6px 8px', color: 'var(--t-text-secondary)' }}>{item.presentacion || '—'}</td>
                    <td style={{ padding: '6px 8px', color: 'var(--t-text-secondary)' }}>{item.lote || '—'}</td>
                    <td style={{ padding: '6px 8px', color: 'var(--t-text-secondary)', whiteSpace: 'nowrap' }}>{fmtFechaCorta(item.fecha_vencimiento)}</td>
                    <td style={{ padding: '6px 8px', fontFamily: 'monospace' }}>{fmtNum2(item.existencia_siis)}</td>
                    <td style={{ padding: '6px 8px' }}>{campoInput('conteo_1', item.conteo_1)}</td>
                    <td style={{ padding: '6px 8px' }}>{campoInput('conteo_2', item.conteo_2)}</td>
                    <td style={{ padding: '6px 8px', fontFamily: 'monospace' }}>
                      {!rep || rep.diferencia_cantidad === null ? (
                        <span style={{ color: 'var(--t-text-muted)' }}>—</span>
                      ) : rep.diferencia_cantidad === 0 ? (
                        <span style={{ color: '#4ade80', fontWeight: 600 }}>0</span>
                      ) : (
                        <span style={{ color: '#f87171', fontWeight: 600 }}>
                          {rep.diferencia_cantidad > 0 ? '+' : ''}{fmtNum2(rep.diferencia_cantidad)} ({fmtPesos(rep.diferencia_valor)})
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return null;
}




































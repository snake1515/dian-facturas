import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';

// Colores de serie validados (paleta categórica, pasan CVD y contraste en fondo oscuro)
const C_OBRA = '#3987e5';
const C_ADM = '#d95926';
const C_SIN = '#64748b';
// Etapas de gestión: una sola tonalidad, de claro (menos avance) a oscuro (más avance)
const ETAPAS = [
  { id: 'sin_gestion', label: 'Sin gestión', color: '#64748b' },
  { id: 'en_proceso',  label: 'En proceso',  color: '#93c5fd' },
  { id: 'ingresada',   label: 'Ingresada (OC / caja menor)', color: '#3b82f6' },
  { id: 'aprobado',    label: 'Aprobada',    color: '#1d4ed8' },
];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const fmt = (n) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n || 0);
const fmtDate = (s) => { if (!s) return '—'; const [y, m, d] = String(s).substring(0, 10).split('-'); return d && m && y ? `${d}/${m}/${y}` : s; };
const haceCuanto = (iso) => {
  if (!iso) return 'nunca';
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} días`;
};

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);

  const cargar = useCallback(async () => {
    setCargando(true); setError(null);
    try { const r = await api.get('/dashboard'); setDatos(r.data); }
    catch (e) { setError(e.response?.data?.error || e.message); }
    finally { setCargando(false); }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const card = { background: 'var(--t-bg-card)', border: '1px solid var(--t-border)', borderRadius: 10, padding: '14px 16px' };
  const titulo = { fontSize: 13, fontWeight: 600, color: 'var(--t-text-secondary)', margin: '22px 0 10px', textTransform: 'uppercase', letterSpacing: '.05em' };
  const clicable = (to) => ({ onClick: () => navigate(to), role: 'button', style: { ...card, cursor: 'pointer' } });

  if (cargando && !datos) return <div style={{ padding: 40, color: 'var(--t-text-muted)' }}>Cargando resumen…</div>;
  if (error && !datos) return <div style={{ padding: 40, color: '#f87171' }}>No se pudo cargar el resumen: {error} <button onClick={cargar}>Reintentar</button></div>;
  if (!datos) return null;

  const tiene = (s) => datos.secciones.includes(s);
  const hoy = new Date();

  // ── Agregados de facturas ──
  const res = (tipo, cat) => (datos.resumen || []).find(r => r.tipo === tipo && r.cat === cat) || { nuevas_hoy: 0, nuevas_7d: 0, mes_cantidad: 0, mes_valor: 0 };
  const sinClasificarMes = res('FE', 'sin_clasificar');
  const etapasDe = (cat) => ETAPAS.map(e => ({ ...e, n: (datos.gestionMes || []).filter(g => g.cat === cat && g.etapa === e.id).reduce((a, g) => a + g.n, 0) }));

  // ── Alertas ──
  const alertas = [];
  if (tiene('facturas')) {
    const g = datos.gmail;
    if (g?.alerta) alertas.push({
      nivel: 'critico', icono: '⛔', titulo: g.conectado ? 'Gmail no está sincronizando' : 'Gmail desconectado',
      texto: g.conectado ? `Última sincronización ${haceCuanto(g.ultimaSync)}. Las facturas nuevas no están llegando: reconecte Gmail en Configuración.` : 'Conecte la cuenta de Gmail en Configuración para recibir facturas.',
      to: user?.rol === 'admin' ? '/configuracion' : null,
    });
    const a = datos.acciones;
    if (a?.sin_gestion_total > 0) alertas.push({
      nivel: 'critico', icono: '⚠️', titulo: `${a.sin_gestion_total} factura${a.sin_gestion_total === 1 ? '' : 's'} con más de ${a.dias} días sin gestión`,
      texto: `Obra: ${a.sin_gestion_obra} · Administrativas: ${a.sin_gestion_adm}`, to: '/facturas-obra',
    });
    if (a?.con_novedad > 0) alertas.push({
      nivel: 'aviso', icono: '📝', titulo: `${a.con_novedad} factura${a.con_novedad === 1 ? '' : 's'} con novedad`,
      texto: 'Marcadas "FACTURA CON NOVEDAD" y aún sin gestión contable.', to: '/facturas-obra?buscar=FACTURA%20CON%20NOVEDAD',
    });
    if (a?.manuales_sin_pdf > 0) alertas.push({
      nivel: 'aviso', icono: '📄', titulo: `${a.manuales_sin_pdf} factura${a.manuales_sin_pdf === 1 ? '' : 's'} manual${a.manuales_sin_pdf === 1 ? '' : 'es'} sin PDF`,
      texto: 'Vuelva a subir su PDF con "Subir PDF DIAN" para adjuntarlo.', to: '/facturas-obra?origen=pdf_manual_sin_pdf',
    });
  }
  if (tiene('proveedores') && datos.proveedoresSinClasificar > 0) alertas.push({
    nivel: 'aviso', icono: '🆕', titulo: `${datos.proveedoresSinClasificar} proveedor${datos.proveedoresSinClasificar === 1 ? '' : 'es'} sin clasificar`,
    texto: 'Sus facturas aparecen en Obra y en Administrativas hasta clasificarlos.', to: '/proveedores',
  });

  const colorNivel = { critico: { bg: 'rgba(239,68,68,.1)', borde: '#ef4444', txt: '#fca5a5' }, aviso: { bg: 'rgba(245,158,11,.1)', borde: '#f59e0b', txt: '#fcd34d' } };

  return (
    <div style={{ padding: '16px 8px', maxWidth: 1400 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Hola{user?.nombre ? `, ${user.nombre.split(' ')[0]}` : ''}</h2>
          <div style={{ fontSize: 13, color: 'var(--t-text-muted)', marginTop: 4 }}>
            Resumen de {MESES[hoy.getMonth()]} {hoy.getFullYear()} · actualizado {new Date(datos.generado).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>
        <button onClick={cargar} disabled={cargando} style={{ background: 'var(--t-bg-card)', border: '1px solid var(--t-border)', borderRadius: 8, padding: '8px 14px', color: 'var(--t-text-secondary)', fontSize: 13, cursor: 'pointer' }}>
          {cargando ? '⟳ Actualizando…' : '⟳ Actualizar'}
        </button>
      </div>

      {/* ── Requiere atención ── */}
      {(tiene('facturas') || tiene('proveedores')) && (
        <>
          <div style={titulo}>Requiere atención</div>
          {alertas.length === 0 ? (
            <div style={{ ...card, borderColor: '#16a34a', color: '#86efac', fontSize: 14 }}>✅ Todo al día: no hay facturas atrasadas ni alertas.</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 10 }}>
              {alertas.map(a => {
                const c = colorNivel[a.nivel];
                return (
                  <div key={a.titulo} onClick={() => a.to && navigate(a.to)} role={a.to ? 'button' : undefined}
                    style={{ ...card, background: c.bg, borderColor: c.borde, cursor: a.to ? 'pointer' : 'default' }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: c.txt }}>{a.icono} {a.titulo}</div>
                    <div style={{ fontSize: 12, color: 'var(--t-text-secondary)', marginTop: 4, lineHeight: 1.5 }}>{a.texto}</div>
                    {a.to && <div style={{ fontSize: 12, color: c.txt, marginTop: 6, fontWeight: 600 }}>Ver →</div>}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ── Llegadas ── */}
      {tiene('facturas') && (
        <>
          <div style={titulo}>Facturas que llegaron</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
            {[
              { tipo: 'FE', cat: 'obra', label: 'Facturas obra', to: '/facturas-obra', color: C_OBRA },
              { tipo: 'FE', cat: 'administrativa', label: 'Facturas administrativas', to: '/facturas-administrativas', color: C_ADM },
              { tipo: 'NC', cat: 'obra', label: 'Notas crédito obra', to: '/notas-credito', color: C_OBRA },
              { tipo: 'NC', cat: 'administrativa', label: 'Notas crédito administrativas', to: '/notas-credito-administrativas', color: C_ADM },
            ].map(t => {
              const r = res(t.tipo, t.cat);
              return (
                <div key={t.label} {...clicable(t.to)}>
                  <div style={{ fontSize: 12, color: 'var(--t-text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: t.color, display: 'inline-block' }} />{t.label}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 6 }}>
                    <span style={{ fontSize: 28, fontWeight: 700, color: 'var(--t-text-primary)' }}>{r.nuevas_hoy}</span>
                    <span style={{ fontSize: 12, color: 'var(--t-text-muted)' }}>hoy</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--t-text-secondary)', marginTop: 2 }}>{r.nuevas_7d} en los últimos 7 días</div>
                </div>
              );
            })}
          </div>
          {(res('FE', 'sin_clasificar').nuevas_7d + res('NC', 'sin_clasificar').nuevas_7d) > 0 && (
            <div style={{ fontSize: 12, color: 'var(--t-text-muted)', marginTop: 8 }}>
              Además llegaron <b style={{ color: '#fcd34d' }}>{res('FE', 'sin_clasificar').nuevas_7d + res('NC', 'sin_clasificar').nuevas_7d}</b> documentos de proveedores sin clasificar en los últimos 7 días (aparecen en ambas pestañas).
            </div>
          )}
        </>
      )}

      {/* ── Mes actual ── */}
      {tiene('facturas') && (
        <>
          <div style={titulo}>Gestión contable de {MESES[hoy.getMonth()]}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 10 }}>
            {[{ cat: 'obra', label: 'Obra', to: '/facturas-obra', color: C_OBRA }, { cat: 'administrativa', label: 'Administrativas', to: '/facturas-administrativas', color: C_ADM }].map(p => {
              const r = res('FE', p.cat);
              const et = etapasDe(p.cat);
              const total = et.reduce((a, e) => a + e.n, 0);
              const avance = total ? Math.round(et.filter(e => e.id !== 'sin_gestion').reduce((a, e) => a + e.n, 0) * 100 / total) : 0;
              return (
                <div key={p.cat} {...clicable(p.to)}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 10, height: 10, borderRadius: 2, background: p.color, display: 'inline-block' }} />Facturas {p.label.toLowerCase()}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--t-text-muted)' }}>{avance}% gestionadas</div>
                  </div>
                  <div style={{ display: 'flex', gap: 18, margin: '8px 0 10px' }}>
                    <div><div style={{ fontSize: 22, fontWeight: 700 }}>{r.mes_cantidad}</div><div style={{ fontSize: 11, color: 'var(--t-text-muted)' }}>facturas del mes</div></div>
                    <div><div style={{ fontSize: 22, fontWeight: 700 }}>{fmt(r.mes_valor)}</div><div style={{ fontSize: 11, color: 'var(--t-text-muted)' }}>valor</div></div>
                  </div>
                  {/* Barra apilada por etapa (2px de separación entre segmentos) */}
                  <div style={{ display: 'flex', gap: 2, height: 10, borderRadius: 5, overflow: 'hidden', background: 'var(--t-bg-inner, rgba(255,255,255,.05))' }}>
                    {total > 0 && et.filter(e => e.n > 0).map(e => (
                      <div key={e.id} title={`${e.label}: ${e.n}`} style={{ width: `${e.n * 100 / total}%`, background: e.color }} />
                    ))}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', marginTop: 8 }}>
                    {et.map(e => (
                      <span key={e.id} style={{ fontSize: 11, color: 'var(--t-text-secondary)', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                        <span style={{ width: 8, height: 8, borderRadius: 2, background: e.color, display: 'inline-block' }} />{e.label}: <b style={{ color: 'var(--t-text-primary)' }}>{e.n}</b>
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          {sinClasificarMes.mes_cantidad > 0 && (
            <div style={{ fontSize: 12, color: 'var(--t-text-muted)', marginTop: 8 }}>
              {sinClasificarMes.mes_cantidad} facturas del mes ({fmt(sinClasificarMes.mes_valor)}) son de proveedores sin clasificar y no están sumadas arriba.
            </div>
          )}
        </>
      )}

      {/* ── Llegadas por semana ── */}
      {tiene('facturas') && datos.semanas && <GraficaSemanas semanas={datos.semanas} titulo={titulo} card={card} />}

      {/* ── Otros módulos ── */}
      {(tiene('cruce') || tiene('pendientes') || tiene('prestamos') || tiene('validador')) && (
        <>
          <div style={titulo}>Otros módulos</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10 }}>
            {tiene('cruce') && (
              <div {...clicable('/cruce-dian')}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>🔍 Cruce DIAN</div>
                {datos.cruce ? (() => {
                  const c = datos.cruce; const pct = c.total ? Math.round(c.encontradas * 100 / c.total) : 0;
                  return (
                    <>
                      <div style={{ fontSize: 12, color: 'var(--t-text-muted)', marginTop: 4 }}>Último reporte: {MESES[parseInt(c.mes, 10) - 1]} {c.anio}</div>
                      <div style={{ fontSize: 24, fontWeight: 700, marginTop: 6 }}>{pct}% <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--t-text-muted)' }}>encontradas en la app</span></div>
                      <div style={{ fontSize: 12, color: c.total - c.encontradas > 0 ? '#fca5a5' : 'var(--t-text-secondary)' }}>
                        {c.encontradas} de {c.total} · faltan {c.total - c.encontradas}
                      </div>
                    </>
                  );
                })() : <div style={{ fontSize: 12, color: 'var(--t-text-muted)', marginTop: 6 }}>Aún no hay reportes DIAN guardados.</div>}
              </div>
            )}
            {tiene('pendientes') && datos.pendientes && (
              <div {...clicable('/pendientes')}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>📦 Pendientes por llegar</div>
                <div style={{ fontSize: 24, fontWeight: 700, marginTop: 8 }}>{datos.pendientes.facturas} <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--t-text-muted)' }}>facturas</span></div>
                <div style={{ fontSize: 12, color: 'var(--t-text-secondary)' }}>{datos.pendientes.productos} productos con faltante o novedad</div>
              </div>
            )}
            {tiene('prestamos') && datos.prestamos && (
              <div {...clicable('/prestamos')}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>🔄 Préstamos</div>
                <div style={{ fontSize: 24, fontWeight: 700, marginTop: 8 }}>{datos.prestamos.dados_abiertos + datos.prestamos.recibidos_abiertos} <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--t-text-muted)' }}>abiertos</span></div>
                <div style={{ fontSize: 12, color: 'var(--t-text-secondary)' }}>Dados: {datos.prestamos.dados_abiertos} · Recibidos: {datos.prestamos.recibidos_abiertos} · Parciales: {datos.prestamos.parciales}</div>
                {datos.prestamos.mas_30_dias > 0 && <div style={{ fontSize: 12, color: '#fcd34d', marginTop: 4 }}>⚠️ {datos.prestamos.mas_30_dias} con más de 30 días (el más antiguo: {fmtDate(datos.prestamos.mas_antiguo)})</div>}
              </div>
            )}
            {tiene('validador') && datos.validador && (
              <div {...clicable('/validador-inventario')}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>📋 Validador de inventarios</div>
                <div style={{ fontSize: 24, fontWeight: 700, marginTop: 8 }}>{datos.validador.listas_abiertas} <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--t-text-muted)' }}>listas de conteo abiertas</span></div>
                <div style={{ fontSize: 12, color: 'var(--t-text-secondary)' }}>{datos.validador.items_sin_contar} ítems sin contar</div>
                {datos.validador.diferencias_sin_motivo > 0 && <div style={{ fontSize: 12, color: '#fcd34d', marginTop: 4 }}>⚠️ {datos.validador.diferencias_sin_motivo} diferencias sin motivo</div>}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// Columnas apiladas por semana: obra / administrativas / sin clasificar.
// Leyenda siempre visible, tooltip al pasar el mouse y tabla accesible.
function GraficaSemanas({ semanas, titulo, card }) {
  const [hover, setHover] = useState(null);
  // Se dibuja al ancho real del contenedor (texto y barras de tamaño fijo)
  const contRef = useRef(null);
  const [ancho, setAncho] = useState(640);
  useEffect(() => {
    const el = contRef.current;
    if (!el) return undefined;
    const medir = () => setAncho(Math.max(280, Math.floor(el.clientWidth)));
    medir();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(medir) : null;
    if (ro) ro.observe(el); else window.addEventListener('resize', medir);
    return () => { if (ro) ro.disconnect(); else window.removeEventListener('resize', medir); };
  }, []);
  const series = [
    { id: 'obra', label: 'Obra', color: C_OBRA },
    { id: 'administrativa', label: 'Administrativas', color: C_ADM },
    { id: 'sin_clasificar', label: 'Sin clasificar', color: C_SIN },
  ];
  // 8 semanas (lunes), aunque alguna no tenga facturas
  const lunes = (() => { const d = new Date(); const dia = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dia); d.setHours(0, 0, 0, 0); return d; })();
  const claves = Array.from({ length: 8 }, (_, i) => { const d = new Date(lunes); d.setDate(d.getDate() - 7 * (7 - i)); return d.toISOString().substring(0, 10); });
  const filas = claves.map(k => {
    const v = {}; series.forEach(s => { v[s.id] = semanas.filter(x => x.semana === k && x.cat === s.id).reduce((a, x) => a + x.n, 0); });
    return { semana: k, ...v, total: series.reduce((a, s) => a + v[s.id], 0) };
  });
  const max = Math.max(1, ...filas.map(f => f.total));
  const tope = Math.ceil(max / 5) * 5 || 5;
  const W = ancho, H = 220, PAD_L = 32, PAD_B = 24, PAD_T = 8;
  const anchoBanda = (W - PAD_L) / filas.length;
  const anchoBarra = Math.min(24, anchoBanda * 0.5);
  const y = (v) => PAD_T + (H - PAD_T - PAD_B) * (1 - v / tope);

  return (
    <>
      <div style={titulo}>Facturas recibidas por semana</div>
      <div style={{ ...card, position: 'relative' }}>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 8 }}>
          {series.map(s => (
            <span key={s.id} style={{ fontSize: 12, color: 'var(--t-text-secondary)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: s.color, display: 'inline-block' }} />{s.label}
            </span>
          ))}
        </div>
        <div ref={contRef} style={{ width: '100%' }} />
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }} role="img" aria-label="Facturas recibidas por semana, últimas 8 semanas">
          {[0, 0.5, 1].map(t => (
            <g key={t}>
              <line x1={PAD_L} x2={W} y1={y(tope * t)} y2={y(tope * t)} stroke="currentColor" strokeOpacity=".12" strokeWidth="1" />
              <text x={PAD_L - 6} y={y(tope * t) + 4} textAnchor="end" fontSize="10" fill="currentColor" fillOpacity=".55">{Math.round(tope * t)}</text>
            </g>
          ))}
          {filas.map((f, i) => {
            const cx = PAD_L + anchoBanda * i + anchoBanda / 2;
            let acum = 0;
            const visibles = series.filter(s => f[s.id] > 0);
            return (
              <g key={f.semana} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                <rect x={cx - anchoBanda / 2} y={PAD_T} width={anchoBanda} height={H - PAD_T - PAD_B} fill="transparent" />
                {visibles.map((s, j) => {
                  const h = (H - PAD_T - PAD_B) * f[s.id] / tope;
                  const top = y(acum + f[s.id]);
                  acum += f[s.id];
                  const esUltimo = j === visibles.length - 1;
                  const gap = j > 0 ? 2 : 0; // separación de 2px entre segmentos
                  return esUltimo
                    ? <path key={s.id} d={`M${cx - anchoBarra / 2},${top + h - gap} V${top + 4} Q${cx - anchoBarra / 2},${top} ${cx - anchoBarra / 2 + 4},${top} H${cx + anchoBarra / 2 - 4} Q${cx + anchoBarra / 2},${top} ${cx + anchoBarra / 2},${top + 4} V${top + h - gap} Z`} fill={s.color} opacity={hover === null || hover === i ? 1 : 0.55} />
                    : <rect key={s.id} x={cx - anchoBarra / 2} y={top} width={anchoBarra} height={Math.max(0, h - gap)} fill={s.color} opacity={hover === null || hover === i ? 1 : 0.55} />;
                })}
                <text x={cx} y={H - 8} textAnchor="middle" fontSize="10" fill="currentColor" fillOpacity=".55">{fmtDate(f.semana).substring(0, 5)}</text>
              </g>
            );
          })}
        </svg>
        {hover !== null && (
          <div style={{ position: 'absolute', top: 44, left: (() => { const cx = PAD_L + anchoBanda * hover + anchoBanda / 2; return cx > W / 2 ? Math.max(0, cx - 16 - 170) : cx + 16; })(), background: 'var(--t-bg-sidebar)', border: '1px solid var(--t-border)', borderRadius: 8, padding: '8px 10px', fontSize: 12, pointerEvents: 'none', boxShadow: '0 4px 16px rgba(0,0,0,.35)', minWidth: 150 }}>
            <div style={{ color: 'var(--t-text-muted)', marginBottom: 4 }}>Semana del {fmtDate(filas[hover].semana)}</div>
            {series.map(s => (
              <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, color: 'var(--t-text-secondary)' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: s.color, display: 'inline-block' }} />{s.label}</span>
                <b style={{ color: 'var(--t-text-primary)' }}>{filas[hover][s.id]}</b>
              </div>
            ))}
            <div style={{ borderTop: '1px solid var(--t-border)', marginTop: 4, paddingTop: 4, display: 'flex', justifyContent: 'space-between', color: 'var(--t-text-secondary)' }}>
              <span>Total</span><b style={{ color: 'var(--t-text-primary)' }}>{filas[hover].total}</b>
            </div>
          </div>
        )}
        <details style={{ marginTop: 8 }}>
          <summary style={{ fontSize: 12, color: 'var(--t-text-muted)', cursor: 'pointer' }}>Ver tabla</summary>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginTop: 6 }}>
            <thead><tr>{['Semana', ...series.map(s => s.label), 'Total'].map(h => <th key={h} style={{ textAlign: 'left', padding: '4px 6px', color: 'var(--t-text-muted)', fontWeight: 500 }}>{h}</th>)}</tr></thead>
            <tbody>{filas.map(f => (
              <tr key={f.semana} style={{ borderTop: '1px solid var(--t-border)' }}>
                <td style={{ padding: '4px 6px' }}>{fmtDate(f.semana)}</td>
                {series.map(s => <td key={s.id} style={{ padding: '4px 6px' }}>{f[s.id]}</td>)}
                <td style={{ padding: '4px 6px', fontWeight: 600 }}>{f.total}</td>
              </tr>
            ))}</tbody>
          </table>
        </details>
      </div>
    </>
  );
}

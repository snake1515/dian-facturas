import React, { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';

const fmtDate = (s) => { if (!s) return '—'; const [y, m, d] = String(s).substring(0, 10).split('-'); return d && m && y ? `${d}/${m}/${y}` : s; };
const fmt = (n) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n || 0);
const leer = (k) => { try { return JSON.parse(sessionStorage.getItem(k) || 'null'); } catch (e) { return null; } };
const guardar = (k, v) => { try { v === null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sin storage */ } };

const CLAVE_RECORRIDO = 'recorridoSinGestion';
const rutaDe = (f) => `${f.categoria === 'administrativa' ? '/facturas-administrativas' : '/facturas-obra'}?buscar=${encodeURIComponent(f.numero)}`;

// Avisos que aparecen en todas las pantallas:
//  1. Proveedores nuevos sin clasificar (admin/editor). No se puede cerrar:
//     desaparece cuando se clasifican todos en la pestaña Proveedores.
//  2. Facturas con más de 5 días sin gestión (todos los usuarios, al ingresar).
//     Al aceptar, recorre las facturas una por una, de la más antigua a la más nueva.
export default function AvisosGlobales() {
  const { puede, token } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // ── 1. Proveedores sin clasificar ──
  const [sinClasificar, setSinClasificar] = useState(0);
  const contarProveedores = useCallback(async () => {
    if (!puede.gestionarProveedores) return;
    try { const r = await api.get('/proveedores/sin-clasificar'); setSinClasificar(r.data?.total || 0); }
    catch (e) { /* silencioso */ }
  }, [puede.gestionarProveedores]);

  useEffect(() => {
    contarProveedores();
    const t = setInterval(contarProveedores, 2 * 60 * 1000);
    window.addEventListener('proveedores-actualizados', contarProveedores);
    return () => { clearInterval(t); window.removeEventListener('proveedores-actualizados', contarProveedores); };
  }, [contarProveedores]);

  // ── 2. Facturas sin gestión ──
  const [modalSinGestion, setModalSinGestion] = useState(null); // { dias, facturas }
  const sesion = (token || '').slice(-16);
  const claveSesion = `avisoSinGestion:${sesion}`;
  // El recorrido pertenece a este ingreso; si cambió el usuario/sesión, se descarta
  const [recorrido, setRecorrido] = useState(() => { const r = leer(CLAVE_RECORRIDO); return r && r.sesion === sesion ? r : null; });

  useEffect(() => {
    if (!token || !puede.verFacturas || leer(claveSesion)) return; // sin acceso a facturas, o ya se mostró en este ingreso
    api.get('/proveedores/facturas-sin-gestion').then(r => {
      guardar(claveSesion, true);
      if (r.data?.facturas?.length) setModalSinGestion(r.data);
    }).catch(() => {});
  }, [token, claveSesion, puede.verFacturas]);

  const irA = (rec) => {
    guardar(CLAVE_RECORRIDO, rec);
    setRecorrido(rec);
    if (rec) navigate(rutaDe(rec.items[rec.idx]));
  };

  const aceptarSinGestion = () => {
    const items = modalSinGestion.facturas.map(f => ({ id: f.id, numero: f.numero, proveedor: f.proveedor_nombre, fecha: f.fecha_emision, total: f.total, categoria: f.categoria }));
    setModalSinGestion(null);
    irA({ items, idx: 0, sesion });
  };

  const terminarRecorrido = () => { guardar(CLAVE_RECORRIDO, null); setRecorrido(null); };

  const actual = recorrido?.items?.[recorrido.idx];
  // En Proveedores y en Inicio no hace falta: allí ya se ve la información
  const enProveedores = location.pathname === '/proveedores' || location.pathname === '/';

  return (
    <>
      {/* Aviso de proveedores nuevos (no se puede cerrar) */}
      {puede.gestionarProveedores && sinClasificar > 0 && !enProveedores && (
        <div onClick={() => navigate('/proveedores')} role="button"
          style={{
            position: 'fixed', right: 20, bottom: recorrido ? 84 : 20, zIndex: 900, maxWidth: 340, cursor: 'pointer',
            background: '#451a03', border: '1px solid #f59e0b', borderRadius: 10, padding: '12px 16px',
            boxShadow: '0 8px 30px rgba(0,0,0,.45)', color: '#fde68a',
          }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>🆕 {sinClasificar} proveedor{sinClasificar === 1 ? '' : 'es'} sin clasificar</div>
          <div style={{ fontSize: 12, lineHeight: 1.5, color: '#fcd34d' }}>
            Sus facturas aparecen en Obra y en Administrativas hasta que se clasifiquen.
          </div>
          <div style={{ marginTop: 8, fontSize: 12, fontWeight: 700, color: '#fff' }}>Revisar proveedores →</div>
        </div>
      )}

      {/* Popup de facturas sin gestión (al ingresar) */}
      {modalSinGestion && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.65)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: 'var(--t-bg-card)', border: '1px solid #ef4444', borderRadius: 12, padding: 24, maxWidth: 520, width: '100%', color: 'var(--t-text-primary)', boxShadow: '0 20px 60px rgba(0,0,0,.5)' }}>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>⚠️ Facturas sin gestión</div>
            <div style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--t-text-secondary)' }}>
              Hay <b style={{ color: '#f87171' }}>{modalSinGestion.facturas.length}</b> factura{modalSinGestion.facturas.length === 1 ? '' : 's'} con más de {modalSinGestion.dias} días desde su emisión
              y sin ninguna gestión en <b>Est. contable</b>.
            </div>
            <div style={{ fontSize: 12, lineHeight: 1.6, color: 'var(--t-text-muted)', marginTop: 8 }}>
              Para que dejen de aparecer, asigne un estado contable (OC, caja menor, contrato…) o escriba <b>FACTURA CON NOVEDAD</b> en la columna Notas.
            </div>
            <div style={{ marginTop: 12, maxHeight: 180, overflowY: 'auto', fontSize: 12, borderTop: '1px solid var(--t-border)' }}>
              {modalSinGestion.facturas.slice(0, 50).map(f => (
                <div key={f.id} style={{ display: 'flex', gap: 8, padding: '5px 0', borderBottom: '1px solid var(--t-border)' }}>
                  <span style={{ width: 80, color: 'var(--t-text-muted)' }}>{fmtDate(f.fecha_emision)}</span>
                  <span style={{ width: 90, fontFamily: 'monospace' }}>{f.numero}</span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.proveedor_nombre}</span>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
              <button onClick={aceptarSinGestion} style={{ background: '#ef4444', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 22px', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
                Aceptar — ir a la más antigua
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Barra de recorrido: factura por factura */}
      {actual && (
        <div style={{
          position: 'fixed', left: '50%', transform: 'translateX(-50%)', bottom: 16, zIndex: 950,
          background: '#1f2937', border: '1px solid #ef4444', borderRadius: 10, padding: '10px 14px',
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', maxWidth: 'calc(100vw - 32px)',
          boxShadow: '0 8px 30px rgba(0,0,0,.5)', color: '#f3f4f6', fontSize: 13,
        }}>
          <span style={{ color: '#fca5a5', fontWeight: 700 }}>Sin gestión {recorrido.idx + 1} de {recorrido.items.length}</span>
          <span><b style={{ fontFamily: 'monospace' }}>{actual.numero}</b> · {actual.proveedor} · {fmtDate(actual.fecha)} · {fmt(actual.total)}</span>
          <span style={{ display: 'flex', gap: 6 }}>
            <button disabled={recorrido.idx === 0} onClick={() => irA({ ...recorrido, idx: recorrido.idx - 1 })}
              style={{ background: '#374151', color: '#fff', border: 'none', borderRadius: 6, padding: '5px 10px', cursor: 'pointer', opacity: recorrido.idx === 0 ? 0.4 : 1 }}>◀ Anterior</button>
            {recorrido.idx < recorrido.items.length - 1 ? (
              <button onClick={() => irA({ ...recorrido, idx: recorrido.idx + 1 })}
                style={{ background: '#ef4444', color: '#fff', border: 'none', borderRadius: 6, padding: '5px 10px', cursor: 'pointer', fontWeight: 700 }}>Siguiente ▶</button>
            ) : (
              <button onClick={terminarRecorrido}
                style={{ background: '#16a34a', color: '#fff', border: 'none', borderRadius: 6, padding: '5px 10px', cursor: 'pointer', fontWeight: 700 }}>✓ Terminar</button>
            )}
            <button onClick={terminarRecorrido} title="Salir del recorrido"
              style={{ background: 'none', color: '#9ca3af', border: '1px solid #4b5563', borderRadius: 6, padding: '5px 8px', cursor: 'pointer' }}>Salir</button>
          </span>
        </div>
      )}
    </>
  );
}

// v2.1
import React, { useState, useEffect } from 'react';
import { obtenerConfig, guardarConfig, gmailAuthUrl, gmailSync, gmailDisconnect, reiniciarCron, listarContactos, crearContacto, eliminarContacto } from '../services/api';

export default function Configuracion() {
  const [tab, setTab] = useState('correo');
  const [cfg, setCfg] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncDesde, setSyncDesde] = useState('');
  const [syncHasta, setSyncHasta] = useState('');
  const [syncResult, setSyncResult] = useState(null);
  const [contactos, setContactos] = useState([]);
  const [nuevoNombre, setNuevoNombre] = useState('');
  const [nuevoEmail, setNuevoEmail] = useState('');
  const [savingContacto, setSavingContacto] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('gmail') === 'conectado') {
      window.history.replaceState({}, '', window.location.pathname);
      setTab('correo');
    }
    cargar();
    cargarContactos();
  }, []);

  const cargarContactos = async () => {
    try { const res = await listarContactos(); setContactos(res.data || []); }
    catch (err) { console.error(err); }
  };

  const agregarContacto = async () => {
    if (!nuevoNombre.trim() || !nuevoEmail.includes('@')) return alert('Ingresa nombre y correo válido');
    setSavingContacto(true);
    try {
      await crearContacto({ nombre: nuevoNombre.trim(), email: nuevoEmail.trim() });
      setNuevoNombre(''); setNuevoEmail('');
      await cargarContactos();
    } catch (err) { alert(err.response?.data?.error || 'Error al agregar contacto'); }
    finally { setSavingContacto(false); }
  };

  const borrarContacto = async (id) => {
    if (!window.confirm('¿Eliminar este contacto?')) return;
    try { await eliminarContacto(id); await cargarContactos(); }
    catch (err) { alert(err.response?.data?.error || 'Error'); }
  };

  const cargar = async () => {
    try {
      const res = await obtenerConfig();
      setCfg(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const set = (k, v) => setCfg(prev => ({ ...prev, [k]: v }));

  const guardar = async () => {
    setSaving(true);
    try {
      await guardarConfig(cfg);
      await reiniciarCron();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      alert(err.response?.data?.error || 'Error al guardar');
    } finally {
      setSaving(false);
    }
  };

  const conectarGmail = async () => {
    try {
      const res = await gmailAuthUrl();
      window.location.href = res.data.url;
    } catch (err) {
      alert('Error al obtener URL de autorización: ' + (err.response?.data?.error || err.message));
    }
  };

  const desconectarGmail = async () => {
    if (!window.confirm('¿Desconectar Gmail? La sincronización automática dejará de funcionar.')) return;
    try {
      await gmailDisconnect();
      await cargar();
    } catch (err) {
      alert(err.response?.data?.error || 'Error');
    }
  };

  // Guardar rango y frecuencia cuando se importa
  const sincronizarAhora = async (desde, hasta) => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const body = {};
      if (desde) body.desde = desde;
      if (hasta) body.hasta = hasta;
      const res = await gmailSync(body);
      setSyncResult(res.data.nuevas || 0);
      // Guardar rango usado para el cron
      if (desde) await guardarConfig({ ...cfg, sync_desde: desde, sync_hasta: hasta || new Date().toISOString().split('T')[0] });
      await reiniciarCron();
      await cargar();
    } catch (err) {
      alert('Error: ' + (err.response?.data?.error || err.message));
    } finally {
      setSyncing(false);
    }
  };

  const tabs = [
    { id: 'correo', label: '📧 Correo Gmail' },
    { id: 'sincronizacion', label: '🔄 Sincronización' },
    { id: 'contactos', label: '👥 Contactos' },
    { id: 'notificaciones', label: '🔔 Notificaciones' },
    { id: 'seguridad', label: '🔒 Seguridad' },
  ];

  if (loading) return <div style={{ padding: 24, color: '#64748b' }}>Cargando configuración...</div>;

  return (
    <div style={{ padding: 24 }}>
      {/* Tabs */}
      <div style={{ display: 'flex', gap: 2, background: '#1e2535', padding: 3, borderRadius: 8, marginBottom: 20, width: 'fit-content' }}>
        {tabs.map(t => (
          <button key={t.id} style={{ padding: '6px 16px', borderRadius: 6, border: 'none', fontSize: 13, fontWeight: 500, cursor: 'pointer', background: tab === t.id ? '#161b27' : 'transparent', color: tab === t.id ? '#e2e8f0' : '#94a3b8', transition: 'all .15s' }}
            onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>

      <div style={{ background: '#1e2535', border: '1px solid #2a3348', borderRadius: 10, padding: 28, maxWidth: 640 }}>

        {/* CORREO GMAIL */}
        {tab === 'correo' && (
          <div>
            <h3 style={sectionTitle}>Cuenta de Gmail enlazada</h3>

            {cfg.gmail_connected === 'true' ? (
              <div style={{ background: '#0f1117', border: '1px solid #2a3348', borderRadius: 8, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#22c55e', flexShrink: 0, boxShadow: '0 0 6px #22c55e' }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 500, fontSize: 13 }}>{cfg.gmail_account || 'Gmail conectado'}</div>
                  <div style={{ fontSize: 11, color: '#64748b' }}>Última sync: {cfg.last_sync ? new Date(cfg.last_sync).toLocaleString('es-CO') : 'Nunca'}</div>
                </div>
                <button style={btnDanger} onClick={desconectarGmail}>Desconectar</button>
              </div>
            ) : (
              <div style={{ background: 'rgba(245,158,11,.08)', border: '1px solid rgba(245,158,11,.3)', borderRadius: 8, padding: '12px 16px', marginBottom: 16, fontSize: 13, color: '#fbbf24' }}>
                ⚠️ Gmail no está conectado. La importación automática de facturas no funcionará.
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <button style={btnPrimary} onClick={conectarGmail}>
                📧 {cfg.gmail_connected === 'true' ? 'Reconectar Gmail' : 'Vincular cuenta Gmail'}
              </button>

            </div>
            {cfg.gmail_connected === 'true' && (
              <div style={{ background: '#0f1117', border: '1px solid #2a3348', borderRadius: 8, padding: 14, marginBottom: 24 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 10 }}>📅 Importar por rango de fechas</div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 140 }}>
                    <label style={{ display: 'block', fontSize: 11, color: '#64748b', marginBottom: 4 }}>Desde</label>
                    <input style={inputSt} type="date" value={syncDesde || cfg.sync_desde || ''} onChange={e => setSyncDesde(e.target.value)} />
                  </div>
                  <div style={{ flex: 1, minWidth: 140 }}>
                    <label style={{ display: 'block', fontSize: 11, color: '#64748b', marginBottom: 4 }}>Hasta</label>
                    <input style={inputSt} type="date" value={syncHasta || new Date().toISOString().split('T')[0]} onChange={e => setSyncHasta(e.target.value)} />
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <button style={btnPrimary} onClick={() => sincronizarAhora(syncDesde, syncHasta)} disabled={syncing}>
                    {syncing ? 'Importando...' : 'Importar rango'}
                  </button>

                  {syncResult !== null && !syncing && (
                    <span style={{ fontSize: 12, color: '#4ade80' }}>Listo: {syncResult} facturas importadas</span>
                  )}
                </div>
              </div>
            )}

            <h3 style={sectionTitle}>Filtros de recepción</h3>
            <FormGroup label="Palabras clave en asunto (separadas por coma)">
              <input style={inputSt} value={cfg.palabras_clave || ''} onChange={e => set('palabras_clave', e.target.value)} placeholder="factura electrónica, DIAN, FE-" />
            </FormGroup>
            <InfoBox>Solo se procesarán correos que contengan alguna de estas palabras en el asunto y tengan adjuntos PDF/XML.</InfoBox>
          </div>
        )}

        {/* SINCRONIZACIÓN */}
        {tab === 'sincronizacion' && (
          <div>
            <h3 style={sectionTitle}>Importación de facturas</h3>
            <div style={{ background: 'rgba(59,130,246,.08)', border: '1px solid rgba(59,130,246,.2)', borderRadius: 8, padding: '14px 16px', fontSize: 13, color: '#94a3b8', marginBottom: 16 }}>
              ℹ️ El cron usa el rango guardado al hacer "Importar rango" en la pestaña Correo Gmail. El "Hasta" siempre será la fecha de hoy al correr automáticamente.
            </div>
            <FormGroup label="¿Cada cuánto tiempo revisar el correo automáticamente?">
              <select style={inputSt} value={cfg.sync_interval_hours || '0'} onChange={e => set('sync_interval_hours', e.target.value)}>
                <option value="0">Desactivado (solo manual)</option>
                <option value="1">Cada 1 hora</option>
                <option value="2">Cada 2 horas</option>
                <option value="4">Cada 4 horas</option>
                <option value="6">Cada 6 horas</option>
                <option value="12">Cada 12 horas</option>
                <option value="24">Cada 24 horas</option>
              </select>
            </FormGroup>
            {cfg.sync_desde && (
              <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 12 }}>
                📅 Rango guardado: <strong style={{ color: '#e2e8f0' }}>{cfg.sync_desde}</strong> → <strong style={{ color: '#e2e8f0' }}>hoy</strong>
              </div>
            )}
            <ToggleRow label="Procesar XML automáticamente" desc="Extrae datos del XML DIAN al importar"
              value={cfg.auto_process_xml === 'true'} onChange={v => set('auto_process_xml', v ? 'true' : 'false')} />
            <ToggleRow label="Guardar PDF y XML adjunto" desc="Almacena los archivos adjuntos de cada factura en Supabase"
              value={cfg.save_attachments !== 'false'} onChange={v => set('save_attachments', v ? 'true' : 'false')} />
          </div>
        )}

        {/* CONTACTOS */}
        {tab === 'contactos' && (
          <div>
            <h3 style={sectionTitle}>Contactos / Responsables</h3>
            <p style={{ fontSize: 12, color: '#64748b', marginBottom: 16 }}>
              Estos contactos aparecen como opciones en la columna <strong style={{ color: '#94a3b8' }}>Responsable</strong> de cada factura y se usan para el reenvío automático de correos.
            </p>

            {/* Lista de contactos */}
            <div style={{ marginBottom: 20 }}>
              {contactos.length === 0 ? (
                <div style={{ background: '#0f1117', borderRadius: 8, padding: '16px', textAlign: 'center', color: '#64748b', fontSize: 13 }}>
                  No hay contactos registrados. Agrega uno abajo.
                </div>
              ) : (
                <div style={{ background: '#0f1117', border: '1px solid #2a3348', borderRadius: 8, overflow: 'hidden' }}>
                  {contactos.map((c, i) => (
                    <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderBottom: i < contactos.length - 1 ? '1px solid #1e2535' : 'none' }}>
                      <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#1e3a5f', color: '#60a5fa', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 600, flexShrink: 0 }}>
                        {c.nombre.charAt(0).toUpperCase()}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, color: '#e2e8f0' }}>{c.nombre}</div>
                        <div style={{ fontSize: 11, color: '#64748b' }}>{c.email}</div>
                      </div>
                      <button onClick={() => borrarContacto(c.id)} style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: 16, padding: '2px 6px', borderRadius: 4 }} title="Eliminar contacto">🗑</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Agregar nuevo contacto */}
            <h3 style={{ ...sectionTitle, marginTop: 8 }}>Agregar contacto</h3>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
              <div style={{ flex: '1 1 160px' }}>
                <label style={{ display: 'block', fontSize: 11, color: '#64748b', marginBottom: 4 }}>Nombre completo</label>
                <input style={inputSt} placeholder="Ej: Juan Pérez" value={nuevoNombre} onChange={e => setNuevoNombre(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && agregarContacto()} />
              </div>
              <div style={{ flex: '1 1 200px' }}>
                <label style={{ display: 'block', fontSize: 11, color: '#64748b', marginBottom: 4 }}>Correo electrónico</label>
                <input style={inputSt} type="email" placeholder="correo@empresa.com" value={nuevoEmail} onChange={e => setNuevoEmail(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && agregarContacto()} />
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                <button style={btnPrimary} onClick={agregarContacto} disabled={savingContacto}>
                  {savingContacto ? 'Guardando...' : '+ Agregar'}
                </button>
              </div>
            </div>
            <InfoBox>Los contactos se guardan globalmente y están disponibles en todas las facturas.</InfoBox>
          </div>
        )}

        {/* NOTIFICACIONES */}
        {tab === 'notificaciones' && (
          <div>
            <h3 style={sectionTitle}>Alertas y notificaciones</h3>
            <ToggleRow label="Notificar al recibir nueva factura" desc="Alerta cuando llega una FE al correo"
              value={cfg.notify_on_new === 'true'} onChange={v => set('notify_on_new', v ? 'true' : 'false')} />
            <ToggleRow label="Notificar notas crédito" desc="Alerta específica para notas crédito"
              value={cfg.notify_on_nc !== 'false'} onChange={v => set('notify_on_nc', v ? 'true' : 'false')} />
            <ToggleRow label="Resumen diario por correo" desc="Email con las facturas recibidas en el día"
              value={cfg.daily_summary === 'true'} onChange={v => set('daily_summary', v ? 'true' : 'false')} />
            <ToggleRow label="Alertas de vencimiento" desc="Avisa 5 días antes del vencimiento de facturas"
              value={cfg.vencimiento_alert !== 'false'} onChange={v => set('vencimiento_alert', v ? 'true' : 'false')} />
          </div>
        )}

        {/* SEGURIDAD */}
        {tab === 'seguridad' && (
          <div>
            <h3 style={sectionTitle}>Sesión y acceso</h3>
            <FormGroup label="Duración de sesión (JWT)">
              <select style={inputSt} value={cfg.session_hours || '8'} onChange={e => set('session_hours', e.target.value)}>
                <option value="1">1 hora</option>
                <option value="4">4 horas</option>
                <option value="8">8 horas (recomendado)</option>
                <option value="24">24 horas</option>
                <option value="168">7 días</option>
              </select>
            </FormGroup>
            <InfoBox>Los cambios de duración de sesión aplican al siguiente inicio de sesión.</InfoBox>
            <div style={{ marginTop: 20 }}>
              <h3 style={sectionTitle}>Información del sistema</h3>
              <div style={{ fontSize: 13, color: '#94a3b8', lineHeight: 2 }}>
                <div>📦 Backend: Node.js + Express</div>
                <div>🗄️ Base de datos: PostgreSQL (Render)</div>
                <div>📧 Email: Gmail OAuth2</div>
                <div>📄 Parser: XML DIAN UBL 2.1</div>
              </div>
            </div>
          </div>
        )}

        {/* Botón guardar global */}
        <div style={{ marginTop: 24, paddingTop: 20, borderTop: '1px solid #2a3348', display: 'flex', alignItems: 'center', gap: 12 }}>
          <button style={btnPrimary} onClick={guardar} disabled={saving}>
            {saving ? 'Guardando...' : '💾 Guardar configuración'}
          </button>
          {saved && <span style={{ fontSize: 12, color: '#4ade80' }}>✓ Guardado correctamente</span>}
        </div>
      </div>
    </div>
  );
}

const ToggleRow = ({ label, desc, value, onChange }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 0', borderBottom: '1px solid #2a3348' }}>
    <div>
      <div style={{ fontSize: 13, fontWeight: 500, color: '#e2e8f0' }}>{label}</div>
      {desc && <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{desc}</div>}
    </div>
    <div style={{ width: 38, height: 22, background: value ? '#3b82f6' : '#374460', borderRadius: 11, cursor: 'pointer', position: 'relative', transition: 'background .2s', flexShrink: 0 }}
      onClick={() => onChange(!value)}>
      <div style={{ position: 'absolute', top: 3, left: value ? 19 : 3, width: 16, height: 16, background: '#fff', borderRadius: '50%', transition: 'left .2s' }} />
    </div>
  </div>
);

const FormGroup = ({ label, children }) => (
  <div style={{ marginBottom: 16 }}>
    <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: '#94a3b8', marginBottom: 6 }}>{label}</label>
    {children}
  </div>
);

const InfoBox = ({ children }) => (
  <div style={{ background: 'rgba(59,130,246,.08)', border: '1px solid rgba(59,130,246,.2)', borderRadius: 6, padding: '10px 12px', fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
    ℹ️ {children}
  </div>
);

const sectionTitle = { fontSize: 14, fontWeight: 600, color: '#e2e8f0', marginBottom: 16, marginTop: 0 };
const inputSt = { width: '100%', background: '#0f1117', border: '1px solid #2a3348', borderRadius: 6, padding: '8px 12px', color: '#e2e8f0', fontSize: 13, outline: 'none', boxSizing: 'border-box' };
const btnPrimary = { background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', fontSize: 13, fontWeight: 500, cursor: 'pointer' };
const btnGhost = { background: '#1e2535', color: '#94a3b8', border: '1px solid #2a3348', borderRadius: 6, padding: '8px 16px', fontSize: 13, cursor: 'pointer' };
const btnDanger = { background: 'rgba(239,68,68,.1)', color: '#f87171', border: '1px solid rgba(239,68,68,.3)', borderRadius: 6, padding: '6px 12px', fontSize: 12, cursor: 'pointer' };


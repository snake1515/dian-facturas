import React, { useState, useEffect } from 'react';
import { listarUsuarios, crearUsuario, actualizarUsuario, eliminarUsuario } from '../services/api';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';

export default function Usuarios() {
  const { user: me, updateUser } = useAuth();
  const [usuarios, setUsuarios] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null); // 'form' | 'perfil'
  const [form, setForm] = useState({ nombre: '', email: '', password: '', rol: 'lector', activo: true });
  const [perfilForm, setPerfilForm] = useState({ nombre: '', email: '', password: '', passwordActual: '' });
  const [editId, setEditId] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState('');
  const [perfilError, setPerfilError] = useState('');
  const [perfilOk, setPerfilOk] = useState('');

  const cargar = async () => {
    try { setLoading(true); const res = await listarUsuarios(); setUsuarios(res.data); }
    catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  useEffect(() => { cargar(); }, []);

  const abrirNuevo = () => {
    setForm({ nombre: '', email: '', password: '', rol: 'lector', activo: true });
    setEditId(null); setError(''); setModal('form');
  };

  const abrirEditar = (u) => {
    setForm({ nombre: u.nombre, email: u.email, password: '', rol: u.rol, activo: u.activo });
    setEditId(u.id); setError(''); setModal('form');
  };

  const abrirPerfil = () => {
    setPerfilForm({ nombre: me.nombre, email: me.email, password: '', passwordActual: '' });
    setPerfilError(''); setPerfilOk(''); setModal('perfil');
  };

  const guardar = async () => {
    if (!form.nombre || !form.email) return setError('Nombre y correo son obligatorios');
    if (!editId && !form.password) return setError('La contraseña es obligatoria para nuevos usuarios');
    setActionLoading(true); setError('');
    try {
      if (editId) {
        const data = { nombre: form.nombre, rol: form.rol, activo: form.activo };
        if (form.password) data.password = form.password;
        await actualizarUsuario(editId, data);
      } else {
        await crearUsuario(form);
      }
      setModal(null); await cargar();
    } catch (err) { setError(err.response?.data?.error || 'Error al guardar'); }
    finally { setActionLoading(false); }
  };

  const guardarPerfil = async () => {
    if (!perfilForm.nombre || !perfilForm.email) return setPerfilError('Nombre y correo son obligatorios');
    setActionLoading(true); setPerfilError(''); setPerfilOk('');
    try {
      const data = { nombre: perfilForm.nombre };
      if (perfilForm.password) {
        if (!perfilForm.passwordActual) return setPerfilError('Ingresa tu contraseña actual para cambiarla');
        data.password = perfilForm.password;
        data.passwordActual = perfilForm.passwordActual;
      }
      await actualizarUsuario(me.id, data);
      updateUser({ nombre: perfilForm.nombre });
      setPerfilOk('Perfil actualizado correctamente');
      setPerfilForm(p => ({ ...p, password: '', passwordActual: '' }));
    } catch (err) { setPerfilError(err.response?.data?.error || 'Error al guardar perfil'); }
    finally { setActionLoading(false); }
  };

  const handleEliminar = async (id) => {
    if (!window.confirm('¿Eliminar este usuario?')) return;
    try { await eliminarUsuario(id); await cargar(); }
    catch (err) { alert(err.response?.data?.error || 'Error al eliminar'); }
  };

  const toggleActivo = async (u) => {
    try { await actualizarUsuario(u.id, { activo: !u.activo }); await cargar(); }
    catch (err) { alert(err.response?.data?.error || 'Error'); }
  };

  const rolLabel = (r) => ({ admin: 'Administrador', editor: 'Editor', lector: 'Lector' }[r] || r);
  const rolColor = (r) => ({ admin: badgeBlue, editor: badgePurple, lector: badgeGray }[r] || badgeGray);

  return (
    <div style={{ padding: '16px 8px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#e2e8f0', margin: 0 }}>Usuarios</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={btnGhost} onClick={abrirPerfil}>👤 Mi perfil</button>
          <button style={btnPrimary} onClick={abrirNuevo}>+ Nuevo usuario</button>
        </div>
      </div>

      {/* Tabla */}
      <div style={{ overflowX: 'auto' }}>
        <div style={tableWrap}>
          {loading ? <div style={empty}>Cargando usuarios...</div> : (
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 500 }}>
              <thead>
                <tr style={{ background: '#161b27', borderBottom: '1px solid #2a3348' }}>
                  {['Usuario', 'Correo', 'Rol', 'Estado', 'Acciones'].map(h => <th key={h} style={th}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {usuarios.map(u => (
                  <tr key={u.id} style={{ borderBottom: '1px solid rgba(42,51,72,.7)' }}>
                    <td style={td}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ ...avatar, background: u.rol === 'admin' ? '#1d4ed8' : u.rol === 'editor' ? '#6d28d9' : '#0f766e' }}>
                          {u.nombre.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                        </div>
                        <span style={{ fontWeight: 500 }}>{u.nombre}</span>
                      </div>
                    </td>
                    <td style={{ ...td, color: '#94a3b8', fontSize: 12 }}>{u.email}</td>
                    <td style={td}><span style={{ ...badge, ...rolColor(u.rol) }}>{rolLabel(u.rol)}</span></td>
                    <td style={td}><span style={{ ...badge, ...(u.activo ? badgeGreen : badgeRed) }}>{u.activo ? 'Activo' : 'Inactivo'}</span></td>
                    <td style={td}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button style={iconBtn} onClick={() => abrirEditar(u)} title="Editar">✏️</button>
                        <button style={iconBtn} onClick={() => toggleActivo(u)} title={u.activo ? 'Desactivar' : 'Activar'}>{u.activo ? '🔒' : '🔓'}</button>
                        <button style={{ ...iconBtn, color: '#f87171' }} onClick={() => handleEliminar(u.id)} title="Eliminar">🗑</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Descripción de roles */}
      <div style={{ marginTop: 20, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
        {[
          { rol: 'Administrador', color: '#60a5fa', permisos: ['Acceso total', 'Gestiona usuarios y configuración', 'Elimina facturas', 'Sincroniza Gmail'] },
          { rol: 'Editor', color: '#a78bfa', permisos: ['Ver y descargar facturas', 'Editar estado contable, doc. ingreso y notas', 'Asignar responsables y reenviar', 'Borrar por fechas y sincronizar'] },
          { rol: 'Lector', color: '#4ade80', permisos: ['Ver y descargar facturas', 'Asignar responsables', 'Reenviar facturas', 'Sin acceso a edición ni configuración'] },
        ].map(r => (
          <div key={r.rol} style={{ background: '#1e2535', border: '1px solid #2a3348', borderRadius: 8, padding: '12px 14px' }}>
            <div style={{ fontWeight: 600, color: r.color, marginBottom: 8, fontSize: 13 }}>{r.rol}</div>
            {r.permisos.map(p => <div key={p} style={{ fontSize: 11, color: '#64748b', marginBottom: 3 }}>• {p}</div>)}
          </div>
        ))}
      </div>

      {/* MODAL FORM USUARIO */}
      {modal === 'form' && (
        <div style={overlay} onClick={e => e.target === e.currentTarget && setModal(null)}>
          <div style={modalBox}>
            <div style={modalHeader}>
              <span style={{ fontWeight: 600, fontSize: 15 }}>{editId ? 'Editar usuario' : 'Nuevo usuario'}</span>
              <button style={closeBtn} onClick={() => setModal(null)}>×</button>
            </div>
            <div style={{ padding: 20, overflowY: 'auto', flex: 1 }}>
              <FG label="Nombre completo">
                <input style={inputSt} value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} placeholder="Juan Pérez" />
              </FG>
              <FG label="Correo electrónico">
                <input style={inputSt} type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="juan@empresa.com" disabled={!!editId} />
              </FG>
              <FG label={editId ? 'Nueva contraseña (dejar vacío para no cambiar)' : 'Contraseña'}>
                <input style={inputSt} type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder="••••••••" />
              </FG>
              <FG label="Rol">
                <select style={inputSt} value={form.rol} onChange={e => setForm({ ...form, rol: e.target.value })}>
                  <option value="lector">Lector — solo consulta y reenvío</option>
                  <option value="editor">Editor — puede editar estados y sincronizar</option>
                  <option value="admin">Administrador — acceso total</option>
                </select>
              </FG>
              {editId && (
                <FG label="Estado">
                  <select style={inputSt} value={form.activo ? 'true' : 'false'} onChange={e => setForm({ ...form, activo: e.target.value === 'true' })}>
                    <option value="true">Activo</option>
                    <option value="false">Inactivo</option>
                  </select>
                </FG>
              )}
              {error && <div style={errorBox}>{error}</div>}
            </div>
            <div style={{ padding: '14px 20px', borderTop: '1px solid #2a3348', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button style={btnGhost} onClick={() => setModal(null)}>Cancelar</button>
              <button style={btnPrimary} onClick={guardar} disabled={actionLoading}>
                {actionLoading ? 'Guardando...' : editId ? 'Guardar cambios' : 'Crear usuario'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL PERFIL */}
      {modal === 'perfil' && (
        <div style={overlay} onClick={e => e.target === e.currentTarget && setModal(null)}>
          <div style={modalBox}>
            <div style={modalHeader}>
              <span style={{ fontWeight: 600, fontSize: 15 }}>Mi perfil</span>
              <button style={closeBtn} onClick={() => setModal(null)}>×</button>
            </div>
            <div style={{ padding: 20, overflowY: 'auto', flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, padding: '12px 14px', background: '#0f1117', borderRadius: 8 }}>
                <div style={{ ...avatar, width: 44, height: 44, fontSize: 16, background: me?.rol === 'admin' ? '#1d4ed8' : me?.rol === 'editor' ? '#6d28d9' : '#0f766e' }}>
                  {me?.nombre?.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{me?.nombre}</div>
                  <div style={{ fontSize: 12, color: '#64748b' }}>{rolLabel(me?.rol)}</div>
                </div>
              </div>
              <FG label="Nombre">
                <input style={inputSt} value={perfilForm.nombre} onChange={e => setPerfilForm({ ...perfilForm, nombre: e.target.value })} />
              </FG>
              <FG label="Correo (no editable)">
                <input style={{ ...inputSt, opacity: 0.5 }} value={perfilForm.email} disabled />
              </FG>
              <div style={{ borderTop: '1px solid #2a3348', paddingTop: 14, marginTop: 4, marginBottom: 14 }}>
                <div style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>Cambiar contraseña (opcional)</div>
                <FG label="Contraseña actual">
                  <input style={inputSt} type="password" value={perfilForm.passwordActual} onChange={e => setPerfilForm({ ...perfilForm, passwordActual: e.target.value })} placeholder="••••••••" />
                </FG>
                <FG label="Nueva contraseña">
                  <input style={inputSt} type="password" value={perfilForm.password} onChange={e => setPerfilForm({ ...perfilForm, password: e.target.value })} placeholder="••••••••" />
                </FG>
              </div>
              {perfilError && <div style={errorBox}>{perfilError}</div>}
              {perfilOk && <div style={{ background: 'rgba(34,197,94,.1)', border: '1px solid rgba(34,197,94,.3)', color: '#4ade80', borderRadius: 6, padding: '8px 12px', fontSize: 12, marginBottom: 12 }}>{perfilOk}</div>}
            </div>
            <div style={{ padding: '14px 20px', borderTop: '1px solid #2a3348', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button style={btnGhost} onClick={() => setModal(null)}>Cerrar</button>
              <button style={btnPrimary} onClick={guardarPerfil} disabled={actionLoading}>
                {actionLoading ? 'Guardando...' : 'Guardar cambios'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const FG = ({ label, children }) => (
  <div style={{ marginBottom: 14 }}>
    <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: '#94a3b8', marginBottom: 6 }}>{label}</label>
    {children}
  </div>
);

const tableWrap = { background: '#1e2535', border: '1px solid #2a3348', borderRadius: 10, overflow: 'hidden' };
const empty = { textAlign: 'center', padding: 48, color: '#64748b' };
const th = { padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: '#64748b', letterSpacing: '.06em', textTransform: 'uppercase', whiteSpace: 'nowrap' };
const td = { padding: '12px 14px', fontSize: 13, color: '#e2e8f0', verticalAlign: 'middle' };
const avatar = { width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600, color: '#fff', flexShrink: 0 };
const badge = { padding: '2px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600 };
const badgeBlue = { background: 'rgba(59,130,246,.12)', color: '#60a5fa' };
const badgePurple = { background: 'rgba(139,92,246,.12)', color: '#a78bfa' };
const badgeGray = { background: 'rgba(100,116,139,.15)', color: '#94a3b8' };
const badgeGreen = { background: 'rgba(34,197,94,.12)', color: '#4ade80' };
const badgeRed = { background: 'rgba(239,68,68,.12)', color: '#f87171' };
const iconBtn = { background: 'none', border: 'none', cursor: 'pointer', padding: '4px 5px', borderRadius: 4, fontSize: 15 };
const inputSt = { width: '100%', background: '#0f1117', border: '1px solid #2a3348', borderRadius: 6, padding: '8px 12px', color: '#e2e8f0', fontSize: 13, outline: 'none', boxSizing: 'border-box' };
const btnPrimary = { background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', fontSize: 13, fontWeight: 500, cursor: 'pointer' };
const btnGhost = { background: '#1e2535', color: '#94a3b8', border: '1px solid #2a3348', borderRadius: 6, padding: '8px 16px', fontSize: 13, cursor: 'pointer' };
const errorBox = { background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.3)', color: '#f87171', borderRadius: 6, padding: '8px 12px', fontSize: 12, marginBottom: 12 };
const overlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 };
const modalBox = { background: '#161b27', border: '1px solid #374460', borderRadius: 14, width: 480, maxWidth: '100%', maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' };
const modalHeader = { padding: '18px 20px', borderBottom: '1px solid #2a3348', display: 'flex', alignItems: 'center', justifyContent: 'space-between' };
const closeBtn = { background: '#1e2535', border: 'none', color: '#94a3b8', borderRadius: 6, width: 28, height: 28, cursor: 'pointer', fontSize: 18, lineHeight: 1 };

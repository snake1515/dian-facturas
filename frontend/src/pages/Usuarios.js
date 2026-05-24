import React, { useState, useEffect } from 'react';
import { listarUsuarios, crearUsuario, actualizarUsuario, eliminarUsuario } from '../services/api';

export default function Usuarios() {
  const [usuarios, setUsuarios] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({ nombre: '', email: '', password: '', rol: 'consulta' });
  const [editId, setEditId] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState('');

  const cargar = async () => {
    try {
      setLoading(true);
      const res = await listarUsuarios();
      setUsuarios(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { cargar(); }, []);

  const abrirNuevo = () => {
    setForm({ nombre: '', email: '', password: '', rol: 'consulta' });
    setEditId(null);
    setError('');
    setModal('form');
  };

  const abrirEditar = (u) => {
    setForm({ nombre: u.nombre, email: u.email, password: '', rol: u.rol, activo: u.activo });
    setEditId(u.id);
    setError('');
    setModal('form');
  };

  const guardar = async () => {
    if (!form.nombre || !form.email) return setError('Nombre y correo son obligatorios');
    if (!editId && !form.password) return setError('La contraseña es obligatoria para nuevos usuarios');
    setActionLoading(true);
    setError('');
    try {
      if (editId) {
        const data = { nombre: form.nombre, rol: form.rol, activo: form.activo };
        if (form.password) data.password = form.password;
        await actualizarUsuario(editId, data);
      } else {
        await crearUsuario(form);
      }
      setModal(null);
      await cargar();
    } catch (err) {
      setError(err.response?.data?.error || 'Error al guardar');
    } finally {
      setActionLoading(false);
    }
  };

  const handleEliminar = async (id) => {
    if (!window.confirm('¿Eliminar este usuario?')) return;
    try {
      await eliminarUsuario(id);
      await cargar();
    } catch (err) {
      alert(err.response?.data?.error || 'Error al eliminar');
    }
  };

  const toggleActivo = async (u) => {
    try {
      await actualizarUsuario(u.id, { activo: !u.activo });
      await cargar();
    } catch (err) {
      alert(err.response?.data?.error || 'Error');
    }
  };

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <button style={btnPrimary} onClick={abrirNuevo}>+ Nuevo usuario</button>
      </div>

      <div style={tableWrap}>
        {loading ? (
          <div style={empty}>Cargando usuarios...</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#161b27', borderBottom: '1px solid #2a3348' }}>
                {['Usuario', 'Correo', 'Rol', 'Estado', 'Acciones'].map(h => (
                  <th key={h} style={th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {usuarios.map(u => (
                <tr key={u.id} style={{ borderBottom: '1px solid rgba(42,51,72,.7)' }}>
                  <td style={td}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ ...avatar, background: u.rol === 'admin' ? '#1d4ed8' : '#0f766e' }}>
                        {u.nombre.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                      </div>
                      <span style={{ fontWeight: 500 }}>{u.nombre}</span>
                    </div>
                  </td>
                  <td style={{ ...td, color: '#94a3b8' }}>{u.email}</td>
                  <td style={td}>
                    <span style={{ ...badge, ...(u.rol === 'admin' ? badgeBlue : badgeGray) }}>
                      {u.rol === 'admin' ? 'Administrador' : 'Solo consulta'}
                    </span>
                  </td>
                  <td style={td}>
                    <span style={{ ...badge, ...(u.activo ? badgeGreen : badgeRed) }}>
                      {u.activo ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td style={td}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button style={iconBtn} onClick={() => abrirEditar(u)} title="Editar">✏️</button>
                      <button style={iconBtn} onClick={() => toggleActivo(u)} title={u.activo ? 'Desactivar' : 'Activar'}>
                        {u.activo ? '🔒' : '🔓'}
                      </button>
                      <button style={{ ...iconBtn, color: '#f87171' }} onClick={() => handleEliminar(u.id)} title="Eliminar">🗑</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal form usuario */}
      {modal === 'form' && (
        <div style={overlay} onClick={e => e.target === e.currentTarget && setModal(null)}>
          <div style={modalBox}>
            <div style={modalHeader}>
              <span style={{ fontWeight: 600, fontSize: 15 }}>{editId ? 'Editar usuario' : 'Nuevo usuario'}</span>
              <button style={closeBtn} onClick={() => setModal(null)}>×</button>
            </div>
            <div style={{ padding: 20 }}>
              <FormGroup label="Nombre completo">
                <input style={inputSt} value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} placeholder="Juan Pérez" />
              </FormGroup>
              <FormGroup label="Correo electrónico">
                <input style={inputSt} type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="juan@empresa.com" disabled={!!editId} />
              </FormGroup>
              <FormGroup label={editId ? 'Nueva contraseña (dejar vacío para no cambiar)' : 'Contraseña'}>
                <input style={inputSt} type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder="••••••••" />
              </FormGroup>
              <FormGroup label="Rol">
                <select style={inputSt} value={form.rol} onChange={e => setForm({ ...form, rol: e.target.value })}>
                  <option value="consulta">Solo consulta — puede ver y reenviar facturas</option>
                  <option value="admin">Administrador — acceso total</option>
                </select>
              </FormGroup>
              {editId && (
                <FormGroup label="Estado">
                  <select style={inputSt} value={form.activo ? 'true' : 'false'} onChange={e => setForm({ ...form, activo: e.target.value === 'true' })}>
                    <option value="true">Activo</option>
                    <option value="false">Inactivo</option>
                  </select>
                </FormGroup>
              )}
              {error && <div style={errorBox}>{error}</div>}
              <div style={{ background: 'rgba(59,130,246,.08)', border: '1px solid rgba(59,130,246,.2)', borderRadius: 6, padding: '10px 12px', fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
                🛡️ Los usuarios de <strong>solo consulta</strong> pueden revisar y reenviar facturas, pero no pueden eliminar ni acceder a la configuración.
              </div>
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
    </div>
  );
}

const FormGroup = ({ label, children }) => (
  <div style={{ marginBottom: 14 }}>
    <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: '#94a3b8', marginBottom: 6 }}>{label}</label>
    {children}
  </div>
);

const tableWrap = { background: '#1e2535', border: '1px solid #2a3348', borderRadius: 10, overflow: 'hidden' };
const empty = { textAlign: 'center', padding: 48, color: '#64748b' };
const th = { padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: '#64748b', letterSpacing: '.06em', textTransform: 'uppercase' };
const td = { padding: '12px 14px', fontSize: 13, color: '#e2e8f0', verticalAlign: 'middle' };
const avatar = { width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600, color: '#fff', flexShrink: 0 };
const badge = { padding: '2px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600 };
const badgeBlue = { background: 'rgba(59,130,246,.12)', color: '#60a5fa' };
const badgeGray = { background: 'rgba(100,116,139,.15)', color: '#94a3b8' };
const badgeGreen = { background: 'rgba(34,197,94,.12)', color: '#4ade80' };
const badgeRed = { background: 'rgba(239,68,68,.12)', color: '#f87171' };
const iconBtn = { background: 'none', border: 'none', cursor: 'pointer', padding: '4px 5px', borderRadius: 4, fontSize: 15 };
const inputSt = { width: '100%', background: '#0f1117', border: '1px solid #2a3348', borderRadius: 6, padding: '8px 12px', color: '#e2e8f0', fontSize: 13, outline: 'none', boxSizing: 'border-box' };
const btnPrimary = { background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', fontSize: 13, fontWeight: 500, cursor: 'pointer' };
const btnGhost = { background: '#1e2535', color: '#94a3b8', border: '1px solid #2a3348', borderRadius: 6, padding: '8px 16px', fontSize: 13, cursor: 'pointer' };
const errorBox = { background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.3)', color: '#f87171', borderRadius: 6, padding: '8px 12px', fontSize: 12, marginBottom: 12 };
const overlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 };
const modalBox = { background: '#161b27', border: '1px solid #374460', borderRadius: 14, width: 480, maxWidth: '95vw', maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' };
const modalHeader = { padding: '18px 20px', borderBottom: '1px solid #2a3348', display: 'flex', alignItems: 'center', justifyContent: 'space-between' };
const closeBtn = { background: '#1e2535', border: 'none', color: '#94a3b8', borderRadius: 6, width: 28, height: 28, cursor: 'pointer', fontSize: 18, lineHeight: 1 };

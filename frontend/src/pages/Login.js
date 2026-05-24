import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { doLogin } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await doLogin(email, password);
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.error || 'Error al iniciar sesión');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={s.wrap}>
      <div style={s.card}>
        <div style={s.logo}>
          <div style={s.logoIcon}>FE</div>
          <div>
            <div style={s.logoTitle}>FacturaDIAN</div>
            <div style={s.logoSub}>Gestión de facturas electrónicas</div>
          </div>
        </div>
        <form onSubmit={handleSubmit}>
          <div style={s.group}>
            <label style={s.label}>Correo electrónico</label>
            <input style={s.input} type="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="admin@empresa.com" />
          </div>
          <div style={s.group}>
            <label style={s.label}>Contraseña</label>
            <input style={s.input} type="password" value={password} onChange={e => setPassword(e.target.value)} required placeholder="••••••••" />
          </div>
          {error && <div style={s.error}>{error}</div>}
          <button style={s.btn} type="submit" disabled={loading}>
            {loading ? 'Ingresando...' : 'Ingresar'}
          </button>
        </form>
      </div>
    </div>
  );
}

const s = {
  wrap: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0f1117' },
  card: { background: '#161b27', border: '1px solid #2a3348', borderRadius: 14, padding: '36px 32px', width: 380 },
  logo: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28 },
  logoIcon: { width: 40, height: 40, background: '#3b82f6', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 14, color: '#fff' },
  logoTitle: { fontWeight: 700, fontSize: 16, color: '#e2e8f0' },
  logoSub: { fontSize: 12, color: '#64748b' },
  group: { marginBottom: 16 },
  label: { display: 'block', fontSize: 12, fontWeight: 500, color: '#94a3b8', marginBottom: 6 },
  input: { width: '100%', background: '#1e2535', border: '1px solid #2a3348', borderRadius: 6, padding: '10px 12px', color: '#e2e8f0', fontSize: 13, outline: 'none', boxSizing: 'border-box' },
  error: { background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.3)', color: '#f87171', borderRadius: 6, padding: '8px 12px', fontSize: 12, marginBottom: 14 },
  btn: { width: '100%', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, padding: '11px', fontSize: 14, fontWeight: 600, cursor: 'pointer', marginTop: 4 },
};

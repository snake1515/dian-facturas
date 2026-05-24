import React, { useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Login from './pages/Login';
import Facturas from './pages/Facturas';
import Usuarios from './pages/Usuarios';
import Configuracion from './pages/Configuracion';

const DARK = {
  bg: '#0f1117', bg2: '#161b27', bg3: '#1e2535',
  border: '#2a3348', border2: '#374460',
  blue: '#3b82f6', text: '#e2e8f0', text2: '#94a3b8', text3: '#64748b',
};

function PrivateRoute({ children, adminOnly = false }) {
  const { user, isAdmin } = useAuth();
  if (!user) return <Navigate to="/login" />;
  if (adminOnly && !isAdmin) return <Navigate to="/" />;
  return children;
}

function Layout() {
  const { user, isAdmin, doLogout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);

  const navItems = [
    { path: '/', label: 'Facturas electrónicas', icon: '🧾', exact: true },
    { path: '/notas', label: 'Notas crédito', icon: '📋' },
    ...(isAdmin ? [
      { path: '/usuarios', label: 'Usuarios', icon: '👥' },
      { path: '/configuracion', label: 'Configuración', icon: '⚙️' },
    ] : []),
  ];

  const isActive = (item) => item.exact ? location.pathname === item.path : location.pathname.startsWith(item.path);

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: DARK.bg, color: DARK.text }}>
      {/* Sidebar */}
      <div style={{ width: collapsed ? 60 : 220, minWidth: collapsed ? 60 : 220, background: DARK.bg2, borderRight: `1px solid ${DARK.border}`, display: 'flex', flexDirection: 'column', transition: 'width .2s', overflow: 'hidden' }}>
        {/* Logo */}
        <div style={{ padding: collapsed ? '16px 12px' : '18px 16px', borderBottom: `1px solid ${DARK.border}`, display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }} onClick={() => setCollapsed(!collapsed)}>
          <div style={{ width: 32, height: 32, background: DARK.blue, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13, color: '#fff', flexShrink: 0 }}>FE</div>
          {!collapsed && (
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>FacturaDIAN</div>
              <div style={{ fontSize: 10, color: DARK.text3 }}>Gestión electrónica</div>
            </div>
          )}
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: '8px 0', overflowY: 'auto' }}>
          {!collapsed && <div style={{ padding: '8px 14px 4px', fontSize: 10, fontWeight: 600, color: DARK.text3, letterSpacing: '.08em', textTransform: 'uppercase' }}>Principal</div>}
          {navItems.map(item => (
            <div key={item.path}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: collapsed ? '10px 14px' : '9px 14px', cursor: 'pointer', color: isActive(item) ? DARK.blue : DARK.text2, borderLeft: `2px solid ${isActive(item) ? DARK.blue : 'transparent'}`, background: isActive(item) ? 'rgba(59,130,246,.1)' : 'transparent', transition: 'all .15s', fontSize: 13, whiteSpace: 'nowrap' }}
              onClick={() => navigate(item.path)}
              title={collapsed ? item.label : ''}>
              <span style={{ fontSize: 16, flexShrink: 0 }}>{item.icon}</span>
              {!collapsed && item.label}
            </div>
          ))}
        </nav>

        {/* Footer usuario */}
        <div style={{ padding: 10, borderTop: `1px solid ${DARK.border}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 8, background: DARK.bg3, borderRadius: 8, cursor: 'pointer' }} onClick={doLogout} title="Cerrar sesión">
            <div style={{ width: 28, height: 28, borderRadius: '50%', background: user?.rol === 'admin' ? '#1d4ed8' : '#0f766e', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600, color: '#fff', flexShrink: 0 }}>
              {user?.nombre?.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
            </div>
            {!collapsed && (
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: DARK.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.nombre}</div>
                <div style={{ fontSize: 10, color: DARK.text3 }}>{user?.rol === 'admin' ? 'Administrador' : 'Solo consulta'}</div>
              </div>
            )}
            {!collapsed && <span style={{ fontSize: 14, color: DARK.text3 }}>↩</span>}
          </div>
        </div>
      </div>

      {/* Main */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Topbar */}
        <div style={{ height: 52, background: DARK.bg2, borderBottom: `1px solid ${DARK.border}`, display: 'flex', alignItems: 'center', padding: '0 20px', gap: 12, flexShrink: 0 }}>
          <div style={{ flex: 1, fontSize: 15, fontWeight: 600 }}>
            {navItems.find(n => isActive(n))?.label || 'FacturaDIAN'}
          </div>
          <div style={{ fontSize: 11, color: DARK.text3 }}>
            Sistema de gestión DIAN · {user?.email}
          </div>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <Routes>
            <Route path="/" element={<Facturas tipo="FE" />} />
            <Route path="/notas" element={<Facturas tipo="NC" />} />
            <Route path="/usuarios" element={<PrivateRoute adminOnly><Usuarios /></PrivateRoute>} />
            <Route path="/configuracion" element={<PrivateRoute adminOnly><Configuracion /></PrivateRoute>} />
          </Routes>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/*" element={<PrivateRoute><Layout /></PrivateRoute>} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

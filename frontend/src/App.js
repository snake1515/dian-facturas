import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';

import Login from './pages/Login';
import Facturas from './pages/Facturas';
import Usuarios from './pages/Usuarios';
import Configuracion from './pages/Configuracion';
import CruceDIAN from './pages/CruceDIAN';

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  useEffect(() => {
    const h = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);
  return isMobile;
}

function PrivateRoute({ children, adminOnly = false }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (adminOnly && user.rol !== 'admin') return <Navigate to="/" replace />;
  return children;
}

function Layout({ children }) {
  const { user, puede, doLogout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Close sidebar on route change (mobile)
  useEffect(() => { setSidebarOpen(false); }, [location.pathname]);

  const handleLogout = () => { doLogout(); navigate('/login'); };

  const navStyle = ({ isActive }) => ({
    display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', borderRadius: 7,
    fontSize: 13, fontWeight: 500,
    color: isActive ? '#e2e8f0' : '#64748b',
    background: isActive ? '#1e2535' : 'transparent',
    textDecoration: 'none', transition: 'all .15s',
  });

  const rolLabel = { admin: 'Administrador', editor: 'Editor', lector: 'Lector' }[user?.rol] || user?.rol;

  const Sidebar = () => (
    <aside style={{
      width: 220, background: '#161b27', borderRight: '1px solid #2a3348',
      display: 'flex', flexDirection: 'column', padding: '20px 12px',
      position: 'fixed', top: 0, left: 0, bottom: 0, zIndex: 50,
      transform: isMobile && !sidebarOpen ? 'translateX(-100%)' : 'translateX(0)',
      transition: 'transform .25s ease',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 28, paddingLeft: 4 }}>
        <div style={{ width: 34, height: 34, background: '#3b82f6', borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13, color: '#fff' }}>FE</div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, color: '#e2e8f0' }}>FacturaDIAN</div>
          <div style={{ fontSize: 11, color: '#475569' }}>Facturas electrónicas</div>
        </div>
        {isMobile && (
          <button onClick={() => setSidebarOpen(false)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#64748b', fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>✕</button>
        )}
      </div>

      <nav style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1 }}>
        <NavLink to="/" end style={navStyle}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          Facturas
        </NavLink>
        <NavLink to="/notas-credito" style={navStyle}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="13" y2="17"/></svg>
          Notas Crédito
        </NavLink>
        {puede.verUsuarios && (
          <NavLink to="/usuarios" style={navStyle}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            Usuarios
          </NavLink>
        )}
        <NavLink to="/cruce-dian" style={navStyle}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
          Cruce DIAN
        </NavLink>
        {puede.verConfiguracion && (
          <NavLink to="/configuracion" style={navStyle}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93l-1.41 1.41M4.93 4.93l1.41 1.41M4.93 19.07l1.41-1.41M19.07 19.07l-1.41-1.41M21 12h-2M5 12H3M12 21v-2M12 5V3"/></svg>
            Configuración
          </NavLink>
        )}
      </nav>

      <div style={{ borderTop: '1px solid #2a3348', paddingTop: 14, marginTop: 8 }}>
        <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 2, paddingLeft: 4 }}>{user?.nombre}</div>
        <div style={{ fontSize: 11, color: '#475569', marginBottom: 10, paddingLeft: 4 }}>{rolLabel}</div>
        <button onClick={handleLogout} style={{ width: '100%', background: 'transparent', border: '1px solid #2a3348', borderRadius: 6, padding: '8px 12px', color: '#64748b', fontSize: 12, cursor: 'pointer', textAlign: 'left' }}>
          Cerrar sesión
        </button>
      </div>
    </aside>
  );

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#0f1117' }}>
      <Sidebar />

      {/* Overlay oscuro al abrir sidebar en móvil */}
      {isMobile && sidebarOpen && (
        <div onClick={() => setSidebarOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 40 }} />
      )}

      {/* Topbar en móvil */}
      {isMobile && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, height: 52,
          background: '#161b27', borderBottom: '1px solid #2a3348',
          display: 'flex', alignItems: 'center', padding: '0 16px', zIndex: 30, gap: 12,
        }}>
          <button onClick={() => setSidebarOpen(true)}
            style={{ background: 'none', border: 'none', color: '#e2e8f0', fontSize: 22, cursor: 'pointer', lineHeight: 1, padding: 0 }}>
            ☰
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 26, height: 26, background: '#3b82f6', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 11, color: '#fff' }}>FE</div>
            <span style={{ fontWeight: 700, fontSize: 14, color: '#e2e8f0' }}>FacturaDIAN</span>
          </div>
        </div>
      )}

      <main style={{
        marginLeft: isMobile ? 0 : 220,
        flex: 1,
        padding: isMobile ? '64px 10px 20px' : '28px 20px',
        color: '#e2e8f0',
        minWidth: 0,
        width: '100%',
        boxSizing: 'border-box',
      }}>
        {children}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginGuard />} />
          <Route path="/" element={<PrivateRoute><Layout><Facturas /></Layout></PrivateRoute>} />
          <Route path="/notas-credito" element={<PrivateRoute><Layout><Facturas tipo="NC" /></Layout></PrivateRoute>} />
          <Route path="/usuarios" element={<PrivateRoute adminOnly><Layout><Usuarios /></Layout></PrivateRoute>} />
          <Route path="/configuracion" element={<PrivateRoute adminOnly><Layout><Configuracion /></Layout></PrivateRoute>} />
          <Route path="/cruce-dian" element={<PrivateRoute><Layout><CruceDIAN /></Layout></PrivateRoute>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

function LoginGuard() {
  const { user } = useAuth();
  return user ? <Navigate to="/" replace /> : <Login />;
}

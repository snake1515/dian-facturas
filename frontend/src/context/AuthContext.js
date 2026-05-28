import React, { createContext, useContext, useState, useCallback } from 'react';
import axios from 'axios';

const AuthContext = createContext(null);
const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';

axios.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

axios.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401 && window.location.pathname !== '/login') {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try { const s = localStorage.getItem('user'); return s ? JSON.parse(s) : null; }
    catch { return null; }
  });
  const [token, setToken] = useState(() => localStorage.getItem('token') || null);
  const [loading, setLoading] = useState(false);

  const doLogin = useCallback(async (email, password) => {
    setLoading(true);
    try {
      const res = await axios.post(`${API_URL}/auth/login`, { email, password });
      const { token: newToken, user: newUser } = res.data;
      localStorage.setItem('token', newToken);
      localStorage.setItem('user', JSON.stringify(newUser));
      setToken(newToken);
      setUser(newUser);
      return newUser;
    } finally { setLoading(false); }
  }, []);

  const doLogout = useCallback(() => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setToken(null);
    setUser(null);
  }, []);

  // Actualizar usuario en contexto (para cambios de perfil)
  const updateUser = useCallback((updates) => {
    const updated = { ...user, ...updates };
    localStorage.setItem('user', JSON.stringify(updated));
    setUser(updated);
  }, [user]);

  const rol = user?.rol || '';

  // Permisos por rol
  const isAdmin  = rol === 'admin';
  const isEditor = rol === 'editor' || rol === 'admin';
  const isLector = rol === 'lector' || rol === 'editor' || rol === 'admin';

  // Capacidades específicas
  const puede = {
    verFacturas:        isLector,
    descargarArchivos:  isLector,
    asignarResponsables: isLector,
    reenviarFacturas:   isLector,
    editarEstadoContable: isEditor,
    editarDocIngreso:   isEditor,
    editarNotas:        isEditor,
    borrarPorFechas:    isEditor,
    sincronizar:        isEditor,
    eliminarFacturas:   isAdmin,
    verUsuarios:        isAdmin,
    verConfiguracion:   isAdmin,
    gestionarUsuarios:  isAdmin,
  };

  return (
    <AuthContext.Provider value={{ user, token, loading, isAdmin, isEditor, isLector, puede, doLogin, doLogout, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return ctx;
}

export default AuthContext;

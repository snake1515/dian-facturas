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

  // Flags por rol
  const isAdmin   = rol === 'admin';
  const isEditor  = rol === 'editor'  || rol === 'admin';
  const isObra    = rol === 'obra'    || rol === 'editor' || rol === 'admin';
  const isLector  = rol === 'lector'  || rol === 'consulta' || rol === 'obra' || rol === 'editor' || rol === 'admin';
  const isRegente = rol === 'regente' || rol === 'admin';

  // Capacidades específicas por rol
  // consulta: ver/descargar/reenviar facturas y NC, nada más
  // obra: ver facturas+NC, notas, doc ingreso, elegir flujo inicial, descargar/reenviar, pendientes
  // regente: solo prestamos (ver + editar + subir PDF + cruces)
  // editor: todo excepto configuración, eliminar facturas, gestionar usuarios
  // admin: todo

  const esConsulta = rol === 'consulta';
  const esObra     = rol === 'obra';
  const esRegente  = rol === 'regente';

  const puede = {
    // Facturas
    verFacturas:            isLector && !isRegente,
    descargarArchivos:      isLector && !isRegente,
    reenviarFacturas:       isLector && !isRegente,
    asignarResponsables:    isEditor,
    editarNotas:            isObra,                    // obra, editor, admin
    editarDocIngreso:       isObra,                    // obra, editor, admin
    elegirFlujo:            isObra,                    // obra puede elegir OC/CM y cambiar
    editarEstadoContable:   isEditor,                  // solo editor/admin avanzan pasos
    devolverEstado:         isAdmin,                   // solo admin puede devolver pasos
    borrarPorFechas:        isEditor,
    sincronizar:            isEditor,
    eliminarFacturas:       isAdmin,

    // Usuarios / config
    verUsuarios:            isAdmin,
    verConfiguracion:       isAdmin,
    gestionarUsuarios:      isAdmin,

    // Pendientes
    verPendientes:          isObra,
    editarPendientes:       isObra,

    // Préstamos
    verPrestamos:           isEditor || isRegente || esObra,
    editarPrestamos:        isEditor || isRegente,

    // Cruce DIAN
    verCruceDIAN:           isEditor,
  };

  return (
    <AuthContext.Provider value={{ user, token, loading, isAdmin, isEditor, isObra, isLector, isRegente, puede, doLogin, doLogout, updateUser }}>
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




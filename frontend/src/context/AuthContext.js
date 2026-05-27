import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import axios from 'axios';

const AuthContext = createContext(null);

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';

// Configura axios para que siempre envíe el token JWT si existe
axios.interceptors.request.use((config) => {
  const token = localStorage.getItem('dian_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Si el backend responde 401, limpia la sesión automáticamente
axios.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401 && window.location.pathname !== '/login') {
      localStorage.removeItem('dian_token');
      localStorage.removeItem('dian_user');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      const stored = localStorage.getItem('dian_user');
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });

  const [token, setToken] = useState(() => localStorage.getItem('dian_token') || null);
  const [loading, setLoading] = useState(false);

  // doLogin: llama al backend, guarda token y user en localStorage
  const doLogin = useCallback(async (email, password) => {
    setLoading(true);
    try {
      const res = await axios.post(`${API_URL}/auth/login`, { email, password });
      const { token: newToken, user: newUser } = res.data;
      localStorage.setItem('dian_token', newToken);
      localStorage.setItem('dian_user', JSON.stringify(newUser));
      setToken(newToken);
      setUser(newUser);
      return newUser;
    } finally {
      setLoading(false);
    }
  }, []);

  // doLogout: limpia todo
  const doLogout = useCallback(() => {
    localStorage.removeItem('dian_token');
    localStorage.removeItem('dian_user');
    setToken(null);
    setUser(null);
  }, []);

  // isAdmin: helper para verificar rol
  const isAdmin = user?.rol === 'admin';

  return (
    <AuthContext.Provider value={{ user, token, loading, isAdmin, doLogin, doLogout }}>
      {children}
    </AuthContext.Provider>
  );
}

// Hook de acceso al contexto
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return ctx;
}

export default AuthContext;

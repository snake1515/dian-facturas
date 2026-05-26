import axios from 'axios';

const api = axios.create({
  baseURL: process.env.REACT_APP_API_URL || 'http://localhost:3001/api',
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('dian_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('dian_token');
      localStorage.removeItem('dian_user');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

// Auth
export const login = (email, password) => api.post('/auth/login', { email, password });
export const crearUsuario = (data) => api.post('/auth/usuarios', data);
export const listarUsuarios = () => api.get('/auth/usuarios');
export const actualizarUsuario = (id, data) => api.put(`/auth/usuarios/${id}`, data);
export const eliminarUsuario = (id) => api.delete(`/auth/usuarios/${id}`);

// Facturas
export const listarFacturas = (params) => api.get('/facturas', { params });
export const obtenerFactura = (id) => api.get(`/facturas/${id}`);
export const actualizarResponsables = (id, emails) => api.put(`/facturas/${id}/responsables`, { emails });
export const reenviarFactura = (id, data) => api.post(`/facturas/${id}/reenviar`, data);
export const eliminarFactura = (id) => api.delete(`/facturas/${id}`);
export const eliminarPorFechas = (data) => api.delete('/facturas', { data });
export const urlPDF = (id) => `${api.defaults.baseURL}/facturas/${id}/pdf`;
export const urlXML = (id) => `${api.defaults.baseURL}/facturas/${id}/xml`;

export const actualizarEstadoContable = (id, estado_contable) => api.put(`/facturas/${id}/estado-contable`, { estado_contable });

// Gmail
export const gmailStatus = () => api.get('/gmail/status');
export const gmailAuthUrl = () => api.get('/gmail/auth-url');
export const gmailSync = (data) => api.post('/gmail/sync', data || {});
export const gmailDisconnect = () => api.delete('/gmail/disconnect');

// Configuración
export const obtenerConfig = () => api.get('/configuracion');
export const guardarConfig = (data) => api.put('/configuracion', data);
export const reiniciarCron = () => api.post('/configuracion/restart-cron');

export default api;

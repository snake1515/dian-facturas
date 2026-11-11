const jwt = require('jsonwebtoken');

const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token requerido' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
};

const adminOnly = (req, res, next) => {
  if (req.user?.rol !== 'admin') {
    return res.status(403).json({ error: 'Acceso restringido a administradores' });
  }
  next();
};

const editorOrAdmin = (req, res, next) => {
  if (!['admin', 'editor'].includes(req.user?.rol)) {
    return res.status(403).json({ error: 'Acceso restringido a editores y administradores' });
  }
  next();
};

// Perfiles que trabajan con facturas. Regente (solo préstamos) y contable
// (solo documentos soporte) no tienen acceso a facturas ni a sus módulos.
const ROLES_FACTURAS = ['admin', 'editor', 'obra', 'consulta', 'lector', 'almacen'];
const soloRolesFacturas = (req, res, next) => {
  if (!ROLES_FACTURAS.includes(req.user?.rol)) {
    return res.status(403).json({ error: 'Su perfil no tiene acceso a facturas' });
  }
  next();
};

// Perfil "almacen": solo facturas y notas crédito ADMINISTRATIVAS (y las de
// proveedores sin clasificar, que aparecen en ambas pestañas). Puede ver,
// descargar PDF/XML, reenviar y escribir "Notas almacén" (columna
// notas_infraestructura). Todo lo demás se rechaza aquí, en el servidor.
const esCategoriaPermitidaAlmacen = async (id) => {
  const { pool } = require('../models/db');
  const { rows } = await pool.query(
    `SELECT COALESCE(f.categoria_manual, p.categoria) AS cat
     FROM facturas f LEFT JOIN proveedores p ON p.nit = TRIM(f.proveedor_nit)
     WHERE f.id = $1`, [id]);
  return rows.length > 0 && rows[0].cat !== 'obra';
};
const restringirAlmacen = async (req, res, next) => {
  if (req.user?.rol !== 'almacen') return next();
  try {
    const m = req.method;
    const ruta = req.path.replace(/\/+$/, '') || '/';
    // Listado: siempre forzado a administrativas
    if (m === 'GET' && ruta === '/') { req.query.categoria = 'administrativa'; return next(); }
    // Contactos (para reenviar): solo lectura y agregar
    if (ruta === '/contactos/lista' && m === 'GET') return next();
    if (ruta === '/contactos' && m === 'POST') return next();
    // Avisos de otros módulos que la pantalla consulta: vacíos
    if (m === 'GET' && (ruta === '/notificaciones' || ruta === '/coincidencias')) return res.json([]);
    // Acciones sobre una factura puntual
    const x = ruta.match(/^\/(\d+)(\/(pdf|xml|reenviar|notas-infraestructura))?$/);
    const permitida = x && (
      (m === 'GET' && (!x[3] || x[3] === 'pdf' || x[3] === 'xml')) ||
      (m === 'POST' && x[3] === 'reenviar') ||
      (m === 'PUT' && x[3] === 'notas-infraestructura'));
    if (!permitida) return res.status(403).json({ error: 'Su perfil (Almacén) no tiene permiso para esta acción' });
    if (!(await esCategoriaPermitidaAlmacen(x[1]))) {
      return res.status(403).json({ error: 'Su perfil (Almacén) solo tiene acceso a facturas administrativas' });
    }
    return next();
  } catch (e) {
    console.error('restringirAlmacen:', e.message);
    return res.status(500).json({ error: 'Error verificando permisos' });
  }
};
// Módulos de facturas a los que Almacén no tiene acceso
const sinAlmacen = (req, res, next) => {
  if (req.user?.rol !== 'almacen') return next();
  if (req.method === 'GET' && req.baseUrl === '/api/coincidencias') return res.json([]);
  return res.status(403).json({ error: 'Su perfil (Almacén) no tiene acceso a este módulo' });
};

module.exports = { authMiddleware, adminOnly, editorOrAdmin, soloRolesFacturas, ROLES_FACTURAS, restringirAlmacen, sinAlmacen };


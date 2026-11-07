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
const ROLES_FACTURAS = ['admin', 'editor', 'obra', 'consulta', 'lector'];
const soloRolesFacturas = (req, res, next) => {
  if (!ROLES_FACTURAS.includes(req.user?.rol)) {
    return res.status(403).json({ error: 'Su perfil no tiene acceso a facturas' });
  }
  next();
};

module.exports = { authMiddleware, adminOnly, editorOrAdmin, soloRolesFacturas, ROLES_FACTURAS };


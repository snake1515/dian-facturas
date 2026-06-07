const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../models/db');
const { authMiddleware, adminOnly } = require('../middleware/auth');

const router = express.Router();

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email y contraseña requeridos' });

    const result = await pool.query('SELECT * FROM usuarios WHERE email = $1 AND activo = true', [email]);
    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: 'Credenciales inválidas' });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Credenciales inválidas' });

    const token = jwt.sign(
      { id: user.id, email: user.email, nombre: user.nombre, rol: user.rol },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({ token, user: { id: user.id, nombre: user.nombre, email: user.email, rol: user.rol, alias: user.alias || null, tema: user.tema || 'oscuro' } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Crear usuario (solo admin, o primer usuario del sistema)
router.post('/usuarios', async (req, res) => {
  try {
    const { nombre, email, password, rol } = req.body;
    if (!nombre || !email || !password) return res.status(400).json({ error: 'Datos incompletos' });

    // Verificar si es el primer usuario (admin inicial)
    const count = await pool.query('SELECT COUNT(*) FROM usuarios');
    const esPrimero = parseInt(count.rows[0].count) === 0;

    // Si no es el primer usuario, verificar auth admin
    if (!esPrimero) {
      const token = req.headers.authorization?.split(' ')[1];
      if (!token) return res.status(401).json({ error: 'No autorizado' });
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (decoded.rol !== 'admin') return res.status(403).json({ error: 'Solo admins pueden crear usuarios' });
    }

    const hash = await bcrypt.hash(password, 10);
    const rolesValidos = ['admin', 'editor', 'lector', 'consulta', 'obra', 'regente'];
    const rolFinal = esPrimero ? 'admin' : (rolesValidos.includes(rol) ? rol : 'consulta');

    const { alias } = req.body;
    const result = await pool.query(
      'INSERT INTO usuarios (nombre, email, password_hash, rol, alias) VALUES ($1,$2,$3,$4,$5) RETURNING id, nombre, email, rol, alias',
      [nombre, email, hash, rolFinal, alias || null]
    );

    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Este email ya está registrado' });
    res.status(500).json({ error: err.message });
  }
});

// Listar usuarios (solo admin)
router.get('/usuarios', authMiddleware, adminOnly, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, nombre, email, rol, activo, alias, created_at FROM usuarios ORDER BY created_at'
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Actualizar usuario (solo admin)
router.put('/usuarios/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { nombre, rol, activo, password, alias } = req.body;
    const { id } = req.params;

    if (password) {
      const hash = await bcrypt.hash(password, 10);
      await pool.query('UPDATE usuarios SET password_hash = $1 WHERE id = $2', [hash, id]);
    }

    const result = await pool.query(
      'UPDATE usuarios SET nombre = COALESCE($1, nombre), rol = COALESCE($2, rol), activo = COALESCE($3, activo), alias = COALESCE($4, alias) WHERE id = $5 RETURNING id, nombre, email, rol, activo, alias',
      [nombre, rol, activo, alias !== undefined ? alias : null, id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Eliminar usuario (solo admin)
router.delete('/usuarios/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    if (parseInt(req.params.id) === req.user.id) {
      return res.status(400).json({ error: 'No puedes eliminarte a ti mismo' });
    }
    await pool.query('DELETE FROM usuarios WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Guardar tema del usuario
router.put('/tema', authMiddleware, async (req, res) => {
  try {
    const { tema } = req.body;
    const temas = ['oscuro', 'blanco', 'rosado', 'morado', 'azul', 'verde'];
    if (!temas.includes(tema)) return res.status(400).json({ error: 'Tema inválido' });
    await pool.query('UPDATE usuarios SET tema = $1 WHERE id = $2', [tema, req.user.id]);
    res.json({ ok: true, tema });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;







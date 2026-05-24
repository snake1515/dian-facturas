const express = require('express');
const { pool } = require('../models/db');
const { authMiddleware, adminOnly } = require('../middleware/auth');

const router = express.Router();

// Obtener toda la configuración
router.get('/', authMiddleware, adminOnly, async (req, res) => {
  try {
    const result = await pool.query('SELECT clave, valor FROM configuracion');
    const cfg = {};
    result.rows.forEach(r => { cfg[r.clave] = r.valor; });
    res.json(cfg);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Actualizar configuración
router.put('/', authMiddleware, adminOnly, async (req, res) => {
  try {
    const updates = req.body;
    for (const [clave, valor] of Object.entries(updates)) {
      await pool.query(
        'INSERT INTO configuracion (clave, valor) VALUES ($1, $2) ON CONFLICT (clave) DO UPDATE SET valor = $2',
        [clave, String(valor)]
      );
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

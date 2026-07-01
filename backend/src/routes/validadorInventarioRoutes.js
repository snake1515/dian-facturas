// backend/src/routes/validadorInventarioRoutes.js
// PostgreSQL — mismo patrón que las demás rutas del proyecto

const express = require('express');
const router = express.Router();
const { pool } = require('../models/db');
const { authMiddleware } = require('../middleware/auth');

// ── GET /api/validador-inventario?bodega=BV ──────────────────────────────────
// Lista los items guardados de una bodega
router.get('/', authMiddleware, async (req, res) => {
  try {
    const bodega = (req.query.bodega || 'BV').toUpperCase();
    const { rows } = await pool.query(
      `SELECT * FROM validador_inventario WHERE bodega = $1 ORDER BY nombre ASC, fecha_vencimiento ASC`,
      [bodega]
    );
    res.json(rows);
  } catch (err) {
    console.error('Error al listar validador de inventario:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── POST /api/validador-inventario/importar ───────────────────────────────────
// Sube o actualiza el Excel del sistema (SIIS). UPSERT por (bodega, codigo, lote,
// fecha_vencimiento): solo actualiza nombre y existencia_sistema — NUNCA toca
// cantidad_fisica/contado, así no se pierde el avance de lo ya contado.
router.post('/importar', authMiddleware, async (req, res) => {
  const { bodega, items } = req.body;
  if (!bodega || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'bodega e items son requeridos' });
  }
  const bod = String(bodega).toUpperCase();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const it of items) {
      if (!it.codigo) continue;
      await client.query(
        `INSERT INTO validador_inventario (bodega, codigo, nombre, lote, fecha_vencimiento, existencia_sistema, costo_unitario, costo_total)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (bodega, codigo, lote, fecha_vencimiento)
         DO UPDATE SET
           nombre             = EXCLUDED.nombre,
           existencia_sistema = EXCLUDED.existencia_sistema,
           costo_unitario     = EXCLUDED.costo_unitario,
           costo_total        = EXCLUDED.costo_total,
           actualizado_en     = NOW()`,
        [bod, String(it.codigo).trim(), String(it.nombre || '').trim(), String(it.lote || '').trim(), String(it.fecha_vencimiento || '').trim(), it.existencia_sistema || 0, it.costo_unitario || 0, it.costo_total || 0]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error al importar validador de inventario:', err);
    return res.status(500).json({ error: 'Error interno del servidor' });
  } finally {
    client.release();
  }

  try {
    const { rows } = await pool.query(
      `SELECT * FROM validador_inventario WHERE bodega = $1 ORDER BY nombre ASC, fecha_vencimiento ASC`,
      [bod]
    );
    res.json(rows);
  } catch (err) {
    console.error('Error al recargar validador de inventario:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── PATCH /api/validador-inventario/:id ───────────────────────────────────────
// Guarda el conteo físico individual de un item (botón "Guardar" por fila)
router.patch('/:id', authMiddleware, async (req, res) => {
  try {
    const { cantidad_fisica } = req.body;
    if (cantidad_fisica === undefined || cantidad_fisica === null || cantidad_fisica === '') {
      return res.status(400).json({ error: 'cantidad_fisica requerida' });
    }
    const { rows } = await pool.query(
      `UPDATE validador_inventario
       SET cantidad_fisica = $1, contado = true, contado_por = $2, contado_en = NOW()
       WHERE id = $3
       RETURNING *`,
      [cantidad_fisica, req.user.id, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Item no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Error al guardar conteo:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── PATCH /api/validador-inventario/:id/reset ─────────────────────────────────
// Deshace el conteo de un item (por si se marcó por error)
router.patch('/:id/reset', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE validador_inventario
       SET cantidad_fisica = NULL, contado = false, contado_por = NULL, contado_en = NULL
       WHERE id = $1
       RETURNING *`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Item no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Error al reiniciar conteo:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

module.exports = router;


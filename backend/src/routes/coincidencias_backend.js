const express = require('express');
const { pool } = require('../models/db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// ── GET /api/coincidencias — listar pendientes de revisión ───────────────────
router.get('/', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT c.*, f.numero AS numero_manual, f.proveedor_nombre AS proveedor_manual,
             f.estado_contable, f.documento_ingreso, f.notas
      FROM coincidencias_gmail c
      JOIN facturas f ON f.id = c.factura_manual_id
      WHERE c.revisada = false
      ORDER BY c.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/coincidencias/:id/aceptar — fusiona datos de Gmail en la factura manual ──
router.put('/:id/aceptar', authMiddleware, async (req, res) => {
  try {
    const coinc = await pool.query('SELECT * FROM coincidencias_gmail WHERE id = $1', [req.params.id]);
    if (!coinc.rows.length) return res.status(404).json({ error: 'Coincidencia no encontrada' });
    const c = coinc.rows[0];

    // Actualizar la factura manual con los datos más completos del XML/Gmail,
    // SIN tocar estado_contable, documento_ingreso, notas ni responsables
    await pool.query(
      `UPDATE facturas SET
        cufe = $1, pdf_path = $2, xml_path = $3, xml_raw = $4,
        forma_pago = $5, gmail_message_id = $6, origen = 'gmail'
       WHERE id = $7`,
      [c.cufe, c.pdf_path, c.xml_path, c.xml_raw, c.forma_pago, c.gmail_message_id, c.factura_manual_id]
    );

    // Reemplazar productos con los del XML si vienen
    const productos = c.productos_json || [];
    if (productos.length > 0) {
      await pool.query('DELETE FROM productos_factura WHERE factura_id = $1', [c.factura_manual_id]);
      for (const p of productos) {
        await pool.query(
          'INSERT INTO productos_factura (factura_id, codigo, descripcion, cantidad, precio_unitario, total) VALUES ($1,$2,$3,$4,$5,$6)',
          [c.factura_manual_id, p.codigo, p.descripcion, p.cantidad, p.precioUnitario, p.total]
        );
      }
    }

    await pool.query('UPDATE coincidencias_gmail SET revisada = true, accion = $1 WHERE id = $2', ['aceptada', req.params.id]);

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/coincidencias/:id/ignorar — descarta la coincidencia ─────────────
router.put('/:id/ignorar', authMiddleware, async (req, res) => {
  try {
    await pool.query('UPDATE coincidencias_gmail SET revisada = true, accion = $1 WHERE id = $2', ['ignorada', req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

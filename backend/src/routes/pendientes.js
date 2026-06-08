const express = require('express');
const { pool } = require('../models/db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// Middleware: solo admin, editor, obra pueden editar
const puedeEditar = (req, res, next) => {
  const rol = req.user?.rol;
  if (!['admin', 'editor', 'obra'].includes(rol)) {
    return res.status(403).json({ error: 'Sin permiso para editar productos pendientes' });
  }
  next();
};

// ── GET /api/pendientes/factura/:numero ───────────────────────────────────────
// Busca factura por número y devuelve sus productos con estado actual
router.get('/factura/:numero', authMiddleware, async (req, res) => {
  try {
    const { numero } = req.params;

    const facturaRes = await pool.query(
      `SELECT id, numero, tipo, proveedor_nombre, proveedor_nit, fecha_emision, total
       FROM facturas WHERE numero ILIKE $1 AND tipo = 'FE' LIMIT 1`,
      [numero]
    );

    if (!facturaRes.rows.length) {
      return res.status(404).json({ error: 'Factura no encontrada' });
    }

    const factura = facturaRes.rows[0];

    const productosRes = await pool.query(
      `SELECT
         p.id,
         p.codigo,
         p.descripcion,
         p.cantidad,
         p.precio_unitario,
         p.total,
         pfe.id        AS estado_id,
         pfe.cantidad_recibida,
         pfe.nota,
         pfe.tipo_problema,
         pfe.updated_at AS estado_updated_at,
         u.nombre      AS revisado_por_nombre
       FROM productos_factura p
       LEFT JOIN productos_factura_estado pfe ON pfe.producto_id = p.id AND pfe.factura_id = $1
       LEFT JOIN usuarios u ON u.id = pfe.revisado_por
       WHERE p.factura_id = $1
       ORDER BY p.id`,
      [factura.id]
    );

    res.json({ factura, productos: productosRes.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ── GET /api/pendientes ───────────────────────────────────────────────────────
// Lista todas las facturas que tienen al menos un producto con problema
router.get('/', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT
        f.id,
        f.numero,
        f.proveedor_nombre,
        f.proveedor_nit,
        f.fecha_emision,
        f.total,
        COUNT(p.id)                                          AS total_productos,
        COUNT(pfe.id) FILTER (WHERE pfe.nota IS NOT NULL
          OR (pfe.cantidad_recibida IS NOT NULL
              AND pfe.cantidad_recibida < p.cantidad))       AS productos_con_problema,
        COUNT(p.id) FILTER (WHERE pfe.id IS NULL)            AS productos_sin_revisar
      FROM facturas f
      JOIN productos_factura p ON p.factura_id = f.id
      LEFT JOIN productos_factura_estado pfe
             ON pfe.producto_id = p.id AND pfe.factura_id = f.id
      WHERE f.tipo = 'FE'
        AND (
          pfe.nota IS NOT NULL
          OR (pfe.cantidad_recibida IS NOT NULL AND pfe.cantidad_recibida < p.cantidad)
        )
      GROUP BY f.id
      ORDER BY f.fecha_emision DESC
    `);

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ── PUT /api/pendientes/producto/:productoId ──────────────────────────────────
// Guarda o actualiza el estado de un producto (cantidad recibida + nota)
router.put('/producto/:productoId', authMiddleware, puedeEditar, async (req, res) => {
  try {
    const { productoId } = req.params;
    const { cantidad_recibida, nota, factura_id } = req.body;

    if (!factura_id) return res.status(400).json({ error: 'factura_id requerido' });

    // Verificar que el producto pertenece a la factura
    const check = await pool.query(
      'SELECT id, cantidad FROM productos_factura WHERE id = $1 AND factura_id = $2',
      [productoId, factura_id]
    );
    if (!check.rows.length) return res.status(404).json({ error: 'Producto no encontrado' });

    const cantidadFactura = parseFloat(check.rows[0].cantidad);
    const cantRecibida = cantidad_recibida !== undefined ? parseFloat(cantidad_recibida) : null;

    // Si cantidad_recibida >= cantidad factura Y no hay nota → eliminar el estado (resuelto)
    if (cantRecibida !== null && cantRecibida >= cantidadFactura && !nota) {
      await pool.query(
        'DELETE FROM productos_factura_estado WHERE producto_id = $1 AND factura_id = $2',
        [productoId, factura_id]
      );
      return res.json({ ok: true, resuelto: true });
    }

    const { tipo_problema } = req.body;

    // Upsert del estado
    await pool.query(
      `INSERT INTO productos_factura_estado
         (factura_id, producto_id, cantidad_recibida, nota, tipo_problema, revisado_por, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (factura_id, producto_id)
       DO UPDATE SET
         cantidad_recibida = $3,
         nota              = $4,
         tipo_problema     = $5,
         revisado_por      = $6,
         updated_at        = NOW()`,
      [factura_id, productoId, cantRecibida, nota || null, tipo_problema || null, req.user.id]
    );

    res.json({ ok: true, resuelto: false });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al guardar estado del producto' });
  }
});

// ── DELETE /api/pendientes/producto/:productoId ───────────────────────────────
// Marca producto como resuelto (borra el estado de problema)
router.delete('/producto/:productoId', authMiddleware, puedeEditar, async (req, res) => {
  try {
    const { productoId } = req.params;
    const { factura_id } = req.body;
    await pool.query(
      'DELETE FROM productos_factura_estado WHERE producto_id = $1 AND factura_id = $2',
      [productoId, factura_id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al resolver producto' });
  }
});

// ── GET /api/pendientes/factura/:facturaId/no-facturados ─────────────────────
router.get('/factura/:facturaId/no-facturados', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM productos_no_facturados WHERE factura_id = $1 ORDER BY created_at`,
      [req.params.facturaId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ── POST /api/pendientes/no-facturado ─────────────────────────────────────────
router.post('/no-facturado', authMiddleware, puedeEditar, async (req, res) => {
  try {
    const { factura_id, descripcion, cantidad, tipo_problema, nota } = req.body;
    if (!factura_id || !descripcion) return res.status(400).json({ error: 'Datos incompletos' });
    const result = await pool.query(
      `INSERT INTO productos_no_facturados (factura_id, descripcion, cantidad, tipo_problema, nota, registrado_por)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [factura_id, descripcion, cantidad || null, tipo_problema || 'no_facturado', nota || null, req.user.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al guardar' });
  }
});

// ── DELETE /api/pendientes/no-facturado/:id ───────────────────────────────────
router.delete('/no-facturado/:id', authMiddleware, puedeEditar, async (req, res) => {
  try {
    await pool.query('DELETE FROM productos_no_facturados WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar' });
  }
});

// ── PUT /api/pendientes/no-facturado/:id ──────────────────────────────────────
router.put('/no-facturado/:id', authMiddleware, puedeEditar, async (req, res) => {
  try {
    const { descripcion, cantidad, tipo_problema, nota } = req.body;
    const result = await pool.query(
      `UPDATE productos_no_facturados SET descripcion=$1, cantidad=$2, tipo_problema=$3, nota=$4 WHERE id=$5 RETURNING *`,
      [descripcion, cantidad || null, tipo_problema || null, nota || null, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar' });
  }
});

module.exports = router;


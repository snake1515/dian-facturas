const express = require('express');
const { pool } = require('../models/db');
const { verificarToken } = require('../middleware/auth');

const router = express.Router();

// ── GET /api/facturas ─────────────────────────────────────────────────────────
router.get('/', verificarToken, async (req, res) => {
  try {
    const { tipo, search, estado } = req.query;

    const condiciones = [];
    const valores = [];
    let i = 1;

    if (tipo) {
      condiciones.push(`f.tipo = $${i++}`);
      valores.push(tipo);
    }

    if (estado) {
      condiciones.push(`f.estado = $${i++}`);
      valores.push(estado);
    }

    if (search) {
      condiciones.push(`(
        f.proveedor_nombre ILIKE $${i}
        OR f.numero ILIKE $${i}
        OR f.estado_contable ILIKE $${i}
        OR f.documento_ingreso ILIKE $${i}
        OR f.proveedor_nit ILIKE $${i}
        OR f.responsables::text ILIKE $${i}
      )`);
      valores.push(`%${search}%`);
      i++;
    }

    const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';

    const query = `
      SELECT
        f.id,
        f.tipo,
        f.numero,
        f.proveedor_nombre,
        f.proveedor_nit,
        f.fecha_emision,
        f.total,
        f.estado,
        f.estado_contable,
        f.documento_ingreso,
        f.responsables,
        f.reenviado_a,
        f.subtotal,
        f.impuestos,
        f.descuentos,
        f.moneda,
        f.notas,
        f.created_at
      FROM facturas f
      ${where}
      ORDER BY f.fecha_emision DESC, f.created_at DESC
    `;

    const result = await pool.query(query, valores);
    res.json(result.rows);
  } catch (err) {
    console.error('Error al listar facturas:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── GET /api/facturas/contactos/lista ─────────────────────────────────────────
router.get('/contactos/lista', verificarToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM contactos ORDER BY nombre ASC');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al listar contactos' });
  }
});

// ── POST /api/facturas/contactos ──────────────────────────────────────────────
router.post('/contactos', verificarToken, async (req, res) => {
  try {
    const { email, nombre } = req.body;
    const result = await pool.query(
      'INSERT INTO contactos (email, nombre) VALUES ($1, $2) RETURNING *',
      [email, nombre]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al crear contacto' });
  }
});

// ── DELETE /api/facturas/contactos/:id ────────────────────────────────────────
router.delete('/contactos/:id', verificarToken, async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM contactos WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar contacto' });
  }
});

// ── GET /api/facturas/:id ─────────────────────────────────────────────────────
router.get('/:id', verificarToken, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT * FROM facturas WHERE id = $1', [id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Factura no encontrada' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── GET /api/facturas/:id/pdf ─────────────────────────────────────────────────
router.get('/:id/pdf', verificarToken, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT pdf_path FROM facturas WHERE id = $1', [id]);
    if (!result.rows.length || !result.rows[0].pdf_path) {
      return res.status(404).json({ error: 'PDF no disponible' });
    }
    res.sendFile(result.rows[0].pdf_path);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── GET /api/facturas/:id/xml ─────────────────────────────────────────────────
router.get('/:id/xml', verificarToken, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT xml_path FROM facturas WHERE id = $1', [id]);
    if (!result.rows.length || !result.rows[0].xml_path) {
      return res.status(404).json({ error: 'XML no disponible' });
    }
    res.sendFile(result.rows[0].xml_path);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── PUT /api/facturas/:id/responsables ────────────────────────────────────────
router.put('/:id/responsables', verificarToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { emails } = req.body;
    await pool.query(
      'UPDATE facturas SET responsables = $1 WHERE id = $2',
      [JSON.stringify(emails), id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar responsables' });
  }
});

// ── PUT /api/facturas/:id/estado-contable ─────────────────────────────────────
router.put('/:id/estado-contable', verificarToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { estado_contable } = req.body;
    await pool.query(
      'UPDATE facturas SET estado_contable = $1 WHERE id = $2',
      [estado_contable, id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar estado contable' });
  }
});

// ── PUT /api/facturas/:id/documento-ingreso ───────────────────────────────────
router.put('/:id/documento-ingreso', verificarToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { documento_ingreso } = req.body;
    await pool.query(
      'UPDATE facturas SET documento_ingreso = $1 WHERE id = $2',
      [documento_ingreso, id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar documento de ingreso' });
  }
});

// ── POST /api/facturas/:id/reenviar ───────────────────────────────────────────
router.post('/:id/reenviar', verificarToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { destinatarios } = req.body;
    const emailsStr = destinatarios.map(d => d.email || d).join(', ');
    await pool.query(
      `UPDATE facturas SET estado = 'reenviado', reenviado_a = $1 WHERE id = $2`,
      [emailsStr, id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al reenviar factura' });
  }
});

// ── DELETE /api/facturas/:id ──────────────────────────────────────────────────
router.delete('/:id', verificarToken, async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM facturas WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar factura' });
  }
});

// ── DELETE /api/facturas (por rango de fechas) ────────────────────────────────
router.delete('/', verificarToken, async (req, res) => {
  try {
    const { desde, hasta, tipo } = req.body;
    const condiciones = [`fecha_emision BETWEEN $1 AND $2`];
    const valores = [desde, hasta];

    if (tipo) {
      condiciones.push(`tipo = $3`);
      valores.push(tipo);
    }

    const result = await pool.query(
      `DELETE FROM facturas WHERE ${condiciones.join(' AND ')}`,
      valores
    );
    res.json({ eliminadas: result.rowCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar por fechas' });
  }
});

module.exports = router;

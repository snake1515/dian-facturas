const express = require('express');
const { reenviarFactura } = require('../services/emailService');
const { pool } = require('../models/db');
const { authMiddleware } = require('../middleware/auth');
const { descargarArchivo } = require('../services/storageService');

const router = express.Router();

// ── GET /api/facturas ─────────────────────────────────────────────────────────
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { tipo, search, estado, estado_contable } = req.query;

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

    if (estado_contable) {
      condiciones.push(`f.estado_contable = $${i++}`);
      valores.push(estado_contable);
    }

    if (search) {
      condiciones.push(`(
        f.proveedor_nombre ILIKE $${i}
        OR f.numero ILIKE $${i}
        OR f.estado_contable ILIKE $${i}
        OR f.documento_ingreso ILIKE $${i}
        OR f.proveedor_nit ILIKE $${i}
        OR f.notas ILIKE $${i}
        OR f.total::text ILIKE $${i}
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
        f.cufe,
        f.proveedor_nombre,
        f.proveedor_nit,
        f.fecha_emision,
        f.fecha_vencimiento,
        f.subtotal,
        f.iva,
        f.total,
        f.estado,
        f.estado_contable,
        f.flujo_tipo,
        f.documento_ingreso,
        f.reenviado_a,
        f.pdf_path,
        f.xml_path,
        f.gmail_message_id,
        f.notas,
        f.es_contrato,
        f.created_at,
        EXISTS(
          SELECT 1 FROM facturas nc
          WHERE nc.tipo = 'NC' AND nc.documento_ingreso = f.numero
        ) AS tiene_nc,
        EXISTS(
          SELECT 1 FROM productos_factura_estado pfe
          JOIN productos_factura p ON p.id = pfe.producto_id
          WHERE pfe.factura_id = f.id
            AND (pfe.nota IS NOT NULL OR (pfe.cantidad_recibida IS NOT NULL AND pfe.cantidad_recibida < p.cantidad))
        ) AS tiene_pendientes,
        COALESCE(
          json_agg(
            json_build_object('email', r.email, 'nombre', r.nombre)
          ) FILTER (WHERE r.email IS NOT NULL),
          '[]'
        ) AS responsables
      FROM facturas f
      LEFT JOIN responsables_factura r ON r.factura_id = f.id
      ${where}
      GROUP BY f.id
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
router.get('/contactos/lista', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM contactos ORDER BY nombre ASC');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al listar contactos' });
  }
});

// ── POST /api/facturas/contactos ──────────────────────────────────────────────
router.post('/contactos', authMiddleware, async (req, res) => {
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
router.delete('/contactos/:id', authMiddleware, async (req, res) => {
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
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`
        SELECT f.*,
          COALESCE(json_agg(DISTINCT jsonb_build_object(
            'id', p.id, 'codigo', p.codigo, 'descripcion', p.descripcion,
            'cantidad', p.cantidad, 'precioUnitario', p.precio_unitario, 'total', p.total
          )) FILTER (WHERE p.id IS NOT NULL), '[]') AS productos,
          COALESCE(json_agg(DISTINCT jsonb_build_object(
            'email', r.email, 'nombre', r.nombre
          )) FILTER (WHERE r.email IS NOT NULL), '[]') AS responsables
        FROM facturas f
        LEFT JOIN productos_factura p ON p.factura_id = f.id
        LEFT JOIN responsables_factura r ON r.factura_id = f.id
        WHERE f.id = $1
        GROUP BY f.id
      `, [id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Factura no encontrada' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── GET /api/facturas/:id/pdf ─────────────────────────────────────────────────
router.get('/:id/pdf', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT pdf_path, numero FROM facturas WHERE id = $1', [id]);
    if (!result.rows.length || !result.rows[0].pdf_path) return res.status(404).json({ error: 'PDF no disponible' });
    const buffer = await descargarArchivo(result.rows[0].pdf_path);
    const filename = `factura_${result.rows[0].numero || id}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al descargar PDF' });
  }
});

// ── GET /api/facturas/:id/xml ─────────────────────────────────────────────────
router.get('/:id/xml', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT xml_path, numero FROM facturas WHERE id = $1', [id]);
    if (!result.rows.length || !result.rows[0].xml_path) return res.status(404).json({ error: 'XML no disponible' });
    const buffer = await descargarArchivo(result.rows[0].xml_path);
    const filename = `factura_${result.rows[0].numero || id}.xml`;
    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al descargar XML' });
  }
});

// ── PUT /api/facturas/:id/responsables ────────────────────────────────────────
router.put('/:id/responsables', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { emails } = req.body;
    await pool.query('DELETE FROM responsables_factura WHERE factura_id = $1', [id]);
    for (const e of emails) {
      const email = typeof e === 'string' ? e : e.email;
      const nombre = typeof e === 'string' ? null : (e.nombre || null);
      await pool.query(
        'INSERT INTO responsables_factura (factura_id, email, nombre) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [id, email, nombre]
      );
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar responsables' });
  }
});

// ── PUT /api/facturas/:id/estado-contable ─────────────────────────────────────
router.put('/:id/estado-contable', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { estado_contable, flujo_tipo } = req.body;
    // flujo_tipo === '' significa reset explícito a NULL
    const flujoFinal = flujo_tipo === '' ? null : (flujo_tipo || null);
    const query = flujo_tipo !== undefined
      ? 'UPDATE facturas SET estado_contable = $1, flujo_tipo = $2 WHERE id = $3'
      : 'UPDATE facturas SET estado_contable = $1 WHERE id = $2';
    const params = flujo_tipo !== undefined ? [estado_contable, flujoFinal, id] : [estado_contable, id];
    await pool.query(query, params);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar estado contable' });
  }
});

// ── PUT /api/facturas/:id/documento-ingreso ───────────────────────────────────
router.put('/:id/documento-ingreso', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { documento_ingreso } = req.body;

    // Obtener tipo de la factura actual
    const self = await pool.query('SELECT tipo, numero FROM facturas WHERE id = $1', [id]);
    if (!self.rows.length) return res.status(404).json({ error: 'Factura no encontrada' });

    await pool.query('UPDATE facturas SET documento_ingreso = $1 WHERE id = $2', [documento_ingreso, id]);

    // Si es una NC, sincronizar estado de cruce en la FE referenciada
    if (self.rows[0].tipo === 'NC') {
      const numAnterior = self.rows[0].documento_ingreso;

      // Si había una FE anterior referenciada, verificar si sigue cruzada con alguna otra NC
      if (numAnterior && numAnterior !== documento_ingreso) {
        // No hay nada que actualizar en la FE — el campo tiene_nc es calculado en tiempo real
      }
      // No se requiere UPDATE extra — el subquery EXISTS en GET calcula tiene_nc dinámicamente
    }

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar documento de ingreso' });
  }
});

// ── PUT /api/facturas/:id/notas ───────────────────────────────────────────────
router.put('/:id/notas', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { notas } = req.body;
    await pool.query('UPDATE facturas SET notas = $1 WHERE id = $2', [notas, id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar notas' });
  }
});

// ── POST /api/facturas/:id/reenviar ───────────────────────────────────────────
router.post('/:id/reenviar', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { destinatarios, mensaje } = req.body;
    if (!destinatarios?.length) return res.status(400).json({ error: 'Se requiere al menos un destinatario' });

    // Enviar correo con Gmail API
    await reenviarFactura({
      facturaId: parseInt(id),
      destinatarios,
      mensaje: mensaje || '',
      usuarioId: req.user.id,
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('Error al reenviar:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/facturas/:id/contrato ───────────────────────────────────────────
router.put('/:id/contrato', authMiddleware, async (req, res) => {
  try {
    const { es_contrato } = req.body;
    await pool.query('UPDATE facturas SET es_contrato = $1 WHERE id = $2', [es_contrato, req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/facturas/:id ──────────────────────────────────────────────────
router.delete('/:id', authMiddleware, async (req, res) => {
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
router.delete('/', authMiddleware, async (req, res) => {
  try {
    const { desde, hasta, tipo } = req.body;
    const condiciones = [`fecha_emision BETWEEN $1 AND $2`];
    const valores = [desde, hasta];
    if (tipo) { condiciones.push(`tipo = $3`); valores.push(tipo); }
    const result = await pool.query(
      `DELETE FROM facturas WHERE ${condiciones.join(' AND ')}`, valores
    );
    res.json({ eliminadas: result.rowCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar por fechas' });
  }
});

module.exports = router;









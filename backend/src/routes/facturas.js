const express = require('express');
const { reenviarFactura } = require('../services/emailService');
const { pool } = require('../models/db');
const { authMiddleware } = require('../middleware/auth');
const { descargarArchivo } = require('../services/storageService');

const router = express.Router();

// ── GET /api/facturas ─────────────────────────────────────────────────────────
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { tipo, search, estado, estado_contable, origen, responsable, valor_min, valor_max } = req.query;

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

    if (origen) {
      condiciones.push(`f.origen = $${i++}`);
      valores.push(origen);
    }

    if (valor_min) {
      condiciones.push(`f.total >= $${i++}`);
      valores.push(parseFloat(valor_min));
    }

    if (valor_max) {
      condiciones.push(`f.total <= $${i++}`);
      valores.push(parseFloat(valor_max));
    }

    if (responsable) {
      condiciones.push(`EXISTS (
        SELECT 1 FROM responsables_factura rf
        WHERE rf.factura_id = f.id
        AND (rf.nombre ILIKE $${i} OR rf.email ILIKE $${i})
      )`);
      valores.push(`%${responsable}%`);
      i++;
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
        OR EXISTS (
          SELECT 1 FROM productos_factura pf
          WHERE pf.factura_id = f.id
          AND (pf.descripcion ILIKE $${i} OR pf.codigo ILIKE $${i})
        )
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
        f.forma_pago,
        f.origen,
        f.tiene_gmail,
        f.gmail_factura_id,
        f.notificacion_vista,
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

// ── GET /api/facturas/notificaciones ─────────────────────────────────────────
// Facturas manuales que ya llegaron por Gmail (campo notificacion_vista = false)
router.get('/notificaciones', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, numero, proveedor_nombre, total, gmail_factura_id
      FROM facturas
      WHERE origen = 'pdf_manual'
        AND tiene_gmail = true
        AND (notificacion_vista = false OR notificacion_vista IS NULL)
      ORDER BY created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Error al listar notificaciones:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── GET /api/facturas/coincidencias ──────────────────────────────────────────
// Coincidencias pendientes de revisión (manual subida antes de que llegara el Gmail)
router.get('/coincidencias', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        c.id,
        c.gmail_message_id,
        c.numero,
        c.cufe,
        c.proveedor_nombre,
        c.proveedor_nit,
        c.fecha_emision,
        c.total,
        c.pdf_path,
        c.xml_path,
        c.forma_pago,
        c.factura_manual_id,
        f.numero        AS numero_manual,
        f.proveedor_nombre AS proveedor_manual,
        f.estado_contable,
        f.documento_ingreso,
        f.notas
      FROM coincidencias_gmail c
      JOIN facturas f ON f.id = c.factura_manual_id
      WHERE c.revisada = false
      ORDER BY c.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Error al listar coincidencias:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── POST /api/facturas/coincidencias/:id/aceptar ─────────────────────────────
// Fusiona los datos del Gmail (XML, PDF, CUFE, forma_pago, productos) en la
// factura manual, conservando toda la gestión ya realizada (estado_contable,
// documento_ingreso, responsables, notas, es_contrato).
router.post('/coincidencias/:id/aceptar', authMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { id } = req.params;

    // Obtener la coincidencia
    const coincRes = await client.query(
      'SELECT * FROM coincidencias_gmail WHERE id = $1 AND revisada = false',
      [id]
    );
    if (!coincRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Coincidencia no encontrada o ya revisada' });
    }
    const coinc = coincRes.rows[0];

    // Actualizar la factura manual con los datos oficiales del Gmail
    await client.query(`
      UPDATE facturas SET
        cufe          = $1,
        pdf_path      = COALESCE($2, pdf_path),
        xml_path      = COALESCE($3, xml_path),
        xml_raw       = COALESCE($4, xml_raw),
        forma_pago    = COALESCE($5, forma_pago),
        subtotal      = $6,
        iva           = $7,
        total         = $8,
        fecha_emision = $9,
        fecha_vencimiento = $10,
        gmail_message_id  = $11,
        origen        = 'gmail',
        estado        = CASE WHEN estado = 'pendiente' THEN 'procesado' ELSE estado END
      WHERE id = $12
    `, [
      coinc.cufe,
      coinc.pdf_path,
      coinc.xml_path,
      coinc.xml_raw,
      coinc.forma_pago,
      coinc.subtotal,
      coinc.iva,
      coinc.total,
      coinc.fecha_emision,
      coinc.fecha_vencimiento,
      coinc.gmail_message_id,
      coinc.factura_manual_id,
    ]);

    // Reemplazar productos si el Gmail los trajo
    if (coinc.productos_json) {
      let productos = [];
      try { productos = JSON.parse(coinc.productos_json); } catch { /* sin productos */ }

      if (productos.length > 0) {
        await client.query('DELETE FROM productos_factura WHERE factura_id = $1', [coinc.factura_manual_id]);

        const placeholders = productos.map((_, i) =>
          `($1, $${i * 5 + 2}, $${i * 5 + 3}, $${i * 5 + 4}, $${i * 5 + 5}, $${i * 5 + 6})`
        ).join(', ');

        await client.query(
          `INSERT INTO productos_factura (factura_id, codigo, descripcion, cantidad, precio_unitario, total)
           VALUES ${placeholders}`,
          [coinc.factura_manual_id, ...productos.flatMap(p => [p.codigo, p.descripcion, p.cantidad, p.precioUnitario, p.total])]
        );
      }
    }

    // Marcar coincidencia como revisada
    await client.query(
      'UPDATE coincidencias_gmail SET revisada = true, revisada_at = NOW() WHERE id = $1',
      [id]
    );

    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error al aceptar coincidencia:', err);
    res.status(500).json({ error: 'Error al fusionar coincidencia' });
  } finally {
    client.release();
  }
});

// ── POST /api/facturas/coincidencias/:id/ignorar ──────────────────────────────
// Descarta la coincidencia sin tocar la factura manual.
router.post('/coincidencias/:id/ignorar', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'UPDATE coincidencias_gmail SET revisada = true, revisada_at = NOW() WHERE id = $1 AND revisada = false',
      [id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Coincidencia no encontrada o ya revisada' });
    res.json({ ok: true });
  } catch (err) {
    console.error('Error al ignorar coincidencia:', err);
    res.status(500).json({ error: 'Error al ignorar coincidencia' });
  }
});

// ── POST /api/facturas/:id/reemplazar-con-gmail ───────────────────────────────
// Hereda la gestión de la factura manual a la factura de Gmail y elimina la manual.
// Usado por el banner de duplicados detectados en el frontend.
router.post('/:id/reemplazar-con-gmail', authMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const manualId = req.params.id;
    const { gmailFacturaId } = req.body;

    if (!gmailFacturaId) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Se requiere gmailFacturaId' });
    }

    // Obtener la factura manual
    const manualRes = await client.query('SELECT * FROM facturas WHERE id = $1', [manualId]);
    if (!manualRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Factura manual no encontrada' });
    }
    const manual = manualRes.rows[0];

    // Verificar que la factura de Gmail existe
    const gmailRes = await client.query('SELECT id FROM facturas WHERE id = $1 AND origen = \'gmail\'', [gmailFacturaId]);
    if (!gmailRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Factura de Gmail no encontrada' });
    }

    // Heredar gestión de la manual a la de Gmail
    await client.query(`
      UPDATE facturas SET
        estado_contable    = $1,
        flujo_tipo         = $2,
        documento_ingreso  = $3,
        notas              = $4,
        es_contrato        = $5
      WHERE id = $6
    `, [
      manual.estado_contable,
      manual.flujo_tipo,
      manual.documento_ingreso,
      manual.notas,
      manual.es_contrato,
      gmailFacturaId,
    ]);

    // Mover responsables de la manual a la de Gmail
    const respRes = await client.query(
      'SELECT email, nombre FROM responsables_factura WHERE factura_id = $1',
      [manualId]
    );
    if (respRes.rows.length > 0) {
      await client.query('DELETE FROM responsables_factura WHERE factura_id = $1', [gmailFacturaId]);
      for (const r of respRes.rows) {
        await client.query(
          'INSERT INTO responsables_factura (factura_id, email, nombre) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
          [gmailFacturaId, r.email, r.nombre]
        );
      }
    }

    // Eliminar la factura manual (cascade elimina sus responsables y productos)
    await client.query('DELETE FROM facturas WHERE id = $1', [manualId]);

    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error al reemplazar con Gmail:', err);
    res.status(500).json({ error: 'Error al reemplazar factura' });
  } finally {
    client.release();
  }
});

// ── POST /api/facturas/:id/descartar-notificacion ────────────────────────────
// Marca notificacion_vista = true para que el banner no vuelva a aparecer.
router.post('/:id/descartar-notificacion', authMiddleware, async (req, res) => {
  try {
    await pool.query(
      'UPDATE facturas SET notificacion_vista = true WHERE id = $1',
      [req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('Error al descartar notificación:', err);
    res.status(500).json({ error: 'Error al descartar notificación' });
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
    const self = await pool.query('SELECT tipo, numero FROM facturas WHERE id = $1', [id]);
    if (!self.rows.length) return res.status(404).json({ error: 'Factura no encontrada' });
    await pool.query('UPDATE facturas SET documento_ingreso = $1 WHERE id = $2', [documento_ingreso, id]);
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


























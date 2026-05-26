const express = require('express');
const path = require('path');
const fs = require('fs');
const { pool } = require('../models/db');
const { authMiddleware, adminOnly } = require('../middleware/auth');
const { reenviarFactura } = require('../services/emailService');

const router = express.Router();

// Listar facturas con productos y responsables
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { tipo, estado, search, desde, hasta } = req.query;

    let where = [];
    let params = [];
    let idx = 1;

    if (tipo) { where.push(`f.tipo = $${idx++}`); params.push(tipo); }
    if (estado) { where.push(`f.estado = $${idx++}`); params.push(estado); }
    if (search) {
      where.push(`(f.proveedor_nombre ILIKE $${idx} OR f.numero ILIKE $${idx})`);
      params.push(`%${search}%`); idx++;
    }
    if (desde) { where.push(`f.fecha_emision >= $${idx++}`); params.push(desde); }
    if (hasta) { where.push(`f.fecha_emision <= $${idx++}`); params.push(hasta); }

    const whereSQL = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const result = await pool.query(
      `SELECT 
        f.*,
        COALESCE(json_agg(DISTINCT jsonb_build_object(
          'id', p.id, 'codigo', p.codigo, 'descripcion', p.descripcion,
          'cantidad', p.cantidad, 'precioUnitario', p.precio_unitario, 'total', p.total
        )) FILTER (WHERE p.id IS NOT NULL), '[]') AS productos,
        COALESCE(json_agg(DISTINCT r.email) FILTER (WHERE r.email IS NOT NULL), '[]') AS responsables
       FROM facturas f
       LEFT JOIN productos_factura p ON p.factura_id = f.id
       LEFT JOIN responsables_factura r ON r.factura_id = f.id
       ${whereSQL}
       GROUP BY f.id
       ORDER BY f.fecha_emision DESC, f.id DESC`,
      params
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Obtener una factura por ID
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT f.*,
        COALESCE(json_agg(DISTINCT jsonb_build_object(
          'id', p.id, 'codigo', p.codigo, 'descripcion', p.descripcion,
          'cantidad', p.cantidad, 'precioUnitario', p.precio_unitario, 'total', p.total
        )) FILTER (WHERE p.id IS NOT NULL), '[]') AS productos,
        COALESCE(json_agg(DISTINCT r.email) FILTER (WHERE r.email IS NOT NULL), '[]') AS responsables
       FROM facturas f
       LEFT JOIN productos_factura p ON p.factura_id = f.id
       LEFT JOIN responsables_factura r ON r.factura_id = f.id
       WHERE f.id = $1
       GROUP BY f.id`,
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Factura no encontrada' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Actualizar responsables de una factura
router.put('/:id/responsables', authMiddleware, async (req, res) => {
  try {
    const { emails } = req.body;
    const facturaId = req.params.id;

    await pool.query('DELETE FROM responsables_factura WHERE factura_id = $1', [facturaId]);

    for (const email of (emails || [])) {
      if (email?.includes('@')) {
        await pool.query(
          'INSERT INTO responsables_factura (factura_id, email) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [facturaId, email.trim()]
        );
      }
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reenviar factura por correo
router.post('/:id/reenviar', authMiddleware, async (req, res) => {
  try {
    const { destinatarios, mensaje } = req.body;
    if (!destinatarios?.length) return res.status(400).json({ error: 'Se requiere al menos un destinatario' });

    await reenviarFactura({
      facturaId: parseInt(req.params.id),
      destinatarios,
      mensaje,
      usuarioId: req.user.id,
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Eliminar una factura (solo admin)
router.delete('/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const factRes = await pool.query('SELECT pdf_path, xml_path FROM facturas WHERE id = $1', [req.params.id]);
    if (!factRes.rows.length) return res.status(404).json({ error: 'Factura no encontrada' });

    const { pdf_path, xml_path } = factRes.rows[0];
    const uploadDir = path.join(__dirname, '../../uploads');

    [pdf_path, xml_path].forEach(f => {
      if (f) {
        const full = path.join(uploadDir, f);
        if (fs.existsSync(full)) fs.unlinkSync(full);
      }
    });

    await pool.query('DELETE FROM facturas WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Borrado masivo por rango de fechas (solo admin)
router.delete('/', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { desde, hasta, tipo } = req.body;
    if (!desde || !hasta) return res.status(400).json({ error: 'Fechas requeridas' });

    let where = ['fecha_emision >= $1', 'fecha_emision <= $2'];
    let params = [desde, hasta];

    if (tipo) { where.push(`tipo = $3`); params.push(tipo); }

    // Obtener archivos a eliminar
    const archivos = await pool.query(
      `SELECT pdf_path, xml_path FROM facturas WHERE ${where.join(' AND ')}`,
      params
    );

    const uploadDir = path.join(__dirname, '../../uploads');
    archivos.rows.forEach(({ pdf_path, xml_path }) => {
      [pdf_path, xml_path].forEach(f => {
        if (f) {
          const full = path.join(uploadDir, f);
          if (fs.existsSync(full)) fs.unlinkSync(full);
        }
      });
    });

    const del = await pool.query(
      `DELETE FROM facturas WHERE ${where.join(' AND ')} RETURNING id`,
      params
    );

    res.json({ ok: true, eliminadas: del.rows.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Descargar PDF adjunto desde Supabase Storage
router.get('/:id/pdf', authMiddleware, async (req, res) => {
  try {
    const { descargarArchivo } = require('../services/storageService');
    const result = await pool.query('SELECT pdf_path FROM facturas WHERE id = $1', [req.params.id]);
    if (!result.rows.length || !result.rows[0].pdf_path) {
      return res.status(404).json({ error: 'PDF no disponible' });
    }
    const buffer = await descargarArchivo(result.rows[0].pdf_path);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="' + result.rows[0].pdf_path + '"');
    res.send(buffer);
  } catch (err) {
    res.status(404).json({ error: 'Archivo no encontrado: ' + err.message });
  }
});

// Descargar XML adjunto desde Supabase Storage
router.get('/:id/xml', authMiddleware, async (req, res) => {
  try {
    const { descargarArchivo } = require('../services/storageService');
    const result = await pool.query('SELECT xml_path FROM facturas WHERE id = $1', [req.params.id]);
    if (!result.rows.length || !result.rows[0].xml_path) {
      return res.status(404).json({ error: 'XML no disponible' });
    }
    const buffer = await descargarArchivo(result.rows[0].xml_path);
    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Content-Disposition', 'attachment; filename="' + result.rows[0].xml_path + '"');
    res.send(buffer);
  } catch (err) {
    res.status(404).json({ error: 'Archivo no encontrado: ' + err.message });
  }
});
// Actualizar estado contable
router.put('/:id/estado-contable', authMiddleware, async (req, res) => {
  try {
    const { estado_contable } = req.body;
    const valores = ['por_gestionar', 'recibio_inventarios', 'recibio_contabilidad', 'aprobado'];
    if (!valores.includes(estado_contable)) {
      return res.status(400).json({ error: 'Estado inválido' });
    }
    await pool.query(
      'UPDATE facturas SET estado_contable = $1 WHERE id = $2',
      [estado_contable, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
module.exports = router;

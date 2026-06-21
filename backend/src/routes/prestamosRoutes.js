// backend/src/routes/prestamosRoutes.js
// PostgreSQL — mismo patrón que las demás rutas del proyecto

const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { pool } = require('../models/db');
const storageService = require('../services/storageService');

// ─── Multer en memoria → Supabase Storage ───────────────────────────────────
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

async function subirPDF(file, carpeta) {
  if (!file) return null;
  const filename = `prestamos/${carpeta}/${Date.now()}_${file.originalname}`;
  await storageService.subirArchivo(file.buffer, filename, file.mimetype);
  const SUPABASE_URL = process.env.SUPABASE_URL;
  return `${SUPABASE_URL}/storage/v1/object/public/facturas/${filename}`;
}

// Servir PDFs e imágenes desde Supabase Storage
router.get('/soporte/:carpeta/:filename', async (req, res) => {
  try {
    const filepath = `prestamos/${req.params.carpeta}/${req.params.filename}`;
    const buffer = await storageService.descargarArchivo(filepath);
    
    // Detectar tipo de archivo por extensión
    const ext = path.extname(req.params.filename).toLowerCase();
    let contentType = 'application/pdf';
    if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
    if (ext === '.png') contentType = 'image/png';
    if (ext === '.gif') contentType = 'image/gif';
    if (ext === '.webp') contentType = 'image/webp';
    
    res.setHeader('Content-Type', contentType);
    res.send(buffer);
  } catch (e) { res.status(404).json({ error: 'Archivo no encontrado' }); }
});

// ═══════════════════════════════════════════════════════════════════════════
//  CLÍNICAS
// ═══════════════════════════════════════════════════════════════════════════

router.get('/clinicas', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM prestamo_clinicas ORDER BY nombre ASC');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/clinicas', async (req, res) => {
  try {
    const { nombre, ciudad, contacto } = req.body;
    if (!nombre) return res.status(400).json({ error: 'nombre requerido' });
    const { rows } = await pool.query(
      'INSERT INTO prestamo_clinicas (nombre) VALUES ($1) RETURNING *',
      [nombre]
    );
    res.status(201).json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/clinicas/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM prestamo_clinicas WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════
//  PRODUCTOS
// ═══════════════════════════════════════════════════════════════════════════

router.get('/productos', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM prestamo_productos ORDER BY nombre ASC');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Carga masiva desde Excel
router.post('/productos/bulk', async (req, res) => {
  try {
    const { rows } = req.body;
    if (!Array.isArray(rows) || rows.length === 0)
      return res.status(400).json({ error: 'rows requerido' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const item of rows) {
        await client.query(`
          INSERT INTO prestamo_productos (codigo, nombre, unidad, precio_unitario, categoria, cuenta_contable)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (codigo) DO UPDATE SET
            nombre          = EXCLUDED.nombre,
            unidad          = EXCLUDED.unidad,
            precio_unitario = EXCLUDED.precio_unitario,
            categoria       = EXCLUDED.categoria,
            cuenta_contable = EXCLUDED.cuenta_contable
        `, [item.codigo, item.nombre, item.unidad || null, item.precio_unitario || 0, item.categoria || null, item.cuenta_contable || null]);
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    const { rows: updated } = await pool.query('SELECT * FROM prestamo_productos ORDER BY nombre ASC');
    res.json(updated);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════
//  PRÉSTAMOS
// ═══════════════════════════════════════════════════════════════════════════

router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM prestamos ORDER BY created_at DESC');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', upload.single('soporte'), async (req, res) => {
  try {
    const {
      tipo, clinica_id, clinica_nombre,
      bodega_codigo, bodega_nombre,
      fecha, documento_contable, observaciones, items,
    } = req.body;

    if (!tipo || !fecha || !documento_contable)
      return res.status(400).json({ error: 'tipo, fecha y documento_contable son requeridos' });

    const soporte_url = req.file ? await subirPDF(req.file, 'documentos') : null;
    const itemsParsed = typeof items === 'string' ? JSON.parse(items) : (items || []);

    const { rows } = await pool.query(`
      INSERT INTO prestamos
        (tipo, clinica_id, clinica_nombre, bodega_codigo, bodega_nombre,
         fecha, documento_contable, observaciones, soporte_url, items, estado)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'abierto')
      RETURNING *
    `, [
      tipo,
      clinica_id || null,
      clinica_nombre || null,
      bodega_codigo || null,
      bodega_nombre || null,
      fecha,
      documento_contable,
      observaciones || null,
      soporte_url,
      JSON.stringify(itemsParsed),
    ]);

    res.status(201).json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});


// Actualizar precio de un producto
router.patch('/productos/:id', async (req, res) => {
  try {
    const { precio_unitario } = req.body;
    const { rows } = await pool.query(
      'UPDATE prestamo_productos SET precio_unitario = $1 WHERE id = $2 RETURNING *',
      [precio_unitario, req.params.id]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Limpiar tabla productos
router.delete('/productos/clear', async (req, res) => {
  try {
    await pool.query('DELETE FROM prestamo_productos');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/:id', async (req, res) => {
  try {
    const { estado } = req.body;
    const { rows } = await pool.query(
      'UPDATE prestamos SET estado = $1 WHERE id = $2 RETURNING *',
      [estado, req.params.id]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════
//  DEVOLUCIONES
// ═══════════════════════════════════════════════════════════════════════════

router.get('/devoluciones', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM prestamo_devoluciones ORDER BY fecha DESC');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/devoluciones', upload.single('soporte'), async (req, res) => {
  try {
    const { prestamo_id, fecha, documento_contable, items } = req.body;

    if (!prestamo_id || !fecha || !documento_contable)
      return res.status(400).json({ error: 'prestamo_id, fecha y documento_contable requeridos' });

    const soporte_url  = req.file ? await subirPDF(req.file, 'devoluciones') : null;
    const itemsParsed  = typeof items === 'string' ? JSON.parse(items) : (items || []);

    const { rows } = await pool.query(`
      INSERT INTO prestamo_devoluciones (prestamo_id, fecha, documento_contable, soporte_url, items)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [prestamo_id, fecha, documento_contable, soporte_url, JSON.stringify(itemsParsed)]);

    // Recalcular estado del préstamo padre
    const { rows: [prestamo] } = await pool.query('SELECT items FROM prestamos WHERE id = $1', [prestamo_id]);
    const itemsPrest  = prestamo?.items || [];
    const totalPrest  = itemsPrest.reduce((s, i) => s + Number(i.cantidad), 0);

    const { rows: todasDevs } = await pool.query(
      'SELECT items FROM prestamo_devoluciones WHERE prestamo_id = $1', [prestamo_id]
    );
    const totalDev = todasDevs.flatMap(d => d.items || []).reduce((s, i) => s + Number(i.cantidad), 0);

    const nuevoEstado = totalDev >= totalPrest ? 'cerrado' : 'parcial';
    await pool.query('UPDATE prestamos SET estado = $1 WHERE id = $2', [nuevoEstado, prestamo_id]);

    res.status(201).json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});


// ═══════════════════════════════════════════════════════════════════════════
//  PURGA MASIVA
// ═══════════════════════════════════════════════════════════════════════════

router.post('/purgar', async (req, res) => {
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM prestamo_cruces');
      await client.query('DELETE FROM prestamo_devoluciones');
      await client.query('DELETE FROM prestamos');
      await client.query('COMMIT');
      throw e;
    } finally {
      client.release();
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════
//  IMPORTACIÓN MASIVA DESDE EXCEL
// ═══════════════════════════════════════════════════════════════════════════
// Recibe array de documentos pre-procesados desde el frontend
// Cada documento: { tipo, documento_contable, fecha, observaciones,
//                   clinica_nombre, bodega_codigo, bodega_nombre, items[] }
router.post('/importar-masivo', async (req, res) => {
  try {
    const { documentos } = req.body;
    if (!Array.isArray(documentos) || documentos.length === 0)
      return res.status(400).json({ error: 'documentos requerido' });

    const client = await pool.connect();
    const creados = [];
    const omitidos = [];

    try {
      await client.query('BEGIN');

      for (const doc of documentos) {
        // Verificar si ya existe
        const { rows: existe } = await client.query(
          'SELECT id FROM prestamos WHERE documento_contable = $1',
          [doc.documento_contable]
        );
        if (existe.length > 0) {
          omitidos.push(doc.documento_contable);
          continue;
        }

        // Auto-crear clínica si no existe
        let clinica_id = null;
        if (doc.clinica_nombre) {
          const { rows: cl } = await client.query(
            'SELECT id FROM prestamo_clinicas WHERE UPPER(nombre) = UPPER($1)',
            [doc.clinica_nombre]
          );
          if (cl.length > 0) {
            clinica_id = cl[0].id;
          } else {
            const { rows: nueva } = await client.query(
              'INSERT INTO prestamo_clinicas (nombre) VALUES ($1) RETURNING id',
              [doc.clinica_nombre]
            );
            clinica_id = nueva[0].id;
          }
        }

        const { rows } = await client.query(`
          INSERT INTO prestamos
            (tipo, clinica_id, clinica_nombre, bodega_codigo, bodega_nombre,
             fecha, documento_contable, observaciones, items, estado)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'abierto')
          RETURNING *
        `, [
          doc.tipo,
          clinica_id,
          doc.clinica_nombre || null,
          doc.bodega_codigo || null,
          doc.bodega_nombre || null,
          doc.fecha,
          doc.documento_contable,
          doc.observaciones || null,
          JSON.stringify(doc.items || []),
        ]);
        creados.push(rows[0]);
      }

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    res.json({ creados: creados.length, omitidos: omitidos.length, omitidos_docs: omitidos, documentos: creados });
  } catch (e) { console.error('importar-masivo ERROR:', e.message); res.status(500).json({ error: e.message }); }
});


// ═══════════════════════════════════════════════════════════════════════════
//  CRUCES
// ═══════════════════════════════════════════════════════════════════════════

// Obtener todos los cruces
router.get('/cruces', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT c.*,
        p.documento_contable AS prestamo_doc,
        p.tipo               AS prestamo_tipo,
        p.clinica_nombre,
        p.items              AS prestamo_items,
        d.documento_contable AS devolucion_doc,
        d.items              AS devolucion_items
      FROM prestamo_cruces c
      JOIN prestamos p ON c.prestamo_id = p.id
      JOIN prestamos d ON c.devolucion_id = d.id
      ORDER BY c.created_at DESC
    `);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Crear cruce entre préstamo y devolución
router.post('/cruces', async (req, res) => {
  try {
    const { prestamo_id, devolucion_id, tipo_cruce, observaciones } = req.body;
    if (!prestamo_id || !devolucion_id)
      return res.status(400).json({ error: 'prestamo_id y devolucion_id requeridos' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows } = await client.query(`
        INSERT INTO prestamo_cruces (prestamo_id, devolucion_id, tipo_cruce, observaciones)
        VALUES ($1, $2, $3, $4) RETURNING *
      `, [prestamo_id, devolucion_id, tipo_cruce || 'total', observaciones || null]);

      // Recalcular estado del préstamo
      const { rows: [prest] } = await client.query(
        'SELECT items FROM prestamos WHERE id = $1', [prestamo_id]
      );
      const { rows: [devo] } = await client.query(
        'SELECT items FROM prestamos WHERE id = $1', [devolucion_id]
      );

      const itemsPrest = prest?.items || [];
      const itemsDevo  = devo?.items  || [];

      // Comparar por código y cantidad
      const totalPrest = itemsPrest.reduce((s, i) => s + Number(i.cantidad), 0);
      const totalDevo  = itemsDevo.reduce((s, i) => s + Number(i.cantidad), 0);
      const nuevoEstado = totalDevo >= totalPrest ? 'cerrado' : 'parcial';

      await client.query('UPDATE prestamos SET estado = $1 WHERE id = $2', [nuevoEstado, prestamo_id]);
      await client.query('COMMIT');
      res.status(201).json({ cruce: rows[0], estado: nuevoEstado });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Adjuntar PDF a un cruce (total o por item)
router.patch('/cruces/:id/soporte', upload.single('soporte'), async (req, res) => {
  try {
    const { item_codigo } = req.body;
    const soporte_url = req.file ? await subirPDF(req.file, 'cruces') : null;

    if (item_codigo) {
      // PDF por producto — guardar en soporte_items JSONB
      const { rows: [cruce] } = await pool.query(
        'SELECT soporte_items FROM prestamo_cruces WHERE id = $1', [req.params.id]
      );
      const soporteItems = cruce?.soporte_items || {};
      soporteItems[item_codigo] = soporte_url;
      const { rows } = await pool.query(
        'UPDATE prestamo_cruces SET soporte_items = $1 WHERE id = $2 RETURNING *',
        [JSON.stringify(soporteItems), req.params.id]
      );
      res.json(rows[0]);
    } else {
      // PDF total del cruce
      const { rows } = await pool.query(
        'UPDATE prestamo_cruces SET soporte_url = $1 WHERE id = $2 RETURNING *',
        [soporte_url, req.params.id]
      );
      res.json(rows[0]);
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Adjuntar PDF o JPG directamente a un préstamo/devolución
router.patch('/:id/soporte', upload.single('soporte'), async (req, res) => {
  try {
    const soporte_url = req.file ? await subirPDF(req.file, 'documentos') : null;
    const { rows } = await pool.query(
      'UPDATE prestamos SET soporte_url = $1 WHERE id = $2 RETURNING *',
      [soporte_url, req.params.id]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Eliminar soporte de un préstamo/devolución
router.delete('/:id/soporte', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'UPDATE prestamos SET soporte_url = NULL WHERE id = $1 RETURNING *',
      [req.params.id]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;








































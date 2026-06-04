// backend/src/routes/prestamosRoutes.js
// PostgreSQL — mismo patrón que las demás rutas del proyecto

const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { pool } = require('../models/db');

// ─── Multer para PDFs ────────────────────────────────────────────────────────
const uploadDir = path.join(__dirname, '../../uploads/prestamos');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename:    (req, file, cb) => cb(null, `${Date.now()}_${file.originalname}`),
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

function buildSoporteUrl(req, filename) {
  if (!filename) return null;
  const base = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
  return `${base}/uploads/prestamos/${filename}`;
}

// Servir PDFs estáticos
router.get('/soporte/:filename', (req, res) => {
  const filePath = path.join(uploadDir, req.params.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Archivo no encontrado' });
  res.sendFile(filePath);
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

    const soporte_url = req.file ? buildSoporteUrl(req, req.file.filename) : null;
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

    const soporte_url  = req.file ? buildSoporteUrl(req, req.file.filename) : null;
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

module.exports = router;



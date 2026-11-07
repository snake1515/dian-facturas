const express = require('express');
const { pool } = require('../models/db');
const { authMiddleware, editorOrAdmin } = require('../middleware/auth');
const { CATEGORIA_SQL, DESDE_SIN_GESTION, DIAS_SIN_GESTION, sincronizarProveedores } = require('../services/clasificacion');

const router = express.Router();
const CATEGORIAS = ['obra', 'administrativa'];
const quien = (req) => req.user?.nombre || req.user?.email || String(req.user?.id || '');

// ── GET /api/proveedores — listado con número de facturas (admin/editor) ─────
router.get('/', authMiddleware, editorOrAdmin, async (req, res) => {
  try {
    await sincronizarProveedores(true);
    const { rows } = await pool.query(`
      SELECT p.id, p.nit, p.nombre, p.categoria, p.clasificado_por, p.clasificado_en, p.created_at,
             COUNT(f.id) FILTER (WHERE f.tipo = 'FE')::int AS facturas,
             COUNT(f.id) FILTER (WHERE f.tipo = 'NC')::int AS notas_credito,
             MAX(f.fecha_emision) AS ultima_factura
      FROM proveedores p
      LEFT JOIN facturas f ON TRIM(f.proveedor_nit) = p.nit
      GROUP BY p.id
      ORDER BY (p.categoria IS NULL) DESC, p.nombre ASC`);
    res.json(rows);
  } catch (err) {
    console.error('Error listando proveedores:', err);
    res.status(500).json({ error: 'Error al listar proveedores' });
  }
});

// ── GET /api/proveedores/categorias — NIT → categoría (lectura, todos) ───────
// Lo usa el Cruce DIAN para separar en obra/administrativa las facturas que
// están en el reporte DIAN pero no en la app (se clasifican por NIT del emisor).
router.get('/categorias', authMiddleware, async (req, res) => {
  try {
    await sincronizarProveedores();
    const { rows } = await pool.query(`SELECT nit, categoria FROM proveedores`);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error consultando categorías' });
  }
});

// ── GET /api/proveedores/sin-clasificar — cuántos faltan por clasificar ──────
router.get('/sin-clasificar', authMiddleware, editorOrAdmin, async (req, res) => {
  try {
    await sincronizarProveedores();
    const { rows } = await pool.query(`SELECT COUNT(*)::int AS total FROM proveedores WHERE categoria IS NULL`);
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error contando proveedores' });
  }
});

// ── PUT /api/proveedores/:id — clasificar un proveedor ───────────────────────
router.put('/:id(\\d+)', authMiddleware, editorOrAdmin, async (req, res) => {
  try {
    const { categoria } = req.body || {};
    if (!CATEGORIAS.includes(categoria)) return res.status(400).json({ error: 'Categoría inválida' });
    const { rows } = await pool.query(
      `UPDATE proveedores SET categoria = $1, clasificado_por = $2, clasificado_en = NOW() WHERE id = $3 RETURNING *`,
      [categoria, quien(req), req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Proveedor no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al clasificar proveedor' });
  }
});

// ── POST /api/proveedores/clasificar-lote — varios proveedores a la vez ──────
router.post('/clasificar-lote', authMiddleware, editorOrAdmin, async (req, res) => {
  try {
    const { ids, categoria } = req.body || {};
    if (!CATEGORIAS.includes(categoria)) return res.status(400).json({ error: 'Categoría inválida' });
    const lista = (Array.isArray(ids) ? ids : []).map(Number).filter(Number.isInteger);
    if (!lista.length) return res.status(400).json({ error: 'Seleccione al menos un proveedor' });
    const r = await pool.query(
      `UPDATE proveedores SET categoria = $1, clasificado_por = $2, clasificado_en = NOW() WHERE id = ANY($3::int[])`,
      [categoria, quien(req), lista]);
    res.json({ ok: true, actualizados: r.rowCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al clasificar proveedores' });
  }
});

// ── PUT /api/proveedores/factura/:id/categoria — mover una factura ───────────
// categoria: 'obra' | 'administrativa' | null (null = volver a la del proveedor)
router.put('/factura/:id(\\d+)/categoria', authMiddleware, editorOrAdmin, async (req, res) => {
  try {
    const categoria = req.body?.categoria ?? null;
    if (categoria !== null && !CATEGORIAS.includes(categoria)) return res.status(400).json({ error: 'Categoría inválida' });
    const r = await pool.query(`UPDATE facturas SET categoria_manual = $1 WHERE id = $2`, [categoria, req.params.id]);
    if (!r.rowCount) return res.status(404).json({ error: 'Factura no encontrada' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al mover la factura' });
  }
});

// ── GET /api/proveedores/facturas-sin-gestion — aviso para todos ─────────────
// Facturas (FE) emitidas desde DESDE_SIN_GESTION, con más de DIAS_SIN_GESTION
// días desde la emisión, sin ninguna gestión contable y sin la nota
// "FACTURA CON NOVEDAD". De la más antigua a la más nueva.
router.get('/facturas-sin-gestion', authMiddleware, async (req, res) => {
  try {
    // Solo para quienes pueden ver facturas (no regente ni contable)
    if (!['admin', 'editor', 'obra', 'consulta', 'lector'].includes(req.user?.rol)) {
      return res.json({ dias: DIAS_SIN_GESTION, facturas: [] });
    }
    const { rows } = await pool.query(`
      SELECT f.id, f.numero, f.proveedor_nombre, f.proveedor_nit, f.fecha_emision, f.total,
             ${CATEGORIA_SQL} AS categoria
      FROM facturas f
      WHERE f.tipo = 'FE'
        AND f.fecha_emision >= $1::date
        AND f.fecha_emision < (NOW() AT TIME ZONE 'America/Bogota')::date - $2::int
        AND COALESCE(f.estado_contable, 'por_gestionar') = 'por_gestionar'
        AND f.flujo_tipo IS NULL
        AND COALESCE(f.es_contrato, false) = false
        AND COALESCE(f.notas, '') NOT LIKE '%FACTURA CON NOVEDAD%'
      ORDER BY f.fecha_emision ASC, f.id ASC`, [DESDE_SIN_GESTION, DIAS_SIN_GESTION]);
    res.json({ dias: DIAS_SIN_GESTION, facturas: rows });
  } catch (err) {
    console.error('Error en facturas sin gestión:', err);
    res.status(500).json({ error: 'Error consultando facturas sin gestión' });
  }
});

module.exports = router;

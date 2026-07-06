// backend/src/routes/validadorInventarioRoutes.js
// PostgreSQL — mismo patrón que las demás rutas del proyecto

const express = require('express');
const router = express.Router();
const { pool } = require('../models/db');
const { authMiddleware } = require('../middleware/auth');

// ── Trunca strings de forma segura para respetar los límites varchar de la BD ─
function truncar(valor, max) {
  const s = String(valor || '').trim();
  return s.length > max ? s.substring(0, max) : s;
}

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

  // Ítems válidos (con código) tal como quedarán guardados, para luego saber
  // cuáles NO vinieron en esta carga y marcarlos como sin_existencias
  const clavesCargadas = items
    .filter(it => it.codigo)
    .map(it => `${truncar(it.codigo, 50)}|${truncar(it.lote, 100)}|${truncar(it.fecha_vencimiento, 20)}`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const it of items) {
      if (!it.codigo) continue;
      await client.query(
        `INSERT INTO validador_inventario (bodega, codigo, nombre, lote, fecha_vencimiento, existencia_sistema, costo_unitario, costo_total, sin_existencias, sin_existencias_desde, ultima_carga)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false, NULL, NOW())
         ON CONFLICT (bodega, codigo, lote, fecha_vencimiento)
         DO UPDATE SET
           nombre                = EXCLUDED.nombre,
           existencia_sistema    = EXCLUDED.existencia_sistema,
           costo_unitario        = EXCLUDED.costo_unitario,
           costo_total           = EXCLUDED.costo_total,
           sin_existencias       = false,
           sin_existencias_desde = NULL,
           ultima_carga          = NOW(),
           actualizado_en        = NOW()`,
        [bod, truncar(it.codigo, 50), truncar(it.nombre, 300), truncar(it.lote, 100), truncar(it.fecha_vencimiento, 20), it.existencia_sistema || 0, it.costo_unitario || 0, it.costo_total || 0]
      );
    }

    // Marca como sin_existencias los ítems de esta bodega que NO vinieron en
    // el Excel recién cargado (no se borran, conservan su conteo/historial).
    // sin_existencias_desde solo se fija si aún no tenía fecha, así conserva
    // el momento exacto en que desapareció por primera vez.
    if (clavesCargadas.length > 0) {
      await client.query(
        `UPDATE validador_inventario
         SET sin_existencias = true,
             sin_existencias_desde = COALESCE(sin_existencias_desde, NOW())
         WHERE bodega = $1
           AND (codigo || '|' || lote || '|' || fecha_vencimiento) <> ALL($2::text[])`,
        [bod, clavesCargadas]
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

// ── PATCH /api/validador-inventario/:id/sobrante ──────────────────────────────
// Registro MANUAL (no calculado) del sobrante en libro: sobrantes antiguos
// de antes de que existiera el control de inventario físico. Independiente
// del conteo físico — se puede editar en cualquier momento.
router.patch('/:id/sobrante', authMiddleware, async (req, res) => {
  try {
    const { sobrante_libro } = req.body;
    if (sobrante_libro === undefined || sobrante_libro === null || sobrante_libro === '') {
      return res.status(400).json({ error: 'sobrante_libro requerido' });
    }
    const { rows } = await pool.query(
      `UPDATE validador_inventario
       SET sobrante_libro = $1
       WHERE id = $2
       RETURNING *`,
      [sobrante_libro, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Item no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Error al guardar sobrante en libro:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

});

// ── PATCH /api/validador-inventario/:id/tipo-diferencia ───────────────────────
// Clasificación MANUAL de la diferencia: 'real' o 'actualizacion'. Persistente
// a propósito: el UPSERT de /importar nunca toca esta columna, así que la
// elección sobrevive a nuevas cargas de Excel hasta que se cambie a mano.
router.patch('/:id/tipo-diferencia', authMiddleware, async (req, res) => {
  try {
    const { tipo_diferencia } = req.body;
    if (![null, 'real', 'actualizacion'].includes(tipo_diferencia)) {
      return res.status(400).json({ error: "tipo_diferencia debe ser 'real', 'actualizacion' o null" });
    }
    const { rows } = await pool.query(
      `UPDATE validador_inventario
       SET tipo_diferencia = $1
       WHERE id = $2
       RETURNING *`,
      [tipo_diferencia, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Item no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Error al guardar tipo de diferencia:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── DELETE /api/validador-inventario/:id ──────────────────────────────────────
// Elimina manualmente un item, solo permitido si está marcado sin_existencias
// (evita borrar por error ítems que sí siguen activos en el sistema)
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `DELETE FROM validador_inventario
       WHERE id = $1 AND sin_existencias = true
       RETURNING id`,
      [req.params.id]
    );
    if (!rows.length) {
      return res.status(400).json({ error: 'Solo se pueden eliminar ítems marcados como sin existencias' });
    }
    res.json({ ok: true, id: rows[0].id });
  } catch (err) {
    console.error('Error al eliminar item del validador de inventario:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

module.exports = router;









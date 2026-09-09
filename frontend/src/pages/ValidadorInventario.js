// backend/src/routes/validadorInventarioRoutes.js
// PostgreSQL — mismo patrón que las demás rutas del proyecto

const express = require('express');
const router = express.Router();
const ExcelJS = require('exceljs');
const { pool } = require('../models/db');
const { authMiddleware, adminOnly, editorOrAdmin } = require('../middleware/auth');

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
      `SELECT vi.*, ti.contable, ti.cuenta, concat_tipo_inventario(vi.codigo) AS concat, pi.presentacion
       FROM validador_inventario vi
       LEFT JOIN tipos_inventario ti ON ti.concat = concat_tipo_inventario(vi.codigo)
       LEFT JOIN presentaciones_inventario pi ON pi.codigo = vi.codigo
       WHERE vi.bodega = $1
       ORDER BY vi.nombre ASC, vi.fecha_vencimiento ASC`,
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
      `SELECT vi.*, ti.contable, ti.cuenta, concat_tipo_inventario(vi.codigo) AS concat, pi.presentacion
       FROM validador_inventario vi
       LEFT JOIN tipos_inventario ti ON ti.concat = concat_tipo_inventario(vi.codigo)
       LEFT JOIN presentaciones_inventario pi ON pi.codigo = vi.codigo
       WHERE vi.bodega = $1
       ORDER BY vi.nombre ASC, vi.fecha_vencimiento ASC`,
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

// ── PATCH /api/validador-inventario/:id/notas ──────────────────────────────────
// Texto libre MANUAL de observaciones por ítem. Persistente: el UPSERT de
// /importar nunca la toca, así que sobrevive a nuevas cargas de Excel.
router.patch('/:id/notas', authMiddleware, async (req, res) => {
  try {
    const { notas } = req.body;
    const { rows } = await pool.query(
      `UPDATE validador_inventario
       SET notas = $1
       WHERE id = $2
       RETURNING *`,
      [notas ?? null, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Item no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Error al guardar notas:', err);
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

// ── POST /api/validador-inventario/presentaciones/importar ────────────────────
// Carga masiva desde un Excel APARTE (no el de SIIS): { items: [{codigo, presentacion}] }.
// Solo admin. Es un UPSERT por código, independiente de bodega/lote — no toca
// nada de validador_inventario, así que se puede recargar en cualquier momento
// sin afectar el conteo físico en curso.
router.post('/presentaciones/importar', authMiddleware, adminOnly, async (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items es requerido' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let actualizados = 0;
    for (const it of items) {
      const codigo = truncar(it.codigo, 50);
      if (!codigo) continue;
      await client.query(
        `INSERT INTO presentaciones_inventario (codigo, presentacion, actualizado_por, actualizado_en)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (codigo) DO UPDATE SET
           presentacion    = EXCLUDED.presentacion,
           actualizado_por = EXCLUDED.actualizado_por,
           actualizado_en  = NOW()`,
        [codigo, truncar(it.presentacion, 200), req.user.id]
      );
      actualizados++;
    }
    await client.query('COMMIT');
    res.json({ ok: true, actualizados });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error al importar presentaciones:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  } finally {
    client.release();
  }
});

// ── PATCH /api/validador-inventario/presentaciones/:codigo ────────────────────
// Edición manual de la presentación de un código puntual. Solo admin.
router.patch('/presentaciones/:codigo', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { presentacion } = req.body;
    if (presentacion === undefined) {
      return res.status(400).json({ error: 'presentacion requerida' });
    }
    const codigo = truncar(req.params.codigo, 50);
    const { rows } = await pool.query(
      `INSERT INTO presentaciones_inventario (codigo, presentacion, actualizado_por, actualizado_en)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (codigo) DO UPDATE SET
         presentacion    = EXCLUDED.presentacion,
         actualizado_por = EXCLUDED.actualizado_por,
         actualizado_en  = NOW()
       RETURNING *`,
      [codigo, truncar(presentacion, 200), req.user.id]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('Error al guardar presentación:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── POST /api/validador-inventario/tipos-inventario/importar ──────────────────
// Carga masiva de la tabla de clasificación (CONCAT -> cuenta contable) desde
// un Excel APARTE: { items: [{concat, contable, cuenta}] }. Editor o admin.
router.post('/tipos-inventario/importar', authMiddleware, editorOrAdmin, async (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items es requerido' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let actualizados = 0;
    for (const it of items) {
      const concat = truncar(it.concat, 6).toUpperCase();
      if (!concat) continue;
      await client.query(
        `INSERT INTO tipos_inventario (concat, contable, cuenta)
         VALUES ($1, $2, $3)
         ON CONFLICT (concat) DO UPDATE SET
           contable = EXCLUDED.contable,
           cuenta   = EXCLUDED.cuenta`,
        [concat, truncar(it.contable, 30), truncar(it.cuenta, 100)]
      );
      actualizados++;
    }
    await client.query('COMMIT');
    res.json({ ok: true, actualizados });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error al importar tipos de inventario:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  } finally {
    client.release();
  }
});

// ── PATCH /api/validador-inventario/tipos-inventario/:concat ──────────────────
// Edición manual puntual de una clasificación (crea si no existía). Editor o admin.
router.patch('/tipos-inventario/:concat', authMiddleware, editorOrAdmin, async (req, res) => {
  try {
    const { contable, cuenta } = req.body;
    if (!cuenta) return res.status(400).json({ error: 'cuenta requerida' });
    const concat = truncar(req.params.concat, 6).toUpperCase();
    const { rows } = await pool.query(
      `INSERT INTO tipos_inventario (concat, contable, cuenta)
       VALUES ($1, $2, $3)
       ON CONFLICT (concat) DO UPDATE SET
         contable = EXCLUDED.contable,
         cuenta   = EXCLUDED.cuenta
       RETURNING *`,
      [concat, truncar(contable, 30), truncar(cuenta, 100)]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('Error al guardar tipo de inventario:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// LISTAS DE CONTEO — sesiones de conteo físico sobre un subconjunto de una
// bodega (general, por cuenta contable, por grupo de inventario o por
// presentación). Los ítems se "congelan" (snapshot) al crear la lista.
// ════════════════════════════════════════════════════════════════════════════

const TIPOS_LISTA = ['general', 'cuenta_contable', 'grupo_inventario', 'presentacion'];

const LABEL_TIPO = {
  general: 'Conteo general',
  cuenta_contable: 'Conteo por cuenta contable',
  grupo_inventario: 'Conteo por grupo de inventario',
  presentacion: 'Conteo por presentación',
};

// Valor que cuenta como "definitivo" para el reporte de diferencias: Conteo 2
// si existe (doble conteo = verificación), si no Conteo 1, si no hay ninguno
// el ítem sigue pendiente.
function conteoDefinitivo(item) {
  if (item.conteo_2 !== null && item.conteo_2 !== undefined) return Number(item.conteo_2);
  if (item.conteo_1 !== null && item.conteo_1 !== undefined) return Number(item.conteo_1);
  return null;
}

// ── GET /api/validador-inventario/listas-conteo/opciones?bodega=BV&tipo=... ──
// Valores disponibles para elegir criterio al crear una lista (con conteo de
// ítems que caerían en cada uno), para poblar el selector en el frontend.
router.get('/listas-conteo/opciones', authMiddleware, async (req, res) => {
  try {
    const bodega = (req.query.bodega || '').toUpperCase();
    const tipo = req.query.tipo;
    if (!bodega) return res.status(400).json({ error: 'bodega requerida' });

    let sql;
    if (tipo === 'cuenta_contable') {
      sql = `SELECT COALESCE(ti.cuenta, 'SIN CLASIFICAR') AS valor, COUNT(*)::int AS items
             FROM validador_inventario vi
             LEFT JOIN tipos_inventario ti ON ti.concat = concat_tipo_inventario(vi.codigo)
             WHERE vi.bodega = $1
             GROUP BY 1 ORDER BY 1`;
    } else if (tipo === 'grupo_inventario') {
      sql = `SELECT grupo_inventario(vi.codigo) AS valor, COUNT(*)::int AS items
             FROM validador_inventario vi
             WHERE vi.bodega = $1
             GROUP BY 1 ORDER BY 1`;
    } else if (tipo === 'presentacion') {
      sql = `SELECT COALESCE(pi.presentacion, 'SIN PRESENTACIÓN') AS valor, COUNT(*)::int AS items
             FROM validador_inventario vi
             LEFT JOIN presentaciones_inventario pi ON pi.codigo = vi.codigo
             WHERE vi.bodega = $1
             GROUP BY 1 ORDER BY 1`;
    } else {
      return res.status(400).json({ error: "tipo debe ser 'cuenta_contable', 'grupo_inventario' o 'presentacion'" });
    }
    const { rows } = await pool.query(sql, [bodega]);
    res.json(rows);
  } catch (err) {
    console.error('Error al listar opciones de lista de conteo:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── POST /api/validador-inventario/listas-conteo ──────────────────────────────
// Crea una lista de conteo y toma la "foto" (snapshot) de los ítems que
// cumplen el criterio elegido, tal como están en ese momento.
router.post('/listas-conteo', authMiddleware, async (req, res) => {
  const { bodega, tipo, criterio, subclasificar_presentacion, conteo1_nombre, conteo2_nombre } = req.body;
  if (!bodega || !TIPOS_LISTA.includes(tipo)) {
    return res.status(400).json({ error: 'bodega y tipo válido son requeridos' });
  }
  if (tipo !== 'general' && !criterio) {
    return res.status(400).json({ error: 'criterio requerido para este tipo de conteo' });
  }
  const bod = String(bodega).toUpperCase();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: listaRows } = await client.query(
      `INSERT INTO listas_conteo (bodega, tipo, criterio, subclasificar_presentacion, conteo1_nombre, conteo2_nombre, creado_por)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [bod, tipo, tipo === 'general' ? null : truncar(criterio, 150), !!subclasificar_presentacion, truncar(conteo1_nombre, 100), truncar(conteo2_nombre, 100), req.user.id]
    );
    const lista = listaRows[0];

    let filtroSql = '';
    const params = [bod];
    if (tipo === 'cuenta_contable') {
      filtroSql = `AND COALESCE(ti.cuenta, 'SIN CLASIFICAR') = $2`;
      params.push(criterio);
    } else if (tipo === 'grupo_inventario') {
      filtroSql = `AND grupo_inventario(vi.codigo) = $2`;
      params.push(criterio);
    } else if (tipo === 'presentacion') {
      filtroSql = `AND COALESCE(pi.presentacion, 'SIN PRESENTACIÓN') = $2`;
      params.push(criterio);
    }

    const { rows: items } = await client.query(
      `SELECT vi.codigo, vi.nombre, vi.lote, vi.fecha_vencimiento, vi.existencia_sistema, vi.costo_unitario,
              COALESCE(ti.cuenta, 'SIN CLASIFICAR') AS cuenta, concat_tipo_inventario(vi.codigo) AS concat, pi.presentacion
       FROM validador_inventario vi
       LEFT JOIN tipos_inventario ti ON ti.concat = concat_tipo_inventario(vi.codigo)
       LEFT JOIN presentaciones_inventario pi ON pi.codigo = vi.codigo
       WHERE vi.bodega = $1 AND vi.sin_existencias = false ${filtroSql}
       ORDER BY pi.presentacion NULLS LAST, vi.nombre ASC`,
      params
    );

    if (items.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'No hay ítems que cumplan ese criterio en esta bodega' });
    }

    for (const it of items) {
      await client.query(
        `INSERT INTO listas_conteo_items (lista_id, codigo, nombre, lote, fecha_vencimiento, presentacion, cuenta, concat, existencia_siis, costo_unitario)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [lista.id, it.codigo, it.nombre, it.lote, it.fecha_vencimiento, it.presentacion, it.cuenta, it.concat, it.existencia_sistema, it.costo_unitario]
      );
    }

    await client.query('COMMIT');
    res.json({ ...lista, total_items: items.length });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error al crear lista de conteo:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  } finally {
    client.release();
  }
});

// ── GET /api/validador-inventario/listas-conteo?bodega=BV ────────────────────
// Resumen de todas las listas (abiertas y cerradas) de una bodega.
router.get('/listas-conteo', authMiddleware, async (req, res) => {
  try {
    const bodega = (req.query.bodega || '').toUpperCase();
    const params = [];
    let where = '';
    if (bodega) { where = 'WHERE lc.bodega = $1'; params.push(bodega); }
    const { rows } = await pool.query(
      `SELECT lc.*,
              COUNT(li.id)::int AS total_items,
              COUNT(li.conteo_1)::int AS con_conteo_1,
              COUNT(li.conteo_2)::int AS con_conteo_2
       FROM listas_conteo lc
       LEFT JOIN listas_conteo_items li ON li.lista_id = lc.id
       ${where}
       GROUP BY lc.id
       ORDER BY lc.creado_en DESC`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error('Error al listar listas de conteo:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── GET /api/validador-inventario/listas-conteo/:id ───────────────────────────
// Detalle de una lista con todos sus ítems (ordenados por presentación si
// aplica subclasificación).
router.get('/listas-conteo/:id', authMiddleware, async (req, res) => {
  try {
    const { rows: listaRows } = await pool.query(`SELECT * FROM listas_conteo WHERE id = $1`, [req.params.id]);
    if (!listaRows.length) return res.status(404).json({ error: 'Lista no encontrada' });
    const { rows: items } = await pool.query(
      `SELECT * FROM listas_conteo_items WHERE lista_id = $1 ORDER BY presentacion NULLS LAST, nombre ASC`,
      [req.params.id]
    );
    res.json({ ...listaRows[0], items });
  } catch (err) {
    console.error('Error al obtener lista de conteo:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── PATCH /api/validador-inventario/listas-conteo/:id/items/:itemId ──────────
// Guarda Conteo 1 o Conteo 2 de un ítem, directo desde la app. Cualquiera con
// acceso puede diligenciar un campo vacío; una vez lleno, solo editor/admin
// puede modificarlo (mismo criterio que el conteo general). Bloqueado si la
// lista ya está cerrada.
router.patch('/listas-conteo/:id/items/:itemId', authMiddleware, async (req, res) => {
  try {
    const { campo, valor } = req.body;
    if (!['conteo_1', 'conteo_2'].includes(campo)) {
      return res.status(400).json({ error: "campo debe ser 'conteo_1' o 'conteo_2'" });
    }
    if (valor === undefined || valor === null || valor === '') {
      return res.status(400).json({ error: 'valor requerido' });
    }
    const { rows: listaRows } = await pool.query(`SELECT estado FROM listas_conteo WHERE id = $1`, [req.params.id]);
    if (!listaRows.length) return res.status(404).json({ error: 'Lista no encontrada' });
    if (listaRows[0].estado === 'cerrada') {
      return res.status(400).json({ error: 'La lista está cerrada, no se puede modificar' });
    }

    const { rows: itemRows } = await pool.query(
      `SELECT * FROM listas_conteo_items WHERE id = $1 AND lista_id = $2`,
      [req.params.itemId, req.params.id]
    );
    if (!itemRows.length) return res.status(404).json({ error: 'Ítem no encontrado' });
    const item = itemRows[0];

    const yaTeniaValor = item[campo] !== null && item[campo] !== undefined;
    if (yaTeniaValor && !['admin', 'editor'].includes(req.user.rol)) {
      return res.status(403).json({ error: 'Este ítem ya fue contado; solo editor/admin puede modificarlo' });
    }

    const colValor = campo, colPor = `${campo}_por`, colEn = `${campo}_en`;
    const { rows } = await pool.query(
      `UPDATE listas_conteo_items SET ${colValor} = $1, ${colPor} = $2, ${colEn} = NOW() WHERE id = $3 RETURNING *`,
      [valor, req.user.id, req.params.itemId]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('Error al guardar conteo de lista:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── GET /api/validador-inventario/listas-conteo/:id/reporte ──────────────────
// Reporte de diferencias (cantidad y valor). Disponible en cualquier momento,
// no solo al cerrar, para poder revisar antes de cerrar.
router.get('/listas-conteo/:id/reporte', authMiddleware, async (req, res) => {
  try {
    const { rows: listaRows } = await pool.query(`SELECT * FROM listas_conteo WHERE id = $1`, [req.params.id]);
    if (!listaRows.length) return res.status(404).json({ error: 'Lista no encontrada' });
    const { rows: items } = await pool.query(`SELECT * FROM listas_conteo_items WHERE lista_id = $1`, [req.params.id]);

    let diferenciaValorTotal = 0;
    let conDiferencia = 0;
    let contados = 0;
    const detalle = items.map(it => {
      const definitivo = conteoDefinitivo(it);
      if (definitivo !== null) contados++;
      const diferenciaCantidad = definitivo === null ? null : Number((definitivo - Number(it.existencia_siis)).toFixed(3));
      const diferenciaValor = diferenciaCantidad === null ? null : Number((diferenciaCantidad * Number(it.costo_unitario)).toFixed(2));
      if (diferenciaCantidad) { conDiferencia++; diferenciaValorTotal += diferenciaValor; }
      return {
        id: it.id, codigo: it.codigo, nombre: it.nombre, lote: it.lote, presentacion: it.presentacion, cuenta: it.cuenta,
        existencia_siis: Number(it.existencia_siis), conteo_1: it.conteo_1 !== null ? Number(it.conteo_1) : null,
        conteo_2: it.conteo_2 !== null ? Number(it.conteo_2) : null, definitivo,
        diferencia_cantidad: diferenciaCantidad, diferencia_valor: diferenciaValor,
      };
    });

    res.json({
      lista: listaRows[0],
      resumen: {
        total_items: items.length, contados, pendientes: items.length - contados,
        con_diferencia: conDiferencia, diferencia_valor_total: Number(diferenciaValorTotal.toFixed(2)),
      },
      items: detalle,
    });
  } catch (err) {
    console.error('Error al generar reporte de lista de conteo:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── POST /api/validador-inventario/listas-conteo/:id/cerrar ──────────────────
// Cierra la lista (editor/admin): ya no se pueden modificar los conteos.
router.post('/listas-conteo/:id/cerrar', authMiddleware, editorOrAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE listas_conteo SET estado = 'cerrada', cerrado_por = $1, cerrado_en = NOW()
       WHERE id = $2 AND estado = 'abierta' RETURNING *`,
      [req.user.id, req.params.id]
    );
    if (!rows.length) return res.status(400).json({ error: 'Lista no encontrada o ya estaba cerrada' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Error al cerrar lista de conteo:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── GET /api/validador-inventario/listas-conteo/:id/plantilla ────────────────
// Genera el Excel en blanco para salir a contar en bodega.
router.get('/listas-conteo/:id/plantilla', authMiddleware, async (req, res) => {
  try {
    const { rows: listaRows } = await pool.query(`SELECT * FROM listas_conteo WHERE id = $1`, [req.params.id]);
    if (!listaRows.length) return res.status(404).json({ error: 'Lista no encontrada' });
    const lista = listaRows[0];
    const { rows: items } = await pool.query(
      `SELECT * FROM listas_conteo_items WHERE lista_id = $1 ORDER BY presentacion NULLS LAST, nombre ASC`,
      [req.params.id]
    );

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Conteo');
    ws.columns = [
      { width: 16 }, { width: 40 }, { width: 14 }, { width: 14 }, { width: 20 }, { width: 12 }, { width: 12 }, { width: 12 },
    ];

    const tituloCriterio = lista.tipo === 'general' ? LABEL_TIPO.general : `${LABEL_TIPO[lista.tipo]}: ${lista.criterio}`;
    ws.mergeCells('A1:H1');
    ws.getCell('A1').value = `Lista de Conteo #${lista.id} — ${tituloCriterio}`;
    ws.getCell('A1').font = { bold: true, size: 14 };

    ws.getCell('A2').value = 'Bodega:';       ws.getCell('B2').value = lista.bodega;
    ws.getCell('C2').value = 'Fecha:';        ws.getCell('D2').value = new Date().toLocaleDateString('es-CO');
    ws.getCell('A3').value = 'Conteo 1 por:'; ws.getCell('B3').value = lista.conteo1_nombre || '_______________';
    ws.getCell('C3').value = 'Conteo 2 por:'; ws.getCell('D3').value = lista.conteo2_nombre || '_______________';
    ['A2', 'C2', 'A3', 'C3'].forEach(c => { ws.getCell(c).font = { bold: true }; });

    const filaEncabezado = 5;
    const encabezados = ['Código', 'Nombre', 'Lote', 'Fecha Venc.', 'Presentación', 'Conteo 1', 'Conteo 2', 'SIIS'];
    ws.getRow(filaEncabezado).values = encabezados;
    ws.getRow(filaEncabezado).font = { bold: true };
    ws.getRow(filaEncabezado).eachCell(c => {
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
      c.border = { bottom: { style: 'thin' } };
    });

    let fila = filaEncabezado + 1;
    let presentacionActual = Symbol('inicio'); // fuerza que la primera fila dispare el encabezado de grupo
    for (const it of items) {
      if (lista.subclasificar_presentacion && it.presentacion !== presentacionActual) {
        presentacionActual = it.presentacion;
        const r = ws.getRow(fila);
        ws.mergeCells(`A${fila}:H${fila}`);
        r.getCell(1).value = it.presentacion || 'SIN PRESENTACIÓN';
        r.font = { bold: true, italic: true };
        r.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
        fila++;
      }
      ws.getRow(fila).values = [
        it.codigo, it.nombre, it.lote || '', it.fecha_vencimiento || '', it.presentacion || '',
        null, null, Number(it.existencia_siis),
      ];
      fila++;
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="lista_conteo_${lista.id}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Error al generar plantilla de lista de conteo:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── GET /api/validador-inventario/listas-conteo/:id/reporte-excel ────────────
// Exporta el reporte de diferencias (cantidad y valor) a Excel.
router.get('/listas-conteo/:id/reporte-excel', authMiddleware, async (req, res) => {
  try {
    const { rows: listaRows } = await pool.query(`SELECT * FROM listas_conteo WHERE id = $1`, [req.params.id]);
    if (!listaRows.length) return res.status(404).json({ error: 'Lista no encontrada' });
    const lista = listaRows[0];
    const { rows: items } = await pool.query(`SELECT * FROM listas_conteo_items WHERE lista_id = $1 ORDER BY presentacion NULLS LAST, nombre ASC`, [req.params.id]);

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Reporte de diferencias');
    ws.columns = [
      { width: 16 }, { width: 40 }, { width: 20 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 14 }, { width: 14 },
    ];
    const tituloCriterio = lista.tipo === 'general' ? LABEL_TIPO.general : `${LABEL_TIPO[lista.tipo]}: ${lista.criterio}`;
    ws.mergeCells('A1:H1');
    ws.getCell('A1').value = `Reporte de diferencias — Lista #${lista.id} — ${tituloCriterio} (${lista.estado === 'cerrada' ? 'CERRADA' : 'ABIERTA'})`;
    ws.getCell('A1').font = { bold: true, size: 13 };

    const filaEncabezado = 3;
    ws.getRow(filaEncabezado).values = ['Código', 'Nombre', 'Presentación', 'SIIS', 'Conteo 1', 'Conteo 2', 'Dif. Cantidad', 'Dif. Valor'];
    ws.getRow(filaEncabezado).font = { bold: true };

    let fila = filaEncabezado + 1;
    let diferenciaValorTotal = 0;
    for (const it of items) {
      const definitivo = conteoDefinitivo(it);
      const diferenciaCantidad = definitivo === null ? null : Number((definitivo - Number(it.existencia_siis)).toFixed(3));
      const diferenciaValor = diferenciaCantidad === null ? null : Number((diferenciaCantidad * Number(it.costo_unitario)).toFixed(2));
      if (diferenciaValor) diferenciaValorTotal += diferenciaValor;
      ws.getRow(fila).values = [
        it.codigo, it.nombre, it.presentacion || '', Number(it.existencia_siis),
        it.conteo_1 !== null ? Number(it.conteo_1) : '', it.conteo_2 !== null ? Number(it.conteo_2) : '',
        diferenciaCantidad ?? '', diferenciaValor ?? '',
      ];
      if (diferenciaCantidad) ws.getRow(fila).eachCell(c => { c.font = { color: { argb: diferenciaCantidad > 0 ? 'FF166534' : 'FFB91C1C' } }; });
      fila++;
    }
    ws.getRow(fila + 1).getCell(7).value = 'Diferencia total en valor:';
    ws.getRow(fila + 1).getCell(7).font = { bold: true };
    ws.getRow(fila + 1).getCell(8).value = Number(diferenciaValorTotal.toFixed(2));
    ws.getRow(fila + 1).getCell(8).font = { bold: true };

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="reporte_diferencias_${lista.id}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Error al generar reporte excel de lista de conteo:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── PATCH /api/validador-inventario/listas-conteo/:id/items/:itemId/cuenta ───
// Reclasifica un ítem "SIN CLASIFICAR" (o cambia su cuenta) directo desde una
// lista de conteo. Editor o admin. No depende de si la lista está abierta o
// cerrada (clasificar no altera el conteo). Actualiza el snapshot de la lista
// Y la tabla maestra tipos_inventario, para que el Validador general y las
// próximas listas de conteo ya vean el artículo clasificado.
router.patch('/listas-conteo/:id/items/:itemId/cuenta', authMiddleware, editorOrAdmin, async (req, res) => {
  try {
    const { cuenta, contable } = req.body;
    if (!cuenta) return res.status(400).json({ error: 'cuenta requerida' });

    const { rows: itemRows } = await pool.query(
      `SELECT * FROM listas_conteo_items WHERE id = $1 AND lista_id = $2`,
      [req.params.itemId, req.params.id]
    );
    if (!itemRows.length) return res.status(404).json({ error: 'Ítem no encontrado' });
    const item = itemRows[0];

    const { rows } = await pool.query(
      `UPDATE listas_conteo_items SET cuenta = $1 WHERE id = $2 RETURNING *`,
      [truncar(cuenta, 100), req.params.itemId]
    );

    if (item.concat) {
      await pool.query(
        `INSERT INTO tipos_inventario (concat, contable, cuenta)
         VALUES ($1, $2, $3)
         ON CONFLICT (concat) DO UPDATE SET contable = EXCLUDED.contable, cuenta = EXCLUDED.cuenta`,
        [item.concat, truncar(contable, 30), truncar(cuenta, 100)]
      );
    }

    res.json(rows[0]);
  } catch (err) {
    console.error('Error al clasificar ítem de la lista de conteo:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

module.exports = router;























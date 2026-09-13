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

// ── Registra un cambio de clasificación en el historial de auditoría ─────────
async function registrarHistorialTipo(dbClient, concat, anterior, nuevoContable, nuevoCuenta, origen, userId) {
  await dbClient.query(
    `INSERT INTO tipos_inventario_historial (concat, contable_anterior, cuenta_anterior, contable_nuevo, cuenta_nuevo, origen, cambiado_por)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [concat, anterior?.contable || null, anterior?.cuenta || null, nuevoContable, nuevoCuenta, origen, userId]
  );
}

// ── GET /api/validador-inventario?bodega=BV ──────────────────────────────────
// Lista los items guardados de una bodega
router.get('/', authMiddleware, async (req, res) => {
  try {
    const bodega = (req.query.bodega || 'BV').toUpperCase();
    const { rows } = await pool.query(
      `SELECT vi.*, ti.contable, ti.cuenta, concat_tipo_inventario(vi.codigo) AS concat, pi.presentacion,
              cc.grupo AS grupo_conteo, cc.subgrupo AS subgrupo_conteo
       FROM validador_inventario vi
       LEFT JOIN tipos_inventario ti ON ti.concat = concat_tipo_inventario(vi.codigo)
       LEFT JOIN presentaciones_inventario pi ON pi.codigo = vi.codigo
       LEFT JOIN clasificacion_conteo cc ON cc.codigo = vi.codigo
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
      `SELECT vi.*, ti.contable, ti.cuenta, concat_tipo_inventario(vi.codigo) AS concat, pi.presentacion,
              cc.grupo AS grupo_conteo, cc.subgrupo AS subgrupo_conteo
       FROM validador_inventario vi
       LEFT JOIN tipos_inventario ti ON ti.concat = concat_tipo_inventario(vi.codigo)
       LEFT JOIN presentaciones_inventario pi ON pi.codigo = vi.codigo
       LEFT JOIN clasificacion_conteo cc ON cc.codigo = vi.codigo
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
      const contableNuevo = truncar(it.contable, 30);
      const cuentaNuevo = truncar(it.cuenta, 100);
      const { rows: anteriorRows } = await client.query(`SELECT contable, cuenta FROM tipos_inventario WHERE concat = $1`, [concat]);
      const anterior = anteriorRows[0] || null;
      if (!anterior || anterior.contable !== contableNuevo || anterior.cuenta !== cuentaNuevo) {
        await registrarHistorialTipo(client, concat, anterior, contableNuevo, cuentaNuevo, 'excel', req.user.id);
      }
      await client.query(
        `INSERT INTO tipos_inventario (concat, contable, cuenta)
         VALUES ($1, $2, $3)
         ON CONFLICT (concat) DO UPDATE SET
           contable = EXCLUDED.contable,
           cuenta   = EXCLUDED.cuenta`,
        [concat, contableNuevo, cuentaNuevo]
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
  const client = await pool.connect();
  try {
    const { contable, cuenta } = req.body;
    if (!cuenta) { client.release(); return res.status(400).json({ error: 'cuenta requerida' }); }
    const concat = truncar(req.params.concat, 6).toUpperCase();
    const contableNuevo = truncar(contable, 30);
    const cuentaNuevo = truncar(cuenta, 100);

    await client.query('BEGIN');
    const { rows: anteriorRows } = await client.query(`SELECT contable, cuenta FROM tipos_inventario WHERE concat = $1`, [concat]);
    const anterior = anteriorRows[0] || null;
    if (!anterior || anterior.contable !== contableNuevo || anterior.cuenta !== cuentaNuevo) {
      await registrarHistorialTipo(client, concat, anterior, contableNuevo, cuentaNuevo, 'manual', req.user.id);
    }
    const { rows } = await client.query(
      `INSERT INTO tipos_inventario (concat, contable, cuenta)
       VALUES ($1, $2, $3)
       ON CONFLICT (concat) DO UPDATE SET
         contable = EXCLUDED.contable,
         cuenta   = EXCLUDED.cuenta
       RETURNING *`,
      [concat, contableNuevo, cuentaNuevo]
    );
    await client.query('COMMIT');
    res.json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error al guardar tipo de inventario:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  } finally {
    client.release();
  }
});

// ── GET /api/validador-inventario/opciones-cuentas ────────────────────────────
// Lista de nombres de cuenta contable ya usados (para el desplegable de
// "Cuenta" en cada artículo, sea nuevo o existente).
router.get('/opciones-cuentas', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT cuenta FROM tipos_inventario WHERE cuenta <> '' ORDER BY cuenta ASC`
    );
    res.json(rows.map(r => r.cuenta));
  } catch (err) {
    console.error('Error al listar opciones de cuentas:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── GET /api/validador-inventario/opciones-grupos-conteo ──────────────────────
// Todos los pares grupo/subgrupo ya usados (para el desplegable de "Grupo
// Conteo" y "Subgrupo" en cada artículo, sea nuevo o existente).
router.get('/opciones-grupos-conteo', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT grupo, subgrupo FROM clasificacion_conteo
       WHERE grupo IS NOT NULL AND grupo <> ''
       ORDER BY grupo ASC, subgrupo ASC NULLS FIRST`
    );
    res.json(rows);
  } catch (err) {
    console.error('Error al listar opciones de grupos de conteo:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── GET /api/validador-inventario/opciones-presentaciones ────────────────────
// Lista de presentaciones ya usadas (para el desplegable de "Presentación").
router.get('/opciones-presentaciones', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT presentacion FROM presentaciones_inventario WHERE presentacion <> '' ORDER BY presentacion ASC`
    );
    res.json(rows.map(r => r.presentacion));
  } catch (err) {
    console.error('Error al listar opciones de presentaciones:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── GET /api/validador-inventario/tipos-inventario?buscar= ───────────────────
// Lista TODAS las clasificaciones de cuenta contable (concat -> contable/
// cuenta), para la pestaña de datos maestros: ver, buscar, editar o agregar
// una a la vez sin depender de subir el Excel completo de nuevo.
router.get('/tipos-inventario', authMiddleware, async (req, res) => {
  try {
    const buscar = (req.query.buscar || '').trim();
    const params = [];
    let where = '';
    if (buscar) {
      params.push(`%${buscar.toUpperCase()}%`);
      where = `WHERE UPPER(concat) LIKE $1 OR UPPER(contable) LIKE $1 OR UPPER(cuenta) LIKE $1`;
    }
    const { rows } = await pool.query(`SELECT * FROM tipos_inventario ${where} ORDER BY concat ASC`, params);
    res.json(rows);
  } catch (err) {
    console.error('Error al listar tipos de inventario:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── DELETE /api/validador-inventario/tipos-inventario/:concat ────────────────
// Elimina una clasificación de cuenta contable. Solo admin.
router.delete('/tipos-inventario/:concat', authMiddleware, adminOnly, async (req, res) => {
  try {
    const concat = truncar(req.params.concat, 6).toUpperCase();
    const { rows } = await pool.query(`DELETE FROM tipos_inventario WHERE concat = $1 RETURNING concat`, [concat]);
    if (!rows.length) return res.status(404).json({ error: 'No encontrado' });
    res.json({ ok: true });
  } catch (err) {
    console.error('Error al eliminar tipo de inventario:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── GET /api/validador-inventario/tipos-inventario/:concat/historial ─────────
// Historial de reclasificaciones de un grupo (quién cambió qué y cuándo).
router.get('/tipos-inventario/:concat/historial', authMiddleware, async (req, res) => {
  try {
    const concat = truncar(req.params.concat, 6).toUpperCase();
    const { rows } = await pool.query(
      `SELECT h.*, u.nombre AS cambiado_por_nombre
       FROM tipos_inventario_historial h
       LEFT JOIN usuarios u ON u.id = h.cambiado_por
       WHERE h.concat = $1
       ORDER BY h.cambiado_en DESC`,
      [concat]
    );
    res.json(rows);
  } catch (err) {
    console.error('Error al obtener historial de tipo de inventario:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// GRUPOS DE CONTEO — clasificación por código completo (grupo + subgrupo),
// adicional a la cuenta contable. Un solo Excel, un solo botón de carga.
// ════════════════════════════════════════════════════════════════════════════

// ── POST /api/validador-inventario/clasificacion-conteo/importar ────────────
// Body: { items: [{codigo, grupo, subgrupo}] }. Editor o admin.
router.post('/clasificacion-conteo/importar', authMiddleware, editorOrAdmin, async (req, res) => {
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
        `INSERT INTO clasificacion_conteo (codigo, grupo, subgrupo, actualizado_por, actualizado_en)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (codigo) DO UPDATE SET
           grupo = EXCLUDED.grupo, subgrupo = EXCLUDED.subgrupo,
           actualizado_por = EXCLUDED.actualizado_por, actualizado_en = NOW()`,
        [codigo, truncar(it.grupo, 100), truncar(it.subgrupo, 100), req.user.id]
      );
      actualizados++;
    }
    await client.query('COMMIT');
    res.json({ ok: true, actualizados });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error al importar clasificación de conteo:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  } finally {
    client.release();
  }
});

// ── PATCH /api/validador-inventario/clasificacion-conteo/:codigo ────────────
// Edición manual puntual (crea si no existía). Editor o admin.
router.patch('/clasificacion-conteo/:codigo', authMiddleware, editorOrAdmin, async (req, res) => {
  try {
    const { grupo, subgrupo } = req.body;
    if (!grupo) return res.status(400).json({ error: 'grupo requerido' });
    const codigo = truncar(req.params.codigo, 50);
    const { rows } = await pool.query(
      `INSERT INTO clasificacion_conteo (codigo, grupo, subgrupo, actualizado_por, actualizado_en)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (codigo) DO UPDATE SET
         grupo = EXCLUDED.grupo, subgrupo = EXCLUDED.subgrupo,
         actualizado_por = EXCLUDED.actualizado_por, actualizado_en = NOW()
       RETURNING *`,
      [codigo, truncar(grupo, 100), truncar(subgrupo, 100), req.user.id]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('Error al guardar clasificación de conteo:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── GET /api/validador-inventario/clasificacion-conteo/opciones?bodega=&grupo= ─
// Sin 'grupo': lista de grupos disponibles en esa bodega (con conteo de ítems).
// Con 'grupo': lista de subgrupos dentro de ese grupo (incluye "SIN SUBGRUPO").
router.get('/clasificacion-conteo/opciones', authMiddleware, async (req, res) => {
  try {
    const bodega = (req.query.bodega || '').toUpperCase();
    if (!bodega) return res.status(400).json({ error: 'bodega requerida' });
    const grupo = req.query.grupo;

    if (!grupo) {
      const { rows } = await pool.query(
        `SELECT cc.grupo AS valor, COUNT(*)::int AS items
         FROM validador_inventario vi
         JOIN clasificacion_conteo cc ON cc.codigo = vi.codigo
         WHERE vi.bodega = $1 AND cc.grupo IS NOT NULL AND cc.grupo <> ''
         GROUP BY cc.grupo ORDER BY cc.grupo`,
        [bodega]
      );
      return res.json(rows);
    }

    const { rows } = await pool.query(
      `SELECT COALESCE(NULLIF(cc.subgrupo, ''), 'SIN SUBGRUPO') AS valor, COUNT(*)::int AS items
       FROM validador_inventario vi
       JOIN clasificacion_conteo cc ON cc.codigo = vi.codigo
       WHERE vi.bodega = $1 AND cc.grupo = $2
       GROUP BY 1 ORDER BY 1`,
      [bodega, grupo]
    );
    res.json(rows);
  } catch (err) {
    console.error('Error al listar opciones de grupo de conteo:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── POST /api/validador-inventario/clasificacion-conteo/limpiar-duplicados ───
// Borra las filas "huérfanas" de 9 dígitos que quedaron de antes del fix del
// cero inicial, SOLO cuando ya existe la versión correcta de 10 dígitos (para
// no arriesgar ningún dato real). Solo admin.
router.post('/clasificacion-conteo/limpiar-duplicados', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      DELETE FROM clasificacion_conteo cc9
      WHERE cc9.codigo ~ '^[0-9]{9}$'
        AND EXISTS (SELECT 1 FROM clasificacion_conteo cc10 WHERE cc10.codigo = '0' || cc9.codigo)
      RETURNING cc9.codigo
    `);
    res.json({ ok: true, eliminados: rows.length, codigos: rows.map(r => r.codigo) });
  } catch (err) {
    console.error('Error al limpiar duplicados de clasificación de conteo:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── GET /api/validador-inventario/clasificacion-conteo?buscar= ───────────────
// Lista TODOS los códigos con su grupo/subgrupo de conteo asignado (con el
// nombre del artículo si existe en algún inventario), para la pestaña de
// datos maestros: ver, buscar, editar o agregar uno a la vez.
router.get('/clasificacion-conteo', authMiddleware, async (req, res) => {
  try {
    const buscar = (req.query.buscar || '').trim();
    const params = [];
    let where = '';
    if (buscar) {
      params.push(`%${buscar.toUpperCase()}%`);
      where = `WHERE UPPER(cc.codigo) LIKE $1 OR UPPER(COALESCE(cc.grupo,'')) LIKE $1
                     OR UPPER(COALESCE(cc.subgrupo,'')) LIKE $1 OR UPPER(COALESCE(vi.nombre,'')) LIKE $1`;
    }
    const { rows } = await pool.query(
      `SELECT cc.codigo, cc.grupo, cc.subgrupo, cc.actualizado_en, vi.nombre
       FROM clasificacion_conteo cc
       LEFT JOIN LATERAL (
         SELECT nombre FROM validador_inventario v WHERE v.codigo = cc.codigo LIMIT 1
       ) vi ON true
       ${where}
       ORDER BY cc.grupo NULLS LAST, cc.subgrupo NULLS LAST, cc.codigo ASC`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error('Error al listar clasificación de conteo:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── DELETE /api/validador-inventario/clasificacion-conteo/:codigo ────────────
// Elimina la asignación de grupo/subgrupo de un código. Solo admin.
router.delete('/clasificacion-conteo/:codigo', authMiddleware, adminOnly, async (req, res) => {
  try {
    const codigo = truncar(req.params.codigo, 50);
    const { rows } = await pool.query(`DELETE FROM clasificacion_conteo WHERE codigo = $1 RETURNING codigo`, [codigo]);
    if (!rows.length) return res.status(404).json({ error: 'No encontrado' });
    res.json({ ok: true });
  } catch (err) {
    console.error('Error al eliminar clasificación de conteo:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// presentación). Los ítems se "congelan" (snapshot) al crear la lista.
// ════════════════════════════════════════════════════════════════════════════

const TIPOS_LISTA = ['general', 'cuenta_contable', 'grupo_inventario', 'presentacion', 'grupo_conteo'];

const LABEL_TIPO = {
  general: 'Conteo general',
  cuenta_contable: 'Conteo por cuenta contable',
  grupo_inventario: 'Conteo por grupo de inventario',
  presentacion: 'Conteo por presentación',
  grupo_conteo: 'Conteo por grupo de conteo',
};

// Valor que cuenta como "definitivo" para el reporte de diferencias: Conteo 2
// si existe (doble conteo = verificación), si no Conteo 1, si no hay ninguno
// el ítem sigue pendiente.
function conteoDefinitivo(item) {
  if (item.conteo_2 !== null && item.conteo_2 !== undefined) return Number(item.conteo_2);
  if (item.conteo_1 !== null && item.conteo_1 !== undefined) return Number(item.conteo_1);
  return null;
}

// Umbral para marcar "requiere reconteo": Conteo 1 y Conteo 2 existen, no
// coinciden, y su diferencia relativa supera el 5%. Es solo una alerta visual,
// no bloquea el cierre — la regla de tomar Conteo 2 como definitivo se
// mantiene igual.
const UMBRAL_RECONTEO_PORC = 0.05;
function requiereReconteo(item) {
  if (item.conteo_1 === null || item.conteo_1 === undefined || item.conteo_2 === null || item.conteo_2 === undefined) return false;
  const c1 = Number(item.conteo_1), c2 = Number(item.conteo_2);
  if (c1 === c2) return false;
  const base = Math.max(Math.abs(c1), Math.abs(c2), 1);
  return Math.abs(c1 - c2) / base > UMBRAL_RECONTEO_PORC;
}

// Días calendario hasta el vencimiento (negativo si ya venció). Acepta
// fecha_vencimiento en formatos comunes de Excel (YYYY-MM-DD, DD/MM/YYYY).
function diasParaVencer(fechaStr) {
  if (!fechaStr) return null;
  let f = null;
  const iso = String(fechaStr).match(/^(\d{4})-(\d{2})-(\d{2})/);
  const dmy = String(fechaStr).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (iso) f = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  else if (dmy) f = new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));
  else { const d = new Date(fechaStr); if (!isNaN(d.getTime())) f = d; }
  if (!f) return null;
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0); f.setHours(0, 0, 0, 0);
  return Math.round((f - hoy) / 86400000);
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
  const { bodega, tipo, criterio, subcriterio, subclasificar_presentacion, conteo1_nombre, conteo2_nombre } = req.body;
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
      `INSERT INTO listas_conteo (bodega, tipo, criterio, subcriterio, subclasificar_presentacion, conteo1_nombre, conteo2_nombre, creado_por)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [bod, tipo, tipo === 'general' ? null : truncar(criterio, 150), tipo === 'grupo_conteo' ? (truncar(subcriterio, 150) || null) : null,
       !!subclasificar_presentacion, truncar(conteo1_nombre, 100), truncar(conteo2_nombre, 100), req.user.id]
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
    } else if (tipo === 'grupo_conteo') {
      filtroSql = `AND cc.grupo = $2`;
      params.push(criterio);
      if (subcriterio) {
        filtroSql += ` AND COALESCE(NULLIF(cc.subgrupo, ''), 'SIN SUBGRUPO') = $3`;
        params.push(subcriterio);
      }
    }

    // Orden: alfabético puro para "grupo_conteo" (así lo pidieron); para los
    // demás tipos se mantiene el orden por presentación ya existente.
    const ordenSql = tipo === 'grupo_conteo' ? 'ORDER BY vi.nombre ASC' : 'ORDER BY pi.presentacion NULLS LAST, vi.nombre ASC';

    const { rows: items } = await client.query(
      `SELECT vi.codigo, vi.nombre, vi.lote, vi.fecha_vencimiento, vi.existencia_sistema, vi.costo_unitario,
              COALESCE(ti.cuenta, 'SIN CLASIFICAR') AS cuenta, concat_tipo_inventario(vi.codigo) AS concat, pi.presentacion,
              cc.grupo AS grupo_conteo, cc.subgrupo AS subgrupo_conteo
       FROM validador_inventario vi
       LEFT JOIN tipos_inventario ti ON ti.concat = concat_tipo_inventario(vi.codigo)
       LEFT JOIN presentaciones_inventario pi ON pi.codigo = vi.codigo
       LEFT JOIN clasificacion_conteo cc ON cc.codigo = vi.codigo
       WHERE vi.bodega = $1 AND vi.sin_existencias = false ${filtroSql}
       ${ordenSql}`,
      params
    );

    if (items.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'No hay ítems que cumplan ese criterio en esta bodega' });
    }

    for (const it of items) {
      await client.query(
        `INSERT INTO listas_conteo_items (lista_id, codigo, nombre, lote, fecha_vencimiento, presentacion, cuenta, concat, grupo_conteo, subgrupo_conteo, existencia_siis, costo_unitario)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [lista.id, it.codigo, it.nombre, it.lote, it.fecha_vencimiento, it.presentacion, it.cuenta, it.concat, it.grupo_conteo, it.subgrupo_conteo, it.existencia_sistema, it.costo_unitario]
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

// Calcula el detalle de diferencias para una lista ya con sus items cargados
// (cerrada: usa existencia_siis_cierre; abierta: usa existencia_actual_live).
// Compartido entre el reporte JSON y el export a Excel.
function calcularDetalleReporte(lista, items) {
  let valorTotalInicial = 0, valorTotalActual = 0;
  let conDiferencia = 0, contados = 0, requierenReconteo = 0;
  const detalle = items.map(it => {
    const definitivo = conteoDefinitivo(it);
    if (definitivo !== null) contados++;

    const existenciaActual = lista.estado === 'cerrada'
      ? (it.existencia_siis_cierre !== null && it.existencia_siis_cierre !== undefined ? Number(it.existencia_siis_cierre) : null)
      : (it.existencia_actual_live !== null && it.existencia_actual_live !== undefined ? Number(it.existencia_actual_live) : null);

    const diferenciaInicial = definitivo === null ? null : Number((definitivo - Number(it.existencia_siis)).toFixed(3));
    const diferenciaActual = (definitivo === null || existenciaActual === null) ? null : Number((definitivo - existenciaActual).toFixed(3));
    const valorInicial = diferenciaInicial === null ? null : Number((diferenciaInicial * Number(it.costo_unitario)).toFixed(2));
    const valorActual = diferenciaActual === null ? null : Number((diferenciaActual * Number(it.costo_unitario)).toFixed(2));
    const reconteo = requiereReconteo(it);
    const diasVence = diasParaVencer(it.fecha_vencimiento);

    if (diferenciaActual) { conDiferencia++; valorTotalActual += valorActual; }
    if (diferenciaInicial) valorTotalInicial += valorInicial;
    if (reconteo) requierenReconteo++;

    return {
      id: it.id, codigo: it.codigo, nombre: it.nombre, lote: it.lote, presentacion: it.presentacion, cuenta: it.cuenta,
      grupo_conteo: it.grupo_conteo, subgrupo_conteo: it.subgrupo_conteo,
      existencia_siis_inicial: Number(it.existencia_siis),
      existencia_siis_actual: existenciaActual,
      conteo_1: it.conteo_1 !== null ? Number(it.conteo_1) : null,
      conteo_2: it.conteo_2 !== null ? Number(it.conteo_2) : null,
      definitivo,
      diferencia_cantidad_inicial: diferenciaInicial, diferencia_valor_inicial: valorInicial,
      diferencia_cantidad_actual: diferenciaActual, diferencia_valor_actual: valorActual,
      requiere_reconteo: reconteo,
      motivo_diferencia: it.motivo_diferencia || '',
      dias_para_vencer: diasVence,
    };
  });
  return {
    resumen: {
      total_items: items.length, contados, pendientes: items.length - contados,
      con_diferencia: conDiferencia, requieren_reconteo: requierenReconteo,
      diferencia_valor_total_inicial: Number(valorTotalInicial.toFixed(2)),
      diferencia_valor_total_actual: Number(valorTotalActual.toFixed(2)),
    },
    items: detalle,
  };
}

async function obtenerItemsConActual(lista, listaId) {
  if (lista.estado === 'cerrada') {
    const r = await pool.query(`SELECT * FROM listas_conteo_items WHERE lista_id = $1`, [listaId]);
    return r.rows;
  }
  const r = await pool.query(
    `SELECT li.*, vi.existencia_sistema AS existencia_actual_live
     FROM listas_conteo_items li
     LEFT JOIN validador_inventario vi
       ON vi.bodega = $2 AND vi.codigo = li.codigo AND vi.lote = li.lote AND vi.fecha_vencimiento = li.fecha_vencimiento
     WHERE li.lista_id = $1`,
    [listaId, lista.bodega]
  );
  return r.rows;
}

// ── GET /api/validador-inventario/listas-conteo/:id/reporte ──────────────────
// Reporte de diferencias, mostrando SIEMPRE dos referencias lado a lado:
//   - existencia_siis_inicial: la del momento en que se creó la lista.
//   - existencia_siis_actual: si la lista ya está cerrada, la que quedó
//     congelada al cerrar; si sigue abierta, se consulta en vivo contra
//     validador_inventario (puede haber cambiado por movimientos de bodega).
// Disponible en cualquier momento, no solo al cerrar.
router.get('/listas-conteo/:id/reporte', authMiddleware, async (req, res) => {
  try {
    const { rows: listaRows } = await pool.query(`SELECT * FROM listas_conteo WHERE id = $1`, [req.params.id]);
    if (!listaRows.length) return res.status(404).json({ error: 'Lista no encontrada' });
    const lista = listaRows[0];
    const items = await obtenerItemsConActual(lista, req.params.id);
    const { resumen, items: detalle } = calcularDetalleReporte(lista, items);
    res.json({ lista, resumen, items: detalle });
  } catch (err) {
    console.error('Error al generar reporte de lista de conteo:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── POST /api/validador-inventario/listas-conteo/:id/cerrar ──────────────────
// Cierra la lista (editor/admin): congela la existencia SIIS "actual" de cada
// ítem (la bodega puede haber seguido operando desde que se creó la lista) y
// ya no se pueden modificar los conteos.
router.post('/listas-conteo/:id/cerrar', authMiddleware, editorOrAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: listaRows } = await client.query(
      `SELECT * FROM listas_conteo WHERE id = $1 AND estado = 'abierta' FOR UPDATE`,
      [req.params.id]
    );
    if (!listaRows.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Lista no encontrada o ya estaba cerrada' });
    }
    const lista = listaRows[0];

    await client.query(
      `UPDATE listas_conteo_items li
       SET existencia_siis_cierre = vi.existencia_sistema
       FROM validador_inventario vi
       WHERE li.lista_id = $1
         AND vi.bodega = $2 AND vi.codigo = li.codigo AND vi.lote = li.lote AND vi.fecha_vencimiento = li.fecha_vencimiento`,
      [req.params.id, lista.bodega]
    );

    const { rows } = await client.query(
      `UPDATE listas_conteo SET estado = 'cerrada', cerrado_por = $1, cerrado_en = NOW() WHERE id = $2 RETURNING *`,
      [req.user.id, req.params.id]
    );
    await client.query('COMMIT');
    res.json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error al cerrar lista de conteo:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  } finally {
    client.release();
  }
});

// ── DELETE /api/validador-inventario/listas-conteo/:id ────────────────────────
// Elimina una lista de conteo completa (sus ítems se borran en cascada). Solo
// admin, porque puede tratarse de un conteo ya cerrado y con historial.
router.delete('/listas-conteo/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { rows } = await pool.query(`DELETE FROM listas_conteo WHERE id = $1 RETURNING id`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Lista no encontrada' });
    res.json({ ok: true, id: rows[0].id });
  } catch (err) {
    console.error('Error al eliminar lista de conteo:', err);
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
    const ordenPlantilla = lista.tipo === 'grupo_conteo' ? 'ORDER BY nombre ASC' : 'ORDER BY presentacion NULLS LAST, nombre ASC';
    const { rows: items } = await pool.query(
      `SELECT * FROM listas_conteo_items WHERE lista_id = $1 ${ordenPlantilla}`,
      [req.params.id]
    );

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Conteo');
    ws.columns = [
      { width: 16 }, { width: 40 }, { width: 14 }, { width: 14 }, { width: 20 }, { width: 16 }, { width: 16 }, { width: 12 }, { width: 12 }, { width: 12 },
    ];

    const tituloCriterio = lista.tipo === 'general' ? LABEL_TIPO.general : `${LABEL_TIPO[lista.tipo]}: ${lista.criterio}${lista.subcriterio ? ' / ' + lista.subcriterio : ''}`;
    ws.mergeCells('A1:J1');
    ws.getCell('A1').value = `Lista de Conteo #${lista.id} — ${tituloCriterio}`;
    ws.getCell('A1').font = { bold: true, size: 14 };

    ws.getCell('A2').value = 'Bodega:';       ws.getCell('B2').value = lista.bodega;
    ws.getCell('C2').value = 'Fecha:';        ws.getCell('D2').value = new Date().toLocaleDateString('es-CO');
    ws.getCell('A3').value = 'Conteo 1 por:'; ws.getCell('B3').value = lista.conteo1_nombre || '_______________';
    ws.getCell('C3').value = 'Conteo 2 por:'; ws.getCell('D3').value = lista.conteo2_nombre || '_______________';
    ['A2', 'C2', 'A3', 'C3'].forEach(c => { ws.getCell(c).font = { bold: true }; });

    const filaEncabezado = 5;
    const encabezados = ['Código', 'Nombre', 'Lote', 'Fecha Venc.', 'Presentación', 'Grupo', 'Subgrupo', 'Conteo 1', 'Conteo 2', 'SIIS'];
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
        ws.mergeCells(`A${fila}:J${fila}`);
        r.getCell(1).value = it.presentacion || 'SIN PRESENTACIÓN';
        r.font = { bold: true, italic: true };
        r.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
        fila++;
      }
      ws.getRow(fila).values = [
        it.codigo, it.nombre, it.lote || '', it.fecha_vencimiento || '', it.presentacion || '',
        it.grupo_conteo || '', it.subgrupo_conteo || '',
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
// Exporta el reporte de diferencias a Excel, con SIIS inicial y SIIS actual
// (al cierre, o en vivo si sigue abierta) lado a lado.
router.get('/listas-conteo/:id/reporte-excel', authMiddleware, async (req, res) => {
  try {
    const { rows: listaRows } = await pool.query(`SELECT * FROM listas_conteo WHERE id = $1`, [req.params.id]);
    if (!listaRows.length) return res.status(404).json({ error: 'Lista no encontrada' });
    const lista = listaRows[0];
    const itemsRaw = await obtenerItemsConActual(lista, req.params.id);
    itemsRaw.sort((a, b) => (a.presentacion || '').localeCompare(b.presentacion || '') || a.nombre.localeCompare(b.nombre));
    const { resumen, items } = calcularDetalleReporte(lista, itemsRaw);

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Reporte de diferencias');
    ws.columns = [
      { width: 16 }, { width: 40 }, { width: 18 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 12 },
      { width: 13 }, { width: 13 }, { width: 13 }, { width: 13 },
    ];
    const tituloCriterio = lista.tipo === 'general' ? LABEL_TIPO.general : `${LABEL_TIPO[lista.tipo]}: ${lista.criterio}`;
    ws.mergeCells('A1:K1');
    ws.getCell('A1').value = `Reporte de diferencias — Conteo #${lista.id} — ${tituloCriterio} (${lista.estado === 'cerrada' ? 'CERRADA' : 'ABIERTA'})`;
    ws.getCell('A1').font = { bold: true, size: 13 };
    ws.getCell('A2').value = `Total: ${resumen.total_items} · Contados: ${resumen.contados} · Con diferencia: ${resumen.con_diferencia} · Diferencia en valor (vs. actual): ${resumen.diferencia_valor_total_actual}`;

    const filaEncabezado = 4;
    ws.getRow(filaEncabezado).values = [
      'Código', 'Nombre', 'Presentación', 'SIIS inicial', 'SIIS actual', 'Conteo 1', 'Conteo 2',
      'Dif. Cant. (inicial)', 'Dif. Valor (inicial)', 'Dif. Cant. (actual)', 'Dif. Valor (actual)',
    ];
    ws.getRow(filaEncabezado).font = { bold: true };

    let fila = filaEncabezado + 1;
    for (const it of items) {
      ws.getRow(fila).values = [
        it.codigo, it.nombre, it.presentacion || '',
        it.existencia_siis_inicial, it.existencia_siis_actual ?? 'N/D',
        it.conteo_1 ?? '', it.conteo_2 ?? '',
        it.diferencia_cantidad_inicial ?? '', it.diferencia_valor_inicial ?? '',
        it.diferencia_cantidad_actual ?? '', it.diferencia_valor_actual ?? '',
      ];
      if (it.diferencia_cantidad_actual) {
        ws.getRow(fila).eachCell(c => { c.font = { color: { argb: it.diferencia_cantidad_actual > 0 ? 'FF166534' : 'FFB91C1C' } }; });
      }
      fila++;
    }
    ws.getRow(fila + 1).getCell(8).value = 'Dif. valor total (inicial):';
    ws.getRow(fila + 1).getCell(9).value = resumen.diferencia_valor_total_inicial;
    ws.getRow(fila + 2).getCell(10).value = 'Dif. valor total (actual):';
    ws.getRow(fila + 2).getCell(11).value = resumen.diferencia_valor_total_actual;
    ws.getRow(fila + 1).eachCell(c => { c.font = { bold: true }; });
    ws.getRow(fila + 2).eachCell(c => { c.font = { bold: true }; });

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
  const client = await pool.connect();
  try {
    const { cuenta, contable } = req.body;
    if (!cuenta) { client.release(); return res.status(400).json({ error: 'cuenta requerida' }); }

    const { rows: itemRows } = await client.query(
      `SELECT * FROM listas_conteo_items WHERE id = $1 AND lista_id = $2`,
      [req.params.itemId, req.params.id]
    );
    if (!itemRows.length) { client.release(); return res.status(404).json({ error: 'Ítem no encontrado' }); }
    const item = itemRows[0];
    const contableNuevo = truncar(contable, 30);
    const cuentaNuevo = truncar(cuenta, 100);

    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE listas_conteo_items SET cuenta = $1 WHERE id = $2 RETURNING *`,
      [cuentaNuevo, req.params.itemId]
    );

    if (item.concat) {
      const { rows: anteriorRows } = await client.query(`SELECT contable, cuenta FROM tipos_inventario WHERE concat = $1`, [item.concat]);
      const anterior = anteriorRows[0] || null;
      if (!anterior || anterior.contable !== contableNuevo || anterior.cuenta !== cuentaNuevo) {
        await registrarHistorialTipo(client, item.concat, anterior, contableNuevo, cuentaNuevo, 'manual_desde_conteo', req.user.id);
      }
      await client.query(
        `INSERT INTO tipos_inventario (concat, contable, cuenta)
         VALUES ($1, $2, $3)
         ON CONFLICT (concat) DO UPDATE SET contable = EXCLUDED.contable, cuenta = EXCLUDED.cuenta`,
        [item.concat, contableNuevo, cuentaNuevo]
      );
    }
    await client.query('COMMIT');
    res.json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error al clasificar ítem de la lista de conteo:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  } finally {
    client.release();
  }
});

// ── PATCH /api/validador-inventario/listas-conteo/:id/items/:itemId/motivo ───
// Justificación de la diferencia (para sustento contable/auditoría). Sin
// restricción de rol — lo diligencia quien esté haciendo el conteo o el cierre.
router.patch('/listas-conteo/:id/items/:itemId/motivo', authMiddleware, async (req, res) => {
  try {
    const { motivo } = req.body;
    if (motivo === undefined) return res.status(400).json({ error: 'motivo requerido' });
    const { rows } = await pool.query(
      `UPDATE listas_conteo_items SET motivo_diferencia = $1 WHERE id = $2 AND lista_id = $3 RETURNING *`,
      [truncar(motivo, 300), req.params.itemId, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Ítem no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Error al guardar motivo de diferencia:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── GET /api/validador-inventario/dashboard?bodega=BV&desde=&hasta= ──────────
// Vista gerencial de progreso: cuántos grupos existen vs cuántos se han
// contado en el periodo, y la diferencia en valor acumulada de los conteos
// cerrados en ese rango.
router.get('/dashboard', authMiddleware, async (req, res) => {
  try {
    const bodega = (req.query.bodega || '').toUpperCase();
    if (!bodega) return res.status(400).json({ error: 'bodega requerida' });
    const desde = req.query.desde || '1900-01-01';
    const hasta = req.query.hasta || '2999-12-31';

    const { rows: gruposRows } = await pool.query(
      `SELECT COUNT(DISTINCT grupo_inventario(codigo))::int AS total FROM validador_inventario WHERE bodega = $1`,
      [bodega]
    );
    const totalGrupos = gruposRows[0].total;

    const { rows: conteosPeriodo } = await pool.query(
      `SELECT id, tipo, criterio, estado, subclasificar_presentacion, creado_en, cerrado_en
       FROM listas_conteo
       WHERE bodega = $1 AND creado_en::date BETWEEN $2 AND $3
       ORDER BY creado_en DESC`,
      [bodega, desde, hasta]
    );

    const gruposContados = new Set(
      conteosPeriodo.filter(c => c.tipo === 'grupo_inventario' && c.estado === 'cerrada').map(c => c.criterio)
    ).size;

    const cerradosEnPeriodo = conteosPeriodo.filter(c => c.estado === 'cerrada');
    let diferenciaValorPeriodo = 0, itemsConDiferenciaPeriodo = 0;
    for (const c of cerradosEnPeriodo) {
      const items = await obtenerItemsConActual(c, c.id);
      const { resumen } = calcularDetalleReporte(c, items);
      diferenciaValorPeriodo += resumen.diferencia_valor_total_actual;
      itemsConDiferenciaPeriodo += resumen.con_diferencia;
    }

    res.json({
      bodega,
      total_grupos_inventario: totalGrupos,
      grupos_contados_periodo: gruposContados,
      conteos_abiertos: conteosPeriodo.filter(c => c.estado === 'abierta').length,
      conteos_cerrados_periodo: cerradosEnPeriodo.length,
      items_con_diferencia_periodo: itemsConDiferenciaPeriodo,
      diferencia_valor_total_periodo: Number(diferenciaValorPeriodo.toFixed(2)),
      conteos: conteosPeriodo,
    });
  } catch (err) {
    console.error('Error al generar dashboard:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── GET /api/validador-inventario/historial-codigo/:codigo?bodega=BV ─────────
// Todas las veces que un código ha entrado en un conteo, con su resultado —
// útil para detectar diferencias recurrentes (posible fuga o error sistemático).
router.get('/historial-codigo/:codigo', authMiddleware, async (req, res) => {
  try {
    const bodega = (req.query.bodega || '').toUpperCase();
    const { rows } = await pool.query(
      `SELECT li.*, lc.tipo, lc.criterio, lc.estado, lc.creado_en AS conteo_creado_en, lc.cerrado_en AS conteo_cerrado_en
       FROM listas_conteo_items li
       JOIN listas_conteo lc ON lc.id = li.lista_id
       WHERE li.codigo = $1 AND ($2 = '' OR lc.bodega = $2)
       ORDER BY lc.creado_en DESC`,
      [req.params.codigo, bodega]
    );
    const historial = rows.map(it => {
      const definitivo = conteoDefinitivo(it);
      const existenciaActual = it.estado === 'cerrada'
        ? (it.existencia_siis_cierre !== null ? Number(it.existencia_siis_cierre) : null)
        : null;
      const diferencia = (definitivo === null || existenciaActual === null) ? null : Number((definitivo - existenciaActual).toFixed(3));
      return {
        lista_id: it.lista_id, tipo: it.tipo, criterio: it.criterio, estado: it.estado,
        creado_en: it.conteo_creado_en, cerrado_en: it.conteo_cerrado_en,
        conteo_1: it.conteo_1 !== null ? Number(it.conteo_1) : null,
        conteo_2: it.conteo_2 !== null ? Number(it.conteo_2) : null,
        existencia_siis_inicial: Number(it.existencia_siis), existencia_siis_actual: existenciaActual,
        diferencia, motivo_diferencia: it.motivo_diferencia || '',
      };
    });
    res.json(historial);
  } catch (err) {
    console.error('Error al obtener historial de código:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── GET /api/validador-inventario/listas-conteo/consolidado?bodega=&desde=&hasta= ──
// Agrega todos los conteos CERRADOS de un rango de fechas (por cerrado_en):
// totales, y el detalle solo de los ítems con diferencia real, con trazabilidad
// de a qué conteo pertenece cada uno.
router.get('/listas-conteo-consolidado', authMiddleware, async (req, res) => {
  try {
    const bodega = (req.query.bodega || '').toUpperCase();
    if (!bodega) return res.status(400).json({ error: 'bodega requerida' });
    const desde = req.query.desde || '1900-01-01';
    const hasta = req.query.hasta || '2999-12-31';

    const { rows: conteos } = await pool.query(
      `SELECT * FROM listas_conteo WHERE bodega = $1 AND estado = 'cerrada' AND cerrado_en::date BETWEEN $2 AND $3 ORDER BY cerrado_en ASC`,
      [bodega, desde, hasta]
    );

    let diferenciaValorTotal = 0, itemsConDiferencia = 0;
    const itemsDiferencia = [];
    for (const c of conteos) {
      const items = await obtenerItemsConActual(c, c.id);
      const { items: detalle, resumen } = calcularDetalleReporte(c, items);
      diferenciaValorTotal += resumen.diferencia_valor_total_actual;
      itemsConDiferencia += resumen.con_diferencia;
      for (const it of detalle) {
        if (it.diferencia_cantidad_actual) {
          itemsDiferencia.push({ ...it, conteo_id: c.id, conteo_tipo: c.tipo, conteo_criterio: c.criterio, conteo_cerrado_en: c.cerrado_en });
        }
      }
    }

    res.json({
      bodega, desde, hasta,
      total_conteos: conteos.length,
      items_con_diferencia: itemsConDiferencia,
      diferencia_valor_total: Number(diferenciaValorTotal.toFixed(2)),
      conteos: conteos.map(c => ({ id: c.id, tipo: c.tipo, criterio: c.criterio, cerrado_en: c.cerrado_en })),
      items: itemsDiferencia,
    });
  } catch (err) {
    console.error('Error al generar reporte consolidado:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── GET /api/validador-inventario/listas-conteo-consolidado-excel ────────────
router.get('/listas-conteo-consolidado-excel', authMiddleware, async (req, res) => {
  try {
    const bodega = (req.query.bodega || '').toUpperCase();
    if (!bodega) return res.status(400).json({ error: 'bodega requerida' });
    const desde = req.query.desde || '1900-01-01';
    const hasta = req.query.hasta || '2999-12-31';

    const { rows: conteos } = await pool.query(
      `SELECT * FROM listas_conteo WHERE bodega = $1 AND estado = 'cerrada' AND cerrado_en::date BETWEEN $2 AND $3 ORDER BY cerrado_en ASC`,
      [bodega, desde, hasta]
    );
    let diferenciaValorTotal = 0;
    const itemsDiferencia = [];
    for (const c of conteos) {
      const items = await obtenerItemsConActual(c, c.id);
      const { items: detalle, resumen } = calcularDetalleReporte(c, items);
      diferenciaValorTotal += resumen.diferencia_valor_total_actual;
      for (const it of detalle) {
        if (it.diferencia_cantidad_actual) itemsDiferencia.push({ ...it, conteo_id: c.id, conteo_criterio: c.criterio, conteo_cerrado_en: c.cerrado_en });
      }
    }

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Consolidado');
    ws.columns = [{ width: 10 }, { width: 12 }, { width: 16 }, { width: 40 }, { width: 12 }, { width: 12 }, { width: 13 }, { width: 30 }];
    ws.mergeCells('A1:H1');
    ws.getCell('A1').value = `Reporte consolidado de diferencias — Bodega ${bodega} — ${desde} a ${hasta}`;
    ws.getCell('A1').font = { bold: true, size: 13 };
    ws.getCell('A2').value = `Conteos cerrados: ${conteos.length} · Diferencia en valor total: ${diferenciaValorTotal.toFixed(2)}`;
    const filaEnc = 4;
    ws.getRow(filaEnc).values = ['Conteo #', 'Cerrado', 'Código', 'Nombre', 'Conteo def.', 'SIIS actual', 'Dif. Cantidad', 'Motivo'];
    ws.getRow(filaEnc).font = { bold: true };
    let fila = filaEnc + 1;
    for (const it of itemsDiferencia) {
      ws.getRow(fila).values = [
        it.conteo_id, it.conteo_cerrado_en ? new Date(it.conteo_cerrado_en).toLocaleDateString('es-CO') : '',
        it.codigo, it.nombre, it.definitivo, it.existencia_siis_actual, it.diferencia_cantidad_actual, it.motivo_diferencia || '',
      ];
      fila++;
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="consolidado_${bodega}_${desde}_${hasta}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Error al exportar consolidado:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

module.exports = router;









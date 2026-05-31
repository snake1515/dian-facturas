const express = require('express');
const { pool } = require('../models/db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// ── GET /api/cruces-dian ──────────────────────────────────────────────────────
// Lista los meses que tienen archivo guardado
router.get('/', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT mes, año, nombre_archivo, fecha_subida,
              jsonb_array_length(registros) AS total_registros
       FROM cruces_dian
       ORDER BY año DESC, mes DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error al listar cruces DIAN:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── GET /api/cruces-dian/:año/:mes ────────────────────────────────────────────
// Trae los registros de un mes específico
router.get('/:año/:mes', authMiddleware, async (req, res) => {
  try {
    const { año, mes } = req.params;
    const result = await pool.query(
      `SELECT mes, año, nombre_archivo, fecha_subida, registros
       FROM cruces_dian
       WHERE año = $1 AND mes = $2`,
      [año, mes]
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: 'No hay archivo guardado para ese mes' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error al obtener cruce DIAN:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── POST /api/cruces-dian ─────────────────────────────────────────────────────
// Guarda o reemplaza el archivo del mes (UPSERT — siempre queda el más reciente)
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { mes, año, nombre_archivo, registros } = req.body;

    if (!mes || !año || !nombre_archivo || !registros) {
      return res.status(400).json({ error: 'Faltan campos requeridos: mes, año, nombre_archivo, registros' });
    }

    const result = await pool.query(
      `INSERT INTO cruces_dian (mes, año, nombre_archivo, registros, fecha_subida)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (mes, año)
       DO UPDATE SET
         nombre_archivo = EXCLUDED.nombre_archivo,
         registros = EXCLUDED.registros,
         fecha_subida = NOW()
       RETURNING mes, año, nombre_archivo, fecha_subida, jsonb_array_length(registros) AS total_registros`,
      [mes, año, nombre_archivo, JSON.stringify(registros)]
    );

    res.json({ ok: true, ...result.rows[0] });
  } catch (err) {
    console.error('Error al guardar cruce DIAN:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

module.exports = router;

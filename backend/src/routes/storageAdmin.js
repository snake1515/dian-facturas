const express = require('express');
const { authMiddleware, adminOnly } = require('../middleware/auth');
const { analizar, ejecutar, analizarBucket, borrarHuerfanos } = require('../services/limpiezaStorage');

const router = express.Router();

const leerAnio = (v) => {
  const n = parseInt(v, 10);
  return n >= 2000 && n <= new Date().getFullYear() ? n : null;
};

// GET /api/storage-admin/vista-previa?anio=2025&manuales=1
router.get('/vista-previa', authMiddleware, adminOnly, async (req, res) => {
  try {
    const anio = leerAnio(req.query.anio);
    if (!anio) return res.status(400).json({ error: 'Año inválido' });
    const { objetivos, ...resumen } = await analizar(anio, req.query.manuales === '1');
    res.json(resumen);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/storage-admin/liberar  { anio, incluirManuales, confirmacion: 'BORRAR' }
router.post('/liberar', authMiddleware, adminOnly, async (req, res) => {
  try {
    const anio = leerAnio(req.body?.anio);
    if (!anio) return res.status(400).json({ error: 'Año inválido' });
    if (req.body?.confirmacion !== 'BORRAR') return res.status(400).json({ error: 'Confirmación requerida' });
    res.json(await ejecutar(anio, !!req.body.incluirManuales));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/storage-admin/analisis — qué ocupa el bucket y cuánto es huérfano
router.get('/analisis', authMiddleware, adminOnly, async (req, res) => {
  try { res.json(await analizarBucket()); }
  catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

// POST /api/storage-admin/borrar-huerfanos  { confirmacion: 'BORRAR' }
router.post('/borrar-huerfanos', authMiddleware, adminOnly, async (req, res) => {
  try {
    if (req.body?.confirmacion !== 'BORRAR') return res.status(400).json({ error: 'Confirmación requerida' });
    res.json(await borrarHuerfanos());
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

module.exports = router;

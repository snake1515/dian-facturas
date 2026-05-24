const express = require('express');
const { pool } = require('../models/db');
const { getAuthUrl, exchangeCodeForTokens, sincronizarCorreos } = require('../services/gmailService');
const { authMiddleware, adminOnly } = require('../middleware/auth');

const router = express.Router();

// Obtener URL de autorización Gmail
router.get('/auth-url', authMiddleware, adminOnly, (req, res) => {
  try {
    const url = getAuthUrl();
    res.json({ url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Callback OAuth2 de Google
router.get('/callback', async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) return res.status(400).send('Código de autorización no recibido');

    const tokens = await exchangeCodeForTokens(code);

    await pool.query(
      "INSERT INTO configuracion (clave, valor) VALUES ('gmail_refresh_token', $1) ON CONFLICT (clave) DO UPDATE SET valor = $1",
      [tokens.refresh_token]
    );
    await pool.query(
      "INSERT INTO configuracion (clave, valor) VALUES ('gmail_connected', 'true') ON CONFLICT (clave) DO UPDATE SET valor = 'true'"
    );

    // Redirigir al frontend con éxito
    res.redirect(`${process.env.FRONTEND_URL}?gmail=conectado`);
  } catch (err) {
    console.error('Error OAuth callback:', err);
    res.redirect(`${process.env.FRONTEND_URL}?gmail=error`);
  }
});

// Sincronizar manualmente (con filtro de fechas opcional)
router.post('/sync', authMiddleware, async (req, res) => {
  try {
    const { desde, hasta } = req.body || {};
    const result = await sincronizarCorreos(desde || null, hasta || null);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Estado de conexión Gmail
router.get('/status', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT clave, valor FROM configuracion WHERE clave IN ('gmail_connected', 'gmail_account', 'last_sync', 'sync_interval_hours')"
    );
    const cfg = {};
    result.rows.forEach(r => { cfg[r.clave] = r.valor; });
    res.json(cfg);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Desconectar Gmail
router.delete('/disconnect', authMiddleware, adminOnly, async (req, res) => {
  try {
    await pool.query(
      "UPDATE configuracion SET valor = '' WHERE clave IN ('gmail_refresh_token', 'gmail_account')"
    );
    await pool.query(
      "UPDATE configuracion SET valor = 'false' WHERE clave = 'gmail_connected'"
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

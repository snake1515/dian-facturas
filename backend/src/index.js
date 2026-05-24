require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const path = require('path');

const { initDB, pool } = require('./models/db');
const { sincronizarCorreos } = require('./services/gmailService');

const authRoutes = require('./routes/auth');
const facturasRoutes = require('./routes/facturas');
const gmailRoutes = require('./routes/gmail');
const configuracionRoutes = require('./routes/configuracion');

const app = express();
const PORT = process.env.PORT || 3001;

// Middlewares
app.use(cors({
  origin: [process.env.FRONTEND_URL, 'http://localhost:3000'],
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Rutas
app.use('/api/auth', authRoutes);
app.use('/api/facturas', facturasRoutes);
app.use('/api/gmail', gmailRoutes);
app.use('/api/configuracion', configuracionRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Cron job dinámico - lee el intervalo configurado en BD
let cronJob = null;

const iniciarCron = async () => {
  try {
    const res = await pool.query(
      "SELECT valor FROM configuracion WHERE clave = 'sync_interval_hours'"
    );
    const horas = parseInt(res.rows[0]?.valor || '2');
    const expresion = `0 */${horas} * * *`; // cada N horas en punto

    if (cronJob) cronJob.stop();

    cronJob = cron.schedule(expresion, async () => {
      console.log(`⏰ Cron: sincronizando Gmail (cada ${horas}h)`);
      try {
        const gmailConnected = await pool.query(
          "SELECT valor FROM configuracion WHERE clave = 'gmail_connected'"
        );
        if (gmailConnected.rows[0]?.valor === 'true') {
          await sincronizarCorreos();
        }
      } catch (err) {
        console.error('❌ Error en cron de sincronización:', err.message);
      }
    });

    console.log(`✅ Cron configurado: sincronización cada ${horas} hora(s)`);
  } catch (err) {
    console.error('Error iniciando cron:', err.message);
  }
};

// Endpoint para reiniciar cron cuando cambia la configuración
app.post('/api/configuracion/restart-cron', async (req, res) => {
  await iniciarCron();
  res.json({ ok: true });
});

// Inicializar
const arrancar = async () => {
  try {
    await initDB();
    await iniciarCron();
    app.listen(PORT, () => {
      console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
    });
  } catch (err) {
    console.error('❌ Error al iniciar:', err);
    process.exit(1);
  }
};

arrancar();

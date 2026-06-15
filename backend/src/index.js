require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cron = require('node-cron');
const path = require('path');

const { initDB, pool } = require('./models/db');
const { sincronizarCorreos } = require('./services/gmailService');

const authRoutes = require('./routes/auth');
const facturasRoutes = require('./routes/facturas');
const facturasPdfRoutes = require('./routes/facturas-pdf');
const gmailRoutes = require('./routes/gmail');
const configuracionRoutes = require('./routes/configuracion');
const crucesDianRoutes = require('./routes/cruces-dian');
const prestamosRoutes = require('./routes/prestamosRoutes');
const pendientesRoutes = require('./routes/pendientes');

const app = express();
const PORT = process.env.PORT || 3001;

// Security headers
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));

// CORS
app.use(cors({
  origin: [process.env.FRONTEND_URL, 'http://localhost:3000'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Headers adicionales de seguridad
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

// Rutas
app.use('/api/auth', authRoutes);
app.use('/api/facturas', facturasRoutes);
app.use('/api/facturas', facturasPdfRoutes);
app.use('/api/gmail', gmailRoutes);
app.use('/api/configuracion', configuracionRoutes);
app.use('/api/cruces-dian', crucesDianRoutes);
app.use('/api/prestamos', prestamosRoutes);
app.use('/api/pendientes', pendientesRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Cron automático con rango guardado en BD
let cronJob = null;

const iniciarCron = async () => {
  try {
    if (cronJob) cronJob.stop();

    // Leer configuración
    const cfgRes = await pool.query(
      "SELECT clave, valor FROM configuracion WHERE clave IN ('sync_interval_hours', 'gmail_connected', 'sync_desde', 'sync_hasta')"
    );
    const cfg = {};
    cfgRes.rows.forEach(r => { cfg[r.clave] = r.valor; });

    if (cfg.gmail_connected !== 'true') {
      console.log('ℹ️ Gmail no conectado — cron desactivado');
      return;
    }

    const horas = parseInt(cfg.sync_interval_hours || '4');
    if (!horas || horas <= 0) {
      console.log('ℹ️ Frecuencia no configurada — cron desactivado');
      return;
    }

    const expresion = `0 */${horas} * * *`;
    cronJob = cron.schedule(expresion, async () => {
      console.log(`⏰ Cron: sincronizando Gmail (cada ${horas}h)...`);
      try {
        // Leer rango guardado
        const rangoRes = await pool.query(
          "SELECT clave, valor FROM configuracion WHERE clave IN ('sync_desde', 'sync_hasta')"
        );
        const rango = {};
        rangoRes.rows.forEach(r => { rango[r.clave] = r.valor; });

        const desde = rango.sync_desde || null;
        // sync_hasta = siempre fecha de hoy
        const hasta = new Date().toISOString().split('T')[0];

        console.log(`📅 Rango: ${desde} → ${hasta}`);
        await sincronizarCorreos(desde, hasta);
      } catch (err) {
        console.error('❌ Error en cron:', err.message);
      }
    });

    console.log(`✅ Cron activo: cada ${horas} hora(s)`);
  } catch (err) {
    console.error('Error iniciando cron:', err.message);
  }
};

app.post('/api/configuracion/restart-cron', async (req, res) => {
  await iniciarCron();
  res.json({ ok: true });
});

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















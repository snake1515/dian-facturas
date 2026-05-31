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
const gmailRoutes = require('./routes/gmail');
const configuracionRoutes = require('./routes/configuracion');

const app = express();
const PORT = process.env.PORT || 3001;

// Security headers
app.use(helmet({
  contentSecurityPolicy: false, // Desactivado para no bloquear la API REST
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

// Cron desactivado — importación solo por rango de fechas manual
let cronJob = null;

const iniciarCron = async () => {
  try {
    if (cronJob) cronJob.stop();
    console.log(`ℹ️ Sincronización automática desactivada. Usar importación por rango de fechas.`);
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

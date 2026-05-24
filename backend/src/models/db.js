const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const initDB = async () => {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS usuarios (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(100) NOT NULL,
        email VARCHAR(150) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        rol VARCHAR(20) NOT NULL DEFAULT 'consulta' CHECK (rol IN ('admin', 'consulta')),
        activo BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS facturas (
        id SERIAL PRIMARY KEY,
        numero VARCHAR(100) NOT NULL,
        tipo VARCHAR(5) NOT NULL CHECK (tipo IN ('FE', 'NC')),
        cufe VARCHAR(255),
        proveedor_nombre VARCHAR(200) NOT NULL,
        proveedor_nit VARCHAR(50) NOT NULL,
        fecha_emision DATE NOT NULL,
        fecha_vencimiento DATE,
        subtotal NUMERIC(18,2) DEFAULT 0,
        iva NUMERIC(18,2) DEFAULT 0,
        total NUMERIC(18,2) NOT NULL,
        estado VARCHAR(30) DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'procesado', 'reenviado')),
        reenviado_a VARCHAR(150),
        gmail_message_id VARCHAR(255) UNIQUE,
        pdf_path VARCHAR(500),
        xml_path VARCHAR(500),
        xml_raw TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS productos_factura (
        id SERIAL PRIMARY KEY,
        factura_id INTEGER REFERENCES facturas(id) ON DELETE CASCADE,
        codigo VARCHAR(100),
        descripcion TEXT NOT NULL,
        cantidad NUMERIC(10,3) NOT NULL,
        precio_unitario NUMERIC(18,2) NOT NULL,
        total NUMERIC(18,2) NOT NULL
      );

      CREATE TABLE IF NOT EXISTS responsables_factura (
        id SERIAL PRIMARY KEY,
        factura_id INTEGER REFERENCES facturas(id) ON DELETE CASCADE,
        email VARCHAR(150) NOT NULL,
        UNIQUE(factura_id, email)
      );

      CREATE TABLE IF NOT EXISTS reenvios_log (
        id SERIAL PRIMARY KEY,
        factura_id INTEGER REFERENCES facturas(id) ON DELETE CASCADE,
        enviado_por INTEGER REFERENCES usuarios(id),
        destinatarios TEXT NOT NULL,
        fecha TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS configuracion (
        id SERIAL PRIMARY KEY,
        clave VARCHAR(100) UNIQUE NOT NULL,
        valor TEXT NOT NULL
      );

      INSERT INTO configuracion (clave, valor) VALUES
        ('sync_interval_hours', '2'),
        ('gmail_connected', 'false'),
        ('gmail_account', ''),
        ('gmail_refresh_token', ''),
        ('auto_process_xml', 'true'),
        ('notify_on_new', 'true'),
        ('palabras_clave', 'factura electrónica,nota crédito,DIAN,FE-')
      ON CONFLICT (clave) DO NOTHING;
    `);
    console.log('✅ Base de datos inicializada correctamente');
  } finally {
    client.release();
  }
};

module.exports = { pool, initDB };

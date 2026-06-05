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
        estado_contable VARCHAR(50) DEFAULT 'por_gestionar',
        documento_ingreso VARCHAR(100),
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

      CREATE TABLE IF NOT EXISTS contactos (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(150) NOT NULL,
        email VARCHAR(150) UNIQUE NOT NULL,
        cargo VARCHAR(100),
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS responsables_factura (
        id SERIAL PRIMARY KEY,
        factura_id INTEGER REFERENCES facturas(id) ON DELETE CASCADE,
        email VARCHAR(150) NOT NULL,
        nombre VARCHAR(150),
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

      -- Migraciones para DBs existentes
      ALTER TABLE facturas ADD COLUMN IF NOT EXISTS documento_ingreso VARCHAR(100);
      ALTER TABLE facturas ADD COLUMN IF NOT EXISTS documento_ingreso VARCHAR(100);
      ALTER TABLE facturas ADD COLUMN IF NOT EXISTS notas TEXT;
      ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_rol_check;
      ALTER TABLE usuarios ADD CONSTRAINT usuarios_rol_check CHECK (rol IN ('admin', 'editor', 'lector', 'consulta'));
      
      ALTER TABLE responsables_factura ADD COLUMN IF NOT EXISTS nombre VARCHAR(150);
      ALTER TABLE facturas ALTER COLUMN estado_contable SET DEFAULT 'por_gestionar';
      ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS tema VARCHAR(50) DEFAULT 'oscuro';
      CREATE TABLE IF NOT EXISTS contactos (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(150) NOT NULL,
        email VARCHAR(150) UNIQUE NOT NULL,
        cargo VARCHAR(100),
        created_at TIMESTAMP DEFAULT NOW()
      );

      -- Migración: agregar rol prestamos
      ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_rol_check;
      ALTER TABLE usuarios ADD CONSTRAINT usuarios_rol_check CHECK (rol IN ('admin', 'editor', 'lector', 'consulta', 'prestamos'));

      -- ─── TABLAS PRÉSTAMOS ────────────────────────────────────────────────────
      CREATE TABLE IF NOT EXISTS prestamo_clinicas (
        id         SERIAL PRIMARY KEY,
        nombre     VARCHAR(200) NOT NULL,
        nit        VARCHAR(50),
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS prestamo_productos (
        id               SERIAL PRIMARY KEY,
        codigo           VARCHAR(20) UNIQUE NOT NULL,
        nombre           TEXT NOT NULL,
        unidad           VARCHAR(50),
        precio_unitario  NUMERIC(14,2) DEFAULT 0,
        categoria        VARCHAR(100),
        cuenta_contable  VARCHAR(20),
        created_at       TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS prestamos (
        id                 SERIAL PRIMARY KEY,
        tipo               VARCHAR(10) NOT NULL CHECK (tipo IN ('ingreso','egreso')),
        clinica_id         INTEGER REFERENCES prestamo_clinicas(id),
        clinica_nombre     VARCHAR(200),
        bodega_codigo      VARCHAR(10) NOT NULL,
        bodega_nombre      VARCHAR(100),
        fecha              DATE NOT NULL,
        documento_contable VARCHAR(100) NOT NULL,
        observaciones      TEXT,
        soporte_url        TEXT,
        items              JSONB DEFAULT '[]',
        estado             VARCHAR(20) NOT NULL DEFAULT 'abierto' CHECK (estado IN ('abierto','parcial','cerrado')),
        created_at         TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS prestamo_devoluciones (
        id                 SERIAL PRIMARY KEY,
        prestamo_id        INTEGER NOT NULL REFERENCES prestamos(id) ON DELETE CASCADE,
        fecha              DATE NOT NULL,
        documento_contable VARCHAR(100) NOT NULL,
        soporte_url        TEXT,
        items              JSONB DEFAULT '[]',
        created_at         TIMESTAMP DEFAULT NOW()
      );

      -- Migraciones prestamo_productos
      ALTER TABLE prestamo_productos ALTER COLUMN cuenta_contable TYPE VARCHAR(30);
      ALTER TABLE prestamo_productos ALTER COLUMN categoria TYPE VARCHAR(200);

      -- Migraciones prestamos
      ALTER TABLE prestamos ALTER COLUMN tipo TYPE VARCHAR(30);
      ALTER TABLE prestamos ALTER COLUMN bodega_codigo TYPE VARCHAR(100);
      ALTER TABLE prestamos ALTER COLUMN bodega_nombre TYPE VARCHAR(200);

      -- Tabla de cruces entre préstamos y devoluciones
      CREATE TABLE IF NOT EXISTS prestamo_cruces (
        id             SERIAL PRIMARY KEY,
        prestamo_id    INTEGER NOT NULL REFERENCES prestamos(id) ON DELETE CASCADE,
        devolucion_id  INTEGER NOT NULL REFERENCES prestamos(id) ON DELETE CASCADE,
        tipo_cruce     VARCHAR(10) NOT NULL DEFAULT 'total' CHECK (tipo_cruce IN ('total','parcial')),
        observaciones  TEXT,
        soporte_url    TEXT,
        soporte_items  JSONB DEFAULT '{}',
        created_at     TIMESTAMP DEFAULT NOW(),
        UNIQUE(prestamo_id, devolucion_id)
      );

      -- Migración: tipo de préstamo ahora incluye devoluciones (IDP, ED)
      ALTER TABLE prestamos DROP CONSTRAINT IF EXISTS prestamos_tipo_check;
      ALTER TABLE prestamos ADD CONSTRAINT prestamos_tipo_check
        CHECK (tipo IN ('ingreso','egreso','devolucion_ingreso','devolucion_egreso'));

      -- Migración: bodega_codigo puede ser null
      ALTER TABLE prestamos ALTER COLUMN bodega_codigo DROP NOT NULL;

      CREATE INDEX IF NOT EXISTS idx_cruces_prestamo    ON prestamo_cruces(prestamo_id);
      CREATE INDEX IF NOT EXISTS idx_cruces_devolucion  ON prestamo_cruces(devolucion_id);

      CREATE INDEX IF NOT EXISTS idx_prestamos_estado       ON prestamos(estado);
      CREATE INDEX IF NOT EXISTS idx_prestamos_tipo         ON prestamos(tipo);
      CREATE INDEX IF NOT EXISTS idx_devoluciones_prestamo  ON prestamo_devoluciones(prestamo_id);
      -- ─────────────────────────────────────────────────────────────────────────

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
















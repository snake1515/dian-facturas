/**
 * Índices de rendimiento. Se crean al arrancar (IF NOT EXISTS), cada uno por
 * separado: si alguno falla (tabla inexistente, extensión no disponible), los
 * demás se crean igual y la app arranca normal.
 *
 * Motivo: en la base gratis (1 GB de RAM) las consultas sin índice recorren
 * tablas completas y ordenan filas grandes en memoria; varias a la vez agotan
 * la memoria del servidor de PostgreSQL.
 */
const { pool } = require('../models/db');

const INDICES = [
  // Listado de facturas: filtro por tipo y orden por fecha
  `CREATE INDEX IF NOT EXISTS idx_facturas_tipo_fecha ON facturas (tipo, fecha_emision DESC, created_at DESC)`,
  // Deduplicación de Gmail y de PDFs manuales
  `CREATE INDEX IF NOT EXISTS idx_facturas_gmail_msg ON facturas (gmail_message_id)`,
  `CREATE INDEX IF NOT EXISTS idx_facturas_numero_nit ON facturas (numero, proveedor_nit)`,
  // Categoría por proveedor (JOIN con proveedores por NIT)
  `CREATE INDEX IF NOT EXISTS idx_facturas_nit_trim ON facturas ((TRIM(proveedor_nit)))`,
  // Cruce factura ↔ nota crédito (número normalizado)
  `CREATE INDEX IF NOT EXISTS idx_facturas_nc_doc ON facturas ((UPPER(TRIM(documento_ingreso)))) WHERE tipo = 'NC'`,
  `CREATE INDEX IF NOT EXISTS idx_facturas_fe_numero ON facturas ((UPPER(TRIM(numero)))) WHERE tipo = 'FE'`,
  // Tablas hijas de facturas
  `CREATE INDEX IF NOT EXISTS idx_responsables_factura ON responsables_factura (factura_id)`,
  `CREATE INDEX IF NOT EXISTS idx_productos_factura ON productos_factura (factura_id)`,
  `CREATE INDEX IF NOT EXISTS idx_coincidencias_revisada ON coincidencias_gmail (revisada, created_at DESC)`,
  // Préstamos: listados ordenados y cruces
  `CREATE INDEX IF NOT EXISTS idx_prestamos_created ON prestamos (created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_prestamo_cruces_created ON prestamo_cruces (created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_prestamo_cruces_prestamo ON prestamo_cruces (prestamo_id)`,
  `CREATE INDEX IF NOT EXISTS idx_prestamo_cruces_devolucion ON prestamo_cruces (devolucion_id)`,
  `CREATE INDEX IF NOT EXISTS idx_prestamo_productos_nombre ON prestamo_productos (nombre)`,
];

// Búsqueda por texto parcial (ILIKE '%texto%'): requiere la extensión pg_trgm
const INDICES_TEXTO = [
  `CREATE INDEX IF NOT EXISTS idx_trgm_facturas_proveedor ON facturas USING gin (proveedor_nombre gin_trgm_ops)`,
  `CREATE INDEX IF NOT EXISTS idx_trgm_facturas_numero ON facturas USING gin (numero gin_trgm_ops)`,
  `CREATE INDEX IF NOT EXISTS idx_trgm_facturas_notas ON facturas USING gin (notas gin_trgm_ops)`,
  `CREATE INDEX IF NOT EXISTS idx_trgm_productos_desc ON productos_factura USING gin (descripcion gin_trgm_ops)`,
  `CREATE INDEX IF NOT EXISTS idx_trgm_productos_codigo ON productos_factura USING gin (codigo gin_trgm_ops)`,
];

const crearIndices = async () => {
  let creados = 0, fallidos = 0;
  for (const sql of INDICES) {
    try { await pool.query(sql); creados++; }
    catch (e) { fallidos++; console.warn('⚠️ Índice no creado:', e.message); }
  }
  let trgm = true;
  try { await pool.query('CREATE EXTENSION IF NOT EXISTS pg_trgm'); }
  catch (e) { trgm = false; console.warn('⚠️ pg_trgm no disponible (búsqueda sin índice de texto):', e.message); }
  if (trgm) {
    for (const sql of INDICES_TEXTO) {
      try { await pool.query(sql); creados++; }
      catch (e) { fallidos++; console.warn('⚠️ Índice de texto no creado:', e.message); }
    }
  }
  // Actualiza estadísticas para que el planificador use los índices nuevos
  try { await pool.query('ANALYZE facturas'); await pool.query('ANALYZE prestamos'); } catch (e) { /* opcional */ }
  console.log(`⚡ Índices de rendimiento verificados: ${creados}${fallidos ? ` (${fallidos} no aplicables)` : ''}`);
};

module.exports = { crearIndices };

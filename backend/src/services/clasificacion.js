/**
 * Clasificación de facturas y notas crédito en "obra" o "administrativa".
 *
 * - Cada proveedor (por NIT) tiene una categoría en la tabla "proveedores".
 * - Una factura puede tener una categoría manual (facturas.categoria_manual)
 *   que tiene prioridad sobre la del proveedor.
 * - Si ninguna está definida, la factura está "sin clasificar" y se muestra
 *   en ambas pestañas.
 */
const { pool } = require('../models/db');

// Categoría efectiva de una factura "f" (expresión SQL reutilizable)
const CATEGORIA_SQL = `COALESCE(f.categoria_manual, (SELECT p.categoria FROM proveedores p WHERE p.nit = TRIM(f.proveedor_nit)))`;

// Fecha desde la que cuenta el aviso de facturas sin gestión
const DESDE_SIN_GESTION = '2026-11-01';
const DIAS_SIN_GESTION = 5;

// Copia a "proveedores" los NIT nuevos que aparezcan en las facturas.
// Se ejecuta como máximo una vez por minuto (salvo forzar = true).
let ultimaSync = 0;
let enCurso = null;
const sincronizarProveedores = async (forzar = false) => {
  if (!forzar && Date.now() - ultimaSync < 60 * 1000) return 0;
  if (enCurso) return enCurso;
  enCurso = (async () => {
    try {
      const r = await pool.query(`
        INSERT INTO proveedores (nit, nombre)
        SELECT DISTINCT ON (TRIM(proveedor_nit)) TRIM(proveedor_nit), proveedor_nombre
        FROM facturas
        WHERE COALESCE(TRIM(proveedor_nit), '') <> ''
        ORDER BY TRIM(proveedor_nit), fecha_emision DESC NULLS LAST
        ON CONFLICT (nit) DO NOTHING`);
      ultimaSync = Date.now();
      if (r.rowCount) console.log(`🏷️ Proveedores nuevos registrados: ${r.rowCount}`);
      return r.rowCount;
    } catch (e) {
      console.error('⚠️ Error sincronizando proveedores:', e.message);
      return 0;
    } finally { enCurso = null; }
  })();
  return enCurso;
};

module.exports = { CATEGORIA_SQL, DESDE_SIN_GESTION, DIAS_SIN_GESTION, sincronizarProveedores };

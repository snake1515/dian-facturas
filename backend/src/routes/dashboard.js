/**
 * Dashboard: resumen de toda la app en una sola llamada.
 * Devuelve solo conteos y totales (nunca listados), para que sea liviano
 * en tráfico de base de datos. Cada sección se incluye según el rol,
 * con los mismos permisos que usa el menú de la app.
 */
const express = require('express');
const { pool } = require('../models/db');
const { authMiddleware } = require('../middleware/auth');
const { DESDE_SIN_GESTION, DIAS_SIN_GESTION, sincronizarProveedores } = require('../services/clasificacion');

const router = express.Router();

const PERMISOS = {
  facturas:    ['admin', 'editor', 'obra', 'consulta', 'lector'],
  pendientes:  ['admin', 'editor', 'obra'],
  prestamos:   ['admin', 'editor', 'regente', 'obra'],
  validador:   ['admin', 'editor', 'obra'],
  cruce:       ['admin', 'editor'],
  proveedores: ['admin', 'editor'],
};
const puede = (rol, seccion) => PERMISOS[seccion].includes(rol);

// Categoría efectiva con JOIN (más eficiente que subconsulta por fila)
const FROM_CAT = `
  FROM facturas f
  LEFT JOIN proveedores p ON p.nit = TRIM(f.proveedor_nit)`;
const CAT = `COALESCE(COALESCE(f.categoria_manual, p.categoria), 'sin_clasificar')`;
const HOY = `(NOW() AT TIME ZONE 'America/Bogota')::date`;
const LLEGADA = `(f.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Bogota')::date`;
const SIN_GESTION = `COALESCE(f.estado_contable, 'por_gestionar') = 'por_gestionar'
        AND f.flujo_tipo IS NULL AND COALESCE(f.es_contrato, false) = false`;

const seguro = async (fn) => { try { return await fn(); } catch (e) { console.error('Dashboard:', e.message); return null; } };

router.get('/', authMiddleware, async (req, res) => {
  const rol = req.user?.rol;
  const r = { generado: new Date().toISOString(), secciones: [] };

  try {
    if (puede(rol, 'facturas')) {
      r.secciones.push('facturas');
      await sincronizarProveedores();

      // Llegadas y mes actual, por tipo (FE/NC) y categoría
      r.resumen = (await pool.query(`
        SELECT f.tipo, ${CAT} AS cat,
          COUNT(*) FILTER (WHERE ${LLEGADA} = ${HOY})::int                         AS nuevas_hoy,
          COUNT(*) FILTER (WHERE ${LLEGADA} > ${HOY} - 7)::int                     AS nuevas_7d,
          COUNT(*) FILTER (WHERE date_trunc('month', f.fecha_emision) = date_trunc('month', ${HOY}))::int AS mes_cantidad,
          COALESCE(SUM(f.total) FILTER (WHERE date_trunc('month', f.fecha_emision) = date_trunc('month', ${HOY})), 0)::float AS mes_valor
        ${FROM_CAT}
        WHERE f.tipo IN ('FE', 'NC')
        GROUP BY 1, 2`)).rows;

      // Gestión contable de las facturas del mes, por categoría
      r.gestionMes = (await pool.query(`
        SELECT ${CAT} AS cat,
          CASE
            WHEN ${SIN_GESTION} THEN 'sin_gestion'
            WHEN f.estado_contable = 'aprobado' THEN 'aprobado'
            WHEN f.estado_contable IN ('ingresado_orden_compra', 'ingresado_caja_menor') THEN 'ingresada'
            ELSE 'en_proceso'
          END AS etapa,
          COUNT(*)::int AS n
        ${FROM_CAT}
        WHERE f.tipo = 'FE' AND date_trunc('month', f.fecha_emision) = date_trunc('month', ${HOY})
        GROUP BY 1, 2`)).rows;

      // Pendientes de acción
      const acc = (await pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE f.tipo = 'FE' AND f.fecha_emision >= $1::date
            AND f.fecha_emision < ${HOY} - $2::int AND ${SIN_GESTION}
            AND COALESCE(f.notas, '') NOT LIKE '%FACTURA CON NOVEDAD%' AND ${CAT} <> 'administrativa')::int AS sin_gestion_obra,
          COUNT(*) FILTER (WHERE f.tipo = 'FE' AND f.fecha_emision >= $1::date
            AND f.fecha_emision < ${HOY} - $2::int AND ${SIN_GESTION}
            AND COALESCE(f.notas, '') NOT LIKE '%FACTURA CON NOVEDAD%' AND ${CAT} = 'administrativa')::int AS sin_gestion_adm,
          COUNT(*) FILTER (WHERE f.tipo = 'FE' AND f.fecha_emision >= $1::date
            AND f.fecha_emision < ${HOY} - $2::int AND ${SIN_GESTION}
            AND COALESCE(f.notas, '') NOT LIKE '%FACTURA CON NOVEDAD%')::int AS sin_gestion_total,
          COUNT(*) FILTER (WHERE COALESCE(f.notas, '') LIKE '%FACTURA CON NOVEDAD%' AND ${SIN_GESTION})::int AS con_novedad,
          COUNT(*) FILTER (WHERE f.origen = 'pdf_manual' AND f.pdf_path IS NULL)::int AS manuales_sin_pdf
        ${FROM_CAT}`, [DESDE_SIN_GESTION, DIAS_SIN_GESTION])).rows[0];
      r.acciones = { ...acc, dias: DIAS_SIN_GESTION };

      // Llegadas por semana (últimas 8), obra vs administrativas
      r.semanas = (await pool.query(`
        SELECT to_char(date_trunc('week', ${LLEGADA}), 'YYYY-MM-DD') AS semana, ${CAT} AS cat, COUNT(*)::int AS n
        ${FROM_CAT}
        WHERE f.tipo = 'FE' AND ${LLEGADA} >= date_trunc('week', ${HOY}) - INTERVAL '7 weeks'
        GROUP BY 1, 2 ORDER BY 1`)).rows;

      // Estado de Gmail: alerta si no sincroniza hace más del doble del intervalo (+1 h)
      const cfg = {};
      (await pool.query(`SELECT clave, valor FROM configuracion
        WHERE clave IN ('gmail_connected', 'gmail_account', 'last_sync', 'sync_interval_hours', 'gmail_ultimo_error')`))
        .rows.forEach(x => { cfg[x.clave] = x.valor; });
      const horas = parseInt(cfg.sync_interval_hours || '4', 10) || 4;
      const ultima = cfg.last_sync ? new Date(cfg.last_sync) : null;
      const horasSin = ultima ? (Date.now() - ultima.getTime()) / 3600000 : null;
      let error = null;
      try { error = cfg.gmail_ultimo_error ? JSON.parse(cfg.gmail_ultimo_error) : null; } catch (e) { error = null; }
      // Mientras el servidor duerme (plan gratis) no se sincroniza: eso no es una falla.
      // Solo se avisa si hay un error real, si Gmail está desconectado, o si el
      // servidor lleva despierto más del intervalo y aun así no ha sincronizado.
      const horasDespierto = process.uptime() / 3600;
      const atrasado = horasSin === null || horasSin > horas * 2 + 1;
      r.gmail = {
        conectado: cfg.gmail_connected === 'true',
        cuenta: cfg.gmail_account || null,
        ultimaSync: cfg.last_sync || null,
        intervaloHoras: horas,
        error: error ? { ...error, permisoVencido: /invalid_grant/i.test(error.mensaje || '') } : null,
        alerta: cfg.gmail_connected !== 'true' || !!error || (atrasado && horasDespierto > horas + 0.5),
      };
    }

    if (puede(rol, 'proveedores')) {
      r.secciones.push('proveedores');
      r.proveedoresSinClasificar = (await pool.query(
        `SELECT COUNT(*)::int AS n FROM proveedores WHERE categoria IS NULL`)).rows[0].n;
    }

    if (puede(rol, 'pendientes')) {
      r.secciones.push('pendientes');
      r.pendientes = await seguro(async () => (await pool.query(`
        SELECT COUNT(DISTINCT pfe.factura_id)::int AS facturas, COUNT(*)::int AS productos
        FROM productos_factura_estado pfe
        JOIN productos_factura p ON p.id = pfe.producto_id
        JOIN facturas f ON f.id = pfe.factura_id AND f.tipo = 'FE'
        WHERE pfe.nota IS NOT NULL OR (pfe.cantidad_recibida IS NOT NULL AND pfe.cantidad_recibida < p.cantidad)`)).rows[0]);
    }

    if (puede(rol, 'prestamos')) {
      r.secciones.push('prestamos');
      r.prestamos = await seguro(async () => (await pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE tipo = 'dado' AND estado <> 'cerrado')::int     AS dados_abiertos,
          COUNT(*) FILTER (WHERE tipo = 'recibido' AND estado <> 'cerrado')::int AS recibidos_abiertos,
          COUNT(*) FILTER (WHERE estado = 'parcial')::int                        AS parciales,
          COUNT(*) FILTER (WHERE estado <> 'cerrado' AND fecha < ${HOY} - 30)::int AS mas_30_dias,
          MIN(fecha) FILTER (WHERE estado <> 'cerrado')                          AS mas_antiguo
        FROM prestamos`)).rows[0]);
    }

    if (puede(rol, 'validador')) {
      r.secciones.push('validador');
      r.validador = await seguro(async () => (await pool.query(`
        SELECT
          (SELECT COUNT(*)::int FROM listas_conteo WHERE estado = 'abierta') AS listas_abiertas,
          (SELECT COUNT(*)::int FROM listas_conteo_items i JOIN listas_conteo l ON l.id = i.lista_id
            WHERE l.estado = 'abierta' AND COALESCE(i.conteo_2, i.conteo_1) IS NULL) AS items_sin_contar,
          (SELECT COUNT(*)::int FROM listas_conteo_items i JOIN listas_conteo l ON l.id = i.lista_id
            WHERE l.estado = 'abierta' AND COALESCE(i.conteo_2, i.conteo_1) IS NOT NULL
              AND COALESCE(i.conteo_2, i.conteo_1) <> COALESCE(i.existencia_siis, 0)
              AND COALESCE(TRIM(i.motivo_diferencia), '') = '') AS diferencias_sin_motivo`)).rows[0]);
    }

    if (puede(rol, 'cruce')) {
      r.secciones.push('cruce');
      // Último reporte DIAN guardado: cuántas de sus facturas ya están en la app (mismo mes)
      r.cruce = await seguro(async () => (await pool.query(`
        SELECT c.mes, c."año" AS anio, c.nombre_archivo, c.fecha_subida,
          jsonb_array_length(c.registros)::int AS total,
          (SELECT COUNT(*)::int FROM jsonb_array_elements(c.registros) reg
            WHERE EXISTS (SELECT 1 FROM facturas f
              WHERE UPPER(TRIM(f.numero)) = UPPER(TRIM(reg->>'numero'))
                AND to_char(f.fecha_emision, 'YYYY-MM') = c."año" || '-' || c.mes)) AS encontradas
        FROM cruces_dian c
        ORDER BY c."año" DESC, c.mes DESC
        LIMIT 1`)).rows[0] || null);
    }

    res.json(r);
  } catch (err) {
    console.error('Error en dashboard:', err);
    res.status(500).json({ error: 'Error generando el resumen' });
  }
});

module.exports = router;

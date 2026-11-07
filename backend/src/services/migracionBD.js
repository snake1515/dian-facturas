/**
 * Migración de la base de datos a otro PostgreSQL (Neon, otro proyecto de
 * Supabase, etc.), servidor a servidor, sin consola.
 *
 * Origen:  DATABASE_URL (la base actual de la app)
 * Destino: DESTINO_DATABASE_URL (variable de entorno en Render)
 *
 * Copia del esquema "public": secuencias, tablas (tipos, NOT NULL, defaults),
 * todos los datos, restricciones (PK, UNIQUE, CHECK, FK), índices y el valor
 * actual de los consecutivos. Al final compara el número de filas por tabla.
 *
 * La ORIGEN solo se lee (nunca se modifica). En el destino solo se toca el
 * esquema "public", y solo si está vacío (o si se pide reemplazar).
 */
const { Pool } = require('pg');
const { pool: origen, limpiarUrl } = require('../models/db');

const q = (id) => `"${String(id).replace(/"/g, '""')}"`;

let estado = { fase: 'inactivo', log: [], inicio: null, fin: null, error: null, tablas: [], resultado: null };
const log = (m) => { console.log('🚚 Migración BD:', m); estado.log.push(`${new Date().toLocaleTimeString('es-CO')} — ${m}`); };

const crearDestino = () => {
  const url = process.env.DESTINO_DATABASE_URL;
  if (!url) return null;
  // SSL siempre, salvo que la URL diga explícitamente sslmode=disable (pruebas locales)
  const sinSsl = /[?&]sslmode=disable(&|$)/.test(url);
  return new Pool({ connectionString: limpiarUrl(url), ssl: sinSsl ? false : { rejectUnauthorized: false }, max: 3 });
};

const tablasDe = async (db) => (await db.query(
  `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
)).rows.map(r => r.tablename);

// ── Vista previa: tamaño, tablas y estado del destino ────────────────────────
const vistaPrevia = async () => {
  const tam = await origen.query(`SELECT pg_database_size(current_database())::bigint AS bytes`);
  const tablas = await origen.query(`
    SELECT c.relname AS tabla, c.reltuples::bigint AS filas_aprox,
           pg_total_relation_size(c.oid)::bigint AS bytes
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
    ORDER BY bytes DESC`);
  const r = {
    origen: { bytes: Number(tam.rows[0].bytes), tablas: tablas.rows.map(t => ({ ...t, bytes: Number(t.bytes), filas_aprox: Math.max(0, Number(t.filas_aprox)) })) },
    destino: { configurado: !!process.env.DESTINO_DATABASE_URL },
  };
  if (r.destino.configurado) {
    const destino = crearDestino();
    try {
      const v = await destino.query('SELECT version() AS v, current_database() AS db');
      r.destino.version = v.rows[0].v.split(' ').slice(0, 2).join(' ');
      r.destino.basedatos = v.rows[0].db;
      r.destino.host = (() => { try { return new URL(process.env.DESTINO_DATABASE_URL).host; } catch (e) { return '?'; } })();
      r.destino.tablasExistentes = await tablasDe(destino);
    } catch (e) {
      r.destino.error = e.message;
    } finally { await destino.end().catch(() => {}); }
  }
  return r;
};

// ── Migración completa ───────────────────────────────────────────────────────
const migrar = async ({ reemplazar = false } = {}) => {
  const destino = crearDestino();
  const lector = await origen.connect();
  try {
    // Foto consistente de la base origen durante toda la copia
    await lector.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');

    const tablas = await tablasDe(lector);
    log(`Origen: ${tablas.length} tablas`);

    // 0) Destino vacío (o limpiarlo si se pidió reemplazar)
    const existentes = await tablasDe(destino);
    if (existentes.length) {
      if (!reemplazar) throw new Error(`El destino ya tiene ${existentes.length} tablas (${existentes.slice(0, 5).join(', ')}…). Marque "Reemplazar" para borrarlas en el DESTINO y copiar de nuevo.`);
      log(`Borrando ${existentes.length} tablas existentes en el destino…`);
      for (const t of existentes) await destino.query(`DROP TABLE IF EXISTS public.${q(t)} CASCADE`);
      const seqs = await destino.query(`SELECT sequencename FROM pg_sequences WHERE schemaname = 'public'`);
      for (const s of seqs.rows) await destino.query(`DROP SEQUENCE IF EXISTS public.${q(s.sequencename)} CASCADE`);
    }

    // 1) Secuencias
    estado.fase = 'estructura';
    const secuencias = (await lector.query(`
      SELECT sequencename, data_type, increment_by, min_value, max_value, start_value, cycle, last_value
      FROM pg_sequences WHERE schemaname = 'public'`)).rows;
    for (const s of secuencias) {
      await destino.query(`CREATE SEQUENCE public.${q(s.sequencename)} AS ${s.data_type}
        INCREMENT BY ${s.increment_by} MINVALUE ${s.min_value} MAXVALUE ${s.max_value}
        START WITH ${s.start_value} ${s.cycle ? 'CYCLE' : 'NO CYCLE'}`);
    }
    log(`Secuencias creadas: ${secuencias.length}`);

    // 2) Tablas (columnas, tipos, NOT NULL, defaults)
    const columnasPorTabla = {};
    for (const t of tablas) {
      const cols = (await lector.query(`
        SELECT a.attname AS nombre, format_type(a.atttypid, a.atttypmod) AS tipo, a.attnotnull AS notnull,
               pg_get_expr(d.adbin, d.adrelid) AS def, a.attgenerated AS generada
        FROM pg_attribute a
        JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
        LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE n.nspname = 'public' AND c.relname = $1 AND a.attnum > 0 AND NOT a.attisdropped
        ORDER BY a.attnum`, [t])).rows;
      columnasPorTabla[t] = cols;
      const defs = cols.map(c => {
        let s = `${q(c.nombre)} ${c.tipo}`;
        if (c.generada === 's') s += ` GENERATED ALWAYS AS (${c.def}) STORED`;
        else if (c.def) s += ` DEFAULT ${c.def}`;
        if (c.notnull) s += ' NOT NULL';
        return s;
      });
      await destino.query(`CREATE TABLE public.${q(t)} (${defs.join(', ')})`);
    }
    log(`Tablas creadas: ${tablas.length}`);

    // 3) Datos
    estado.fase = 'datos';
    estado.tablas = tablas.map(t => ({ tabla: t, copiadas: 0, total: null }));
    for (const [idx, t] of tablas.entries()) {
      const cols = columnasPorTabla[t].filter(c => c.generada !== 's');
      const total = Number((await lector.query(`SELECT COUNT(*)::bigint AS n FROM public.${q(t)}`)).rows[0].n);
      estado.tablas[idx].total = total;
      if (!total) continue;
      const lista = cols.map(c => q(c.nombre)).join(', ');
      // Cada valor se lee como TEXTO exacto de PostgreSQL (fechas con microsegundos,
      // numéricos, JSON, arreglos…) y el destino lo vuelve a interpretar con el tipo
      // de su columna: copia fiel, sin pasar por conversiones de JavaScript.
      const listaTexto = cols.map((c, j) => `${q(c.nombre)}::text AS c${j}`).join(', ');
      const LOTE = 200;
      for (let offset = 0; offset < total; offset += LOTE) {
        const filas = (await lector.query(
          `SELECT ${listaTexto} FROM public.${q(t)} ORDER BY ctid LIMIT ${LOTE} OFFSET ${offset}`)).rows;
        if (!filas.length) break;
        const valores = [];
        const tuplas = filas.map(f => {
          const ph = cols.map((c, j) => {
            valores.push(f[`c${j}`]);
            return `$${valores.length}::${c.tipo}`;
          });
          return `(${ph.join(', ')})`;
        });
        await destino.query(`INSERT INTO public.${q(t)} (${lista}) VALUES ${tuplas.join(', ')}`, valores);
        estado.tablas[idx].copiadas += filas.length;
      }
      log(`${t}: ${estado.tablas[idx].copiadas} filas`);
    }

    // 4) Restricciones: primero PK/UNIQUE/CHECK/EXCLUDE, luego FK
    estado.fase = 'restricciones';
    const restr = (await lector.query(`
      SELECT c.relname AS tabla, con.conname AS nombre, con.contype AS tipo, pg_get_constraintdef(con.oid) AS def
      FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND con.contype IN ('p','u','c','x','f')
      ORDER BY CASE con.contype WHEN 'p' THEN 1 WHEN 'u' THEN 2 WHEN 'c' THEN 3 WHEN 'x' THEN 4 ELSE 5 END`)).rows;
    for (const r of restr) {
      await destino.query(`ALTER TABLE public.${q(r.tabla)} ADD CONSTRAINT ${q(r.nombre)} ${r.def}`);
    }
    log(`Restricciones: ${restr.length}`);

    // 5) Índices que no pertenecen a una restricción
    const idxs = (await lector.query(`
      SELECT i.indexdef FROM pg_indexes i
      WHERE i.schemaname = 'public'
        AND NOT EXISTS (
          SELECT 1 FROM pg_constraint con JOIN pg_class ic ON ic.oid = con.conindid
          JOIN pg_namespace n ON n.oid = ic.relnamespace
          WHERE n.nspname = 'public' AND ic.relname = i.indexname)`)).rows;
    for (const i of idxs) await destino.query(i.indexdef);
    log(`Índices: ${idxs.length}`);

    // 6) Consecutivos: valor actual y dueño (columna serial)
    for (const s of secuencias) {
      if (s.last_value !== null) await destino.query(`SELECT setval('public.${q(s.sequencename)}', $1, true)`, [s.last_value]);
    }
    const duenos = (await lector.query(`
      SELECT s.relname AS seq, t.relname AS tabla, a.attname AS col
      FROM pg_class s JOIN pg_namespace n ON n.oid = s.relnamespace
      JOIN pg_depend d ON d.objid = s.oid AND d.deptype = 'a'
      JOIN pg_class t ON t.oid = d.refobjid
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid
      WHERE s.relkind = 'S' AND n.nspname = 'public'`)).rows;
    for (const o of duenos) {
      await destino.query(`ALTER SEQUENCE public.${q(o.seq)} OWNED BY public.${q(o.tabla)}.${q(o.col)}`);
    }
    log(`Consecutivos ajustados: ${secuencias.length}`);

    // 7) Verificación: filas por tabla en origen vs destino
    estado.fase = 'verificando';
    const verif = [];
    for (const t of tablas) {
      const a = Number((await lector.query(`SELECT COUNT(*)::bigint AS n FROM public.${q(t)}`)).rows[0].n);
      const b = Number((await destino.query(`SELECT COUNT(*)::bigint AS n FROM public.${q(t)}`)).rows[0].n);
      verif.push({ tabla: t, origen: a, destino: b, ok: a === b });
    }
    await lector.query('COMMIT');
    const fallas = verif.filter(v => !v.ok);
    estado.resultado = { verificacion: verif, ok: fallas.length === 0 };
    log(fallas.length ? `⚠️ ${fallas.length} tablas con diferencias` : '✅ Copia verificada: todas las tablas coinciden');
    estado.fase = 'terminado';
  } catch (e) {
    await lector.query('ROLLBACK').catch(() => {});
    estado.error = e.message;
    estado.fase = 'error';
    log(`❌ ${e.message}`);
  } finally {
    lector.release();
    estado.fin = new Date().toISOString();
    await destino.end().catch(() => {});
  }
};

const iniciar = (opts) => {
  if (['estructura', 'datos', 'restricciones', 'verificando'].includes(estado.fase)) {
    throw new Error('Ya hay una migración en curso');
  }
  if (!process.env.DESTINO_DATABASE_URL) throw new Error('Falta la variable DESTINO_DATABASE_URL en Render');
  estado = { fase: 'estructura', log: [], inicio: new Date().toISOString(), fin: null, error: null, tablas: [], resultado: null };
  migrar(opts); // en segundo plano; el avance se consulta con obtenerEstado()
};

const obtenerEstado = () => estado;

module.exports = { vistaPrevia, iniciar, obtenerEstado };

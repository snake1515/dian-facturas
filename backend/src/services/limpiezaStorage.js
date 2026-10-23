/**
 * Liberación de espacio en Supabase Storage por año.
 * Borra del bucket los archivos (PDF/XML) de las facturas de un año y deja
 * pdf_path/xml_path en NULL. NUNCA borra facturas de la base de datos.
 *  - PDF de Gmail: recuperables luego desde el correo original.
 *  - XML: siguen disponibles desde la columna xml_raw.
 *  - PDF manuales: solo se incluyen si incluirManuales = true (NO recuperables).
 */
const { pool } = require('../models/db');

const BUCKET = 'facturas';

const analizar = async (anio, incluirManuales = false) => {
  const tam = new Map();
  let totalBucket = null;
  let archivosBucket = null;
  try {
    const r = await pool.query(
      "SELECT name, COALESCE((metadata->>'size')::bigint, 0) AS size FROM storage.objects WHERE bucket_id = $1",
      [BUCKET]
    );
    totalBucket = 0;
    r.rows.forEach(o => { tam.set(o.name, Number(o.size)); totalBucket += Number(o.size); });
    archivosBucket = r.rows.length;
  } catch (e) {
    console.error('⚠️ No se pudieron leer tamaños de storage.objects:', e.message);
  }

  const { rows } = await pool.query(
    `SELECT id, origen, pdf_path, xml_path FROM facturas
     WHERE fecha_emision >= $1 AND fecha_emision < $2
       AND (pdf_path IS NOT NULL OR xml_path IS NOT NULL)`,
    [`${anio}-01-01`, `${anio + 1}-01-01`]
  );

  const objetivos = [];
  const r = {
    pdfGmail: { n: 0, bytes: 0 }, xml: { n: 0, bytes: 0 },
    pdfManual: { n: 0, bytes: 0 }, pdfManualConservados: { n: 0, bytes: 0 },
  };
  for (const f of rows) {
    if (f.xml_path) {
      const s = tam.get(f.xml_path) || 0;
      objetivos.push({ id: f.id, campo: 'xml_path', ruta: f.xml_path, size: s });
      r.xml.n++; r.xml.bytes += s;
    }
    if (f.pdf_path) {
      const s = tam.get(f.pdf_path) || 0;
      if (f.origen === 'gmail') {
        objetivos.push({ id: f.id, campo: 'pdf_path', ruta: f.pdf_path, size: s });
        r.pdfGmail.n++; r.pdfGmail.bytes += s;
      } else if (incluirManuales) {
        objetivos.push({ id: f.id, campo: 'pdf_path', ruta: f.pdf_path, size: s });
        r.pdfManual.n++; r.pdfManual.bytes += s;
      } else {
        r.pdfManualConservados.n++; r.pdfManualConservados.bytes += s;
      }
    }
  }
  const bytesLiberar = objetivos.reduce((a, o) => a + o.size, 0);
  return {
    anio, incluirManuales, facturas: rows.length, ...r,
    archivosBorrar: objetivos.length, bytesLiberar,
    bucket: { archivos: archivosBucket, bytes: totalBucket },
    objetivos,
  };
};

const borrarLote = async (rutas) => {
  const res = await fetch(`${process.env.SUPABASE_URL}/storage/v1/object/${BUCKET}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefixes: rutas }),
  });
  const texto = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${texto.slice(0, 300)}`);
  let data = [];
  try { data = JSON.parse(texto || '[]'); } catch (e) {}
  return new Set((Array.isArray(data) ? data : []).map(o => o.name));
};

const ejecutar = async (anio, incluirManuales = false) => {
  const a = await analizar(anio, incluirManuales);
  let borrados = 0, fallidos = 0, bytesLiberados = 0, error = null;
  for (let i = 0; i < a.objetivos.length; i += 100) {
    const lote = a.objetivos.slice(i, i + 100);
    try {
      const ok = await borrarLote(lote.map(o => o.ruta));
      for (const o of lote) {
        if (ok.has(o.ruta)) {
          await pool.query(`UPDATE facturas SET ${o.campo} = NULL WHERE id = $1 AND ${o.campo} = $2`, [o.id, o.ruta]);
          borrados++; bytesLiberados += o.size;
        } else fallidos++;
      }
    } catch (e) {
      console.error(`❌ Limpieza storage lote ${i / 100 + 1}:`, e.message);
      fallidos += lote.length;
      error = e.message;
      if (/restricted|402/i.test(e.message)) break; // Supabase bloquea borrados
    }
  }
  console.log(`🧹 Limpieza storage ${anio}: ${borrados} borrados, ${fallidos} fallidos`);
  return { anio, borrados, fallidos, bytesLiberados, error };
};

// ── Análisis completo del bucket y archivos huérfanos ────────────────────────
// Un archivo es "huérfano" si ninguna columna de la base de datos lo referencia
// (p. ej. quedó al borrar facturas, que no borran sus archivos). Se detectan
// automáticamente todas las columnas tipo ruta/URL de las tablas públicas.
const obtenerReferencias = async () => {
  const cols = await pool.query(`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public'
      AND data_type IN ('character varying', 'text')
      AND column_name <> 'xml_raw'
      AND (column_name ILIKE '%path%' OR column_name ILIKE '%url%'
           OR column_name ILIKE '%archivo%' OR column_name ILIKE '%soporte%'
           OR column_name ILIKE '%pdf%' OR column_name ILIKE '%xml%')
  `);
  if (!cols.rows.length) return { sql: 'SELECT NULL::text AS ref WHERE false', columnas: [] };
  const partes = cols.rows.map(c =>
    `SELECT "${c.column_name}"::text AS ref FROM public."${c.table_name}" WHERE "${c.column_name}" IS NOT NULL`
  );
  // Si alguna referencia es una URL completa, se queda solo con la ruta dentro del bucket
  const sql = `SELECT DISTINCT regexp_replace(ref, '^.*/${BUCKET}/', '') AS ref FROM (${partes.join(' UNION ALL ')}) t`;
  return { sql, columnas: cols.rows.map(c => `${c.table_name}.${c.column_name}`) };
};

const analizarBucket = async () => {
  const { sql, columnas } = await obtenerReferencias();
  const base = `
    WITH refs AS (${sql}),
    obj AS (
      SELECT o.name, COALESCE((o.metadata->>'size')::bigint, 0) AS size, o.created_at,
             CASE WHEN position('/' in o.name) > 0 THEN split_part(o.name, '/', 1) ELSE '(raíz)' END AS carpeta,
             lower(substring(o.name from '\\.([^./]+)$')) AS ext,
             EXISTS (SELECT 1 FROM refs r WHERE r.ref = o.name) AS referenciado
      FROM storage.objects o WHERE o.bucket_id = $1
    )`;
  const tot = await pool.query(`${base}
    SELECT referenciado, COUNT(*)::int AS n, COALESCE(SUM(size),0)::bigint AS bytes FROM obj GROUP BY referenciado`, [BUCKET]);
  const porCarpeta = await pool.query(`${base}
    SELECT carpeta, COALESCE(ext,'?') AS ext, referenciado, COUNT(*)::int AS n, SUM(size)::bigint AS bytes
    FROM obj GROUP BY 1,2,3 ORDER BY bytes DESC LIMIT 30`, [BUCKET]);
  const huerfanosPorMes = await pool.query(`${base}
    SELECT to_char(created_at, 'YYYY-MM') AS mes, COUNT(*)::int AS n, SUM(size)::bigint AS bytes
    FROM obj WHERE NOT referenciado GROUP BY 1 ORDER BY 1`, [BUCKET]);
  const borrables = await pool.query(`${base}
    SELECT COUNT(*)::int AS n, COALESCE(SUM(size),0)::bigint AS bytes FROM obj
    WHERE NOT referenciado AND created_at < NOW() - INTERVAL '24 hours'`, [BUCKET]);

  const r = { referenciados: { n: 0, bytes: 0 }, huerfanos: { n: 0, bytes: 0 } };
  tot.rows.forEach(x => { r[x.referenciado ? 'referenciados' : 'huerfanos'] = { n: x.n, bytes: Number(x.bytes) }; });
  return {
    total: { n: r.referenciados.n + r.huerfanos.n, bytes: r.referenciados.bytes + r.huerfanos.bytes },
    ...r,
    huerfanosBorrables: { n: borrables.rows[0].n, bytes: Number(borrables.rows[0].bytes) },
    porCarpeta: porCarpeta.rows.map(x => ({ ...x, bytes: Number(x.bytes) })),
    huerfanosPorMes: huerfanosPorMes.rows.map(x => ({ ...x, bytes: Number(x.bytes) })),
    columnasRevisadas: columnas,
  };
};

const borrarHuerfanos = async () => {
  const { sql } = await obtenerReferencias();
  const { rows } = await pool.query(`
    WITH refs AS (${sql})
    SELECT o.name, COALESCE((o.metadata->>'size')::bigint, 0) AS size
    FROM storage.objects o
    WHERE o.bucket_id = $1 AND o.created_at < NOW() - INTERVAL '24 hours'
      AND NOT EXISTS (SELECT 1 FROM refs r WHERE r.ref = o.name)`, [BUCKET]);
  let borrados = 0, fallidos = 0, bytesLiberados = 0, error = null;
  for (let i = 0; i < rows.length; i += 100) {
    const lote = rows.slice(i, i + 100);
    try {
      const ok = await borrarLote(lote.map(o => o.name));
      for (const o of lote) { if (ok.has(o.name)) { borrados++; bytesLiberados += Number(o.size); } else fallidos++; }
    } catch (e) {
      console.error(`❌ Borrado huérfanos lote ${i / 100 + 1}:`, e.message);
      fallidos += lote.length; error = e.message;
      if (/restricted|402/i.test(e.message)) break;
    }
  }
  console.log(`🧹 Huérfanos: ${borrados} borrados, ${fallidos} fallidos`);
  return { borrados, fallidos, bytesLiberados, error };
};

module.exports = { analizar, ejecutar, analizarBucket, borrarHuerfanos };

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

module.exports = { analizar, ejecutar };

/**
 * Libera espacio en Supabase Storage borrando los archivos (PDF/XML) de las
 * facturas de un año. NO borra las facturas de la base de datos: solo los
 * archivos del bucket, y deja pdf_path/xml_path en NULL.
 *  - Los PDF de facturas de Gmail se pueden recuperar luego desde el correo.
 *  - Los XML se siguen descargando desde la columna xml_raw.
 *  - Los PDF de facturas manuales NO se tocan, salvo con --incluir-manuales.
 *
 * Uso (desde la carpeta backend, con un .env que tenga DATABASE_URL,
 * SUPABASE_URL y SUPABASE_SERVICE_KEY, los mismos de Render):
 *   node scripts/liberar-storage.js --anio=2025                 -> solo muestra
 *   node scripts/liberar-storage.js --anio=2025 --ejecutar      -> borra
 *   node scripts/liberar-storage.js --anio=2025 --ejecutar --incluir-manuales
 */
require('dotenv').config();
const { Pool } = require('pg');

const args = process.argv.slice(2);
const anio = parseInt((args.find(a => a.startsWith('--anio=')) || '--anio=2025').split('=')[1], 10);
const EJECUTAR = args.includes('--ejecutar');
const INCLUIR_MANUALES = args.includes('--incluir-manuales');
const BUCKET = 'facturas';
const { DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;

if (!DATABASE_URL || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Faltan variables: DATABASE_URL, SUPABASE_URL y SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
const mb = (b) => (b / 1024 / 1024).toFixed(1) + ' MB';

const borrarLote = async (rutas) => {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefixes: rutas }),
  });
  const texto = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${texto.slice(0, 300)}`);
  return JSON.parse(texto || '[]').map(o => o.name);
};

(async () => {
  // Tamaños reales de los archivos del bucket
  const tam = new Map();
  let totalBucket = 0;
  try {
    const r = await pool.query(
      "SELECT name, COALESCE((metadata->>'size')::bigint, 0) AS size FROM storage.objects WHERE bucket_id = $1",
      [BUCKET]
    );
    r.rows.forEach(o => { tam.set(o.name, Number(o.size)); totalBucket += Number(o.size); });
    console.log(`\n📦 Bucket "${BUCKET}": ${r.rows.length} archivos, ${mb(totalBucket)} en total`);
  } catch (e) {
    console.log('⚠️ No se pudieron leer los tamaños (storage.objects):', e.message);
  }

  const { rows } = await pool.query(
    `SELECT id, numero, origen, pdf_path, xml_path FROM facturas
     WHERE fecha_emision >= $1 AND fecha_emision < $2
       AND (pdf_path IS NOT NULL OR xml_path IS NOT NULL)`,
    [`${anio}-01-01`, `${anio + 1}-01-01`]
  );

  const objetivos = []; // { id, campo, ruta, size }
  const resumen = { pdfGmail: [0, 0], pdfManual: [0, 0], xml: [0, 0], pdfManualOmitidos: [0, 0] };
  for (const f of rows) {
    if (f.xml_path) {
      const s = tam.get(f.xml_path) || 0;
      objetivos.push({ id: f.id, campo: 'xml_path', ruta: f.xml_path, size: s });
      resumen.xml[0]++; resumen.xml[1] += s;
    }
    if (f.pdf_path) {
      const s = tam.get(f.pdf_path) || 0;
      if (f.origen === 'gmail') {
        objetivos.push({ id: f.id, campo: 'pdf_path', ruta: f.pdf_path, size: s });
        resumen.pdfGmail[0]++; resumen.pdfGmail[1] += s;
      } else if (INCLUIR_MANUALES) {
        objetivos.push({ id: f.id, campo: 'pdf_path', ruta: f.pdf_path, size: s });
        resumen.pdfManual[0]++; resumen.pdfManual[1] += s;
      } else {
        resumen.pdfManualOmitidos[0]++; resumen.pdfManualOmitidos[1] += s;
      }
    }
  }

  const totalLiberar = objetivos.reduce((a, o) => a + o.size, 0);
  console.log(`\n🗓️  Facturas ${anio} con archivos: ${rows.length}`);
  console.log(`   PDF de Gmail a borrar:      ${resumen.pdfGmail[0]} (${mb(resumen.pdfGmail[1])})`);
  console.log(`   XML a borrar:               ${resumen.xml[0]} (${mb(resumen.xml[1])})`);
  if (INCLUIR_MANUALES) console.log(`   PDF manuales a borrar:      ${resumen.pdfManual[0]} (${mb(resumen.pdfManual[1])})  ⚠️ NO recuperables`);
  else console.log(`   PDF manuales (se conservan): ${resumen.pdfManualOmitidos[0]} (${mb(resumen.pdfManualOmitidos[1])})`);
  console.log(`\n   ➜ Se liberarían: ${mb(totalLiberar)}` + (totalBucket ? `  (bucket quedaría en ~${mb(totalBucket - totalLiberar)})` : ''));

  if (!EJECUTAR) {
    console.log('\nModo vista previa: no se borró nada. Agregue --ejecutar para borrar.\n');
    await pool.end(); return;
  }

  console.log('\n🧹 Borrando...');
  let ok = 0, fallos = 0;
  for (let i = 0; i < objetivos.length; i += 100) {
    const lote = objetivos.slice(i, i + 100);
    try {
      const borrados = new Set(await borrarLote(lote.map(o => o.ruta)));
      for (const o of lote) {
        // Si Supabase no devuelve la lista, se asume borrado solo si el archivo ya no existe
        if (borrados.has(o.ruta)) {
          await pool.query(`UPDATE facturas SET ${o.campo} = NULL WHERE id = $1 AND ${o.campo} = $2`, [o.id, o.ruta]);
          ok++;
        } else fallos++;
      }
    } catch (e) {
      console.error(`❌ Lote ${i / 100 + 1}:`, e.message);
      fallos += lote.length;
      if (/restricted|402/.test(e.message)) {
        console.error('Supabase no permite borrar mientras el Storage está restringido. Detenido.');
        break;
      }
    }
    process.stdout.write(`   ${Math.min(i + 100, objetivos.length)}/${objetivos.length}\r`);
  }
  console.log(`\n✅ Borrados: ${ok}   ❌ Fallidos: ${fallos}\n`);
  await pool.end();
})().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });

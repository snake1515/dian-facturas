// Copia TODOS los archivos del bucket de Supabase Storage a Cloudflare R2.
// Supabase solo se lee (nunca se borra nada). Lo que ya está en R2 se salta,
// así que se puede volver a correr cuantas veces haga falta (retoma donde quedó).
const { R2_ACTIVO, esArchivoGmail } = require('./storageService');
const { pool } = require('../models/db');

const BUCKET = 'facturas';
const SUPA = () => process.env.SUPABASE_URL;
const KEY = () => process.env.SUPABASE_SERVICE_KEY;
const PARALELO = Number(process.env.R2_COPIA_PARALELO) || 12;

let estado = { fase: 'inactivo' };

const headers = () => ({ Authorization: `Bearer ${KEY()}`, apikey: KEY() });

// Lista recursiva del bucket con la API de Storage (no depende de la base de datos)
const listar = async (prefijo = '') => {
  const archivos = [];
  for (let offset = 0; ; offset += 1000) {
    const res = await fetch(`${SUPA()}/storage/v1/object/list/${BUCKET}`, {
      method: 'POST',
      headers: { ...headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix: prefijo, limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } }),
    });
    const txt = await res.text();
    if (!res.ok) throw new Error(`Supabase respondió ${res.status} al listar "${prefijo || '/'}": ${txt.slice(0, 200)}`);
    const items = JSON.parse(txt);
    for (const it of items) {
      const ruta = prefijo ? `${prefijo}/${it.name}` : it.name;
      if (it.id === null || it.id === undefined) {
        archivos.push(...await listar(ruta)); // carpeta
      } else {
        archivos.push({ ruta, size: Number(it.metadata?.size || 0), mime: it.metadata?.mimetype || 'application/octet-stream' });
      }
    }
    if (items.length < 1000) break;
  }
  return archivos;
};

const r2Cliente = () => {
  const { S3Client } = require('@aws-sdk/client-s3');
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env;
  return new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
  });
};

const yaEnR2 = async (r2, ruta) => {
  const { HeadObjectCommand } = require('@aws-sdk/client-s3');
  try { await r2.send(new HeadObjectCommand({ Bucket: process.env.R2_BUCKET, Key: ruta })); return true; }
  catch (e) {
    if (e?.$metadata?.httpStatusCode === 404 || e?.name === 'NotFound') return false;
    throw e;
  }
};

const bajarSupabase = async (ruta) => {
  const url = `${SUPA()}/storage/v1/object/${BUCKET}/${ruta.split('/').map(encodeURIComponent).join('/')}`;
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) throw new Error(`Supabase ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
};

const vistaPrevia = async () => {
  if (!R2_ACTIVO) throw new Error('R2 no está configurado en Render (faltan variables R2_*).');
  const todos = await listar();
  const archivos = todos.filter(a => !esArchivoGmail(a.ruta));
  const porCarpeta = {};
  for (const a of archivos) {
    const c = a.ruta.includes('/') ? a.ruta.split('/')[0] : '(raíz)';
    porCarpeta[c] = porCarpeta[c] || { n: 0, bytes: 0 };
    porCarpeta[c].n++; porCarpeta[c].bytes += a.size;
  }
  const gm = todos.filter(a => esArchivoGmail(a.ruta));
  return { archivos: archivos.length, bytes: archivos.reduce((s, a) => s + a.size, 0), porCarpeta,
           gmail: { archivos: gm.length, bytes: gm.reduce((s, a) => s + a.size, 0) } };
};

const iniciar = () => {
  if (!R2_ACTIVO) throw new Error('R2 no está configurado en Render (faltan variables R2_*).');
  if (estado.fase === 'listando' || estado.fase === 'copiando') throw new Error('Ya hay una copia en curso.');
  estado = { fase: 'listando', inicio: new Date().toISOString(), total: 0, bytesTotal: 0, copiados: 0, saltados: 0, bytesCopiados: 0, errores: [] };
  (async () => {
    try {
      // Los archivos de Gmail no se copian: el PDF se lee del correo y el XML está en la base
      const todos = await listar();
      const archivos = todos.filter(a => !esArchivoGmail(a.ruta));
      estado.omitidosGmail = todos.length - archivos.length;
      Object.assign(estado, { fase: 'copiando', total: archivos.length, bytesTotal: archivos.reduce((s, a) => s + a.size, 0) });
      const r2 = r2Cliente();
      const { PutObjectCommand } = require('@aws-sdk/client-s3');
      let i = 0;
      const trabajador = async () => {
        while (i < archivos.length) {
          const a = archivos[i++];
          try {
            if (await yaEnR2(r2, a.ruta)) { estado.saltados++; continue; }
            const buf = await bajarSupabase(a.ruta);
            await r2.send(new PutObjectCommand({ Bucket: process.env.R2_BUCKET, Key: a.ruta, Body: buf, ContentType: a.mime }));
            estado.copiados++; estado.bytesCopiados += buf.length;
          } catch (e) {
            if (estado.errores.length < 200) estado.errores.push({ ruta: a.ruta, error: e.message.slice(0, 160) });
            else estado.erroresExtra = (estado.erroresExtra || 0) + 1;
          }
        }
      };
      await Promise.all(Array.from({ length: PARALELO }, trabajador));
      estado.fase = 'terminado';
      estado.fin = new Date().toISOString();
      console.log(`☁️ Copia a R2 terminada: ${estado.copiados} copiados, ${estado.saltados} ya estaban, ${estado.errores.length} errores`);
    } catch (e) {
      estado.fase = 'error';
      estado.mensaje = e.message;
      console.error('❌ Copia a R2:', e.message);
    }
  })();
};

const obtenerEstado = () => estado;

// Borra de R2 los PDF/XML que vinieron por Gmail (se pueden volver a traer del correo / están en la base).
// Solo borra si la base confirma de qué correo es (PDF) o que tiene el XML guardado en xml_raw.
const limpiarGmail = async () => {
  if (!R2_ACTIVO) throw new Error('R2 no está configurado.');
  const { ListObjectsV2Command, DeleteObjectsCommand } = require('@aws-sdk/client-s3');
  const r2 = r2Cliente();
  const claves = [];
  let token;
  do {
    const r = await r2.send(new ListObjectsV2Command({ Bucket: process.env.R2_BUCKET, ContinuationToken: token }));
    (r.Contents || []).forEach(o => claves.push({ ruta: o.Key, size: o.Size || 0 }));
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);

  const ids = new Set();
  const xmlOk = new Set();
  const q = async (sql) => { try { return (await pool.query(sql)).rows; } catch (e) { return []; } };
  for (const t of ['facturas', 'coincidencias_gmail']) {
    (await q(`SELECT DISTINCT gmail_message_id AS id FROM ${t} WHERE gmail_message_id IS NOT NULL`)).forEach(r => ids.add(r.id));
    (await q(`SELECT xml_path FROM ${t} WHERE xml_path IS NOT NULL AND xml_raw IS NOT NULL`)).forEach(r => xmlOk.add(r.xml_path));
  }
  const borrar = claves.filter(c => {
    if (!esArchivoGmail(c.ruta)) return false;
    if (/\.xml$/i.test(c.ruta)) return xmlOk.has(c.ruta);
    return ids.has(c.ruta.split('/')[0].split('_')[0]);
  });
  let borrados = 0, bytes = 0;
  for (let i = 0; i < borrar.length; i += 1000) {
    const lote = borrar.slice(i, i + 1000);
    await r2.send(new DeleteObjectsCommand({ Bucket: process.env.R2_BUCKET, Delete: { Objects: lote.map(c => ({ Key: c.ruta })), Quiet: true } }));
    borrados += lote.length; bytes += lote.reduce((s, c) => s + c.size, 0);
  }
  const quedan = claves.length - borrados;
  return { enR2: claves.length, borrados, bytesLiberados: bytes, quedan,
           bytesQuedan: claves.reduce((s, c) => s + c.size, 0) - bytes };
};

module.exports = { vistaPrevia, iniciar, obtenerEstado, limpiarGmail };

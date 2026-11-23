// Copia TODOS los archivos del bucket de Supabase Storage a Cloudflare R2.
// Supabase solo se lee (nunca se borra nada). Lo que ya está en R2 se salta,
// así que se puede volver a correr cuantas veces haga falta (retoma donde quedó).
const { R2_ACTIVO } = require('./storageService');

const BUCKET = 'facturas';
const SUPA = () => process.env.SUPABASE_URL;
const KEY = () => process.env.SUPABASE_SERVICE_KEY;
const PARALELO = 4;

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
  const archivos = await listar();
  const porCarpeta = {};
  for (const a of archivos) {
    const c = a.ruta.includes('/') ? a.ruta.split('/')[0] : '(raíz)';
    porCarpeta[c] = porCarpeta[c] || { n: 0, bytes: 0 };
    porCarpeta[c].n++; porCarpeta[c].bytes += a.size;
  }
  return { archivos: archivos.length, bytes: archivos.reduce((s, a) => s + a.size, 0), porCarpeta };
};

const iniciar = () => {
  if (!R2_ACTIVO) throw new Error('R2 no está configurado en Render (faltan variables R2_*).');
  if (estado.fase === 'listando' || estado.fase === 'copiando') throw new Error('Ya hay una copia en curso.');
  estado = { fase: 'listando', inicio: new Date().toISOString(), total: 0, bytesTotal: 0, copiados: 0, saltados: 0, bytesCopiados: 0, errores: [] };
  (async () => {
    try {
      const archivos = await listar();
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

module.exports = { vistaPrevia, iniciar, obtenerEstado };

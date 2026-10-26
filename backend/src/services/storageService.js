const https = require('https');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const BUCKET = 'facturas';

/**
 * Sube un archivo a Supabase Storage
 * @param {Buffer} buffer - contenido del archivo
 * @param {string} filename - nombre del archivo en el bucket
 * @param {string} mimeType - tipo MIME
 * @returns {string} path del archivo en el bucket
 */
const subirSupabase = async (buffer, filename, mimeType) => {
  const url = `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${filename}`;
  
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': mimeType,
        'Content-Length': buffer.length,
        'x-upsert': 'true',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200 || res.statusCode === 201) {
          resolve(filename);
        } else {
          reject(new Error(`Storage error ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(buffer);
    req.end();
  });
};

/**
 * Descarga un archivo de Supabase Storage
 * @param {string} filename - path del archivo en el bucket
 * @returns {Buffer} contenido del archivo
 */
const descargarSupabase = async (filename) => {
  const url = `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${filename}`;

  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${SUPABASE_KEY}`,
      },
    };

    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve(Buffer.concat(chunks));
        } else {
          // Se adjunta el código HTTP y el cuerpo para poder diagnosticar
          // (404 = archivo no existe en el bucket; 402/403 = cuota/restricción de Supabase)
          const err = new Error(`Storage download error ${res.statusCode}: ${Buffer.concat(chunks).toString('utf-8').slice(0, 300)}`);
          err.statusCode = res.statusCode;
          reject(err);
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
};

/**
 * Elimina un archivo de Supabase Storage
 */
const eliminarSupabase = async (filename) => {
  const url = `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${filename}`;

  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname,
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${SUPABASE_KEY}`,
      },
    };

    const req = https.request(options, (res) => {
      res.on('data', () => {});
      res.on('end', () => resolve());
    });

    req.on('error', reject);
    req.end();
  });
};

// ── Cloudflare R2 ────────────────────────────────────────────────────────────
// Si las variables R2_* están configuradas, todo archivo NUEVO se guarda en R2.
// Al leer se busca primero en R2 y, si no está, en Supabase (archivos antiguos).
// Si R2 no está configurado, todo sigue funcionando igual que antes (solo Supabase).
const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env;
const R2_ACTIVO = !!(R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET);

let r2 = null;
if (R2_ACTIVO) {
  const { S3Client } = require('@aws-sdk/client-s3');
  r2 = new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
  });
  console.log(`☁️ Storage: Cloudflare R2 activo (bucket "${R2_BUCKET}") — Supabase queda solo como respaldo de lectura`);
} else {
  console.log('☁️ Storage: Supabase (R2 no configurado)');
}

const subirR2 = async (buffer, filename, mimeType) => {
  const { PutObjectCommand } = require('@aws-sdk/client-s3');
  await r2.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: filename, Body: buffer, ContentType: mimeType }));
  return filename;
};

const descargarR2 = async (filename) => {
  const { GetObjectCommand } = require('@aws-sdk/client-s3');
  try {
    const res = await r2.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: filename }));
    return Buffer.from(await res.Body.transformToByteArray());
  } catch (err) {
    const status = err?.$metadata?.httpStatusCode;
    if (err?.name === 'NoSuchKey' || status === 404) return null; // no está en R2
    throw err;
  }
};

const eliminarR2 = async (filename) => {
  const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
  await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: filename }));
};

// ── API pública (misma firma de siempre) ─────────────────────────────────────
const subirArchivo = async (buffer, filename, mimeType) => {
  if (R2_ACTIVO) return subirR2(buffer, filename, mimeType);
  return subirSupabase(buffer, filename, mimeType);
};

const descargarArchivo = async (filename) => {
  if (R2_ACTIVO) {
    try {
      const buf = await descargarR2(filename);
      if (buf) return buf;
    } catch (err) {
      console.error(`⚠️ Error leyendo de R2 (${filename}):`, err.message);
    }
  }
  return descargarSupabase(filename); // archivos antiguos
};

const eliminarArchivo = async (filename) => {
  if (R2_ACTIVO) {
    try { await eliminarR2(filename); } catch (err) { console.error(`⚠️ Error borrando de R2 (${filename}):`, err.message); }
  }
  try { await eliminarSupabase(filename); } catch (err) { /* puede no existir o estar bloqueado */ }
};

module.exports = { subirArchivo, descargarArchivo, eliminarArchivo, R2_ACTIVO };

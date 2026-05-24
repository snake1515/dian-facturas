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
const subirArchivo = async (buffer, filename, mimeType) => {
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
const descargarArchivo = async (filename) => {
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
          reject(new Error(`Storage download error ${res.statusCode}`));
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
const eliminarArchivo = async (filename) => {
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

module.exports = { subirArchivo, descargarArchivo, eliminarArchivo };

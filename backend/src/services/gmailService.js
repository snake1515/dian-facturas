const { google } = require('googleapis');
const AdmZip = require('adm-zip');
const { pool } = require('../models/db');
const { parsearXMLDIAN } = require('./xmlParser');
const { subirArchivo } = require('./storageService');

const getOAuth2Client = () => {
  return new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    process.env.GMAIL_REDIRECT_URI
  );
};

const getAuthUrl = () => {
  const oauth2Client = getOAuth2Client();
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/userinfo.email',
    ],
  });
};

const exchangeCodeForTokens = async (code) => {
  const oauth2Client = getOAuth2Client();
  const { tokens } = await oauth2Client.getToken(code);
  return tokens;
};

const getAuthenticatedClient = async () => {
  const res = await pool.query(
    "SELECT valor FROM configuracion WHERE clave = 'gmail_refresh_token'"
  );
  const refreshToken = res.rows[0]?.valor;
  if (!refreshToken) throw new Error('Gmail no está conectado');
  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  return oauth2Client;
};

const sincronizarCorreos = async (desde = null, hasta = null) => {
  console.log(`🔄 Iniciando sincronización de Gmail${desde ? ` desde ${desde} hasta ${hasta}` : ' (todo)'}...`);
  try {
    const auth = await getAuthenticatedClient();
    const gmail = google.gmail({ version: 'v1', auth });

    const cfgRes = await pool.query(
      "SELECT valor FROM configuracion WHERE clave = 'palabras_clave'"
    );
    const palabras = (cfgRes.rows[0]?.valor || 'RV:,factura electronica,DIAN').split(',').map(p => p.trim());
    let query = palabras.map(p => `subject:"${p}"`).join(' OR ');
    query = `(${query}) has:attachment`;

    // Filtro por fechas en formato Gmail
    let desdeTimestamp = null;
    let hastaTimestamp = null;

    if (desde) {
      const d = new Date(desde + 'T00:00:00');
      desdeTimestamp = d.getTime();
      query += ` after:${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
    }
    if (hasta) {
      const h = new Date(hasta + 'T23:59:59');
      hastaTimestamp = h.getTime();
      // Sumar un dia para incluir el dia hasta en Gmail
      const hNext = new Date(h);
      hNext.setDate(hNext.getDate() + 1);
      query += ` before:${hNext.getFullYear()}/${String(hNext.getMonth()+1).padStart(2,'0')}/${String(hNext.getDate()).padStart(2,'0')}`;
    }

    console.log(`🔍 Query Gmail: ${query}`);

    // Paginar para traer todos los correos del rango
    let messages = [];
    let pageToken = null;
    do {
      const listRes = await gmail.users.messages.list({
        userId: 'me',
        q: query,
        maxResults: 500,
        ...(pageToken ? { pageToken } : {}),
      });
      const batch = listRes.data.messages || [];
      messages = messages.concat(batch);
      pageToken = listRes.data.nextPageToken || null;
      console.log(`📬 Página: ${batch.length} correos, total acumulado: ${messages.length}`);
    } while (pageToken);

    // Filtro adicional por fecha interna del mensaje (evita correos fuera del rango)
    if (desdeTimestamp || hastaTimestamp) {
      const antes = messages.length;
      // Obtenemos metadatos de cada mensaje para verificar fecha real
      // Solo filtramos si hay rango definido
      const messagesFiltrados = [];
      for (const msg of messages) {
        try {
          const meta = await gmail.users.messages.get({
            userId: 'me',
            id: msg.id,
            format: 'metadata',
            metadataHeaders: ['Date'],
          });
          const internalDate = parseInt(meta.data.internalDate); // en millisegundos
          if (desdeTimestamp && internalDate < desdeTimestamp) continue;
          if (hastaTimestamp && internalDate > hastaTimestamp) continue;
          messagesFiltrados.push(msg);
        } catch (err) {
          // Si no podemos obtener metadatos, incluimos el mensaje
          messagesFiltrados.push(msg);
        }
      }
      messages = messagesFiltrados;
      console.log(`🗓️ Filtro de fechas: ${antes} → ${messages.length} correos dentro del rango`);
    }

    console.log(`📬 Total correos a procesar: ${messages.length}`);

    let nuevas = 0;
    for (const msg of messages) {
      try {
        const resultado = await procesarMensaje(gmail, msg.id);
        if (resultado) nuevas++;
      } catch (err) {
        if (!err.message?.includes('ya procesado')) {
          console.error(`❌ Error procesando mensaje ${msg.id}:`, err.message);
        }
      }
    }

    console.log(`✅ Sincronización completa. ${nuevas} facturas nuevas procesadas.`);

    await pool.query(
      "INSERT INTO configuracion (clave, valor) VALUES ('last_sync', $1) ON CONFLICT (clave) DO UPDATE SET valor = $1",
      [new Date().toISOString()]
    );

    return { ok: true, nuevas };
  } catch (err) {
    console.error('❌ Error en sincronización:', err.message);
    return { ok: false, error: err.message };
  }
};

const procesarMensaje = async (gmail, messageId) => {
  const existe = await pool.query(
    'SELECT id FROM facturas WHERE gmail_message_id = $1', [messageId]
  );
  if (existe.rows.length > 0) throw new Error('ya procesado');

  const msgRes = await gmail.users.messages.get({
    userId: 'me', id: messageId, format: 'full',
  });

  const parts = obtenerPartes(msgRes.data.payload);

  let xmlContent = null;
  let pdfBuffer = null;
  let pdfFilename = null;
  let xmlFilename = null;

  for (const part of parts) {
    const filename = (part.filename || '').toLowerCase();
    const mimeType = part.mimeType || '';
    if (!part.body?.attachmentId) continue;

    const attRes = await gmail.users.messages.attachments.get({
      userId: 'me', messageId, id: part.body.attachmentId,
    });
    const data = Buffer.from(attRes.data.data, 'base64');

    if (filename.endsWith('.zip') || mimeType.includes('zip')) {
      console.log(`📦 Descomprimiendo ZIP: ${part.filename}`);
      try {
        const zip = new AdmZip(data);
        for (const entry of zip.getEntries()) {
          const entryName = entry.entryName.toLowerCase();
          const entryData = entry.getData();
          if (entryName.endsWith('.xml') && !xmlContent) {
            xmlContent = entryData.toString('utf-8');
            xmlFilename = `${messageId}_${entry.entryName}`;
            console.log(`📄 XML en ZIP: ${entry.entryName}`);
          }
          if (entryName.endsWith('.pdf') && !pdfBuffer) {
            pdfBuffer = entryData;
            pdfFilename = `${messageId}_${entry.entryName}`;
            console.log(`📄 PDF en ZIP: ${entry.entryName}`);
          }
        }
      } catch (zipErr) {
        console.error(`❌ Error descomprimiendo ZIP:`, zipErr.message);
      }
      continue;
    }

    if (filename.endsWith('.xml') || mimeType.includes('xml')) {
      xmlContent = data.toString('utf-8');
      xmlFilename = `${messageId}_${part.filename}`;
    }
    if (filename.endsWith('.pdf') || mimeType.includes('pdf')) {
      pdfBuffer = data;
      pdfFilename = `${messageId}_${part.filename}`;
    }
  }

  if (!xmlContent) {
    console.log(`⚠️ Mensaje ${messageId} sin XML DIAN válido`);
    return false;
  }

  if (pdfBuffer && pdfFilename) {
    try {
      await subirArchivo(pdfBuffer, pdfFilename, 'application/pdf');
      console.log(`☁️ PDF subido: ${pdfFilename}`);
    } catch (err) {
      console.error(`❌ Error subiendo PDF:`, err.message);
      pdfFilename = null;
    }
  }
  if (xmlContent && xmlFilename) {
    try {
      await subirArchivo(Buffer.from(xmlContent, 'utf-8'), xmlFilename, 'application/xml');
      console.log(`☁️ XML subido: ${xmlFilename}`);
    } catch (err) {
      console.error(`❌ Error subiendo XML:`, err.message);
      xmlFilename = null;
    }
  }

  const datos = await parsearXMLDIAN(xmlContent);

  const facturaRes = await pool.query(
    `INSERT INTO facturas
      (numero, tipo, cufe, proveedor_nombre, proveedor_nit, fecha_emision, fecha_vencimiento,
       subtotal, iva, total, gmail_message_id, pdf_path, xml_path, xml_raw)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING id`,
    [
      datos.numero, datos.tipo, datos.cufe,
      datos.proveedorNombre, datos.proveedorNit,
      datos.fechaEmision, datos.fechaVence,
      datos.subtotal, datos.iva, datos.total,
      messageId, pdfFilename || null, xmlFilename || null, xmlContent,
    ]
  );

  const facturaId = facturaRes.rows[0].id;
  for (const prod of datos.productos) {
    await pool.query(
      `INSERT INTO productos_factura (factura_id, codigo, descripcion, cantidad, precio_unitario, total)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [facturaId, prod.codigo, prod.descripcion, prod.cantidad, prod.precioUnitario, prod.total]
    );
  }

  console.log(`✅ Factura ${datos.numero} de ${datos.proveedorNombre} guardada`);
  return true;
};

const obtenerPartes = (payload, partes = []) => {
  if (!payload) return partes;
  if (payload.filename && payload.body) partes.push(payload);
  if (payload.parts) payload.parts.forEach(p => obtenerPartes(p, partes));
  return partes;
};

module.exports = { getAuthUrl, exchangeCodeForTokens, sincronizarCorreos };

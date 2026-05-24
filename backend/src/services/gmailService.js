const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');
const { pool } = require('../models/db');
const { parsearXMLDIAN } = require('./xmlParser');

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
  const { pool: db } = require('../models/db');
  const res = await db.query(
    "SELECT valor FROM configuracion WHERE clave = 'gmail_refresh_token'"
  );
  const refreshToken = res.rows[0]?.valor;
  if (!refreshToken) throw new Error('Gmail no está conectado. Configura OAuth primero.');

  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  return oauth2Client;
};

const sincronizarCorreos = async () => {
  console.log('🔄 Iniciando sincronización de Gmail...');
  try {
    const auth = await getAuthenticatedClient();
    const gmail = google.gmail({ version: 'v1', auth });

    // Obtener palabras clave configuradas
    const cfgRes = await pool.query(
      "SELECT valor FROM configuracion WHERE clave = 'palabras_clave'"
    );
    const palabras = (cfgRes.rows[0]?.valor || 'factura electrónica,DIAN').split(',').map(p => p.trim());
    const query = palabras.map(p => `subject:"${p}"`).join(' OR ');

    // Buscar correos con adjuntos no procesados aún
    const listRes = await gmail.users.messages.list({
      userId: 'me',
      q: `(${query}) has:attachment`,
      maxResults: 50,
    });

    const messages = listRes.data.messages || [];
    console.log(`📬 Encontrados ${messages.length} correos para revisar`);

    let nuevas = 0;
    for (const msg of messages) {
      try {
        await procesarMensaje(gmail, msg.id);
        nuevas++;
      } catch (err) {
        if (!err.message?.includes('duplicate')) {
          console.error(`❌ Error procesando mensaje ${msg.id}:`, err.message);
        }
      }
    }

    console.log(`✅ Sincronización completa. ${nuevas} facturas nuevas procesadas.`);

    // Actualizar timestamp
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
  // Verificar si ya fue procesado
  const existe = await pool.query(
    'SELECT id FROM facturas WHERE gmail_message_id = $1',
    [messageId]
  );
  if (existe.rows.length > 0) return;

  const msgRes = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'full',
  });

  const msg = msgRes.data;
  const parts = obtenerPartes(msg.payload);

  let xmlContent = null;
  let pdfPath = null;
  let xmlPath = null;

  const uploadDir = path.join(__dirname, '../../uploads');
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

  for (const part of parts) {
    const filename = part.filename || '';
    const mimeType = part.mimeType || '';

    if (part.body?.attachmentId) {
      const attRes = await gmail.users.messages.attachments.get({
        userId: 'me',
        messageId,
        id: part.body.attachmentId,
      });

      const data = Buffer.from(attRes.data.data, 'base64');

      if (filename.toLowerCase().endsWith('.xml') || mimeType.includes('xml')) {
        xmlContent = data.toString('utf-8');
        xmlPath = path.join(uploadDir, `${messageId}_${filename}`);
        fs.writeFileSync(xmlPath, data);
      }

      if (filename.toLowerCase().endsWith('.pdf') || mimeType.includes('pdf')) {
        pdfPath = path.join(uploadDir, `${messageId}_${filename}`);
        fs.writeFileSync(pdfPath, data);
      }
    }
  }

  if (!xmlContent) {
    console.log(`⚠️ Mensaje ${messageId} sin XML DIAN válido, omitiendo`);
    return;
  }

  // Parsear XML DIAN
  const datos = await parsearXMLDIAN(xmlContent);

  // Insertar factura
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
      messageId,
      pdfPath ? path.basename(pdfPath) : null,
      xmlPath ? path.basename(xmlPath) : null,
      xmlContent,
    ]
  );

  const facturaId = facturaRes.rows[0].id;

  // Insertar productos
  for (const prod of datos.productos) {
    await pool.query(
      `INSERT INTO productos_factura (factura_id, codigo, descripcion, cantidad, precio_unitario, total)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [facturaId, prod.codigo, prod.descripcion, prod.cantidad, prod.precioUnitario, prod.total]
    );
  }

  console.log(`✅ Factura ${datos.numero} (${datos.tipo}) de ${datos.proveedorNombre} guardada`);
};

const obtenerPartes = (payload, partes = []) => {
  if (!payload) return partes;
  if (payload.filename && payload.body) partes.push(payload);
  if (payload.parts) payload.parts.forEach(p => obtenerPartes(p, partes));
  return partes;
};

module.exports = { getAuthUrl, exchangeCodeForTokens, sincronizarCorreos };

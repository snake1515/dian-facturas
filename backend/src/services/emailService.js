const { google } = require('googleapis');
const { pool } = require('../models/db');
const { descargarArchivo } = require('./storageService');

// Obtiene cliente OAuth2 autenticado con el refresh token guardado en BD
const getGmailClient = async () => {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    process.env.GMAIL_REDIRECT_URI
  );
  const res = await pool.query(
    "SELECT valor FROM configuracion WHERE clave = 'gmail_refresh_token'"
  );
  const refreshToken = res.rows[0]?.valor;
  if (!refreshToken) throw new Error('Gmail no está conectado');
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  return { oauth2Client, gmail: google.gmail({ version: 'v1', auth: oauth2Client }) };
};

// Construye un email RFC 2822 en base64 con adjuntos
const buildRawEmail = ({ from, to, subject, htmlBody, attachments }) => {
  const boundary = `boundary_${Date.now()}`;
  const lines = [];

  lines.push(`From: ${from}`);
  lines.push(`To: ${to}`);
  lines.push(`Subject: ${subject}`);
  lines.push('MIME-Version: 1.0');
  lines.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
  lines.push('');
  lines.push(`--${boundary}`);
  lines.push('Content-Type: text/html; charset="UTF-8"');
  lines.push('Content-Transfer-Encoding: base64');
  lines.push('');
  lines.push(Buffer.from(htmlBody, 'utf-8').toString('base64'));

  for (const att of attachments) {
    lines.push(`--${boundary}`);
    lines.push(`Content-Type: ${att.contentType}; name="${att.filename}"`);
    lines.push('Content-Transfer-Encoding: base64');
    lines.push(`Content-Disposition: attachment; filename="${att.filename}"`);
    lines.push('');
    lines.push(att.content.toString('base64'));
  }

  lines.push(`--${boundary}--`);

  const raw = lines.join('\r\n');
  return Buffer.from(raw).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const reenviarFactura = async ({ facturaId, destinatarios, mensaje, usuarioId }) => {
  const facturaRes = await pool.query(
    `SELECT f.*,
       json_agg(json_build_object('descripcion', p.descripcion, 'cantidad', p.cantidad, 'total', p.total)) as productos
     FROM facturas f
     LEFT JOIN productos_factura p ON p.factura_id = f.id
     WHERE f.id = $1
     GROUP BY f.id`,
    [facturaId]
  );

  if (!facturaRes.rows.length) throw new Error('Factura no encontrada');
  const factura = facturaRes.rows[0];

  // Descargar adjuntos desde Supabase Storage
  const attachments = [];
  if (factura.pdf_path) {
    try {
      const pdfBuffer = await descargarArchivo(factura.pdf_path);
      attachments.push({
        filename: factura.pdf_path.split('/').pop() || 'factura.pdf',
        content: pdfBuffer,
        contentType: 'application/pdf',
      });
    } catch (err) {
      console.error('No se pudo descargar PDF:', err.message);
    }
  }
  if (factura.xml_path) {
    try {
      const xmlBuffer = await descargarArchivo(factura.xml_path);
      attachments.push({
        filename: factura.xml_path.split('/').pop() || 'factura.xml',
        content: xmlBuffer,
        contentType: 'application/xml',
      });
    } catch (err) {
      console.error('No se pudo descargar XML:', err.message);
    }
  }

  const htmlBody = `
    <div style="font-family:Arial,sans-serif;max-width:600px">
      <h2 style="color:#1d4ed8">Factura Electrónica DIAN</h2>
      <table style="width:100%;border-collapse:collapse;margin-bottom:16px">
        <tr><td style="padding:6px;color:#666">Número:</td><td style="padding:6px;font-weight:bold">${factura.numero}</td></tr>
        <tr style="background:#f5f5f5"><td style="padding:6px;color:#666">Proveedor:</td><td style="padding:6px">${factura.proveedor_nombre}</td></tr>
        <tr><td style="padding:6px;color:#666">NIT:</td><td style="padding:6px">${factura.proveedor_nit}</td></tr>
        <tr style="background:#f5f5f5"><td style="padding:6px;color:#666">Fecha:</td><td style="padding:6px">${factura.fecha_emision}</td></tr>
        <tr><td style="padding:6px;color:#666">Total:</td><td style="padding:6px;font-weight:bold;font-size:18px">$${Number(factura.total).toLocaleString('es-CO')}</td></tr>
      </table>
      ${mensaje ? `<p style="background:#f0f7ff;padding:12px;border-radius:6px">${mensaje}</p>` : ''}
      <p style="color:#666;font-size:12px">Este correo fue enviado desde el sistema de gestión de facturas DIAN. Se adjuntan el PDF y el XML de la factura.</p>
    </div>
  `;

  const { gmail } = await getGmailClient();
  const from = `Facturas DIAN <${process.env.GMAIL_USER}>`;
  const subject = `Factura ${factura.tipo} ${factura.numero} - ${factura.proveedor_nombre}`;

  const raw = buildRawEmail({
    from,
    to: destinatarios.join(', '),
    subject,
    htmlBody,
    attachments,
  });

  await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw },
  });

  console.log(`✅ Factura ${factura.numero} reenviada a ${destinatarios.join(', ')}`);

  // Actualizar estado en BD
  await pool.query(
    `UPDATE facturas SET estado = 'reenviado', reenviado_a = $1 WHERE id = $2`,
    [destinatarios[0], facturaId]
  );

  // Registrar en log
  await pool.query(
    `INSERT INTO reenvios_log (factura_id, enviado_por, destinatarios) VALUES ($1, $2, $3)`,
    [facturaId, usuarioId, destinatarios.join(', ')]
  );

  return { ok: true };
};

module.exports = { reenviarFactura };

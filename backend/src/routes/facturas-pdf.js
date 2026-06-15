const express = require('express');
const multer = require('multer');
const { pool } = require('../models/db');
const { authMiddleware } = require('../middleware/auth');
const { parsearPDFDIAN } = require('../services/pdfParser');
const { subirArchivo } = require('../services/storageService');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// ── POST /api/facturas/subir-pdf ──────────────────────────────────────────────
// Recibe un PDF de la DIAN, lo parsea y lo guarda como factura manual
router.post('/subir-pdf', authMiddleware, upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Se requiere un archivo PDF' });

    const pdfBuffer = req.file.buffer;
    let datos;
    try {
      datos = await parsearPDFDIAN(pdfBuffer);
    } catch (parseErr) {
      return res.status(422).json({ error: `No se pudo leer el PDF: ${parseErr.message}` });
    }

    if (!datos.numero || datos.numero === 'SIN-NUMERO') {
      return res.status(422).json({ error: 'No se encontró número de factura en el PDF' });
    }
    if (!datos.fechaEmision) {
      return res.status(422).json({ error: 'No se encontró fecha de emisión en el PDF' });
    }

    // Verificar duplicado por número + NIT
    const existente = await pool.query(
      'SELECT id, origen FROM facturas WHERE numero = $1 AND proveedor_nit = $2',
      [datos.numero, datos.proveedorNit]
    );

    if (existente.rows.length > 0) {
      const dup = existente.rows[0];
      return res.status(409).json({
        error: 'duplicado',
        facturaId: dup.id,
        origen: dup.origen,
        mensaje: `La factura ${datos.numero} de ${datos.proveedorNombre} ya existe (origen: ${dup.origen})`,
      });
    }

    // Subir PDF al storage
    const pdfFilename = `manual_${Date.now()}_${req.file.originalname}`;
    let pdfPath = null;
    try {
      await subirArchivo(pdfBuffer, pdfFilename, 'application/pdf');
      pdfPath = pdfFilename;
    } catch (storageErr) {
      console.error('Error subiendo PDF al storage:', storageErr.message);
    }

    // Insertar factura
    const result = await pool.query(
      `INSERT INTO facturas
        (numero, tipo, cufe, proveedor_nombre, proveedor_nit, fecha_emision, fecha_vencimiento,
         subtotal, iva, total, pdf_path, forma_pago, origen)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'pdf_manual')
       RETURNING id`,
      [
        datos.numero, datos.tipo, datos.cufe,
        datos.proveedorNombre, datos.proveedorNit,
        datos.fechaEmision, datos.fechaVence,
        datos.subtotal, datos.iva, datos.total,
        pdfPath, datos.formaPago || null,
      ]
    );

    const facturaId = result.rows[0].id;

    // Insertar productos
    if (datos.productos && datos.productos.length > 0) {
      const placeholders = datos.productos.map((_, i) =>
        `($1, $${i * 5 + 2}, $${i * 5 + 3}, $${i * 5 + 4}, $${i * 5 + 5}, $${i * 5 + 6})`
      ).join(', ');
      const valores = [
        facturaId,
        ...datos.productos.flatMap(p => [p.codigo, p.descripcion, p.cantidad, p.precioUnitario, p.total]),
      ];
      await pool.query(
        `INSERT INTO productos_factura (factura_id, codigo, descripcion, cantidad, precio_unitario, total)
         VALUES ${placeholders}`,
        valores
      );
    }

    console.log(`✅ Factura PDF manual ${datos.numero} de ${datos.proveedorNombre} guardada`);
    res.json({ ok: true, facturaId, datos });
  } catch (err) {
    console.error('Error subiendo PDF:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/facturas/notificaciones ─────────────────────────────────────────
// Busca facturas manuales que ya tienen su equivalente en Gmail (mismo número normalizado + NIT)
router.get('/notificaciones', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        manual.id,
        manual.numero,
        manual.proveedor_nombre,
        manual.total,
        manual.fecha_emision,
        gmail.id AS gmail_factura_id
      FROM facturas manual
      JOIN facturas gmail 
        ON REGEXP_REPLACE(UPPER(gmail.numero), '[^A-Z0-9]', '', 'g') = REGEXP_REPLACE(UPPER(manual.numero), '[^A-Z0-9]', '', 'g')
        AND gmail.proveedor_nit = manual.proveedor_nit
        AND gmail.origen = 'gmail'
      WHERE manual.origen = 'pdf_manual'
      ORDER BY manual.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/facturas/:id/reemplazar-con-gmail ───────────────────────────────
// :id = id de la factura MANUAL
// gmailFacturaId = id de la factura que llegó por Gmail
// Se elimina la manual y la Gmail hereda toda la gestión
router.post('/:id/reemplazar-con-gmail', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params; // factura manual
    const { gmailFacturaId } = req.body;

    const manualF = await pool.query('SELECT * FROM facturas WHERE id = $1 AND origen = $2', [id, 'pdf_manual']);
    if (!manualF.rows.length) return res.status(404).json({ error: 'Factura manual no encontrada' });
    const manual = manualF.rows[0];

    const gmailF = await pool.query('SELECT * FROM facturas WHERE id = $1 AND origen = $2', [gmailFacturaId, 'gmail']);
    if (!gmailF.rows.length) return res.status(404).json({ error: 'Factura Gmail no encontrada' });

    // Copiar gestión de la manual a la Gmail
    await pool.query(`
      UPDATE facturas SET
        estado_contable   = $1,
        flujo_tipo        = $2,
        documento_ingreso = $3,
        notas             = $4,
        es_contrato       = $5
      WHERE id = $6
    `, [
      manual.estado_contable,
      manual.flujo_tipo,
      manual.documento_ingreso,
      manual.notas,
      manual.es_contrato,
      gmailFacturaId,
    ]);

    // Copiar responsables de la manual a la Gmail
    const responsables = await pool.query(
      'SELECT email, nombre FROM responsables_factura WHERE factura_id = $1', [id]
    );
    if (responsables.rows.length > 0) {
      await pool.query('DELETE FROM responsables_factura WHERE factura_id = $1', [gmailFacturaId]);
      for (const r of responsables.rows) {
        await pool.query(
          'INSERT INTO responsables_factura (factura_id, email, nombre) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
          [gmailFacturaId, r.email, r.nombre]
        );
      }
    }

    // Eliminar la factura manual
    await pool.query('DELETE FROM facturas WHERE id = $1', [id]);

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/facturas/:id/descartar-notificacion ────────────────────────────
router.post('/:id/descartar-notificacion', authMiddleware, async (req, res) => {
  try {
    await pool.query(
      'UPDATE facturas SET notificacion_vista = true WHERE id = $1',
      [req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;



// backend/src/routes/prestamosRoutes.js
// PostgreSQL — mismo patrón que las demás rutas del proyecto

const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { pool } = require('../models/db');
const storageService = require('../services/storageService');
const { authMiddleware, adminOnly } = require('../middleware/auth');

// ─── Multer en memoria → Supabase Storage ───────────────────────────────────
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

async function subirPDF(file, carpeta) {
  if (!file) return null;
  const filename = `prestamos/${carpeta}/${Date.now()}_${file.originalname}`;
  await storageService.subirArchivo(file.buffer, filename, file.mimetype);
  return filename; // Retorna solo el filename, no la URL
}

// Servir PDFs e imágenes desde Supabase Storage (usando backend autenticado)
router.get('/soporte/*', async (req, res) => {
  try {
    const filepath = req.params[0]; // prestamos/documentos/1782014160410_pdf_factura_27663.pdf
    const buffer = await storageService.descargarArchivo(filepath);
    
    // Detectar tipo de archivo por extensión
    const ext = path.extname(filepath).toLowerCase();
    let contentType = 'application/pdf';
    if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
    if (ext === '.png') contentType = 'image/png';
    if (ext === '.gif') contentType = 'image/gif';
    if (ext === '.webp') contentType = 'image/webp';
    
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `inline; filename="${path.basename(filepath)}"`);
    res.send(buffer);
  } catch (e) { res.status(404).json({ error: 'Archivo no encontrado' }); }
});

// ═══════════════════════════════════════════════════════════════════════════
//  CLÍNICAS
// ═══════════════════════════════════════════════════════════════════════════

router.get('/clinicas', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM prestamo_clinicas ORDER BY nombre ASC');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/clinicas', async (req, res) => {
  try {
    const { nombre, ciudad, contacto } = req.body;
    if (!nombre) return res.status(400).json({ error: 'nombre requerido' });
    const { rows } = await pool.query(
      'INSERT INTO prestamo_clinicas (nombre) VALUES ($1) RETURNING *',
      [nombre]
    );
    res.status(201).json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/clinicas/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM prestamo_clinicas WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════
//  PRODUCTOS
// ═══════════════════════════════════════════════════════════════════════════

router.get('/productos', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM prestamo_productos ORDER BY nombre ASC');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Carga masiva desde Excel
router.post('/productos/bulk', async (req, res) => {
  try {
    const { rows } = req.body;
    if (!Array.isArray(rows) || rows.length === 0)
      return res.status(400).json({ error: 'rows requerido' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const item of rows) {
        await client.query(`
          INSERT INTO prestamo_productos (codigo, nombre, unidad, precio_unitario, categoria, cuenta_contable)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (codigo) DO UPDATE SET
            nombre          = EXCLUDED.nombre,
            unidad          = EXCLUDED.unidad,
            precio_unitario = EXCLUDED.precio_unitario,
            categoria       = EXCLUDED.categoria,
            cuenta_contable = EXCLUDED.cuenta_contable
        `, [item.codigo, item.nombre, item.unidad || null, item.precio_unitario || 0, item.categoria || null, item.cuenta_contable || null]);
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    const { rows: updated } = await pool.query('SELECT * FROM prestamo_productos ORDER BY nombre ASC');
    res.json(updated);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════
//  PRÉSTAMOS
// ═══════════════════════════════════════════════════════════════════════════

router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM prestamos ORDER BY created_at DESC');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', upload.single('soporte'), async (req, res) => {
  try {
    const {
      tipo, clinica_id, clinica_nombre,
      bodega_codigo, bodega_nombre,
      fecha, documento_contable, observaciones, items,
    } = req.body;

    if (!tipo || !fecha || !documento_contable)
      return res.status(400).json({ error: 'tipo, fecha y documento_contable son requeridos' });

    const soporte_url = req.file ? await subirPDF(req.file, 'documentos') : null;
    const itemsParsed = typeof items === 'string' ? JSON.parse(items) : (items || []);

    const { rows } = await pool.query(`
      INSERT INTO prestamos
        (tipo, clinica_id, clinica_nombre, bodega_codigo, bodega_nombre,
         fecha, documento_contable, observaciones, soporte_url, items, estado)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'abierto')
      RETURNING *
    `, [
      tipo,
      clinica_id || null,
      clinica_nombre || null,
      bodega_codigo || null,
      bodega_nombre || null,
      fecha,
      documento_contable,
      observaciones || null,
      soporte_url,
      JSON.stringify(itemsParsed),
    ]);

    res.status(201).json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});


// Actualizar precio de un producto
router.patch('/productos/:id', async (req, res) => {
  try {
    const { precio_unitario } = req.body;
    const { rows } = await pool.query(
      'UPDATE prestamo_productos SET precio_unitario = $1 WHERE id = $2 RETURNING *',
      [precio_unitario, req.params.id]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Limpiar tabla productos
router.delete('/productos/clear', async (req, res) => {
  try {
    await pool.query('DELETE FROM prestamo_productos');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Edición completa de un movimiento (préstamo/devolución) — solo admin.
// Acepta cualquier subconjunto de los campos editables; solo se actualizan
// los que vienen presentes en el body (permite tanto ediciones parciales,
// como el cambio de estado que ya usaban otras partes del sistema).
const CAMPOS_EDITABLES_PRESTAMO = [
  'tipo', 'clinica_id', 'clinica_nombre', 'bodega_codigo', 'bodega_nombre',
  'fecha', 'documento_contable', 'observaciones', 'estado', 'items',
];

router.patch('/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const sets = [];
    const values = [];
    let i = 1;

    for (const campo of CAMPOS_EDITABLES_PRESTAMO) {
      if (!(campo in req.body)) continue;
      let valor = req.body[campo];
      if (campo === 'items') {
        valor = JSON.stringify(typeof valor === 'string' ? JSON.parse(valor) : (valor || []));
      }
      sets.push(`${campo} = $${i}`);
      values.push(valor);
      i++;
    }

    if (sets.length === 0) {
      return res.status(400).json({ error: 'No se enviaron campos para actualizar' });
    }

    values.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE prestamos SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
      values
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Movimiento no encontrado' });

    // Si se editaron los items, el saldo cruzado con otros documentos pudo
    // cambiar de sentido (p. ej. se corrige una cantidad mal importada) —
    // recalculamos el estado real de este documento Y de todos los que estén
    // cruzados con él, para que quede consistente con lo que ahora muestra
    // el Kárdex (que sí lee los items en vivo).
    let doc = rows[0];
    if ('items' in req.body) {
      const { rows: relacionados } = await pool.query(
        `SELECT DISTINCT unnest(ARRAY[prestamo_id, devolucion_id]) AS doc_id
         FROM prestamo_cruces WHERE prestamo_id = $1 OR devolucion_id = $1`,
        [req.params.id]
      );
      const idsARecalcular = new Set([Number(req.params.id), ...relacionados.map(r => r.doc_id)]);
      for (const id of idsARecalcular) await recalcularEstadoDocumento(pool, id);
      const { rows: refrescado } = await pool.query('SELECT * FROM prestamos WHERE id = $1', [req.params.id]);
      doc = refrescado[0];
    }
    res.json(doc);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════
//  DEVOLUCIONES
// ═══════════════════════════════════════════════════════════════════════════

router.get('/devoluciones', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM prestamo_devoluciones ORDER BY fecha DESC');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/devoluciones', upload.single('soporte'), async (req, res) => {
  try {
    const { prestamo_id, fecha, documento_contable, items } = req.body;

    if (!prestamo_id || !fecha || !documento_contable)
      return res.status(400).json({ error: 'prestamo_id, fecha y documento_contable requeridos' });

    const soporte_url  = req.file ? await subirPDF(req.file, 'devoluciones') : null;
    const itemsParsed  = typeof items === 'string' ? JSON.parse(items) : (items || []);

    const { rows } = await pool.query(`
      INSERT INTO prestamo_devoluciones (prestamo_id, fecha, documento_contable, soporte_url, items)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [prestamo_id, fecha, documento_contable, soporte_url, JSON.stringify(itemsParsed)]);

    // Recalcular estado del préstamo padre
    const { rows: [prestamo] } = await pool.query('SELECT items FROM prestamos WHERE id = $1', [prestamo_id]);
    const itemsPrest  = prestamo?.items || [];
    const totalPrest  = itemsPrest.reduce((s, i) => s + Number(i.cantidad), 0);

    const { rows: todasDevs } = await pool.query(
      'SELECT items FROM prestamo_devoluciones WHERE prestamo_id = $1', [prestamo_id]
    );
    const totalDev = todasDevs.flatMap(d => d.items || []).reduce((s, i) => s + Number(i.cantidad), 0);

    const nuevoEstado = totalDev >= totalPrest ? 'cerrado' : 'parcial';
    await pool.query('UPDATE prestamos SET estado = $1 WHERE id = $2', [nuevoEstado, prestamo_id]);

    res.status(201).json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});


// ═══════════════════════════════════════════════════════════════════════════
//  PURGA MASIVA
// ═══════════════════════════════════════════════════════════════════════════

router.delete('/purgar', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM prestamo_cruces');
    await client.query('DELETE FROM prestamo_devoluciones');
    await client.query('DELETE FROM prestamos');
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
//  IMPORTACIÓN MASIVA DESDE EXCEL
// ═══════════════════════════════════════════════════════════════════════════
// Recibe array de documentos pre-procesados desde el frontend
// Cada documento: { tipo, documento_contable, fecha, observaciones,
//                   clinica_nombre, bodega_codigo, bodega_nombre, items[] }
router.post('/importar-masivo', async (req, res) => {
  try {
    const { documentos } = req.body;
    if (!Array.isArray(documentos) || documentos.length === 0)
      return res.status(400).json({ error: 'documentos requerido' });

    const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
    const client = await pool.connect();
    const creados = [];
    const omitidos = [];
    const errores = [];

    try {
      await client.query('BEGIN');

      for (const doc of documentos) {
        // Validar fecha antes de intentar el insert — un documento con fecha
        // inválida se omite y se reporta, en vez de abortar TODA la importación.
        if (!doc.fecha || !FECHA_RE.test(doc.fecha)) {
          errores.push({ documento_contable: doc.documento_contable, motivo: `Fecha inválida: "${doc.fecha}"` });
          continue;
        }

        // Verificar si ya existe
        const { rows: existe } = await client.query(
          'SELECT id FROM prestamos WHERE documento_contable = $1',
          [doc.documento_contable]
        );
        if (existe.length > 0) {
          omitidos.push(doc.documento_contable);
          continue;
        }

        // Auto-crear clínica si no existe
        let clinica_id = null;
        if (doc.clinica_nombre) {
          const { rows: cl } = await client.query(
            'SELECT id FROM prestamo_clinicas WHERE UPPER(nombre) = UPPER($1)',
            [doc.clinica_nombre]
          );
          if (cl.length > 0) {
            clinica_id = cl[0].id;
          } else {
            const { rows: nueva } = await client.query(
              'INSERT INTO prestamo_clinicas (nombre) VALUES ($1) RETURNING id',
              [doc.clinica_nombre]
            );
            clinica_id = nueva[0].id;
          }
        }

        const { rows } = await client.query(`
          INSERT INTO prestamos
            (tipo, clinica_id, clinica_nombre, bodega_codigo, bodega_nombre,
             fecha, documento_contable, observaciones, items, estado)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'abierto')
          RETURNING *
        `, [
          doc.tipo,
          clinica_id,
          doc.clinica_nombre || null,
          doc.bodega_codigo || null,
          doc.bodega_nombre || null,
          doc.fecha,
          doc.documento_contable,
          doc.observaciones || null,
          JSON.stringify(doc.items || []),
        ]);
        creados.push(rows[0]);
      }

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    res.json({
      creados: creados.length,
      omitidos: omitidos.length,
      omitidos_docs: omitidos,
      errores: errores.length,
      errores_docs: errores,
      documentos: creados,
    });
  } catch (e) { console.error('importar-masivo ERROR:', e.message); res.status(500).json({ error: e.message }); }
});


// ═══════════════════════════════════════════════════════════════════════════
//  CRUCES  (soporta multicruce: un préstamo con varias devoluciones,
//  una devolución con varios préstamos, o combinaciones entre ambos)
// ═══════════════════════════════════════════════════════════════════════════

// Recalcula el estado de un documento (préstamo o devolución) sumando
// TODOS los cruces en los que participa, sin importar si es de un lado u otro
async function recalcularEstadoDocumento(client, documentoId) {
  const { rows: [doc] } = await client.query('SELECT items FROM prestamos WHERE id = $1', [documentoId]);
  if (!doc) return null;
  const totalDoc = (doc.items || []).reduce((s, i) => s + Number(i.cantidad), 0);

  const { rows: comoPrest } = await client.query(
    `SELECT d.items FROM prestamo_cruces c JOIN prestamos d ON d.id = c.devolucion_id WHERE c.prestamo_id = $1`,
    [documentoId]
  );
  const { rows: comoDevo } = await client.query(
    `SELECT p.items FROM prestamo_cruces c JOIN prestamos p ON p.id = c.prestamo_id WHERE c.devolucion_id = $1`,
    [documentoId]
  );

  const cruzado = [...comoPrest, ...comoDevo].reduce(
    (s, r) => s + (r.items || []).reduce((a, i) => a + Number(i.cantidad), 0), 0
  );

  const nuevoEstado = totalDoc === 0 ? 'abierto' : cruzado >= totalDoc ? 'cerrado' : cruzado > 0 ? 'parcial' : 'abierto';
  await client.query('UPDATE prestamos SET estado = $1 WHERE id = $2', [nuevoEstado, documentoId]);
  return nuevoEstado;
}

// Genera el PDF del cruce con tablas y bordes
async function generarPdfCruce({ numero, fecha, observaciones, documentos }) {
  const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
  const pdfDoc   = await PDFDocument.create();
  const font     = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // ── Paleta de colores ──
  const AZUL      = rgb(0.07, 0.33, 0.65);
  const AZUL_LIGHT= rgb(0.87, 0.93, 0.98);
  const GRIS_HD   = rgb(0.93, 0.93, 0.93);
  const GRIS_LIN  = rgb(0.82, 0.82, 0.82);
  const NEGRO     = rgb(0.08, 0.08, 0.08);
  const BLANCO    = rgb(1, 1, 1);

  const W = 612, H = 792;
  const ML = 45, MR = 45;  // márgenes izq/der
  const CW = W - ML - MR;  // ancho útil = 522

  let page = pdfDoc.addPage([W, H]);
  let y = H - 48;

  // ── helpers ──────────────────────────────────────────────────────────────
  function texto(t, x, cy, size, f, color, maxW) {
    if (!t) return;
    const str = String(t);
    // Truncar si es necesario para no salir del margen
    let s = str;
    if (maxW) {
      while (s.length > 0 && (f || font).widthOfTextAtSize(s, size) > maxW) s = s.slice(0, -1);
      if (s.length < str.length) s = s.slice(0, -1) + '…';
    }
    page.drawText(s, { x, y: cy, size, font: f || font, color: color || NEGRO });
  }

  function rect(x, cy, w, h, fillColor, borderColor, borderWidth) {
    if (fillColor) page.drawRectangle({ x, y: cy, width: w, height: h, color: fillColor });
    if (borderColor) page.drawRectangle({ x, y: cy, width: w, height: h, borderColor, borderWidth: borderWidth || 0.5, color: fillColor || undefined });
  }

  function linH(cy, x1, x2, color) {
    page.drawLine({ start: { x: x1, y: cy }, end: { x: x2, y: cy }, thickness: 0.5, color: color || GRIS_LIN });
  }

  function nuevaPagina() {
    page = pdfDoc.addPage([W, H]);
    y = H - 48;
    // Encabezado mini en páginas adicionales
    rect(ML, y - 2, CW, 18, AZUL_LIGHT);
    texto(`CRUCE DE PRÉSTAMOS  ·  ${numero}`, ML + 6, y + 4, 9, fontBold, AZUL);
    y -= 28;
  }

  function checkY(needed) {
    if (y - needed < 55) { nuevaPagina(); }
  }

  // ── ENCABEZADO ────────────────────────────────────────────────────────────
  // Barra azul título
  rect(ML, y - 4, CW, 28, AZUL);
  texto('CRUCE DE PRÉSTAMOS', ML + 10, y + 6, 16, fontBold, BLANCO);
  y -= 36;

  // Recuadro consecutivo + fecha
  rect(ML, y - 22, CW, 28, AZUL_LIGHT, AZUL, 0.8);
  texto(`Consecutivo: ${numero}`, ML + 10, y - 8, 11, fontBold, AZUL);
  texto(`Fecha: ${fecha}`, ML + 280, y - 8, 10, font, NEGRO);
  y -= 38;

  // Descripción
  if (observaciones && observaciones.trim()) {
    checkY(30);
    rect(ML, y - 4, CW, 16, GRIS_HD);
    texto('Descripción:', ML + 6, y + 4, 9, fontBold, NEGRO);
    y -= 18;
    // Partir en líneas de hasta 95 chars
    const palabras = observaciones.split(' ');
    let renglon = '';
    for (const w of palabras) {
      if ((renglon + w).length > 100) {
        checkY(14);
        texto(renglon.trim(), ML + 6, y, 9, font, NEGRO);
        y -= 13;
        renglon = '';
      }
      renglon += w + ' ';
    }
    if (renglon.trim()) {
      checkY(14);
      texto(renglon.trim(), ML + 6, y, 9, font, NEGRO);
      y -= 13;
    }
    y -= 6;
  }

  // ── Sección "Documentos incluidos" ───────────────────────────────────────
  checkY(20);
  rect(ML, y - 4, CW, 16, AZUL);
  texto('Documentos incluidos en este cruce', ML + 6, y + 4, 9, fontBold, BLANCO);
  y -= 22;

  // Anchos de columnas tabla documentos: Doc | Tipo | Clínica | Fecha | Valor
  const DC = [0, 80, 145, 345, 425, 522]; // posiciones relativas al ML

  for (const d of documentos) {
    const valor = (d.items || []).reduce((s, i) => s + Number(i.cantidad) * Number(i.precio_unitario || 0), 0);
    const fechaDoc = d.fecha ? String(d.fecha).substring(0, 10) : '—';
    const nItems = (d.items || []).length;
    const altoCabDoc = 18;

    // Descripción propia del documento (observaciones de la EPO/IPE/IDP/ED),
    // partida en líneas para que quepa dentro del ancho útil de la página.
    const descLineas = [];
    if (d.observaciones && String(d.observaciones).trim()) {
      const palabras = String(d.observaciones).trim().split(/\s+/);
      let renglon = '';
      for (const w of palabras) {
        if ((renglon + w).length > 110) { descLineas.push(renglon.trim()); renglon = ''; }
        renglon += w + ' ';
      }
      if (renglon.trim()) descLineas.push(renglon.trim());
    }
    const altoDesc  = descLineas.length > 0 ? 4 + descLineas.length * 11 : 0;
    const altoTabla = nItems > 0 ? 16 + nItems * 14 : 0;
    checkY(altoCabDoc + altoDesc + altoTabla + 8);

    // Cabecera del documento — fondo azul claro con borde
    rect(ML, y - altoCabDoc + 4, CW, altoCabDoc, AZUL_LIGHT, AZUL, 0.6);
    texto(d.documento_contable || '', ML + DC[0] + 4, y - 10, 9, fontBold, AZUL, 74);
    texto(d.tipo || '', ML + DC[1] + 4, y - 10, 8, font, NEGRO, 60);
    texto(d.clinica_nombre || '', ML + DC[2] + 4, y - 10, 8, font, NEGRO, 195);
    texto(fechaDoc, ML + DC[3] + 4, y - 10, 8, font, NEGRO, 75);
    texto('$' + valor.toLocaleString('es-CO'), ML + DC[4] + 4, y - 10, 8, fontBold, NEGRO, 90);
    y -= altoCabDoc + 2;

    // Descripción del documento (si tiene observaciones registradas)
    if (descLineas.length > 0) {
      checkY(11);
      texto('Descripción:', ML + 4, y - 8, 7.5, fontBold, NEGRO, 58);
      texto(descLineas[0], ML + 60, y - 8, 7.5, font, NEGRO, CW - 64);
      y -= 11;
      for (let li = 1; li < descLineas.length; li++) {
        checkY(11);
        texto(descLineas[li], ML + 60, y - 8, 7.5, font, NEGRO, CW - 64);
        y -= 11;
      }
      y -= 3;
    }

    // Tabla de items del documento
    if (nItems > 0) {
      // Header columnas items
      rect(ML, y - 14, CW, 14, GRIS_HD, GRIS_LIN, 0.5);
      texto('Código', ML + 4, y - 10, 7.5, fontBold, NEGRO);
      texto('Producto', ML + 90, y - 10, 7.5, fontBold, NEGRO);
      texto('Cant.', ML + CW - 38, y - 10, 7.5, fontBold, NEGRO);
      y -= 14;

      for (const item of d.items) {
        checkY(14);
        // Fila con borde inferior
        rect(ML, y - 12, CW, 13, null, GRIS_LIN, 0.3);
        linH(y - 12, ML, ML + CW, GRIS_LIN);
        texto(String(item.codigo || ''), ML + 4, y - 9, 7.5, font, NEGRO, 82);
        texto(item.nombre || '', ML + 90, y - 9, 7.5, font, NEGRO, 340);
        texto(String(item.cantidad ?? ''), ML + CW - 38, y - 9, 7.5, fontBold, NEGRO);
        y -= 13;
      }
      // Borde exterior de la tabla
      rect(ML, y, CW, nItems * 13 + 14, null, GRIS_LIN, 0.5);
    }
    y -= 10;
  }

  // ── Total general ─────────────────────────────────────────────────────────
  checkY(22);
  const totalGeneral = documentos.reduce((s, d) =>
    s + (d.items || []).reduce((ss, i) => ss + Number(i.cantidad) * Number(i.precio_unitario || 0), 0), 0);
  rect(ML, y - 18, CW, 18, GRIS_HD, GRIS_LIN, 0.5);
  texto('VALOR TOTAL DEL CRUCE', ML + 6, y - 12, 9, fontBold, NEGRO);
  texto('$' + totalGeneral.toLocaleString('es-CO'), ML + CW - 100, y - 12, 10, fontBold, AZUL);
  y -= 28;

  // ── Pie de página en todas las páginas ────────────────────────────────────
  const totalPags = pdfDoc.getPageCount();
  for (let pi = 0; pi < totalPags; pi++) {
    const pg = pdfDoc.getPage(pi);
    pg.drawLine({ start: { x: ML, y: 38 }, end: { x: W - MR, y: 38 }, thickness: 0.5, color: GRIS_LIN });
    pg.drawText(`Documento generado automáticamente — ${numero}`, { x: ML, y: 24, size: 7, font, color: GRIS_LIN });
    pg.drawText(`Página ${pi + 1} de ${totalPags}`, { x: W - MR - 60, y: 24, size: 7, font, color: GRIS_LIN });
  }

  // ── Anexar soportes ───────────────────────────────────────────────────────
  for (const d of documentos) {
    if (!d.soporte_url) continue;
    try {
      const buffer = await storageService.descargarArchivo(d.soporte_url);
      const ext = path.extname(d.soporte_url).toLowerCase();
      if (ext === '.pdf') {
        const donante = await PDFDocument.load(buffer, { ignoreEncryption: true });
        const paginas = await pdfDoc.copyPages(donante, donante.getPageIndices());
        paginas.forEach(pg => pdfDoc.addPage(pg));
      } else if (['.jpg', '.jpeg', '.png'].includes(ext)) {
        const img = ext === '.png' ? await pdfDoc.embedPng(buffer) : await pdfDoc.embedJpg(buffer);
        const pImg = pdfDoc.addPage([W, H]);
        const scale = Math.min((CW) / img.width, (H - 100) / img.height, 1);
        pImg.drawImage(img, { x: ML, y: H - 60 - img.height * scale, width: img.width * scale, height: img.height * scale });
      }
    } catch (e) {
      console.error(`No se pudo anexar el soporte de ${d.documento_contable}:`, e.message);
    }
  }

  return Buffer.from(await pdfDoc.save());
}

// Obtener todos los cruces
router.get('/cruces', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT c.*,
        p.documento_contable AS prestamo_doc,
        p.tipo               AS prestamo_tipo,
        p.estado              AS estado_prestamo,
        p.soporte_url          AS prestamo_soporte_url,
        p.clinica_nombre,
        p.items              AS prestamo_items,
        d.documento_contable AS devolucion_doc,
        d.estado              AS estado_devolucion,
        d.soporte_url          AS devolucion_soporte_url,
        d.items              AS devolucion_items,
        g.numero              AS grupo_numero,
        g.pdf_url              AS grupo_pdf_url,
        g.observaciones        AS grupo_observaciones
      FROM prestamo_cruces c
      JOIN prestamos p ON c.prestamo_id = p.id
      JOIN prestamos d ON c.devolucion_id = d.id
      LEFT JOIN cruce_grupos g ON g.id = c.grupo_id
      ORDER BY c.created_at DESC
    `);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Crear cruce (uno o varios pares préstamo/devolución = multicruce), genera consecutivo + PDF
router.post('/cruces', async (req, res) => {
  try {
    let { pares, observaciones, prestamo_id, devolucion_id, tipo_cruce } = req.body;
    if (!pares) {
      // Compatibilidad con el formato anterior de un solo par
      if (!prestamo_id || !devolucion_id)
        return res.status(400).json({ error: 'prestamo_id y devolucion_id requeridos' });
      pares = [{ prestamo_id, devolucion_id, tipo_cruce: tipo_cruce || 'total' }];
    }
    if (!Array.isArray(pares) || pares.length === 0)
      return res.status(400).json({ error: 'Se requiere al menos un par préstamo/devolución' });

    const client = await pool.connect();
    let numero, documentos = [];
    try {
      await client.query('BEGIN');

      const { rows: [{ n }] } = await client.query("SELECT nextval('cruce_consecutivo_seq') AS n");
      numero = `CRU-${String(n).padStart(5, '0')}`;

      const { rows: [grupo] } = await client.query(
        `INSERT INTO cruce_grupos (numero, observaciones) VALUES ($1, $2) RETURNING *`,
        [numero, observaciones || null]
      );

      const cruceRows = [];
      for (const par of pares) {
        if (!par.prestamo_id || !par.devolucion_id) continue;
        const { rows } = await client.query(`
          INSERT INTO prestamo_cruces (prestamo_id, devolucion_id, tipo_cruce, observaciones, grupo_id)
          VALUES ($1, $2, $3, $4, $5) RETURNING *
        `, [par.prestamo_id, par.devolucion_id, par.tipo_cruce || 'total', par.observaciones || observaciones || null, grupo.id]);
        cruceRows.push(rows[0]);
      }

      if (cruceRows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Ningún par válido para cruzar' });
      }

      // Recalcular estado de cada documento único involucrado (en ambas direcciones)
      const idsUnicos = Array.from(new Set(cruceRows.flatMap(c => [c.prestamo_id, c.devolucion_id])));
      const estados = {};
      for (const id of idsUnicos) estados[id] = await recalcularEstadoDocumento(client, id);

      const { rows: docs } = await client.query(`SELECT * FROM prestamos WHERE id = ANY($1::int[])`, [idsUnicos]);
      documentos = docs;

      await client.query('COMMIT');

      // Generar y subir el PDF del cruce (fuera de la transacción — no bloquea si falla)
      let pdf_url = null;
      try {
        const pdfBuffer = await generarPdfCruce({
          numero, fecha: new Date().toISOString().substring(0, 10),
          observaciones: observaciones || '', documentos,
        });
        pdf_url = `prestamos/cruces_grupos/${numero}.pdf`;
        await storageService.subirArchivo(pdfBuffer, pdf_url, 'application/pdf');
        await pool.query('UPDATE cruce_grupos SET pdf_url = $1 WHERE id = $2', [pdf_url, grupo.id]);
      } catch (e) {
        console.error('Error generando PDF de cruce:', e.message);
      }

      res.status(201).json({ grupo: { ...grupo, pdf_url }, cruces: cruceRows, estados });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Editar tipo_cruce / observaciones de un cruce — solo admin
router.patch('/cruces/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { tipo_cruce, observaciones } = req.body;
    if (tipo_cruce && !['total', 'parcial'].includes(tipo_cruce))
      return res.status(400).json({ error: "tipo_cruce debe ser 'total' o 'parcial'" });

    const { rows: [actual] } = await pool.query('SELECT * FROM prestamo_cruces WHERE id = $1', [req.params.id]);
    if (!actual) return res.status(404).json({ error: 'Cruce no encontrado' });

    const { rows } = await pool.query(
      'UPDATE prestamo_cruces SET tipo_cruce = $1, observaciones = $2 WHERE id = $3 RETURNING *',
      [tipo_cruce || actual.tipo_cruce, observaciones !== undefined ? observaciones : actual.observaciones, req.params.id]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Revertir (eliminar) un cruce individual — el o los documentos vuelven a recalcular su estado
router.delete('/cruces/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [cruce] } = await client.query('SELECT * FROM prestamo_cruces WHERE id = $1', [req.params.id]);
    if (!cruce) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Cruce no encontrado' }); }

    await client.query('DELETE FROM prestamo_cruces WHERE id = $1', [req.params.id]);
    await recalcularEstadoDocumento(client, cruce.prestamo_id);
    await recalcularEstadoDocumento(client, cruce.devolucion_id);

    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// Reparar cruces antiguos: a los que no tienen grupo (creados antes del sistema de
// consecutivo + PDF) les asigna número, recalcula su estado y genera su PDF.
router.post('/cruces/backfill', async (req, res) => {
  try {
    const { rows: sinGrupo } = await pool.query(
      'SELECT * FROM prestamo_cruces WHERE grupo_id IS NULL ORDER BY created_at ASC'
    );

    const resultados = [];
    for (const c of sinGrupo) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const { rows: [{ n }] } = await client.query("SELECT nextval('cruce_consecutivo_seq') AS n");
        const numero = `CRU-${String(n).padStart(5, '0')}`;

        const { rows: [grupo] } = await client.query(
          `INSERT INTO cruce_grupos (numero, observaciones) VALUES ($1, $2) RETURNING *`,
          [numero, c.observaciones || null]
        );
        await client.query('UPDATE prestamo_cruces SET grupo_id = $1 WHERE id = $2', [grupo.id, c.id]);

        await recalcularEstadoDocumento(client, c.prestamo_id);
        await recalcularEstadoDocumento(client, c.devolucion_id);

        const { rows: documentos } = await client.query(
          `SELECT * FROM prestamos WHERE id = ANY($1::int[])`, [[c.prestamo_id, c.devolucion_id]]
        );

        await client.query('COMMIT');

        try {
          const pdfBuffer = await generarPdfCruce({
            numero,
            fecha: (c.created_at ? new Date(c.created_at) : new Date()).toISOString().substring(0, 10),
            observaciones: c.observaciones || '', documentos,
          });
          const pdf_url = `prestamos/cruces_grupos/${numero}.pdf`;
          await storageService.subirArchivo(pdfBuffer, pdf_url, 'application/pdf');
          await pool.query('UPDATE cruce_grupos SET pdf_url = $1 WHERE id = $2', [pdf_url, grupo.id]);
        } catch (e) {
          console.error(`No se pudo generar el PDF de respaldo para ${numero}:`, e.message);
        }

        resultados.push({ cruce_id: c.id, numero });
      } catch (e) {
        await client.query('ROLLBACK');
        console.error('Error reparando cruce', c.id, e.message);
      } finally {
        client.release();
      }
    }

    res.json({ actualizados: resultados.length, detalle: resultados });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Regenerar el PDF de todos los cruces que ya tienen uno, con el formato actual
// (por ejemplo, cuando se cambia el diseño del PDF y hay que actualizar los ya emitidos).
// Sobrescribe el archivo en el mismo path de Storage, así el link/consecutivo no cambia.
router.post('/cruces/regenerar-pdfs', async (req, res) => {
  try {
    const { rows: grupos } = await pool.query(
      "SELECT * FROM cruce_grupos WHERE pdf_url IS NOT NULL ORDER BY numero ASC"
    );

    const regenerados = [];
    const errores = [];

    for (const grupo of grupos) {
      try {
        const { rows: cruceRows } = await pool.query(
          'SELECT * FROM prestamo_cruces WHERE grupo_id = $1', [grupo.id]
        );
        if (cruceRows.length === 0) continue;

        const idsUnicos = Array.from(new Set(cruceRows.flatMap(c => [c.prestamo_id, c.devolucion_id])));
        const { rows: documentos } = await pool.query(
          `SELECT * FROM prestamos WHERE id = ANY($1::int[])`, [idsUnicos]
        );

        const pdfBuffer = await generarPdfCruce({
          numero: grupo.numero,
          fecha: (grupo.created_at ? new Date(grupo.created_at) : new Date()).toISOString().substring(0, 10),
          observaciones: grupo.observaciones || '', documentos,
        });
        await storageService.subirArchivo(pdfBuffer, grupo.pdf_url, 'application/pdf');
        regenerados.push(grupo.numero);
      } catch (e) {
        console.error(`No se pudo regenerar el PDF de ${grupo.numero}:`, e.message);
        errores.push({ numero: grupo.numero, motivo: e.message });
      }
    }

    res.json({ regenerados: regenerados.length, errores: errores.length, detalle_errores: errores });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Adjuntar PDF a un cruce (total o por item)
router.patch('/cruces/:id/soporte', upload.single('soporte'), async (req, res) => {
  try {
    const { item_codigo } = req.body;
    const soporte_url = req.file ? await subirPDF(req.file, 'cruces') : null;

    if (item_codigo) {
      // PDF por producto — guardar en soporte_items JSONB
      const { rows: [cruce] } = await pool.query(
        'SELECT soporte_items FROM prestamo_cruces WHERE id = $1', [req.params.id]
      );
      const soporteItems = cruce?.soporte_items || {};
      soporteItems[item_codigo] = soporte_url;
      const { rows } = await pool.query(
        'UPDATE prestamo_cruces SET soporte_items = $1 WHERE id = $2 RETURNING *',
        [JSON.stringify(soporteItems), req.params.id]
      );
      res.json(rows[0]);
    } else {
      // PDF total del cruce
      const { rows } = await pool.query(
        'UPDATE prestamo_cruces SET soporte_url = $1 WHERE id = $2 RETURNING *',
        [soporte_url, req.params.id]
      );
      res.json(rows[0]);
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Adjuntar PDF o JPG directamente a un préstamo/devolución
router.patch('/:id/soporte', upload.single('soporte'), async (req, res) => {
  try {
    const soporte_url = req.file ? await subirPDF(req.file, 'documentos') : null;
    const { rows } = await pool.query(
      'UPDATE prestamos SET soporte_url = $1 WHERE id = $2 RETURNING *',
      [soporte_url, req.params.id]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Eliminar soporte de un préstamo/devolución
router.delete('/:id/soporte', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'UPDATE prestamos SET soporte_url = NULL WHERE id = $1 RETURNING *',
      [req.params.id]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;


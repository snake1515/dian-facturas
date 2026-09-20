const express = require('express');
const multer = require('multer');
const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const ExcelJS = require('exceljs');
const AdmZip = require('adm-zip');
const { authMiddleware } = require('../middleware/auth');

const execFileAsync = promisify(execFile);
const router = express.Router();

// Máximo de PDFs por lote — acción manual puntual, no un flujo masivo automático.
const MAX_PDFS_POR_LOTE = 150;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB por archivo, de sobra para este tipo de PDF
});

// Solo el rol 'contable' (y admin, por si necesita soporte) puede usar este módulo.
const contableOAdmin = (req, res, next) => {
  if (!['contable', 'admin'].includes(req.user?.rol)) {
    return res.status(403).json({ error: 'Acceso restringido al rol contable' });
  }
  next();
};

// ── Helpers ────────────────────────────────────────────────────────────────

// Ubica una columna del reporte por el texto de su encabezado (fila 1),
// sin asumir una posición fija — el mismo reporte ya tuvo un bug de columnas
// desplazadas en CruceDIAN, así que aquí buscamos por nombre para no repetirlo.
function localizarColumnas(worksheet) {
  const headerRow = worksheet.getRow(1);
  const columnas = {};
  headerRow.eachCell((cell, colNumber) => {
    const texto = String(cell.value || '').trim().toLowerCase();
    if (texto === 'cufe/cude' || texto === 'cufe') columnas.cufe = colNumber;
    if (texto === 'folio') columnas.folio = colNumber;
    if (texto === 'prefijo') columnas.prefijo = colNumber;
  });
  return columnas;
}

// Construye el mapa CUFE (normalizado) -> número de documento esperado (Prefijo+Folio),
// usando siempre la primera (o única) hoja del archivo.
function construirMapaCufes(workbook) {
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error('El Excel no tiene ninguna hoja');

  const columnas = localizarColumnas(worksheet);
  if (!columnas.cufe || !columnas.folio || !columnas.prefijo) {
    throw new Error('No se encontraron las columnas CUFE/CUDE, Folio y Prefijo en la fila de encabezado');
  }

  const mapa = new Map();
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // encabezado

    // .text conserva el valor formateado (evita perder ceros a la izquierda
    // si Folio/Prefijo vinieran como texto con formato numérico).
    const cufeRaw = row.getCell(columnas.cufe).text || '';
    const folio = (row.getCell(columnas.folio).text || '').trim();
    const prefijo = (row.getCell(columnas.prefijo).text || '').trim();

    const cufe = cufeRaw.trim().toLowerCase();
    if (!cufe || (!folio && !prefijo)) return;

    mapa.set(cufe, {
      numeroEsperado: `${prefijo}${folio}`.toUpperCase(),
      fila: rowNumber,
    });
  });

  return mapa;
}

// Extrae el "Número de documento" de la representación gráfica del PDF DIAN.
function extraerNumeroDocumento(texto) {
  const m = texto.match(/N[uú]mero de documento:\s*([^\s]+)/i);
  return m ? m[1].trim().toUpperCase() : null;
}

// Desencripta y extrae el texto de un PDF cifrado usando pdftotext (poppler-utils).
// Usa execFile con argumentos en array (NO exec con string interpolado) para que
// la contraseña, escrita por una persona, nunca pase por un intérprete de shell.
async function extraerTextoPDF(pdfBuffer, contrasena) {
  const tmpPath = path.join(os.tmpdir(), `docsoporte_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.pdf`);
  fs.writeFileSync(tmpPath, pdfBuffer);
  try {
    const { stdout } = await execFileAsync('pdftotext', ['-upw', contrasena, '-layout', tmpPath, '-']);
    return stdout;
  } finally {
    fs.unlinkSync(tmpPath);
  }
}

// ── POST /api/documentos-soporte/procesar ────────────────────────────────────
// Recibe N PDFs (nombrados con el CUFE, tal como los descarga el portal de la
// DIAN) + el Excel del reporte + la contraseña (typed a mano, nunca guardada).
// Devuelve un .zip con los PDFs renombrados + un Excel con el resultado de
// cada uno. No se persiste nada en Storage ni en base de datos.
router.post(
  '/procesar',
  authMiddleware,
  contableOAdmin,
  upload.fields([
    { name: 'pdfs', maxCount: MAX_PDFS_POR_LOTE },
    { name: 'excel', maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const pdfs = req.files?.pdfs || [];
      const excelFile = req.files?.excel?.[0];
      const contrasena = req.body?.contrasena;

      if (!excelFile) return res.status(400).json({ error: 'Falta el archivo Excel del reporte' });
      if (!pdfs.length) return res.status(400).json({ error: 'No se recibió ningún PDF' });
      if (pdfs.length > MAX_PDFS_POR_LOTE) {
        return res.status(400).json({ error: `Máximo ${MAX_PDFS_POR_LOTE} PDFs por lote` });
      }
      if (!contrasena) return res.status(400).json({ error: 'Falta la contraseña de los PDFs' });

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(excelFile.buffer);

      let mapaCufes;
      try {
        mapaCufes = construirMapaCufes(workbook);
      } catch (e) {
        return res.status(422).json({ error: e.message });
      }

      const zip = new AdmZip();
      const resultados = [];

      for (const pdf of pdfs) {
        const cufeArchivo = pdf.originalname.replace(/\.pdf$/i, '').trim().toLowerCase();
        const fila = { archivoOriginal: pdf.originalname, cufe: cufeArchivo };

        const registro = mapaCufes.get(cufeArchivo);
        if (!registro) {
          resultados.push({ ...fila, numeroEsperado: null, numeroEncontrado: null, estado: 'sin match en reporte' });
          continue;
        }

        let texto;
        try {
          texto = await extraerTextoPDF(pdf.buffer, contrasena);
        } catch (e) {
          resultados.push({ ...fila, numeroEsperado: registro.numeroEsperado, numeroEncontrado: null, estado: 'contraseña inválida o PDF ilegible' });
          continue;
        }

        const numeroEncontrado = extraerNumeroDocumento(texto);
        if (!numeroEncontrado) {
          resultados.push({ ...fila, numeroEsperado: registro.numeroEsperado, numeroEncontrado: null, estado: 'no se encontró número de documento en el PDF' });
          continue;
        }

        if (numeroEncontrado.replace(/[^A-Z0-9]/g, '') !== registro.numeroEsperado.replace(/[^A-Z0-9]/g, '')) {
          resultados.push({ ...fila, numeroEsperado: registro.numeroEsperado, numeroEncontrado, estado: 'número no coincide' });
          continue;
        }

        zip.addFile(`${numeroEncontrado}.pdf`, pdf.buffer);
        resultados.push({ ...fila, numeroEsperado: registro.numeroEsperado, numeroEncontrado, estado: 'renombrado' });
      }

      // Reporte de resultados dentro del mismo zip
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Resultado');
      ws.columns = [
        { header: 'Archivo original', key: 'archivoOriginal', width: 90 },
        { header: 'CUFE detectado', key: 'cufe', width: 40 },
        { header: 'Número esperado', key: 'numeroEsperado', width: 20 },
        { header: 'Número encontrado', key: 'numeroEncontrado', width: 20 },
        { header: 'Estado', key: 'estado', width: 32 },
      ];
      ws.getRow(1).font = { bold: true };
      resultados.forEach((r) => ws.addRow(r));
      const reporteBuffer = await wb.xlsx.writeBuffer();
      zip.addFile('reporte.xlsx', reporteBuffer);

      const zipBuffer = zip.toBuffer();
      const nombreZip = `documentos_soporte_${Date.now()}.zip`;

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${nombreZip}"`);
      res.send(zipBuffer);
    } catch (err) {
      console.error('Error procesando documentos soporte:', err.message);
      res.status(500).json({ error: 'Error interno al procesar el lote' });
    }
  }
);

module.exports = router;

const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const os = require('os');

const execAsync = promisify(exec);

const parsearPDFDIAN = async (pdfBuffer) => {
  const tmpPath = path.join(os.tmpdir(), `factura_${Date.now()}.pdf`);
  fs.writeFileSync(tmpPath, pdfBuffer);

  let texto = '';
  try {
    const { stdout } = await execAsync(`pdftotext -layout "${tmpPath}" -`);
    texto = stdout;
  } finally {
    fs.unlinkSync(tmpPath);
  }

  if (!texto || texto.trim().length < 50) {
    throw new Error('No se pudo extraer texto del PDF. Verifica que sea un PDF de la DIAN con capa de texto.');
  }

  return extraerDatosDIAN(texto);
};

const extraerDatosDIAN = (texto) => {
  const get = (pattern) => {
    const m = texto.match(pattern);
    return m ? m[1].trim() : null;
  };

  const cufe = get(/Código Único de Factura - CUFE\s*:\s*\n\s*([a-f0-9]{80,})/i)
    || get(/CUFE\s*:\s*([a-f0-9]{80,})/i);

  const numeroRaw = get(/Número de Factura:\s*([^\s\n]+)/i)
    || get(/Número de Nota[^:]*:\s*([^\s\n]+)/i);
  // Normalizar: quitar caracteres especiales para que SC-2314 === SC2314
  const numero = numeroRaw ? numeroRaw.replace(/[^A-Za-z0-9]/g, '').toUpperCase() : null;

  const esNC = /nota\s+cr[eé]dito/i.test(texto) || /^NC/i.test(numero || '');
  const tipo = esNC ? 'NC' : 'FE';

  const parseFecha = (str) => {
    if (!str) return null;
    const m = str.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
  };

  const fechaEmision = parseFecha(get(/Fecha de Emisión:\s*([\d\/]+)/i));
  const fechaVence = parseFecha(get(/Fecha de Vencimiento:\s*([\d\/]+)/i));
  const formaPago = get(/Forma de pago:\s*([^\n\r]+)/i);

  const proveedorNombre = get(/Razón Social:\s*([^\n\r]+)/i) || 'Proveedor desconocido';
  const proveedorNit = (get(/Nit del Emisor:\s*([\d\-]+)/i) || '000000000-0').replace(/\./g, '').trim();

  const parseMonto = (str) => {
    if (!str) return 0;
    return parseFloat(str.replace(/\./g, '').replace(',', '.')) || 0;
  };

  // Totales: buscar en la columna COP (valores reales)
  const totalStr = get(/Total factura \(=\)\s+COP \$\s+\$\s+([\d.,]+)/i)
    || get(/Total factura \(=\)\s+COP \$\s+([\d.,]+)/i)
    || get(/Total neto factura \(=\)\s+([\d.,]+)/i);
  const subtotalStr = get(/Subtotal\s+[\d.,]+\s*\n.*?Subtotal\s+([\d.,]+)/s)
    || get(/Subtotal\s+([\d.,]+)/);
  const ivaStr = get(/\bIVA\b\s+[\d.,]+\s*\n.*?\bIVA\b\s+([\d.,]+)/s)
    || get(/\bIVA\b\s+([\d.,]+)/);

  const signo = esNC ? -1 : 1;

  const productos = extraerProductos(texto, esNC);

  return {
    tipo,
    numero: numero || 'SIN-NUMERO',
    cufe,
    fechaEmision,
    fechaVence,
    proveedorNombre: proveedorNombre.trim(),
    proveedorNit,
    subtotal: signo * parseMonto(subtotalStr),
    iva: signo * parseMonto(ivaStr),
    total: signo * parseMonto(totalStr),
    formaPago: formaPago ? formaPago.trim() : null,
    productos,
  };
};

const extraerProductos = (texto, esNC) => {
  try {
    const seccionMatch = texto.match(/Detalles de Productos([\s\S]*?)(?:Notas Finales|Datos Totales)/i);
    if (!seccionMatch) return [];

    const seccion = seccionMatch[1];
    const lineas = seccion.split('\n');
    const productos = [];

    // El formato de la DIAN tiene esta estructura por línea:
    // Nro  Código  Descripción  U/M  Cantidad  $  PrecioUnit  $  Desc  $  Recargo  $  IVA  %  INC  %  $  Total
    // La U/M es un código numérico (ej: 94) que aparece antes de Cantidad
    for (let i = 0; i < lineas.length; i++) {
      const linea = lineas[i];
      // Detectar línea de producto: empieza con número de ítem, luego código
      const m = linea.match(/^\s+(\d+)\s+(\d+)\s+(.*?)\s+\d+\s+([\d,]+)\s+\$\s+([\d.,]+)/);
      if (!m) continue;

      let descripcion = m[3].trim();
      const codigo = m[2];
      const cantidad = parseFloat(m[4].replace(',', '.')) || 1;
      const precioUnitario = parseFloat(m[5].replace(/\./g, '').replace(',', '.')) || 0;

      // Descripción puede continuar en línea siguiente
      if (i + 1 < lineas.length) {
        const sig = lineas[i + 1].trim();
        if (sig && sig.length < 80 && !sig.match(/^\d+\s+\d+/) && !/Nro\.|Código|IMPUESTO|Notas/.test(sig) && !/^\$/.test(sig)) {
          descripcion = descripcion + ' ' + sig;
          i++;
        }
      }

      const totalMatch = linea.match(/\$\s+([\d.,]+)\s*$/);
      const total = totalMatch
        ? parseFloat(totalMatch[1].replace(/\./g, '').replace(',', '.'))
        : precioUnitario * cantidad;

      productos.push({
        codigo,
        descripcion: descripcion.replace(/\s+/g, ' ').trim(),
        cantidad,
        precioUnitario,
        total: esNC ? -Math.abs(total) : total,
      });
    }

    return productos;
  } catch {
    return [];
  }
};

module.exports = { parsearPDFDIAN };

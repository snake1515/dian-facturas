const xml2js = require('xml2js');

/**
 * Parsea un XML de factura electrónica DIAN (UBL 2.1)
 * y extrae los campos relevantes.
 */
const parsearXMLDIAN = async (xmlString) => {
  const parser = new xml2js.Parser({ explicitArray: false, ignoreAttrs: false });
  const resultado = await parser.parseStringPromise(xmlString);

  // Detectar si es FE o NC
  const esNotaCredito = !!resultado['CreditNote'];
  const raiz = esNotaCredito ? resultado['CreditNote'] : resultado['Invoice'];
  const tipo = esNotaCredito ? 'NC' : 'FE';

  if (!raiz) throw new Error('XML no reconocido como factura electrónica DIAN');

  // Número de documento
  const numero = getText(raiz, 'cbc:ID') || getText(raiz, 'ID') || 'SIN-NUMERO';

  // CUFE / CUDE
  const cufe = getText(raiz, 'cbc:UUID') || getText(raiz, 'UUID') || null;

  // Fechas
  const fechaEmision = getText(raiz, 'cbc:IssueDate') || getText(raiz, 'IssueDate') || null;
  const fechaVence = getText(raiz, 'cbc:DueDate') || getText(raiz, 'DueDate') || null;

  // Proveedor (AccountingSupplierParty)
  const proveedor = extraerProveedor(raiz);

  // Totales
  const totales = extraerTotales(raiz, esNotaCredito);

  // Líneas de productos
  const productos = extraerProductos(raiz, esNotaCredito);

  return {
    tipo,
    numero,
    cufe,
    fechaEmision,
    fechaVence,
    proveedorNombre: proveedor.nombre,
    proveedorNit: proveedor.nit,
    subtotal: totales.subtotal,
    iva: totales.iva,
    total: totales.total,
    productos,
  };
};

const getText = (obj, key) => {
  if (!obj) return null;
  const val = obj[key];
  if (!val) return null;
  if (typeof val === 'string') return val.trim();
  if (typeof val === 'object' && val._) return val._.trim();
  return null;
};

const extraerProveedor = (raiz) => {
  try {
    const party =
      raiz['cac:AccountingSupplierParty'] ||
      raiz['AccountingSupplierParty'];
    const partyData =
      party?.['cac:Party'] ||
      party?.['Party'] || party;

    const legalEntity =
      partyData?.['cac:PartyLegalEntity'] ||
      partyData?.['PartyLegalEntity'];

    const nombre =
      getText(legalEntity, 'cbc:RegistrationName') ||
      getText(legalEntity, 'RegistrationName') ||
      getText(partyData?.['cac:PartyName'] || partyData?.['PartyName'], 'cbc:Name') ||
      'Proveedor desconocido';

    const nit =
      getText(legalEntity, 'cbc:CompanyID') ||
      getText(legalEntity, 'CompanyID') ||
      getText(partyData?.['cac:PartyIdentification']?.['cbc:ID'] || {}, '_') ||
      '000000000-0';

    return { nombre, nit };
  } catch {
    return { nombre: 'Proveedor desconocido', nit: '000000000-0' };
  }
};

const extraerTotales = (raiz, esNC) => {
  try {
    const monetary =
      raiz['cac:LegalMonetaryTotal'] ||
      raiz['LegalMonetaryTotal'];

    const subtotal = parseFloat(
      getText(monetary, 'cbc:LineExtensionAmount') ||
      getText(monetary, 'LineExtensionAmount') || '0'
    );
    const total = parseFloat(
      getText(monetary, 'cbc:PayableAmount') ||
      getText(monetary, 'PayableAmount') || '0'
    );

    // IVA
    const taxTotals = raiz['cac:TaxTotal'] || raiz['TaxTotal'];
    let iva = 0;
    if (Array.isArray(taxTotals)) {
      iva = taxTotals.reduce((acc, t) => {
        return acc + parseFloat(getText(t, 'cbc:TaxAmount') || getText(t, 'TaxAmount') || '0');
      }, 0);
    } else if (taxTotals) {
      iva = parseFloat(getText(taxTotals, 'cbc:TaxAmount') || getText(taxTotals, 'TaxAmount') || '0');
    }

    const signo = esNC ? -1 : 1;
    return {
      subtotal: signo * subtotal,
      iva: signo * iva,
      total: signo * total,
    };
  } catch {
    return { subtotal: 0, iva: 0, total: 0 };
  }
};

const extraerProductos = (raiz, esNC) => {
  try {
    const lineKey = esNC ? 'cac:CreditNoteLine' : 'cac:InvoiceLine';
    const lineKeyAlt = esNC ? 'CreditNoteLine' : 'InvoiceLine';
    let lineas = raiz[lineKey] || raiz[lineKeyAlt] || [];
    if (!Array.isArray(lineas)) lineas = [lineas];

    return lineas.map((linea) => {
      const item = linea['cac:Item'] || linea['Item'] || {};
      const price = linea['cac:Price'] || linea['Price'] || {};

      const descripcion =
        getText(item, 'cbc:Description') ||
        getText(item, 'Description') ||
        getText(item['cac:StandardItemIdentification'] || {}, 'cbc:ID') ||
        'Producto sin descripción';

      const codigo =
        getText(item['cac:SellersItemIdentification'] || {}, 'cbc:ID') ||
        getText(item['cac:StandardItemIdentification'] || {}, 'cbc:ID') ||
        null;

      const cantidad = parseFloat(
        getText(linea, 'cbc:InvoicedQuantity') ||
        getText(linea, 'InvoicedQuantity') ||
        getText(linea, 'cbc:CreditedQuantity') || '1'
      );

      const precioUnitario = parseFloat(
        getText(price, 'cbc:PriceAmount') ||
        getText(price, 'PriceAmount') || '0'
      );

      const total = parseFloat(
        getText(linea, 'cbc:LineExtensionAmount') ||
        getText(linea, 'LineExtensionAmount') || '0'
      );

      return {
        codigo,
        descripcion,
        cantidad,
        precioUnitario,
        total: esNC ? -Math.abs(total) : total,
      };
    });
  } catch {
    return [];
  }
};

module.exports = { parsearXMLDIAN };

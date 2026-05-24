const xml2js = require('xml2js');

/**
 * Parsea un XML de factura electrónica DIAN (UBL 2.1)
 * Soporta:
 * 1. AttachedDocument (contenedor DIAN con Invoice/CreditNote embebido en CDATA)
 * 2. Invoice directo
 * 3. CreditNote directo
 */
const parsearXMLDIAN = async (xmlString) => {
  const parser = new xml2js.Parser({ explicitArray: false, ignoreAttrs: false, explicitCharkey: true });

  // Intentar extraer el XML embebido en el CDATA del AttachedDocument
  const xmlReal = extraerXMLDeCDATA(xmlString) || xmlString;

  const resultado = await parser.parseStringPromise(xmlReal);

  const esNotaCredito = !!resultado['CreditNote'];
  const raiz = esNotaCredito ? resultado['CreditNote'] : resultado['Invoice'];
  const tipo = esNotaCredito ? 'NC' : 'FE';

  if (!raiz) {
    // Si tampoco funciona, intentar parsear el AttachedDocument directamente
    return parsearAttachedDocument(xmlString);
  }

  const numero = getVal(raiz, 'cbc:ID') || getVal(raiz, 'ID') || 'SIN-NUMERO';
  const cufe = getVal(raiz, 'cbc:UUID') || getVal(raiz, 'UUID') || null;
  const fechaEmision = getVal(raiz, 'cbc:IssueDate') || getVal(raiz, 'IssueDate') || null;
  const fechaVence = getVal(raiz, 'cbc:DueDate') || getVal(raiz, 'DueDate') || null;
  const proveedor = extraerProveedor(raiz);
  const totales = extraerTotales(raiz, esNotaCredito);
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

/**
 * Extrae el XML real embebido en el CDATA del AttachedDocument DIAN
 */
const extraerXMLDeCDATA = (xmlString) => {
  try {
    // Buscar el contenido del CDATA que contiene el Invoice o CreditNote
    const cdataMatch = xmlString.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
    if (cdataMatch && cdataMatch[1]) {
      const contenido = cdataMatch[1].trim();
      if (contenido.includes('<Invoice') || contenido.includes('<CreditNote')) {
        return contenido;
      }
    }

    // Buscar múltiples CDATA y encontrar el que tenga la factura
    const allCdata = [...xmlString.matchAll(/<!\[CDATA\[([\s\S]*?)\]\]>/g)];
    for (const match of allCdata) {
      const contenido = match[1].trim();
      if (contenido.includes('<Invoice') || contenido.includes('<CreditNote')) {
        return contenido;
      }
    }

    return null;
  } catch {
    return null;
  }
};

/**
 * Parsear AttachedDocument directamente cuando no hay CDATA con Invoice
 */
const parsearAttachedDocument = async (xmlString) => {
  const parser = new xml2js.Parser({ explicitArray: false, ignoreAttrs: false, explicitCharkey: true });
  const resultado = await parser.parseStringPromise(xmlString);
  const raiz = resultado['AttachedDocument'];

  if (!raiz) throw new Error('XML no reconocido como factura electrónica DIAN');

  // Extraer datos del AttachedDocument
  const numero = getVal(raiz, 'cbc:ID') || getVal(raiz, 'cbc:ParentDocumentID') || 'SIN-NUMERO';
  const fecha = getVal(raiz, 'cbc:IssueDate') || null;

  // Determinar tipo por el ProfileID o número
  const profileId = getVal(raiz, 'cbc:ProfileID') || '';
  const esNC = profileId.toLowerCase().includes('nota') || numero.toUpperCase().includes('NC');
  const tipo = esNC ? 'NC' : 'FE';

  // Proveedor desde SenderParty
  const sender = raiz['cac:SenderParty'] || raiz['SenderParty'];
  const taxScheme = sender?.['cac:PartyTaxScheme'] || sender?.['PartyTaxScheme'];
  const nombre = getVal(taxScheme, 'cbc:RegistrationName') || 'Proveedor desconocido';
  const nitRaw = taxScheme?.['cbc:CompanyID'];
  const nit = (typeof nitRaw === 'object' ? nitRaw?._ : nitRaw) || '000000000-0';

  return {
    tipo,
    numero,
    cufe: null,
    fechaEmision: fecha,
    fechaVence: null,
    proveedorNombre: nombre,
    proveedorNit: nit,
    subtotal: 0,
    iva: 0,
    total: 0,
    productos: [],
  };
};

const getVal = (obj, key) => {
  if (!obj) return null;
  const val = obj[key];
  if (!val) return null;
  if (typeof val === 'string') return val.trim();
  if (typeof val === 'object') {
    if (val._) return val._.trim();
    if (val['$']) return null;
  }
  return null;
};

const extraerProveedor = (raiz) => {
  try {
    const party = raiz['cac:AccountingSupplierParty'] || raiz['AccountingSupplierParty'];
    const partyData = party?.['cac:Party'] || party?.['Party'] || party;
    const legalEntity = partyData?.['cac:PartyLegalEntity'] || partyData?.['PartyLegalEntity'];

    const nombre =
      getVal(legalEntity, 'cbc:RegistrationName') ||
      getVal(legalEntity, 'RegistrationName') ||
      getVal(partyData?.['cac:PartyName'] || partyData?.['PartyName'], 'cbc:Name') ||
      'Proveedor desconocido';

    const nitRaw = legalEntity?.['cbc:CompanyID'] || legalEntity?.['CompanyID'];
    const nit = (typeof nitRaw === 'object' ? nitRaw?._ : nitRaw) || '000000000-0';

    return { nombre, nit };
  } catch {
    return { nombre: 'Proveedor desconocido', nit: '000000000-0' };
  }
};

const extraerTotales = (raiz, esNC) => {
  try {
    const monetary = raiz['cac:LegalMonetaryTotal'] || raiz['LegalMonetaryTotal'];
    const subtotal = parseFloat(getVal(monetary, 'cbc:LineExtensionAmount') || '0');
    const total = parseFloat(getVal(monetary, 'cbc:PayableAmount') || '0');

    const taxTotals = raiz['cac:TaxTotal'] || raiz['TaxTotal'];
    let iva = 0;
    if (Array.isArray(taxTotals)) {
      iva = taxTotals.reduce((acc, t) => acc + parseFloat(getVal(t, 'cbc:TaxAmount') || '0'), 0);
    } else if (taxTotals) {
      iva = parseFloat(getVal(taxTotals, 'cbc:TaxAmount') || '0');
    }

    const signo = esNC ? -1 : 1;
    return { subtotal: signo * subtotal, iva: signo * iva, total: signo * total };
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
        getVal(item, 'cbc:Description') ||
        getVal(item, 'Description') ||
        'Producto sin descripción';

      const codigo =
        getVal(item['cac:SellersItemIdentification'] || {}, 'cbc:ID') ||
        getVal(item['cac:StandardItemIdentification'] || {}, 'cbc:ID') ||
        null;

      const cantidad = parseFloat(
        getVal(linea, 'cbc:InvoicedQuantity') ||
        getVal(linea, 'cbc:CreditedQuantity') || '1'
      );

      const precioUnitario = parseFloat(getVal(price, 'cbc:PriceAmount') || '0');
      const total = parseFloat(getVal(linea, 'cbc:LineExtensionAmount') || '0');

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

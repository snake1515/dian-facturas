/**
 * PDFs de la DIAN protegidos con contraseña.
 *
 * Los PDF descargados del portal de la DIAN pueden venir cifrados. Antes de
 * leerlos y guardarlos se quita la contraseña con qpdf, así la copia que queda
 * en la app se abre sin pedir clave.
 *
 * Se usa execFile (sin shell) para que la contraseña nunca se interprete como
 * comando, y nunca se escribe en los logs.
 */
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const run = (cmd, args) => new Promise((resolve) => {
  execFile(cmd, args, { timeout: 60000 }, (error, stdout, stderr) => {
    resolve({ code: error ? (typeof error.code === 'number' ? error.code : error.code || 1) : 0, stdout, stderr: String(stderr || '') });
  });
});

const errorConCodigo = (codigo, mensaje) => Object.assign(new Error(mensaje), { codigo });

/**
 * Devuelve el PDF sin contraseña.
 * - Si el PDF no está cifrado, lo devuelve igual.
 * - Si requiere contraseña y no se envió → error codigo 'requiere_password'.
 * - Si la contraseña es incorrecta → error codigo 'password_incorrecta'.
 */
const desbloquearPdf = async (buffer, password = '') => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfdian-'));
  const entrada = path.join(dir, 'in.pdf');
  const salida = path.join(dir, 'out.pdf');
  try {
    fs.writeFileSync(entrada, buffer);

    // qpdf --requires-password: 0 = pide contraseña, 2 = no cifrado, 3 = cifrado sin contraseña de apertura
    const req = await run('qpdf', ['--requires-password', entrada]);

    if (req.code === 'ENOENT') {
      // Sin qpdf en el servidor: alternativa con poppler (pdftocairo)
      if (!password) return buffer;
      const r = await run('pdftocairo', ['-pdf', '-upw', password, entrada, salida]);
      if (r.code !== 0 || !fs.existsSync(salida)) {
        if (/incorrect password|password/i.test(r.stderr)) throw errorConCodigo('password_incorrecta', 'La contraseña del PDF no es correcta');
        throw new Error(`No se pudo abrir el PDF protegido: ${r.stderr.trim() || r.code}`);
      }
      return fs.readFileSync(salida);
    }

    if (req.code === 2) return buffer;                       // no está cifrado
    if (req.code === 0 && !password) {
      throw errorConCodigo('requiere_password', 'El PDF está protegido con contraseña');
    }

    const args = ['--decrypt', entrada, salida];
    if (password) args.unshift(`--password=${password}`);
    const r = await run('qpdf', args);
    // qpdf: 0 = ok, 3 = ok con advertencias
    if ((r.code === 0 || r.code === 3) && fs.existsSync(salida)) return fs.readFileSync(salida);
    if (/invalid password/i.test(r.stderr)) throw errorConCodigo('password_incorrecta', 'La contraseña del PDF no es correcta');
    throw new Error(`No se pudo quitar la contraseña del PDF: ${r.stderr.trim() || r.code}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

module.exports = { desbloquearPdf };

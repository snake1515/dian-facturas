// Genera un identificador de versión único en cada build.
// Se ejecuta automáticamente antes de `npm start` y `npm run build`
// (ver "prestart" y "prebuild" en package.json). No requiere pasos manuales.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function getVersion() {
  // 1) Si el build corre en Render, usa el commit que Render está desplegando.
  if (process.env.RENDER_GIT_COMMIT) {
    return process.env.RENDER_GIT_COMMIT.slice(0, 12);
  }
  // 2) Si se ejecuta localmente dentro del repo git, usa el commit actual.
  try {
    return execSync('git rev-parse HEAD').toString().trim().slice(0, 12);
  } catch (e) {
    // 3) Último recurso: timestamp (garantiza que cada build sea distinto).
    return 'ts-' + Date.now();
  }
}

const version = getVersion();
const buildTime = new Date().toISOString();

// A) JSON servido como archivo estático — la app lo consulta en tiempo real
//    para saber cuál es la última versión publicada.
fs.writeFileSync(
  path.join(__dirname, '..', 'public', 'version.json'),
  JSON.stringify({ version, buildTime }, null, 2)
);

// B) Módulo JS que queda incrustado dentro del propio bundle — así la app
//    sabe con qué versión fue compilada ella misma, para comparar.
fs.writeFileSync(
  path.join(__dirname, '..', 'src', 'version.js'),
  `// Archivo generado automáticamente en cada build (scripts/generate-version.js).\n` +
    `// No editar a mano: se sobrescribe en cada "npm start" / "npm run build".\n` +
    `export const APP_VERSION = ${JSON.stringify(version)};\n` +
    `export const BUILD_TIME = ${JSON.stringify(buildTime)};\n`
);

console.log(`[version] Build generado: ${version} (${buildTime})`);

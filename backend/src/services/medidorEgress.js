/**
 * Medidor aproximado de egress de la base de datos.
 * Cuenta cuántos datos devuelve cada consulta a Postgres y los agrupa por
 * la ruta de la API que la originó (p. ej. "GET /api/validador-inventario").
 * El tamaño es una estimación (JSON de las filas), suficiente para saber
 * qué pantallas consumen más. Se reinicia cada vez que se reinicia el servidor.
 */
const { AsyncLocalStorage } = require('async_hooks');
const { Client } = require('pg');

const contexto = new AsyncLocalStorage();
const stats = new Map(); // ruta -> { llamadas, consultas, bytes, filas, max }
const inicio = new Date();

const tamano = (res) => {
  try {
    const lista = Array.isArray(res) ? res : [res];
    let b = 0, f = 0;
    for (const r of lista) {
      if (r && Array.isArray(r.rows) && r.rows.length) { b += Buffer.byteLength(JSON.stringify(r.rows)); f += r.rows.length; }
    }
    return { b, f };
  } catch (e) { return { b: 0, f: 0 }; }
};

const registrar = (res, ctx) => {
  const clave = ctx ? ctx.ruta : '(tareas internas: cron, arranque)';
  const { b, f } = tamano(res);
  let s = stats.get(clave);
  if (!s) { s = { llamadas: 0, consultas: 0, bytes: 0, filas: 0, max: 0 }; stats.set(clave, s); }
  s.consultas++; s.bytes += b; s.filas += f;
  if (ctx) { ctx.bytes += b; }
};

// Envuelve Client.prototype.query (lo usan tanto pool.query como pool.connect)
const original = Client.prototype.query;
Client.prototype.query = function (...args) {
  const ctx = contexto.getStore(); // ruta que lanzó la consulta (se fija al llamarla)
  const cbIdx = args.findIndex(a => typeof a === 'function');
  if (cbIdx >= 0) {
    const cb = args[cbIdx];
    args[cbIdx] = function (err, res) { if (!err) registrar(res, ctx); return cb.apply(this, arguments); };
    return original.apply(this, args);
  }
  const r = original.apply(this, args);
  if (r && typeof r.then === 'function') r.then(res => registrar(res, ctx), () => {});
  return r;
};

// Middleware: etiqueta cada petición con su ruta (números → :id)
const middleware = (req, res, next) => {
  const ctx = { ruta: '', bytes: 0 };
  res.on('finish', () => {
    const s = stats.get(ctx.ruta);
    if (s) { s.llamadas++; if (ctx.bytes > s.max) s.max = ctx.bytes; }
  });
  contexto.run(ctx, () => {
    ctx.ruta = `${req.method} ${req.originalUrl.split('?')[0].replace(/\/\d+(?=\/|$)/g, '/:id')}`
      .replace(/(\/api\/prestamos\/soporte)\/.*/, '$1/*');
    next();
  });
};

const reporte = () => {
  const filas = [...stats.entries()].map(([ruta, s]) => ({ ruta, ...s }))
    .sort((a, b) => b.bytes - a.bytes);
  const total = filas.reduce((a, f) => a + f.bytes, 0);
  return { desde: inicio.toISOString(), total, filas };
};

module.exports = { middleware, reporte };

// middleware/errores.js — último middleware de la app: cualquier error que no
// atrapó una ruta (JSON mal formado, cuerpo demasiado grande, etc.) se responde
// como JSON, igual que el resto del API. Sin esto Express respondía una página
// HTML ("Bad Request") que el frontend no sabe leer, y dejaba un stack trace
// en los logs de Railway por cada petición mal hecha.
function manejarErrores(err, req, res, next) {
  if (res.headersSent) return next(err);
  const status = err.status || err.statusCode || 500;
  if (status >= 500) {
    console.error(`❌ ${req.method} ${req.originalUrl}:`, err);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
  const mensajes = {
    "entity.parse.failed":    "El cuerpo de la petición no es JSON válido",
    "entity.too.large":       "La información enviada es demasiado grande",
    "encoding.unsupported":   "Codificación no soportada",
  };
  res.status(status).json({ error: mensajes[err.type] || err.expose && err.message || "Petición inválida" });
}

module.exports = { manejarErrores };

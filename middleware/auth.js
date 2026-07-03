const jwt       = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");

const JWT_SECRET = process.env.JWT_SECRET || "autodromo_mty_secret_2024";

const loginLimit = rateLimit({
  windowMs: 15 * 60 * 1000, max: 15, standardHeaders: true, legacyHeaders: false,
  message: { error: "Demasiados intentos. Intenta en 15 minutos." },
});

const autoRegistroLimit = rateLimit({
  windowMs: 60 * 1000, max: 5, standardHeaders: true, legacyHeaders: false,
  message: { error: "Demasiadas solicitudes. Espera un momento." },
});

function autenticar(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) return res.status(401).json({ error: "Token requerido" });
  try { req.usuario = jwt.verify(header.split(" ")[1], JWT_SECRET); next(); }
  catch { return res.status(401).json({ error: "Token inválido o expirado" }); }
}

function autorizar(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.usuario.rol)) return res.status(403).json({ error: "Sin permisos" });
    next();
  };
}

function autenticarPiloto(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) return res.status(401).json({ error: "Token requerido" });
  try {
    const payload = jwt.verify(header.split(" ")[1], JWT_SECRET);
    if (payload.tipo !== "piloto") return res.status(403).json({ error: "Acceso solo para pilotos" });
    req.piloto = payload;
    next();
  } catch { return res.status(401).json({ error: "Token inválido o expirado" }); }
}

module.exports = { JWT_SECRET, loginLimit, autoRegistroLimit, autenticar, autorizar, autenticarPiloto };

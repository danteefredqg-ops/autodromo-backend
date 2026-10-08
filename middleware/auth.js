const jwt       = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
const db        = require("../configuracion/db");

// Sin fallback: una clave hardcodeada en el código fuente permitiría forjar
// tokens de administrador con solo leer el repo. Si falta la variable de
// entorno, el servidor debe negarse a arrancar, no arrancar "igual mismo".
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error(
    "JWT_SECRET no está configurado. Agrega esta variable de entorno antes de arrancar " +
    "el servidor (ver backend/.env.example) — sin ella, cualquiera podría forjar tokens válidos."
  );
}

// Solo cuentan los intentos FALLIDOS (skipSuccessfulRequests): el límite es
// para frenar a quien adivina contraseñas, no a la gente que entra bien. En un
// evento muchas personas comparten la IP pública del WiFi del autódromo y, si
// contaran también los logins correctos, 15 pilotos entrando en 15 minutos
// bloquearían al resto.
const loginLimit = rateLimit({
  windowMs: 15 * 60 * 1000, max: 15, standardHeaders: true, legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: "Demasiados intentos. Intenta en 15 minutos." },
});

// 5/min era demasiado agresivo para un evento real: muchas personas
// registrándose desde la misma WiFi del autódromo (o el staff ayudando desde
// una sola tablet) comparten la misma IP pública y chocan contra el límite
// entre ellas mismas, no por abuso. 20/min sigue frenando un bot de spam
// pero da margen de sobra para una ventanilla o kiosco atendiendo gente real.
const autoRegistroLimit = rateLimit({
  windowMs: 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false,
  message: { error: "Demasiadas solicitudes. Espera un momento." },
});

// Más estricto que loginLimit: evita que se use para enumerar correos
// registrados o para saturar la cuenta de Resend con envíos.
const forgotPasswordLimit = rateLimit({
  windowMs: 15 * 60 * 1000, max: 3, standardHeaders: true, legacyHeaders: false,
  message: { error: "Demasiadas solicitudes. Intenta de nuevo en 15 minutos." },
});

// El token por sí solo no basta: se revisa en la BD que el usuario siga activo
// y se toma su rol ACTUAL. Antes, desactivar a un empleado o cambiarle el rol
// no surtía efecto hasta que su token expiraba (hasta 8 horas después).
async function autenticar(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) return res.status(401).json({ error: "Token requerido" });
  let payload;
  try { payload = jwt.verify(header.split(" ")[1], JWT_SECRET); }
  catch { return res.status(401).json({ error: "Token inválido o expirado" }); }
  // Este middleware es exclusivo de personal del sistema (admin/inscripciones/torre).
  // Los pilotos tienen su propio esquema de token (tipo:"piloto", ver autenticarPiloto)
  // y NO deben poder pasar por aquí — si no se rechaza explícitamente, un piloto
  // cualquiera podría usar su propio token para leer rutas de staff que solo hacen
  // autenticar() sin autorizar(), como el listado completo de pilotos o reportes.
  if (payload.tipo === "piloto") return res.status(403).json({ error: "Acceso solo para personal del sistema" });
  try {
    const [rows] = await db.query("SELECT id, username, nombre, rol, activo FROM usuarios WHERE id = ? LIMIT 1", [payload.id]);
    if (rows.length === 0 || !rows[0].activo) return res.status(401).json({ error: "Tu usuario fue desactivado. Contacta al administrador." });
    const { activo, ...usuario } = rows[0];
    req.usuario = usuario;
    next();
  } catch (err) {
    console.error(err);
    res.status(503).json({ error: "Base de datos no disponible, intenta de nuevo" });
  }
}

function autorizar(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.usuario.rol)) return res.status(403).json({ error: "Sin permisos" });
    next();
  };
}

// Igual que autenticar(): un piloto eliminado deja de tener acceso de inmediato,
// no hasta que expire su token (7 días).
async function autenticarPiloto(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) return res.status(401).json({ error: "Token requerido" });
  let payload;
  try { payload = jwt.verify(header.split(" ")[1], JWT_SECRET); }
  catch { return res.status(401).json({ error: "Token inválido o expirado" }); }
  if (payload.tipo !== "piloto") return res.status(403).json({ error: "Acceso solo para pilotos" });
  try {
    const [rows] = await db.query("SELECT id, activo FROM pilotos WHERE id = ? LIMIT 1", [payload.id]);
    if (rows.length === 0 || !rows[0].activo) return res.status(401).json({ error: "Tu cuenta ya no está activa. Contacta a Autódromo Monterrey." });
    req.piloto = payload;
    next();
  } catch (err) {
    console.error(err);
    res.status(503).json({ error: "Base de datos no disponible, intenta de nuevo" });
  }
}

module.exports = { JWT_SECRET, loginLimit, autoRegistroLimit, forgotPasswordLimit, autenticar, autorizar, autenticarPiloto };

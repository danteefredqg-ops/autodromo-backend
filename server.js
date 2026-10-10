// server.js — Autódromo Monterrey API (entry point)
const express = require("express");
const cors    = require("cors");
const db      = require("./configuracion/db");
const { UPLOADS_DIR } = require("./configuracion/uploads");

const { inicializarBD } = require("./db/init");
const { manejarErrores } = require("./middleware/errores");
const { validarTipos } = require("./middleware/validarTipos");
const { iniciarProgramadorBackup } = require("./configuracion/backup");
const { limpiarArchivosHuerfanos } = require("./configuracion/limpiezaUploads");

const app  = express();
const PORT = process.env.PORT || 3001;

// Railway pone un proxy (su edge) delante del servidor y manda la IP real del
// visitante en X-Forwarded-For. Sin esto, req.ip era la IP del proxy para
// TODOS: los límites de intentos (login, auto-registro, recuperar contraseña)
// se compartían entre todos los usuarios — 15 logins de personas distintas en
// 15 min y a todos les salía "Demasiados intentos". Es 1 salto: el dominio
// apunta directo a Railway (sin Cloudflare como proxy); si algún día se pone
// otro proxy delante, este número tiene que subir.
app.set("trust proxy", 1);
// No anunciar en cada respuesta que el servidor es Express (pista gratis para un atacante).
app.disable("x-powered-by");

const ENV_REQUERIDOS = ["MYSQLHOST", "MYSQLUSER", "MYSQLPASSWORD", "MYSQLDATABASE"];
const faltantes = ENV_REQUERIDOS.filter(v => !process.env[v]);
if (faltantes.length)      console.warn(`⚠️  Variables faltantes: ${faltantes.join(", ")}`);
if (!process.env.JWT_SECRET) console.warn("⚠️  JWT_SECRET no configurado — el servidor va a rehusarse a arrancar.");
if (!process.env.UPLOADS_DIR) console.warn("⚠️  UPLOADS_DIR no configurado — las fotos se guardan localmente y se perderán en el próximo deploy. Conecta un Volume en Railway.");
if (!process.env.RESEND_API_KEY) console.warn("⚠️  RESEND_API_KEY no configurado — la recuperación de contraseña no podrá enviar correos.");
if (!process.env.BACKUP_EMAIL) console.warn("⚠️  BACKUP_EMAIL no configurado — no habrá respaldo automático de la base de datos.");
if (!process.env.GOOGLE_CLIENT_ID) console.warn("⚠️  GOOGLE_CLIENT_ID no configurado — el login con Google para pilotos no funcionará.");

// CORS — admite una o varias URLs separadas por coma en FRONTEND_URL (por si hay
// más de un dominio válido, ej. mientras se migra a un dominio propio). Se
// normalizan sin "/" final porque el header Origin del navegador nunca lo trae —
// un FRONTEND_URL mal copiado con esa barra de más rompía el CORS en silencio,
// sin ningún indicio en los logs de qué estaba pasando.
const origenesPermitidos = (process.env.FRONTEND_URL || "")
  .split(",").map(o => o.trim().replace(/\/$/, "")).filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Sin header Origin (curl, apps móviles, servidor-a-servidor) o sin
    // FRONTEND_URL configurado: se permite, igual que el comportamiento anterior.
    if (!origin || origenesPermitidos.length === 0 || origenesPermitidos.includes(origin)) {
      return callback(null, true);
    }
    // Sin lanzar error: se responde sin los encabezados CORS y el navegador
    // bloquea la respuesta igual. Lanzarlo llenaba el log con un stack trace
    // por cada intento (y devolvía un 500) sin aportar nada.
    console.warn(`⚠️  CORS bloqueó una petición desde un origen no permitido: ${origin}`);
    callback(null, false);
  },
  credentials: true,
}));
app.use(express.json());
app.use(validarTipos); // tipos de dato del body antes de llegar a las rutas (ver middleware/validarTipos.js)
// nosniff: el navegador respeta el tipo (imagen) y no "adivina" HTML por el
// contenido aunque alguien logre subir algo disfrazado de imagen.
app.use("/uploads", express.static(UPLOADS_DIR, {
  setHeaders: (res) => res.set("X-Content-Type-Options", "nosniff"),
}));

// ─── Health ───────────────────────────────────────────────────────────────────
app.get("/api/health", async (req, res) => {
  try {
    await db.query("SELECT 1");
    res.json({ ok: true, mensaje: "Autódromo Monterrey API activa", hora: new Date() });
  } catch {
    res.status(503).json({ ok: false, error: "Base de datos no disponible" });
  }
});

// ─── Rutas ───────────────────────────────────────────────────────────────────
app.use("/api/auth",          require("./routes/auth"));
app.use("/api/pilotos",       require("./routes/pilotos"));
app.use("/api/categorias",    require("./routes/categorias"));
app.use("/api/campeonatos",   require("./routes/campeonatos"));
app.use("/api/etapas",        require("./routes/etapas"));
app.use("/api/contratos",     require("./routes/contratos"));
app.use("/api/inscripciones", require("./routes/inscripciones"));
app.use("/api/formularios",   require("./routes/formularios"));
app.use("/api/reportes",      require("./routes/reportes"));
app.use("/api/usuarios",      require("./routes/usuarios"));
app.use("/api/piloto",        require("./routes/piloto"));
app.use("/api/resultados",    require("./routes/resultados"));
app.use("/api/backup",        require("./routes/backup"));
app.use("/api/imagenes-registro", require("./routes/imagenes"));

// ─── 404 ──────────────────────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: "Ruta no encontrada" }));

// ─── Errores no atrapados por las rutas (JSON mal formado, etc.) ─────────────
app.use(manejarErrores);

// Red de seguridad: una promesa rechazada sin catch en alguna ruta tumbaba el
// proceso entero (Node lo termina por defecto) y Railway lo reiniciaba,
// cortando a todos los que estuvieran usando el sistema. Se registra y sigue.
process.on("unhandledRejection", (err) => {
  console.error("❌ Promesa rechazada sin manejar:", err);
});

// ─── Arrancar ─────────────────────────────────────────────────────────────────
inicializarBD()
  .then(() => {
    const servidor = app.listen(PORT, () => {
      console.log(`\n🏁 Autódromo Monterrey API`);
      console.log(`🚀 Puerto: ${PORT}`);
      console.log(`📦 Listo\n`);
      iniciarProgramadorBackup();
      // Fotos/imágenes que ya no son de nadie (ver configuracion/limpiezaUploads.js).
      limpiarArchivosHuerfanos(db).catch(err => console.warn(`⚠️  No se pudo limpiar uploads: ${err.message}`));
    });
    // En cada deploy Railway manda SIGTERM al proceso viejo: se dejan terminar
    // las peticiones en curso (p.ej. un registro a medio guardar) antes de salir,
    // en vez de cortarlas. Si algo se cuelga, se sale igual a los 10 s.
    process.on("SIGTERM", () => {
      console.log("🛑 SIGTERM recibido — cerrando sin cortar peticiones en curso...");
      servidor.close(() => db.end().catch(() => {}).finally(() => process.exit(0)));
      setTimeout(() => process.exit(0), 10000).unref();
    });
  })
  .catch(err => {
    console.error("❌ Error al inicializar BD:", err);
    process.exit(1);
  });

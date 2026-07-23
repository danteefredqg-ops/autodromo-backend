// server.js — Autódromo Monterrey API (entry point)
const express = require("express");
const cors    = require("cors");
const db      = require("./configuracion/db");
const { UPLOADS_DIR } = require("./configuracion/uploads");

const { inicializarBD } = require("./db/init");

const app  = express();
const PORT = process.env.PORT || 3001;

const ENV_REQUERIDOS = ["MYSQLHOST", "MYSQLUSER", "MYSQLPASSWORD", "MYSQLDATABASE"];
const faltantes = ENV_REQUERIDOS.filter(v => !process.env[v]);
if (faltantes.length)      console.warn(`⚠️  Variables faltantes: ${faltantes.join(", ")}`);
if (!process.env.JWT_SECRET) console.warn("⚠️  JWT_SECRET no configurado — el servidor va a rehusarse a arrancar.");
if (!process.env.UPLOADS_DIR) console.warn("⚠️  UPLOADS_DIR no configurado — las fotos se guardan localmente y se perderán en el próximo deploy. Conecta un Volume en Railway.");
if (!process.env.RESEND_API_KEY) console.warn("⚠️  RESEND_API_KEY no configurado — la recuperación de contraseña no podrá enviar correos.");

app.use(cors({ origin: process.env.FRONTEND_URL || "*", credentials: true }));
app.use(express.json());
app.use("/uploads", express.static(UPLOADS_DIR));

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

// ─── 404 ──────────────────────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: "Ruta no encontrada" }));

// ─── Arrancar ─────────────────────────────────────────────────────────────────
inicializarBD()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`\n🏁 Autódromo Monterrey API`);
      console.log(`🚀 Puerto: ${PORT}`);
      console.log(`📦 Listo\n`);
    });
  })
  .catch(err => {
    console.error("❌ Error al inicializar BD:", err);
    process.exit(1);
  });

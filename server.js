// server.js - Autódromo Monterrey API
const express    = require("express");
const cors       = require("cors");
const bcrypt     = require("bcryptjs");
const jwt        = require("jsonwebtoken");
const rateLimit  = require("express-rate-limit");
const db         = require("./configuracion/db");

const app  = express();
const PORT = process.env.PORT || 3001;

// ─── Validación de variables de entorno ───────────────────────────────────────
const ENV_REQUERIDOS = ["MYSQLHOST", "MYSQLUSER", "MYSQLPASSWORD", "MYSQLDATABASE"];
const faltantes = ENV_REQUERIDOS.filter((v) => !process.env[v]);
if (faltantes.length) {
  console.warn(`⚠️  Variables de entorno faltantes: ${faltantes.join(", ")}`);
}
if (!process.env.JWT_SECRET) {
  console.warn("⚠️  JWT_SECRET no configurado — usando clave de desarrollo. CAMBIAR en producción.");
}
const JWT_SECRET = process.env.JWT_SECRET || "autodromo_mty_secret_2024";

// ─── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({
  origin: process.env.FRONTEND_URL || "*",
  credentials: true,
}));
app.use(express.json());

// ─── Rate limiting ────────────────────────────────────────────────────────────
const loginLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiados intentos de acceso. Intenta de nuevo en 15 minutos." },
});

const autoRegistroLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiadas solicitudes. Espera un momento antes de intentar de nuevo." },
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function autenticar(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Token requerido" });
  }
  try {
    req.usuario = jwt.verify(header.split(" ")[1], JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Token inválido o expirado" });
  }
}

function autorizar(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.usuario.rol)) {
      return res.status(403).json({ error: "Sin permisos para esta acción" });
    }
    next();
  };
}

// ─── Inicializar tablas ────────────────────────────────────────────────────────
async function inicializarBD() {
  const sql = [
    `CREATE TABLE IF NOT EXISTS usuarios (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      username    VARCHAR(80)  NOT NULL UNIQUE,
      password    VARCHAR(255) NOT NULL,
      nombre      VARCHAR(150) NOT NULL,
      rol         ENUM('admin','inscripciones','torre') NOT NULL DEFAULT 'inscripciones',
      activo      TINYINT(1)   NOT NULL DEFAULT 1,
      creado_en   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,

    `CREATE TABLE IF NOT EXISTS pilotos (
      id                  INT AUTO_INCREMENT PRIMARY KEY,
      nombre_completo     VARCHAR(150) NOT NULL,
      telefono            VARCHAR(30),
      email               VARCHAR(150) UNIQUE,
      tipo_sangre         VARCHAR(5)   NOT NULL,
      direccion           VARCHAR(255),
      ciudad              VARCHAR(80),
      estado              VARCHAR(80),
      nacionalidad        VARCHAR(80)  NOT NULL DEFAULT 'Mexicana',
      estatus_licencia    ENUM('Vigente','Vencida','Suspendida') NOT NULL DEFAULT 'Vigente',
      numero_licencia     VARCHAR(60)  UNIQUE,
      fecha_nacimiento    DATE,
      contacto_emergencia VARCHAR(150),
      telefono_emergencia VARCHAR(30),
      notas               TEXT,
      activo              TINYINT(1)   NOT NULL DEFAULT 1,
      creado_en           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      actualizado_en      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`,

    `CREATE TABLE IF NOT EXISTS categorias (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      nombre      VARCHAR(60)  NOT NULL UNIQUE,
      descripcion VARCHAR(150),
      color       VARCHAR(10)  NOT NULL DEFAULT '#e63946',
      activo      TINYINT(1)   NOT NULL DEFAULT 1,
      creado_en   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,

    `CREATE TABLE IF NOT EXISTS carreras (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      nombre      VARCHAR(150) NOT NULL,
      fecha       DATE         NOT NULL,
      ubicacion   VARCHAR(150) NOT NULL DEFAULT 'Autódromo Monterrey',
      descripcion TEXT,
      activo      TINYINT(1)   NOT NULL DEFAULT 1,
      creado_en   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      actualizado_en DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`,

    `CREATE TABLE IF NOT EXISTS inscripciones (
      id              INT AUTO_INCREMENT PRIMARY KEY,
      piloto_id       INT          NOT NULL,
      carrera_id      INT          NOT NULL,
      categoria_id    INT          NOT NULL,
      numero_piloto   INT          NOT NULL,
      vehiculo        VARCHAR(100) NOT NULL,
      modelo_vehiculo VARCHAR(100),
      anio_vehiculo   INT,
      color_vehiculo  VARCHAR(50),
      estatus         ENUM('Pendiente','Pagado','Descalificado') NOT NULL DEFAULT 'Pendiente',
      metodo_pago     ENUM('Efectivo','Transferencia','Tarjeta'),
      monto_pago      DECIMAL(10,2),
      pagado_en       DATETIME,
      pagado_por      VARCHAR(80),
      notas           TEXT,
      auto_registro   TINYINT(1)   NOT NULL DEFAULT 0,
      creado_en       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      actualizado_en  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_carrera_numero (carrera_id, numero_piloto),
      FOREIGN KEY (piloto_id)    REFERENCES pilotos(id),
      FOREIGN KEY (carrera_id)   REFERENCES carreras(id),
      FOREIGN KEY (categoria_id) REFERENCES categorias(id)
    )`,
  ];

  for (const query of sql) {
    await db.query(query);
  }
  console.log("✅ Tablas verificadas/creadas");

  // Seed: usuario admin por defecto
  const [rows] = await db.query("SELECT id FROM usuarios WHERE username = 'admin' LIMIT 1");
  if (rows.length === 0) {
    const hash = await bcrypt.hash("Admin123!", 10);
    await db.query(
      "INSERT INTO usuarios (username, password, nombre, rol) VALUES (?, ?, ?, ?)",
      ["admin", hash, "Administrador General", "admin"]
    );
    const hash2 = await bcrypt.hash("Inscri123!", 10);
    await db.query(
      "INSERT INTO usuarios (username, password, nombre, rol) VALUES (?, ?, ?, ?)",
      ["inscripciones", hash2, "Staff Inscripciones", "inscripciones"]
    );
    const hash3 = await bcrypt.hash("Torre123!", 10);
    await db.query(
      "INSERT INTO usuarios (username, password, nombre, rol) VALUES (?, ?, ?, ?)",
      ["torre", hash3, "Torre de Control", "torre"]
    );
    console.log("✅ Usuarios por defecto creados");
  }

  // Seed: 9 categorías
  const categorias = [
    ["BN",           "Beginner Nacional",    "#22c55e"],
    ["SR",           "Super Rookie",         "#3b82f6"],
    ["Rotax Junior", "Categoría Junior Rotax","#f59e0b"],
    ["Rotax Senior", "Categoría Senior Rotax","#ef4444"],
    ["X30 Junior",   "X30 Junior",           "#8b5cf6"],
    ["X30 Senior",   "X30 Senior",           "#ec4899"],
    ["Shifter",      "Kart Shifter",         "#06b6d4"],
    ["DD2",          "Dual Drive 2",         "#f97316"],
    ["Máster",       "Categoría Máster 35+", "#64748b"],
  ];
  for (const [nombre, descripcion, color] of categorias) {
    await db.query(
      "INSERT IGNORE INTO categorias (nombre, descripcion, color) VALUES (?, ?, ?)",
      [nombre, descripcion, color]
    );
  }
  console.log("✅ Categorías verificadas");
}

// ─── Health ───────────────────────────────────────────────────────────────────
app.get("/api/health", async (req, res) => {
  try {
    await db.query("SELECT 1");
    res.json({ ok: true, mensaje: "Autódromo Monterrey API activa", hora: new Date() });
  } catch {
    res.status(503).json({ ok: false, error: "Base de datos no disponible" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════════════════════════════════════
app.post("/api/auth/login", loginLimit, async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: "Usuario y contraseña requeridos" });
    }
    const [rows] = await db.query(
      "SELECT * FROM usuarios WHERE username = ? AND activo = 1 LIMIT 1",
      [username]
    );
    if (rows.length === 0) {
      return res.status(401).json({ error: "Credenciales incorrectas" });
    }
    const usuario = rows[0];
    const valido  = await bcrypt.compare(password, usuario.password);
    if (!valido) {
      return res.status(401).json({ error: "Credenciales incorrectas" });
    }
    const token = jwt.sign(
      { id: usuario.id, username: usuario.username, rol: usuario.rol, nombre: usuario.nombre },
      JWT_SECRET,
      { expiresIn: "8h" }
    );
    res.json({
      token,
      usuario: { id: usuario.id, username: usuario.username, rol: usuario.rol, nombre: usuario.nombre },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al iniciar sesión" });
  }
});

app.get("/api/auth/yo", autenticar, async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT id, username, nombre, rol, activo FROM usuarios WHERE id = ? LIMIT 1",
      [req.usuario.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Usuario no encontrado" });
    res.json(rows[0]);
  } catch {
    res.status(500).json({ error: "Error al obtener usuario" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// PILOTOS
// ═══════════════════════════════════════════════════════════════════════════════
app.get("/api/pilotos", autenticar, async (req, res) => {
  try {
    const { buscar, estatus_licencia } = req.query;
    let sql = `
      SELECT p.*,
        (SELECT COUNT(*) FROM inscripciones WHERE piloto_id = p.id) AS total_carreras,
        (SELECT MAX(c.fecha)
           FROM inscripciones i JOIN carreras c ON c.id = i.carrera_id
           WHERE i.piloto_id = p.id) AS ultima_carrera_fecha,
        (SELECT COUNT(*)
           FROM inscripciones i2
           WHERE i2.piloto_id = p.id
             AND i2.carrera_id IN (SELECT id FROM carreras ORDER BY fecha DESC LIMIT 3)
        ) AS etapas_recientes
      FROM pilotos p WHERE p.activo = 1`;
    const params = [];

    if (estatus_licencia) {
      sql += " AND p.estatus_licencia = ?";
      params.push(estatus_licencia);
    }
    if (buscar) {
      sql += " AND (p.nombre_completo LIKE ? OR p.email LIKE ? OR p.telefono LIKE ? OR p.numero_licencia LIKE ?)";
      const like = `%${buscar}%`;
      params.push(like, like, like, like);
    }
    sql += " ORDER BY p.nombre_completo ASC";
    const [rows] = await db.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener pilotos" });
  }
});

app.get("/api/pilotos/:id", autenticar, async (req, res) => {
  try {
    const [pilotos] = await db.query("SELECT * FROM pilotos WHERE id = ? LIMIT 1", [req.params.id]);
    if (pilotos.length === 0) return res.status(404).json({ error: "Piloto no encontrado" });
    const [inscripciones] = await db.query(
      `SELECT i.*, c.nombre AS carrera_nombre, c.fecha AS carrera_fecha,
              cat.nombre AS categoria_nombre, cat.color AS categoria_color
       FROM inscripciones i
       JOIN carreras   c   ON c.id   = i.carrera_id
       JOIN categorias cat ON cat.id = i.categoria_id
       WHERE i.piloto_id = ?
       ORDER BY i.creado_en DESC`,
      [req.params.id]
    );
    res.json({ ...pilotos[0], inscripciones });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener piloto" });
  }
});

app.post("/api/pilotos", autenticar, autorizar("admin", "inscripciones"), async (req, res) => {
  try {
    const {
      nombre_completo, telefono, email, tipo_sangre, direccion, ciudad, estado,
      nacionalidad, estatus_licencia, numero_licencia, fecha_nacimiento,
      contacto_emergencia, telefono_emergencia, notas,
    } = req.body;
    if (!nombre_completo || !tipo_sangre) {
      return res.status(400).json({ error: "Nombre y tipo de sangre requeridos" });
    }
    const [result] = await db.query(
      `INSERT INTO pilotos
        (nombre_completo, telefono, email, tipo_sangre, direccion, ciudad, estado,
         nacionalidad, estatus_licencia, numero_licencia, fecha_nacimiento,
         contacto_emergencia, telefono_emergencia, notas)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        nombre_completo, telefono || null, email || null, tipo_sangre,
        direccion || null, ciudad || null, estado || null,
        nacionalidad || "Mexicana", estatus_licencia || "Vigente",
        numero_licencia || null,
        fecha_nacimiento || null,
        contacto_emergencia || null, telefono_emergencia || null,
        notas || null,
      ]
    );
    const [nuevo] = await db.query("SELECT * FROM pilotos WHERE id = ? LIMIT 1", [result.insertId]);
    res.status(201).json(nuevo[0]);
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "Email o número de licencia ya registrado" });
    }
    console.error(err);
    res.status(500).json({ error: "Error al crear piloto" });
  }
});

app.put("/api/pilotos/:id", autenticar, autorizar("admin", "inscripciones"), async (req, res) => {
  try {
    const {
      nombre_completo, telefono, email, tipo_sangre, direccion, ciudad, estado,
      nacionalidad, estatus_licencia, numero_licencia, fecha_nacimiento,
      contacto_emergencia, telefono_emergencia, notas,
    } = req.body;
    if (!nombre_completo || !tipo_sangre) {
      return res.status(400).json({ error: "Nombre y tipo de sangre requeridos" });
    }
    await db.query(
      `UPDATE pilotos SET
        nombre_completo = ?, telefono = ?, email = ?, tipo_sangre = ?,
        direccion = ?, ciudad = ?, estado = ?, nacionalidad = ?,
        estatus_licencia = ?, numero_licencia = ?, fecha_nacimiento = ?,
        contacto_emergencia = ?, telefono_emergencia = ?, notas = ?
       WHERE id = ?`,
      [
        nombre_completo, telefono || null, email || null, tipo_sangre,
        direccion || null, ciudad || null, estado || null,
        nacionalidad || "Mexicana", estatus_licencia || "Vigente",
        numero_licencia || null, fecha_nacimiento || null,
        contacto_emergencia || null, telefono_emergencia || null,
        notas || null, req.params.id,
      ]
    );
    const [rows] = await db.query("SELECT * FROM pilotos WHERE id = ? LIMIT 1", [req.params.id]);
    res.json(rows[0]);
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") return res.status(409).json({ error: "Datos duplicados" });
    res.status(500).json({ error: "Error al actualizar piloto" });
  }
});

app.delete("/api/pilotos/:id", autenticar, autorizar("admin"), async (req, res) => {
  try {
    await db.query("UPDATE pilotos SET activo = 0 WHERE id = ?", [req.params.id]);
    res.json({ mensaje: "Piloto desactivado" });
  } catch {
    res.status(500).json({ error: "Error al desactivar piloto" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// CATEGORÍAS
// ═══════════════════════════════════════════════════════════════════════════════
app.get("/api/categorias", async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT c.*, (SELECT COUNT(*) FROM inscripciones WHERE categoria_id = c.id) AS total_inscritos
       FROM categorias c WHERE c.activo = 1 ORDER BY c.nombre ASC`
    );
    res.json(rows);
  } catch {
    res.status(500).json({ error: "Error al obtener categorías" });
  }
});

app.post("/api/categorias", autenticar, autorizar("admin"), async (req, res) => {
  try {
    const { nombre, descripcion, color } = req.body;
    const [result] = await db.query(
      "INSERT INTO categorias (nombre, descripcion, color) VALUES (?, ?, ?)",
      [nombre, descripcion || null, color || "#e63946"]
    );
    const [nueva] = await db.query("SELECT * FROM categorias WHERE id = ? LIMIT 1", [result.insertId]);
    res.status(201).json(nueva[0]);
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") return res.status(409).json({ error: "Categoría ya existe" });
    res.status(500).json({ error: "Error al crear categoría" });
  }
});

app.put("/api/categorias/:id", autenticar, autorizar("admin"), async (req, res) => {
  try {
    const { nombre, descripcion, color } = req.body;
    await db.query(
      "UPDATE categorias SET nombre = ?, descripcion = ?, color = ? WHERE id = ?",
      [nombre, descripcion || null, color || "#e63946", req.params.id]
    );
    const [rows] = await db.query("SELECT * FROM categorias WHERE id = ? LIMIT 1", [req.params.id]);
    res.json(rows[0]);
  } catch {
    res.status(500).json({ error: "Error al actualizar categoría" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// CARRERAS
// ═══════════════════════════════════════════════════════════════════════════════
app.get("/api/carreras", async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT c.*, (SELECT COUNT(*) FROM inscripciones WHERE carrera_id = c.id) AS total_inscritos
       FROM carreras c WHERE c.activo = 1 ORDER BY c.fecha DESC`
    );
    res.json(rows);
  } catch {
    res.status(500).json({ error: "Error al obtener carreras" });
  }
});

app.get("/api/carreras/:id", async (req, res) => {
  try {
    const [rows] = await db.query("SELECT * FROM carreras WHERE id = ? LIMIT 1", [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: "Carrera no encontrada" });
    res.json(rows[0]);
  } catch {
    res.status(500).json({ error: "Error al obtener carrera" });
  }
});

app.post("/api/carreras", autenticar, autorizar("admin"), async (req, res) => {
  try {
    const { nombre, fecha, ubicacion, descripcion } = req.body;
    if (!nombre || !fecha) return res.status(400).json({ error: "Nombre y fecha requeridos" });
    const [result] = await db.query(
      "INSERT INTO carreras (nombre, fecha, ubicacion, descripcion) VALUES (?, ?, ?, ?)",
      [nombre, fecha, ubicacion || "Autódromo Monterrey", descripcion || null]
    );
    const [nueva] = await db.query("SELECT * FROM carreras WHERE id = ? LIMIT 1", [result.insertId]);
    res.status(201).json(nueva[0]);
  } catch {
    res.status(500).json({ error: "Error al crear carrera" });
  }
});

app.put("/api/carreras/:id", autenticar, autorizar("admin"), async (req, res) => {
  try {
    const { nombre, fecha, ubicacion, descripcion } = req.body;
    if (!nombre || !fecha) return res.status(400).json({ error: "Nombre y fecha requeridos" });
    await db.query(
      "UPDATE carreras SET nombre = ?, fecha = ?, ubicacion = ?, descripcion = ? WHERE id = ?",
      [nombre, fecha, ubicacion || "Autódromo Monterrey", descripcion || null, req.params.id]
    );
    const [rows] = await db.query("SELECT * FROM carreras WHERE id = ? LIMIT 1", [req.params.id]);
    res.json(rows[0]);
  } catch {
    res.status(500).json({ error: "Error al actualizar carrera" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// INSCRIPCIONES
// ═══════════════════════════════════════════════════════════════════════════════
app.get("/api/inscripciones", autenticar, async (req, res) => {
  try {
    const { carrera_id, categoria_id, estatus } = req.query;
    let sql = `
      SELECT i.*,
        p.nombre_completo AS piloto_nombre, p.tipo_sangre, p.telefono AS piloto_telefono,
        p.nacionalidad AS piloto_nacionalidad,
        c.nombre AS carrera_nombre, c.fecha AS carrera_fecha,
        cat.nombre AS categoria_nombre, cat.color AS categoria_color
      FROM inscripciones i
      JOIN pilotos   p   ON p.id   = i.piloto_id
      JOIN carreras  c   ON c.id   = i.carrera_id
      JOIN categorias cat ON cat.id = i.categoria_id
      WHERE 1=1`;
    const params = [];

    if (carrera_id)   { sql += " AND i.carrera_id = ?";   params.push(carrera_id); }
    if (categoria_id) { sql += " AND i.categoria_id = ?"; params.push(categoria_id); }
    if (estatus)      { sql += " AND i.estatus = ?";      params.push(estatus); }

    sql += " ORDER BY cat.nombre ASC, i.numero_piloto ASC";
    const [rows] = await db.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener inscripciones" });
  }
});

app.post("/api/inscripciones", autenticar, autorizar("admin", "inscripciones"), async (req, res) => {
  try {
    const { piloto_id, carrera_id, categoria_id, numero_piloto, vehiculo, modelo_vehiculo } = req.body;
    if (!piloto_id || !carrera_id || !categoria_id || !numero_piloto || !vehiculo) {
      return res.status(400).json({ error: "Campos obligatorios incompletos" });
    }
    const [yaInscrito] = await db.query(
      "SELECT id FROM inscripciones WHERE piloto_id = ? AND carrera_id = ? LIMIT 1",
      [piloto_id, carrera_id]
    );
    if (yaInscrito.length > 0) {
      return res.status(409).json({ error: "Este piloto ya está inscrito en esta carrera" });
    }
    const [result] = await db.query(
      `INSERT INTO inscripciones (piloto_id, carrera_id, categoria_id, numero_piloto, vehiculo, modelo_vehiculo)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [piloto_id, carrera_id, categoria_id, numero_piloto, vehiculo, modelo_vehiculo || null]
    );
    const [nueva] = await db.query(
      `SELECT i.*, p.nombre_completo AS piloto_nombre, p.tipo_sangre,
              cat.nombre AS categoria_nombre, cat.color AS categoria_color,
              c.nombre AS carrera_nombre
       FROM inscripciones i
       JOIN pilotos p ON p.id = i.piloto_id
       JOIN categorias cat ON cat.id = i.categoria_id
       JOIN carreras c ON c.id = i.carrera_id
       WHERE i.id = ? LIMIT 1`,
      [result.insertId]
    );
    res.status(201).json(nueva[0]);
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: `El número de piloto ya está registrado en esta carrera` });
    }
    console.error(err);
    res.status(500).json({ error: "Error al inscribir piloto" });
  }
});

app.patch("/api/inscripciones/:id/pagar", autenticar, autorizar("admin", "inscripciones"), async (req, res) => {
  try {
    const { metodo_pago, monto_pago } = req.body;
    await db.query(
      `UPDATE inscripciones
       SET estatus = 'Pagado', metodo_pago = ?, monto_pago = ?, pagado_en = NOW(), pagado_por = ?
       WHERE id = ?`,
      [metodo_pago || "Efectivo", monto_pago || null, req.usuario.username, req.params.id]
    );
    const [rows] = await db.query(
      `SELECT i.*, p.nombre_completo AS piloto_nombre, cat.nombre AS categoria_nombre
       FROM inscripciones i
       JOIN pilotos p ON p.id = i.piloto_id
       JOIN categorias cat ON cat.id = i.categoria_id
       WHERE i.id = ? LIMIT 1`,
      [req.params.id]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al registrar pago" });
  }
});

app.patch("/api/inscripciones/:id/estatus", autenticar, autorizar("admin", "inscripciones"), async (req, res) => {
  try {
    const { estatus, notas } = req.body;
    const estatusValidos = ["Pendiente", "Pagado", "Descalificado"];
    if (!estatus || !estatusValidos.includes(estatus)) {
      return res.status(400).json({ error: "Estatus inválido. Valores permitidos: Pendiente, Pagado, Descalificado" });
    }
    await db.query(
      "UPDATE inscripciones SET estatus = ?, notas = ? WHERE id = ?",
      [estatus, notas || null, req.params.id]
    );
    res.json({ mensaje: "Estatus actualizado" });
  } catch {
    res.status(500).json({ error: "Error al actualizar estatus" });
  }
});

app.delete("/api/inscripciones/:id", autenticar, autorizar("admin"), async (req, res) => {
  try {
    await db.query("DELETE FROM inscripciones WHERE id = ?", [req.params.id]);
    res.json({ mensaje: "Inscripción eliminada" });
  } catch {
    res.status(500).json({ error: "Error al eliminar inscripción" });
  }
});

// Auto-registro público (sin token)
app.post("/api/inscripciones/auto-registro", autoRegistroLimit, async (req, res) => {
  try {
    const {
      carrera_id, categoria_id, numero_piloto, vehiculo, modelo_vehiculo,
      // datos piloto
      email, nombre_completo, telefono, tipo_sangre,
      contacto_emergencia, telefono_emergencia,
    } = req.body;

    if (!carrera_id || !categoria_id || !numero_piloto || !vehiculo) {
      return res.status(400).json({ error: "Campos obligatorios incompletos" });
    }

    // Buscar piloto por email
    let piloto_id = null;
    if (email) {
      const [existentes] = await db.query(
        "SELECT id FROM pilotos WHERE email = ? AND activo = 1 LIMIT 1",
        [email]
      );
      if (existentes.length > 0) {
        piloto_id = existentes[0].id;
      }
    }

    // Crear piloto nuevo si no existe
    if (!piloto_id) {
      if (!nombre_completo || !tipo_sangre) {
        return res.status(400).json({ error: "Nombre y tipo de sangre requeridos para nuevo piloto" });
      }
      const [result] = await db.query(
        `INSERT INTO pilotos (nombre_completo, telefono, email, tipo_sangre, contacto_emergencia, telefono_emergencia)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [nombre_completo, telefono || null, email || null, tipo_sangre,
         contacto_emergencia || null, telefono_emergencia || null]
      );
      piloto_id = result.insertId;
    }

    const [result] = await db.query(
      `INSERT INTO inscripciones (piloto_id, carrera_id, categoria_id, numero_piloto, vehiculo, modelo_vehiculo, auto_registro)
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
      [piloto_id, carrera_id, categoria_id, numero_piloto, vehiculo, modelo_vehiculo || null]
    );

    const [nueva] = await db.query(
      `SELECT i.*, p.nombre_completo AS piloto_nombre,
              cat.nombre AS categoria_nombre, c.nombre AS carrera_nombre
       FROM inscripciones i
       JOIN pilotos p ON p.id = i.piloto_id
       JOIN categorias cat ON cat.id = i.categoria_id
       JOIN carreras c ON c.id = i.carrera_id
       WHERE i.id = ? LIMIT 1`,
      [result.insertId]
    );
    res.status(201).json({ mensaje: "Pre-inscripción exitosa", inscripcion: nueva[0] });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: `El número ${req.body.numero_piloto} ya está registrado en esta carrera` });
    }
    console.error(err);
    res.status(500).json({ error: "Error en auto-registro" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// REPORTES
// ═══════════════════════════════════════════════════════════════════════════════
app.get("/api/reportes/por-categoria", autenticar, async (req, res) => {
  try {
    const { carrera_id, categoria_id } = req.query;
    if (!carrera_id) return res.status(400).json({ error: "carrera_id requerido" });

    let sql = `
      SELECT i.*,
        p.nombre_completo AS piloto_nombre, p.tipo_sangre, p.telefono AS piloto_telefono,
        p.nacionalidad, p.estatus_licencia,
        cat.nombre AS categoria_nombre, cat.color AS categoria_color, cat.descripcion AS categoria_descripcion
      FROM inscripciones i
      JOIN pilotos   p   ON p.id   = i.piloto_id
      JOIN categorias cat ON cat.id = i.categoria_id
      WHERE i.carrera_id = ?`;
    const params = [carrera_id];

    if (categoria_id) { sql += " AND i.categoria_id = ?"; params.push(categoria_id); }
    sql += " ORDER BY cat.nombre ASC, i.numero_piloto ASC";

    const [rows] = await db.query(sql, params);

    // Agrupar por categoría
    const agrupado = {};
    for (const r of rows) {
      const nombre = r.categoria_nombre;
      if (!agrupado[nombre]) {
        agrupado[nombre] = {
          categoria: { nombre, color: r.categoria_color, descripcion: r.categoria_descripcion },
          pilotos: [],
          total: 0,
          pagados: 0,
        };
      }
      agrupado[nombre].pilotos.push(r);
      agrupado[nombre].total++;
      if (r.estatus === "Pagado") agrupado[nombre].pagados++;
    }

    res.json({ agrupado, total: rows.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al generar reporte" });
  }
});

app.get("/api/reportes/corte-general", autenticar, autorizar("admin", "inscripciones"), async (req, res) => {
  try {
    const { carrera_id } = req.query;
    if (!carrera_id) return res.status(400).json({ error: "carrera_id requerido" });

    const [carrera] = await db.query("SELECT * FROM carreras WHERE id = ? LIMIT 1", [carrera_id]);
    if (carrera.length === 0) return res.status(404).json({ error: "Carrera no encontrada" });

    const [inscripciones] = await db.query(
      `SELECT i.*,
        p.nombre_completo AS piloto_nombre, p.tipo_sangre, p.telefono AS piloto_telefono,
        cat.nombre AS categoria_nombre, cat.color AS categoria_color
       FROM inscripciones i
       JOIN pilotos   p   ON p.id   = i.piloto_id
       JOIN categorias cat ON cat.id = i.categoria_id
       WHERE i.carrera_id = ?
       ORDER BY i.numero_piloto ASC`,
      [carrera_id]
    );

    const pagados   = inscripciones.filter((r) => r.estatus === "Pagado");
    const pendientes = inscripciones.filter((r) => r.estatus === "Pendiente");
    const ingresos   = pagados.reduce((s, r) => s + (parseFloat(r.monto_pago) || 0), 0);

    // Resumen por categoría
    const por_categoria = {};
    for (const r of inscripciones) {
      const n = r.categoria_nombre;
      if (!por_categoria[n]) {
        por_categoria[n] = { categoria: { nombre: n, color: r.categoria_color }, total: 0, pagados: 0 };
      }
      por_categoria[n].total++;
      if (r.estatus === "Pagado") por_categoria[n].pagados++;
    }

    res.json({
      carrera: carrera[0],
      resumen: {
        total:    inscripciones.length,
        pagados:  pagados.length,
        pendientes: pendientes.length,
        ingresos,
      },
      por_categoria,
      inscripciones,
      generado_en: new Date(),
      generado_por: req.usuario.username,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al generar corte general" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// USUARIOS (solo admin)
// ═══════════════════════════════════════════════════════════════════════════════
app.get("/api/usuarios", autenticar, autorizar("admin"), async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT id, username, nombre, rol, activo, creado_en FROM usuarios ORDER BY nombre ASC"
    );
    res.json(rows);
  } catch {
    res.status(500).json({ error: "Error al obtener usuarios" });
  }
});

app.post("/api/usuarios", autenticar, autorizar("admin"), async (req, res) => {
  try {
    const { username, password, nombre, rol } = req.body;
    if (!username || !password || !nombre || !rol) {
      return res.status(400).json({ error: "Todos los campos son requeridos" });
    }
    const hash = await bcrypt.hash(password, 10);
    const [result] = await db.query(
      "INSERT INTO usuarios (username, password, nombre, rol) VALUES (?, ?, ?, ?)",
      [username, hash, nombre, rol]
    );
    res.status(201).json({ id: result.insertId, username, nombre, rol, activo: 1 });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") return res.status(409).json({ error: "Username ya existe" });
    res.status(500).json({ error: "Error al crear usuario" });
  }
});

app.patch("/api/usuarios/:id/activar", autenticar, autorizar("admin"), async (req, res) => {
  try {
    const [rows] = await db.query("SELECT activo FROM usuarios WHERE id = ? LIMIT 1", [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: "Usuario no encontrado" });
    const nuevoEstado = rows[0].activo ? 0 : 1;
    await db.query("UPDATE usuarios SET activo = ? WHERE id = ?", [nuevoEstado, req.params.id]);
    res.json({ activo: nuevoEstado });
  } catch {
    res.status(500).json({ error: "Error al actualizar usuario" });
  }
});

app.patch("/api/usuarios/:id/password", autenticar, autorizar("admin"), async (req, res) => {
  try {
    const { password } = req.body;
    if (!password || password.length < 6) {
      return res.status(400).json({ error: "Mínimo 6 caracteres" });
    }
    const hash = await bcrypt.hash(password, 10);
    await db.query("UPDATE usuarios SET password = ? WHERE id = ?", [hash, req.params.id]);
    res.json({ mensaje: "Contraseña actualizada" });
  } catch {
    res.status(500).json({ error: "Error al cambiar contraseña" });
  }
});

// ─── 404 ─────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: "Ruta no encontrada" });
});

// ─── Arrancar ─────────────────────────────────────────────────────────────────
inicializarBD()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`\n🏁 Autódromo Monterrey API`);
      console.log(`🚀 Puerto: ${PORT}`);
      console.log(`📦 Listo\n`);
    });
  })
  .catch((err) => {
    console.error("❌ Error al inicializar BD:", err);
    process.exit(1);
  });

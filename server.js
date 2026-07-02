// server.js - Autódromo Monterrey API
const express   = require("express");
const cors      = require("cors");
const bcrypt    = require("bcryptjs");
const jwt       = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
const db        = require("./configuracion/db");

const app  = express();
const PORT = process.env.PORT || 3001;

const ENV_REQUERIDOS = ["MYSQLHOST", "MYSQLUSER", "MYSQLPASSWORD", "MYSQLDATABASE"];
const faltantes = ENV_REQUERIDOS.filter((v) => !process.env[v]);
if (faltantes.length) console.warn(`⚠️  Variables faltantes: ${faltantes.join(", ")}`);
if (!process.env.JWT_SECRET) console.warn("⚠️  JWT_SECRET no configurado — usando clave de desarrollo.");
const JWT_SECRET = process.env.JWT_SECRET || "autodromo_mty_secret_2024";

app.use(cors({ origin: process.env.FRONTEND_URL || "*", credentials: true }));
app.use(express.json());

const loginLimit = rateLimit({
  windowMs: 15 * 60 * 1000, max: 15, standardHeaders: true, legacyHeaders: false,
  message: { error: "Demasiados intentos. Intenta en 15 minutos." },
});
const autoRegistroLimit = rateLimit({
  windowMs: 60 * 1000, max: 5, standardHeaders: true, legacyHeaders: false,
  message: { error: "Demasiadas solicitudes. Espera un momento." },
});

// ─── Auth helpers ──────────────────────────────────────────────────────────────
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

// ─── DB migration helpers ──────────────────────────────────────────────────────
async function tablaExiste(nombre) {
  const [r] = await db.query(
    "SELECT COUNT(*) AS cnt FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?",
    [nombre]
  );
  return r[0].cnt > 0;
}

async function columnaExiste(tabla, columna) {
  const [r] = await db.query(
    "SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
    [tabla, columna]
  );
  return r[0].cnt > 0;
}

async function indiceExiste(tabla, nombre) {
  const [r] = await db.query(`SHOW INDEX FROM \`${tabla}\` WHERE Key_name = ?`, [nombre]);
  return r.length > 0;
}

async function addColIfMissing(tabla, columna, definicion) {
  try {
    if (!(await columnaExiste(tabla, columna))) {
      await db.query(`ALTER TABLE \`${tabla}\` ADD COLUMN \`${columna}\` ${definicion}`);
      console.log(`  + ${tabla}.${columna} añadida`);
    }
  } catch (err) {
    console.warn(`  ⚠️  No se pudo añadir ${tabla}.${columna}: ${err.message}`);
  }
}

// ─── BD init ──────────────────────────────────────────────────────────────────
async function inicializarBD() {
  // 1. Rename carreras → campeonatos
  const tieneCamp = await tablaExiste("campeonatos");
  const tieneCarr = await tablaExiste("carreras");
  if (!tieneCamp && tieneCarr) {
    await db.query("RENAME TABLE carreras TO campeonatos");
    console.log("✅ carreras → campeonatos");
  }

  // 2. Tablas base
  await db.query(`CREATE TABLE IF NOT EXISTS usuarios (
    id        INT AUTO_INCREMENT PRIMARY KEY,
    username  VARCHAR(80)  NOT NULL UNIQUE,
    password  VARCHAR(255) NOT NULL,
    nombre    VARCHAR(150) NOT NULL,
    rol       ENUM('admin','inscripciones','torre') NOT NULL DEFAULT 'inscripciones',
    activo    TINYINT(1)   NOT NULL DEFAULT 1,
    creado_en DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);

  await db.query(`CREATE TABLE IF NOT EXISTS pilotos (
    id                   INT AUTO_INCREMENT PRIMARY KEY,
    apellido_paterno     VARCHAR(60),
    apellido_materno     VARCHAR(60),
    nombres              VARCHAR(100),
    numero_piloto        INT UNIQUE,
    numero_piloto_anterior INT,
    nombre_completo      VARCHAR(150) NOT NULL,
    telefono             VARCHAR(30),
    email                VARCHAR(150) UNIQUE,
    tipo_sangre          VARCHAR(5)   NOT NULL,
    direccion            VARCHAR(255),
    ciudad               VARCHAR(80),
    estado               VARCHAR(80),
    nacionalidad         VARCHAR(80)  NOT NULL DEFAULT 'Mexicana',
    estatus_licencia     ENUM('Vigente','Vencida','Suspendida') NOT NULL DEFAULT 'Vigente',
    numero_licencia      VARCHAR(60)  UNIQUE,
    fecha_nacimiento     DATE,
    contacto_emergencia  VARCHAR(150),
    telefono_emergencia  VARCHAR(30),
    notas                TEXT,
    activo               TINYINT(1)   NOT NULL DEFAULT 1,
    creado_en            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado_en       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )`);

  await db.query(`CREATE TABLE IF NOT EXISTS categorias (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    nombre      VARCHAR(60)  NOT NULL UNIQUE,
    descripcion VARCHAR(150),
    color       VARCHAR(10)  NOT NULL DEFAULT '#e63946',
    activo      TINYINT(1)   NOT NULL DEFAULT 1,
    creado_en   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);

  await db.query(`CREATE TABLE IF NOT EXISTS campeonatos (
    id             INT AUTO_INCREMENT PRIMARY KEY,
    nombre         VARCHAR(150) NOT NULL,
    fecha          DATE         NULL,
    ubicacion      VARCHAR(150) NOT NULL DEFAULT 'Autódromo Monterrey',
    descripcion    TEXT,
    activo         TINYINT(1)   NOT NULL DEFAULT 1,
    creado_en      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado_en DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )`);

  await db.query(`CREATE TABLE IF NOT EXISTS campeonato_categorias (
    campeonato_id INT NOT NULL,
    categoria_id  INT NOT NULL,
    PRIMARY KEY (campeonato_id, categoria_id),
    FOREIGN KEY (campeonato_id) REFERENCES campeonatos(id) ON DELETE CASCADE,
    FOREIGN KEY (categoria_id)  REFERENCES categorias(id)  ON DELETE CASCADE
  )`);

  await db.query(`CREATE TABLE IF NOT EXISTS contratos_anuales (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    piloto_id   INT      NOT NULL,
    anio        YEAR     NOT NULL,
    fecha_firma DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ip_firma    VARCHAR(45),
    activo      TINYINT(1) NOT NULL DEFAULT 1,
    UNIQUE KEY uk_piloto_anio (piloto_id, anio),
    FOREIGN KEY (piloto_id) REFERENCES pilotos(id)
  )`);

  // 3. Tabla etapas (carreras individuales dentro de un campeonato)
  await db.query(`CREATE TABLE IF NOT EXISTS etapas (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    campeonato_id INT          NOT NULL,
    numero        INT          NOT NULL DEFAULT 1,
    nombre        VARCHAR(150) NOT NULL,
    fecha         DATE         NOT NULL,
    ubicacion     VARCHAR(150) NOT NULL DEFAULT 'Autódromo Monterrey',
    descripcion   TEXT,
    costo         DECIMAL(10,2),
    activo        TINYINT(1)   NOT NULL DEFAULT 1,
    creado_en     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_camp_etapa (campeonato_id, numero),
    FOREIGN KEY (campeonato_id) REFERENCES campeonatos(id) ON DELETE CASCADE
  )`);

  // 4. Migrate inscripciones: carrera_id → campeonato_id (legacy)
  const tieneInsc = await tablaExiste("inscripciones");
  if (tieneInsc && (await columnaExiste("inscripciones", "carrera_id"))) {
    const [fks] = await db.query(
      "SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inscripciones' AND CONSTRAINT_TYPE = 'FOREIGN KEY'"
    );
    for (const { CONSTRAINT_NAME } of fks) {
      try { await db.query(`ALTER TABLE inscripciones DROP FOREIGN KEY \`${CONSTRAINT_NAME}\``); } catch {}
    }
    const [idxs] = await db.query("SHOW INDEX FROM inscripciones WHERE Column_name = 'carrera_id' AND Non_unique = 0");
    for (const idx of idxs) {
      if (idx.Key_name !== "PRIMARY") {
        try { await db.query(`ALTER TABLE inscripciones DROP INDEX \`${idx.Key_name}\``); } catch {}
      }
    }
    await db.query("ALTER TABLE inscripciones CHANGE COLUMN carrera_id campeonato_id INT NOT NULL");
    try { await db.query("ALTER TABLE inscripciones ADD FOREIGN KEY (piloto_id)     REFERENCES pilotos(id)"); } catch {}
    try { await db.query("ALTER TABLE inscripciones ADD FOREIGN KEY (campeonato_id) REFERENCES campeonatos(id)"); } catch {}
    try { await db.query("ALTER TABLE inscripciones ADD FOREIGN KEY (categoria_id)  REFERENCES categorias(id)"); } catch {}
    console.log("✅ carrera_id → campeonato_id");
  } else if (!tieneInsc) {
    await db.query(`CREATE TABLE IF NOT EXISTS inscripciones (
      id              INT AUTO_INCREMENT PRIMARY KEY,
      piloto_id       INT          NOT NULL,
      campeonato_id   INT          NOT NULL,
      etapa_id        INT          NULL,
      categoria_id    INT          NOT NULL,
      numero_piloto   INT          NOT NULL,
      vehiculo        VARCHAR(100) NOT NULL,
      modelo_vehiculo VARCHAR(100),
      anio_vehiculo   INT,
      color_vehiculo  VARCHAR(50),
      apodo_vehiculo  VARCHAR(100),
      estatus         ENUM('Pendiente','Pagado','Descalificado') NOT NULL DEFAULT 'Pendiente',
      metodo_pago     ENUM('Efectivo','Transferencia'),
      monto_pago      DECIMAL(10,2),
      pagado_en       DATETIME,
      pagado_por      VARCHAR(80),
      notas           TEXT,
      auto_registro   TINYINT(1)   NOT NULL DEFAULT 0,
      creado_en       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      actualizado_en  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_etapa_cat_piloto (etapa_id, categoria_id, piloto_id),
      FOREIGN KEY (piloto_id)     REFERENCES pilotos(id),
      FOREIGN KEY (campeonato_id) REFERENCES campeonatos(id),
      FOREIGN KEY (etapa_id)      REFERENCES etapas(id),
      FOREIGN KEY (categoria_id)  REFERENCES categorias(id)
    )`);
  }

  // 5. Columnas faltantes
  await addColIfMissing("pilotos", "apellido_paterno",     "VARCHAR(60) NULL AFTER id");
  await addColIfMissing("pilotos", "apellido_materno",     "VARCHAR(60) NULL AFTER apellido_paterno");
  await addColIfMissing("pilotos", "nombres",              "VARCHAR(100) NULL AFTER apellido_materno");
  await addColIfMissing("pilotos", "numero_piloto",        "INT NULL UNIQUE AFTER nombres");
  await addColIfMissing("pilotos", "numero_piloto_anterior","INT NULL AFTER numero_piloto");
  await addColIfMissing("inscripciones", "etapa_id",       "INT NULL AFTER campeonato_id");
  await addColIfMissing("inscripciones", "apodo_vehiculo",   "VARCHAR(100) NULL");
  await addColIfMissing("inscripciones", "modelo_vehiculo",  "VARCHAR(100) NULL");
  await addColIfMissing("inscripciones", "anio_vehiculo",    "INT NULL");
  await addColIfMissing("inscripciones", "color_vehiculo",   "VARCHAR(50) NULL");
  // Campos extra para formularios oficiales
  await addColIfMissing("pilotos", "curp",                 "VARCHAR(20) NULL");
  await addColIfMissing("pilotos", "escolaridad",          "VARCHAR(60) NULL");
  await addColIfMissing("pilotos", "lugar_nacimiento",     "VARCHAR(100) NULL");
  await addColIfMissing("pilotos", "calle",                "VARCHAR(150) NULL");
  await addColIfMissing("pilotos", "colonia",              "VARCHAR(100) NULL");
  await addColIfMissing("pilotos", "cp",                   "VARCHAR(10) NULL");
  await addColIfMissing("pilotos", "num_ext",              "VARCHAR(20) NULL");
  await addColIfMissing("pilotos", "num_int",              "VARCHAR(20) NULL");
  await addColIfMissing("pilotos", "parentesco_emergencia","VARCHAR(50) NULL");
  await addColIfMissing("pilotos", "alergias",             "VARCHAR(200) NULL");
  await addColIfMissing("pilotos", "condiciones_medicas",  "VARCHAR(300) NULL");
  await addColIfMissing("pilotos", "comision_nacional",    "VARCHAR(200) NULL");
  await addColIfMissing("pilotos", "nombre_equipo",        "VARCHAR(100) NULL");
  await addColIfMissing("pilotos", "anio_licencia_anterior","YEAR NULL");
  await addColIfMissing("campeonato_categorias", "costo",            "DECIMAL(10,2) NULL");
  await addColIfMissing("categorias",            "costo_default",    "DECIMAL(10,2) NULL");
  await addColIfMissing("pilotos",               "password",          "VARCHAR(255) NULL");
  await addColIfMissing("pilotos",               "foto_vehiculo",     "VARCHAR(300) NULL");

  // Pre-cargar costo_default para categorías conocidas (solo si aún no tienen valor)
  const COSTOS_CONOCIDOS = [
    ['BRACKET', 2300], ['BRACKET AVANZADO', 2500], ['BRACKET RAPIDO', 2500],
    ['BRACKET SPORT', 2500], ['11 SEGUNDOS', 3000], ['DRAGSTER', 4000],
    ['PRO COMPETITION', 4000], ['PRO BIKE', 2500], ['SUPER QUICK', 3500],
    ['JUNIOR DRAGSTER', 1800], ['PONY 1', 3000], ['PONY 2', 3000],
    ['PONY LIBRE', 3500], ['CMC', 3500], ['CMC LIBRE', 3500],
    ['AMERICAN IRON', 3500], ['KA SERIES (1 PILOTO)', 3500],
    ['KA SERIES (2 PILOTOS)', 4000], ['KA SERIES (2 PILOTO)', 4000],
    ['PRO/AM', 1000], ['INVASION', 1500], ['INVASIÓN', 1500],
  ];
  for (const [nombre, costo] of COSTOS_CONOCIDOS) {
    await db.query(
      "UPDATE categorias SET costo_default = ? WHERE UPPER(nombre) = UPPER(?) AND costo_default IS NULL",
      [costo, nombre]
    ).catch(() => {});
  }

  // Tabla resultados (posiciones por etapa/categoria)
  await db.query(`CREATE TABLE IF NOT EXISTS resultados (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    etapa_id     INT              NOT NULL,
    categoria_id INT              NOT NULL,
    piloto_id    INT              NOT NULL,
    posicion     TINYINT UNSIGNED NOT NULL,
    puntos       DECIMAL(6,2)     NOT NULL DEFAULT 0,
    notas        VARCHAR(200)     NULL,
    creado_en    DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_res (etapa_id, categoria_id, piloto_id),
    FOREIGN KEY (etapa_id)     REFERENCES etapas(id),
    FOREIGN KEY (categoria_id) REFERENCES categorias(id),
    FOREIGN KEY (piloto_id)    REFERENCES pilotos(id)
  )`);

  // Hacer fecha nullable en campeonatos (ahora son temporadas, no eventos individuales)
  try { await db.query("ALTER TABLE campeonatos MODIFY COLUMN fecha DATE NULL"); } catch {}

  // Quitar Tarjeta del ENUM
  try { await db.query("ALTER TABLE inscripciones MODIFY COLUMN metodo_pago ENUM('Efectivo','Transferencia')"); } catch {}

  // 6. Crear Etapa 1 para campeonatos existentes que no tienen etapas
  if (await tablaExiste("etapas")) {
    const [camps] = await db.query("SELECT * FROM campeonatos WHERE activo = 1");
    for (const camp of camps) {
      const [existeEtapa] = await db.query(
        "SELECT id FROM etapas WHERE campeonato_id = ? AND numero = 1 LIMIT 1", [camp.id]
      );
      if (existeEtapa.length === 0) {
        const fecha = camp.fecha
          ? (typeof camp.fecha === "string" ? camp.fecha : camp.fecha.toISOString().split("T")[0])
          : new Date().toISOString().split("T")[0];
        await db.query(
          "INSERT INTO etapas (campeonato_id, numero, nombre, fecha, ubicacion) VALUES (?,?,?,?,?)",
          [camp.id, 1, "Etapa 1", fecha, camp.ubicacion || "Autódromo Monterrey"]
        );
        console.log(`  + Etapa 1 creada para campeonato id=${camp.id}`);
      }
    }
    // Poblar etapa_id en inscripciones existentes que no lo tienen
    await db.query(`
      UPDATE inscripciones i
      JOIN etapas e ON e.campeonato_id = i.campeonato_id AND e.numero = 1
      SET i.etapa_id = e.id
      WHERE i.etapa_id IS NULL AND i.campeonato_id IS NOT NULL
    `);
    // FK para etapa_id
    try { await db.query("ALTER TABLE inscripciones ADD CONSTRAINT fk_insc_etapa FOREIGN KEY (etapa_id) REFERENCES etapas(id)"); } catch {}
  }

  // 7. Actualizar unique key en inscripciones
  if (await tablaExiste("inscripciones")) {
    if (await indiceExiste("inscripciones", "uk_campeonato_numero")) {
      try { await db.query("ALTER TABLE inscripciones DROP INDEX uk_campeonato_numero"); } catch {}
      console.log("✅ uk_campeonato_numero eliminado");
    }
    if (!(await indiceExiste("inscripciones", "uk_etapa_cat_piloto"))) {
      try { await db.query("ALTER TABLE inscripciones ADD UNIQUE KEY uk_etapa_cat_piloto (etapa_id, categoria_id, piloto_id)"); } catch {}
    }
  }

  console.log("✅ Tablas verificadas/creadas");

  // 8. Seed usuarios
  const [adminExiste] = await db.query("SELECT id FROM usuarios WHERE username = 'admin' LIMIT 1");
  if (adminExiste.length === 0) {
    const h1 = await bcrypt.hash("Admin123!", 10);
    const h2 = await bcrypt.hash("Inscri123!", 10);
    const h3 = await bcrypt.hash("Torre123!", 10);
    await db.query("INSERT INTO usuarios (username,password,nombre,rol) VALUES (?,?,?,?)", ["admin",       h1, "Administrador General", "admin"]);
    await db.query("INSERT INTO usuarios (username,password,nombre,rol) VALUES (?,?,?,?)", ["inscripciones",h2, "Staff Inscripciones",   "inscripciones"]);
    await db.query("INSERT INTO usuarios (username,password,nombre,rol) VALUES (?,?,?,?)", ["torre",       h3, "Torre de Control",       "torre"]);
    console.log("✅ Usuarios creados");
  }

  // 9. Seed categorías
  const cats = [
    ["BN","Beginner Nacional","#22c55e"], ["SR","Super Rookie","#3b82f6"],
    ["Rotax Junior","Categoría Junior Rotax","#f59e0b"], ["Rotax Senior","Categoría Senior Rotax","#ef4444"],
    ["X30 Junior","X30 Junior","#8b5cf6"], ["X30 Senior","X30 Senior","#ec4899"],
    ["Shifter","Kart Shifter","#06b6d4"], ["DD2","Dual Drive 2","#f97316"],
    ["Máster","Categoría Máster 35+","#64748b"],
  ];
  for (const [nombre, descripcion, color] of cats) {
    await db.query("INSERT IGNORE INTO categorias (nombre,descripcion,color) VALUES (?,?,?)", [nombre, descripcion, color]);
  }
  console.log("✅ Categorías verificadas");
}

// ═══════════════════════════════════════════════════════════════════════════════
// HEALTH
// ═══════════════════════════════════════════════════════════════════════════════
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
    if (!username || !password) return res.status(400).json({ error: "Usuario y contraseña requeridos" });
    const [rows] = await db.query("SELECT * FROM usuarios WHERE username = ? AND activo = 1 LIMIT 1", [username]);
    if (rows.length === 0) return res.status(401).json({ error: "Credenciales incorrectas" });
    const usuario = rows[0];
    if (!(await bcrypt.compare(password, usuario.password))) return res.status(401).json({ error: "Credenciales incorrectas" });
    const token = jwt.sign(
      { id: usuario.id, username: usuario.username, rol: usuario.rol, nombre: usuario.nombre },
      JWT_SECRET, { expiresIn: "8h" }
    );
    res.json({ token, usuario: { id: usuario.id, username: usuario.username, rol: usuario.rol, nombre: usuario.nombre } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al iniciar sesión" });
  }
});

app.get("/api/auth/yo", autenticar, async (req, res) => {
  try {
    const [rows] = await db.query("SELECT id,username,nombre,rol,activo FROM usuarios WHERE id = ? LIMIT 1", [req.usuario.id]);
    if (rows.length === 0) return res.status(404).json({ error: "Usuario no encontrado" });
    res.json(rows[0]);
  } catch {
    res.status(500).json({ error: "Error al obtener usuario" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// PILOTOS
// ═══════════════════════════════════════════════════════════════════════════════

// Búsqueda pública por email (auto-registro, sin auth)
app.get("/api/pilotos/buscar-por-email", autoRegistroLimit, async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) return res.status(400).json({ error: "Email requerido" });
    const [rows] = await db.query(
      `SELECT id, nombre_completo, apellido_paterno, apellido_materno, nombres,
              tipo_sangre, numero_piloto, numero_piloto_anterior, nacionalidad
       FROM pilotos WHERE email = ? AND activo = 1 LIMIT 1`,
      [email]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Piloto no encontrado" });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al buscar piloto" });
  }
});

app.get("/api/pilotos", autenticar, async (req, res) => {
  try {
    const { buscar, estatus_licencia } = req.query;
    let sql = `
      SELECT p.*,
        (SELECT COUNT(*) FROM inscripciones WHERE piloto_id = p.id) AS total_campeonatos
      FROM pilotos p WHERE p.activo = 1`;
    const params = [];
    if (estatus_licencia) { sql += " AND p.estatus_licencia = ?"; params.push(estatus_licencia); }
    if (buscar) {
      sql += ` AND (p.nombre_completo LIKE ? OR p.apellido_paterno LIKE ? OR p.apellido_materno LIKE ?
               OR p.nombres LIKE ? OR p.email LIKE ? OR p.telefono LIKE ?
               OR p.numero_licencia LIKE ? OR CAST(p.numero_piloto AS CHAR) LIKE ?)`;
      const like = `%${buscar}%`;
      params.push(like, like, like, like, like, like, like, like);
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
      `SELECT i.*, e.nombre AS etapa_nombre, e.numero AS etapa_numero, e.fecha AS etapa_fecha,
              camp.nombre AS campeonato_nombre,
              cat.nombre AS categoria_nombre, cat.color AS categoria_color
       FROM inscripciones i
       LEFT JOIN etapas e       ON e.id       = i.etapa_id
       JOIN campeonatos camp    ON camp.id    = i.campeonato_id
       JOIN categorias cat      ON cat.id     = i.categoria_id
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
      apellido_paterno, apellido_materno, nombres, numero_piloto,
      nombre_completo: ncInput, telefono, email, tipo_sangre,
      direccion, ciudad, estado, nacionalidad, estatus_licencia,
      numero_licencia, fecha_nacimiento, contacto_emergencia, telefono_emergencia, notas,
    } = req.body;
    const nombre_completo = ncInput || [nombres, apellido_paterno, apellido_materno].filter(Boolean).join(" ");
    if (!nombre_completo || !tipo_sangre) return res.status(400).json({ error: "Nombre y tipo de sangre requeridos" });
    const [result] = await db.query(
      `INSERT INTO pilotos
        (apellido_paterno, apellido_materno, nombres, numero_piloto, nombre_completo,
         telefono, email, tipo_sangre, direccion, ciudad, estado, nacionalidad,
         estatus_licencia, numero_licencia, fecha_nacimiento, contacto_emergencia, telefono_emergencia, notas)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        apellido_paterno || null, apellido_materno || null, nombres || null, numero_piloto || null,
        nombre_completo, telefono || null, email || null, tipo_sangre,
        direccion || null, ciudad || null, estado || null, nacionalidad || "Mexicana",
        estatus_licencia || "Vigente", numero_licencia || null, fecha_nacimiento || null,
        contacto_emergencia || null, telefono_emergencia || null, notas || null,
      ]
    );
    const [nuevo] = await db.query("SELECT * FROM pilotos WHERE id = ? LIMIT 1", [result.insertId]);
    res.status(201).json(nuevo[0]);
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") return res.status(409).json({ error: "Email, número de piloto o licencia ya registrado" });
    console.error(err);
    res.status(500).json({ error: "Error al crear piloto" });
  }
});

app.put("/api/pilotos/:id", autenticar, autorizar("admin", "inscripciones"), async (req, res) => {
  try {
    const {
      apellido_paterno, apellido_materno, nombres, numero_piloto,
      nombre_completo: ncInput, telefono, email, tipo_sangre,
      direccion, ciudad, estado, nacionalidad, estatus_licencia,
      numero_licencia, fecha_nacimiento, contacto_emergencia, telefono_emergencia, notas,
    } = req.body;
    const nombre_completo = ncInput || [nombres, apellido_paterno, apellido_materno].filter(Boolean).join(" ");
    if (!nombre_completo || !tipo_sangre) return res.status(400).json({ error: "Nombre y tipo de sangre requeridos" });
    await db.query(
      `UPDATE pilotos SET
        apellido_paterno=?, apellido_materno=?, nombres=?, numero_piloto=?,
        nombre_completo=?, telefono=?, email=?, tipo_sangre=?,
        direccion=?, ciudad=?, estado=?, nacionalidad=?,
        estatus_licencia=?, numero_licencia=?, fecha_nacimiento=?,
        contacto_emergencia=?, telefono_emergencia=?, notas=?
       WHERE id=?`,
      [
        apellido_paterno || null, apellido_materno || null, nombres || null, numero_piloto || null,
        nombre_completo, telefono || null, email || null, tipo_sangre,
        direccion || null, ciudad || null, estado || null, nacionalidad || "Mexicana",
        estatus_licencia || "Vigente", numero_licencia || null, fecha_nacimiento || null,
        contacto_emergencia || null, telefono_emergencia || null, notas || null,
        req.params.id,
      ]
    );
    const [rows] = await db.query("SELECT * FROM pilotos WHERE id = ? LIMIT 1", [req.params.id]);
    res.json(rows[0]);
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") return res.status(409).json({ error: "Datos duplicados" });
    res.status(500).json({ error: "Error al actualizar piloto" });
  }
});

// Asignar número 1 al campeón (todos los roles autenticados pueden hacerlo)
app.patch("/api/pilotos/:id/numero-uno", autenticar, async (req, res) => {
  try {
    const [rows] = await db.query("SELECT id, numero_piloto, numero_piloto_anterior FROM pilotos WHERE id = ? AND activo = 1 LIMIT 1", [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: "Piloto no encontrado" });
    const p = rows[0];

    if (p.numero_piloto === 1) {
      // Restaurar número anterior
      const anterior = p.numero_piloto_anterior;
      await db.query(
        "UPDATE pilotos SET numero_piloto = ?, numero_piloto_anterior = NULL WHERE id = ?",
        [anterior, p.id]
      );
      return res.json({ mensaje: "Número restaurado", numero_piloto: anterior });
    }

    // Si otro piloto ya tiene el #1, restaurarle su número anterior
    await db.query(
      "UPDATE pilotos SET numero_piloto = numero_piloto_anterior, numero_piloto_anterior = NULL WHERE numero_piloto = 1 AND id != ?",
      [p.id]
    );

    // Asignar #1 a este piloto
    await db.query(
      "UPDATE pilotos SET numero_piloto_anterior = numero_piloto, numero_piloto = 1 WHERE id = ?",
      [p.id]
    );

    res.json({ mensaje: "¡Número 1 asignado al campeón!", numero_piloto: 1, numero_anterior: p.numero_piloto });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al cambiar número" });
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
      "INSERT INTO categorias (nombre,descripcion,color) VALUES (?,?,?)",
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
    await db.query("UPDATE categorias SET nombre=?,descripcion=?,color=? WHERE id=?",
      [nombre, descripcion || null, color || "#e63946", req.params.id]);
    const [rows] = await db.query("SELECT * FROM categorias WHERE id = ? LIMIT 1", [req.params.id]);
    res.json(rows[0]);
  } catch {
    res.status(500).json({ error: "Error al actualizar categoría" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// CAMPEONATOS (temporadas)
// ═══════════════════════════════════════════════════════════════════════════════
app.get("/api/campeonatos", async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT c.*,
        (SELECT COUNT(*) FROM etapas e WHERE e.campeonato_id = c.id AND e.activo = 1) AS total_etapas,
        (SELECT COUNT(*) FROM inscripciones i JOIN etapas e ON e.id = i.etapa_id WHERE e.campeonato_id = c.id) AS total_inscritos,
        (SELECT e.numero FROM etapas e WHERE e.campeonato_id = c.id AND e.activo = 1 AND e.fecha <= CURDATE() ORDER BY e.fecha DESC, e.numero DESC LIMIT 1) AS etapa_actual_num
       FROM campeonatos c WHERE c.activo = 1 ORDER BY c.creado_en DESC`
    );
    // Cargar categorías de cada campeonato en paralelo
    const [catRows] = await db.query(
      `SELECT cc.campeonato_id, cc.costo, cat.id, cat.nombre, cat.color
       FROM campeonato_categorias cc
       JOIN categorias cat ON cat.id = cc.categoria_id
       WHERE cat.activo = 1`
    ).catch(() => [[]]);
    const catsPorCamp = {};
    for (const row of catRows) {
      if (!catsPorCamp[row.campeonato_id]) catsPorCamp[row.campeonato_id] = [];
      catsPorCamp[row.campeonato_id].push({ id: row.id, nombre: row.nombre, color: row.color, costo: row.costo });
    }
    const result = rows.map(r => ({ ...r, categorias: catsPorCamp[r.id] || [] }));
    res.json(result);
  } catch (err) {
    console.error("GET /api/campeonatos error:", err.message);
    res.status(500).json({ error: "Error al obtener campeonatos" });
  }
});

app.get("/api/campeonatos/:id", async (req, res) => {
  try {
    const [rows] = await db.query("SELECT * FROM campeonatos WHERE id = ? LIMIT 1", [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: "Campeonato no encontrado" });
    res.json(rows[0]);
  } catch {
    res.status(500).json({ error: "Error al obtener campeonato" });
  }
});

// Categorías de un campeonato
app.get("/api/campeonatos/:id/categorias", async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT cat.*, cc.costo FROM categorias cat
       JOIN campeonato_categorias cc ON cc.categoria_id = cat.id
       WHERE cc.campeonato_id = ? AND cat.activo = 1
       ORDER BY cat.nombre ASC`,
      [req.params.id]
    );
    res.json(rows);
  } catch {
    res.status(500).json({ error: "Error al obtener categorías del campeonato" });
  }
});

// Etapas de un campeonato
app.get("/api/campeonatos/:id/etapas", async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT e.*,
        (SELECT COUNT(*) FROM inscripciones WHERE etapa_id = e.id) AS total_inscritos
       FROM etapas e WHERE e.campeonato_id = ? AND e.activo = 1 ORDER BY e.numero ASC`,
      [req.params.id]
    );
    res.json(rows);
  } catch {
    res.status(500).json({ error: "Error al obtener etapas" });
  }
});

app.post("/api/campeonatos", autenticar, autorizar("admin"), async (req, res) => {
  try {
    const { nombre, descripcion, ubicacion, categorias } = req.body;
    if (!nombre) return res.status(400).json({ error: "Nombre requerido" });
    const [result] = await db.query(
      "INSERT INTO campeonatos (nombre,descripcion,ubicacion) VALUES (?,?,?)",
      [nombre, descripcion || null, ubicacion || "Autódromo Monterrey"]
    );
    const campId = result.insertId;
    if (Array.isArray(categorias) && categorias.length > 0) {
      const vals = categorias.map((c) => [campId, c.id, c.costo ?? null]);
      await db.query("INSERT INTO campeonato_categorias (campeonato_id,categoria_id,costo) VALUES ?", [vals]);
    }
    const [nuevo] = await db.query("SELECT * FROM campeonatos WHERE id = ? LIMIT 1", [campId]);
    res.status(201).json(nuevo[0]);
  } catch {
    res.status(500).json({ error: "Error al crear campeonato" });
  }
});

app.put("/api/campeonatos/:id", autenticar, autorizar("admin"), async (req, res) => {
  try {
    const { nombre, descripcion, ubicacion, categorias } = req.body;
    if (!nombre) return res.status(400).json({ error: "Nombre requerido" });
    await db.query(
      "UPDATE campeonatos SET nombre=?,descripcion=?,ubicacion=? WHERE id=?",
      [nombre, descripcion || null, ubicacion || "Autódromo Monterrey", req.params.id]
    );
    if (Array.isArray(categorias)) {
      await db.query("DELETE FROM campeonato_categorias WHERE campeonato_id = ?", [req.params.id]);
      if (categorias.length > 0) {
        const vals = categorias.map((c) => [req.params.id, c.id, c.costo ?? null]);
        await db.query("INSERT INTO campeonato_categorias (campeonato_id,categoria_id,costo) VALUES ?", [vals]);
      }
    }
    const [rows] = await db.query("SELECT * FROM campeonatos WHERE id = ? LIMIT 1", [req.params.id]);
    res.json(rows[0]);
  } catch {
    res.status(500).json({ error: "Error al actualizar campeonato" });
  }
});

app.delete("/api/campeonatos/:id", autenticar, autorizar("admin"), async (req, res) => {
  try {
    const [insc] = await db.query(
      "SELECT COUNT(*) AS cnt FROM inscripciones i JOIN etapas e ON e.id = i.etapa_id WHERE e.campeonato_id = ?",
      [req.params.id]
    );
    if (insc[0].cnt > 0) return res.status(409).json({ error: "No se puede eliminar: tiene inscripciones registradas" });
    await db.query("UPDATE etapas SET activo = 0 WHERE campeonato_id = ?", [req.params.id]);
    await db.query("UPDATE campeonatos SET activo = 0 WHERE id = ?", [req.params.id]);
    res.json({ mensaje: "Campeonato eliminado" });
  } catch {
    res.status(500).json({ error: "Error al eliminar campeonato" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ETAPAS (carreras individuales dentro de un campeonato)
// ═══════════════════════════════════════════════════════════════════════════════
app.post("/api/campeonatos/:id/etapas", autenticar, autorizar("admin"), async (req, res) => {
  try {
    const campId = req.params.id;
    const { numero, nombre, fecha, ubicacion, descripcion, costo } = req.body;
    if (!fecha) return res.status(400).json({ error: "Fecha requerida" });

    // Auto-numero si no viene
    let etapaNum = numero;
    if (!etapaNum) {
      const [maxRow] = await db.query(
        "SELECT COALESCE(MAX(numero),0)+1 AS sig FROM etapas WHERE campeonato_id = ?", [campId]
      );
      etapaNum = maxRow[0].sig;
    }

    const [camp] = await db.query("SELECT ubicacion FROM campeonatos WHERE id = ? LIMIT 1", [campId]);
    const defaultUbic = camp.length > 0 ? camp[0].ubicacion : "Autódromo Monterrey";

    const [result] = await db.query(
      "INSERT INTO etapas (campeonato_id,numero,nombre,fecha,ubicacion,descripcion,costo) VALUES (?,?,?,?,?,?,?)",
      [campId, etapaNum, nombre || `Etapa ${etapaNum}`, fecha, ubicacion || defaultUbic, descripcion || null, costo || null]
    );
    const [nueva] = await db.query(
      `SELECT e.*, (SELECT COUNT(*) FROM inscripciones WHERE etapa_id = e.id) AS total_inscritos
       FROM etapas e WHERE e.id = ? LIMIT 1`,
      [result.insertId]
    );
    res.status(201).json(nueva[0]);
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") return res.status(409).json({ error: "Ya existe una etapa con ese número en este campeonato" });
    console.error(err);
    res.status(500).json({ error: "Error al crear etapa" });
  }
});

app.put("/api/etapas/:id", autenticar, autorizar("admin"), async (req, res) => {
  try {
    const { numero, nombre, fecha, ubicacion, descripcion, costo } = req.body;
    if (!fecha) return res.status(400).json({ error: "Fecha requerida" });
    await db.query(
      "UPDATE etapas SET numero=?,nombre=?,fecha=?,ubicacion=?,descripcion=?,costo=? WHERE id=?",
      [numero, nombre, fecha, ubicacion || "Autódromo Monterrey", descripcion || null, costo || null, req.params.id]
    );
    const [rows] = await db.query(
      `SELECT e.*, (SELECT COUNT(*) FROM inscripciones WHERE etapa_id = e.id) AS total_inscritos
       FROM etapas e WHERE e.id = ? LIMIT 1`,
      [req.params.id]
    );
    res.json(rows[0]);
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") return res.status(409).json({ error: "Ya existe una etapa con ese número" });
    res.status(500).json({ error: "Error al actualizar etapa" });
  }
});

app.delete("/api/etapas/:id", autenticar, autorizar("admin"), async (req, res) => {
  try {
    const [insc] = await db.query("SELECT COUNT(*) AS cnt FROM inscripciones WHERE etapa_id = ?", [req.params.id]);
    if (insc[0].cnt > 0) return res.status(409).json({ error: "No se puede eliminar: tiene inscripciones activas" });
    await db.query("UPDATE etapas SET activo = 0 WHERE id = ?", [req.params.id]);
    res.json({ mensaje: "Etapa eliminada" });
  } catch {
    res.status(500).json({ error: "Error al eliminar etapa" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// CONTRATOS ANUALES
// ═══════════════════════════════════════════════════════════════════════════════
app.get("/api/contratos/estado", async (req, res) => {
  try {
    const { piloto_id, anio } = req.query;
    if (!piloto_id || !anio) return res.status(400).json({ error: "piloto_id y anio requeridos" });
    const [rows] = await db.query(
      "SELECT * FROM contratos_anuales WHERE piloto_id = ? AND anio = ? AND activo = 1 LIMIT 1",
      [piloto_id, anio]
    );
    res.json({ firmado: rows.length > 0, contrato: rows[0] || null });
  } catch {
    res.status(500).json({ error: "Error al verificar contrato" });
  }
});

app.post("/api/contratos/firmar", autoRegistroLimit, async (req, res) => {
  try {
    const { piloto_id, anio } = req.body;
    if (!piloto_id || !anio) return res.status(400).json({ error: "piloto_id y anio requeridos" });
    const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").toString().split(",")[0].trim();
    await db.query(
      "INSERT INTO contratos_anuales (piloto_id,anio,ip_firma) VALUES (?,?,?) ON DUPLICATE KEY UPDATE fecha_firma=NOW(), ip_firma=?, activo=1",
      [piloto_id, anio, ip, ip]
    );
    res.json({ mensaje: "Contrato firmado correctamente" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al registrar contrato" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// INSCRIPCIONES
// ═══════════════════════════════════════════════════════════════════════════════
app.get("/api/inscripciones", autenticar, async (req, res) => {
  try {
    const { campeonato_id, etapa_id, categoria_id, estatus, piloto_id } = req.query;
    let sql = `
      SELECT i.*,
        p.nombre_completo AS piloto_nombre, p.tipo_sangre, p.telefono AS piloto_telefono,
        p.nacionalidad AS piloto_nacionalidad,
        camp.nombre AS campeonato_nombre,
        e.nombre AS etapa_nombre, e.numero AS etapa_numero, e.fecha AS etapa_fecha,
        cat.nombre AS categoria_nombre, cat.color AS categoria_color
      FROM inscripciones i
      JOIN pilotos   p      ON p.id    = i.piloto_id
      JOIN campeonatos camp  ON camp.id = i.campeonato_id
      LEFT JOIN etapas e    ON e.id    = i.etapa_id
      JOIN categorias cat   ON cat.id  = i.categoria_id
      WHERE 1=1`;
    const params = [];
    if (piloto_id)     { sql += " AND i.piloto_id = ?";     params.push(piloto_id); }
    if (etapa_id)      { sql += " AND i.etapa_id = ?";      params.push(etapa_id); }
    else if (campeonato_id) { sql += " AND i.campeonato_id = ?"; params.push(campeonato_id); }
    if (categoria_id)  { sql += " AND i.categoria_id = ?";  params.push(categoria_id); }
    if (estatus)       { sql += " AND i.estatus = ?";        params.push(estatus); }
    sql += " ORDER BY i.creado_en DESC, cat.nombre ASC, i.numero_piloto ASC";
    const [rows] = await db.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener inscripciones" });
  }
});

app.post("/api/inscripciones", autenticar, autorizar("admin", "inscripciones"), async (req, res) => {
  try {
    const {
      piloto_id, etapa_id, campeonato_id: directCampId, categoria_id, numero_piloto,
      vehiculo, modelo_vehiculo, anio_vehiculo, color_vehiculo, apodo_vehiculo,
    } = req.body;

    if (!piloto_id || !categoria_id || !numero_piloto || !vehiculo) {
      return res.status(400).json({ error: "Campos obligatorios incompletos" });
    }
    if (!etapa_id && !directCampId) {
      return res.status(400).json({ error: "Se requiere etapa_id o campeonato_id" });
    }

    // Resolver campeonato_id desde etapa si aplica
    let campId = directCampId;
    let etId   = etapa_id || null;
    if (etapa_id) {
      const [etRow] = await db.query("SELECT campeonato_id FROM etapas WHERE id = ? AND activo = 1 LIMIT 1", [etapa_id]);
      if (etRow.length === 0) return res.status(404).json({ error: "Etapa no encontrada" });
      campId = etRow[0].campeonato_id;
    }

    // Verificar que no esté ya en la misma categoría de la misma etapa
    if (etId) {
      const [dup] = await db.query(
        "SELECT id FROM inscripciones WHERE piloto_id = ? AND etapa_id = ? AND categoria_id = ? LIMIT 1",
        [piloto_id, etId, categoria_id]
      );
      if (dup.length > 0) return res.status(409).json({ error: "Este piloto ya está inscrito en esta categoría para esta etapa" });
    }

    const [result] = await db.query(
      `INSERT INTO inscripciones
        (piloto_id, campeonato_id, etapa_id, categoria_id, numero_piloto, vehiculo,
         modelo_vehiculo, anio_vehiculo, color_vehiculo, apodo_vehiculo)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [piloto_id, campId, etId, categoria_id, numero_piloto, vehiculo,
       modelo_vehiculo || null, anio_vehiculo || null, color_vehiculo || null, apodo_vehiculo || null]
    );
    const [nueva] = await db.query(
      `SELECT i.*, p.nombre_completo AS piloto_nombre, p.tipo_sangre,
              cat.nombre AS categoria_nombre, cat.color AS categoria_color,
              camp.nombre AS campeonato_nombre,
              e.nombre AS etapa_nombre, e.numero AS etapa_numero
       FROM inscripciones i
       JOIN pilotos   p    ON p.id    = i.piloto_id
       JOIN categorias cat  ON cat.id  = i.categoria_id
       JOIN campeonatos camp ON camp.id = i.campeonato_id
       LEFT JOIN etapas e   ON e.id    = i.etapa_id
       WHERE i.id = ? LIMIT 1`,
      [result.insertId]
    );
    res.status(201).json(nueva[0]);
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") return res.status(409).json({ error: "El piloto ya está inscrito con esa combinación" });
    console.error(err);
    res.status(500).json({ error: "Error al inscribir piloto" });
  }
});

app.patch("/api/inscripciones/:id/pagar", autenticar, autorizar("admin", "inscripciones"), async (req, res) => {
  try {
    const { metodo_pago, monto_pago } = req.body;
    const metodo = ["Efectivo", "Transferencia"].includes(metodo_pago) ? metodo_pago : "Efectivo";
    await db.query(
      "UPDATE inscripciones SET estatus='Pagado', metodo_pago=?, monto_pago=?, pagado_en=NOW(), pagado_por=? WHERE id=?",
      [metodo, monto_pago || null, req.usuario.username, req.params.id]
    );
    const [rows] = await db.query(
      `SELECT i.*, p.nombre_completo AS piloto_nombre, cat.nombre AS categoria_nombre
       FROM inscripciones i
       JOIN pilotos   p   ON p.id   = i.piloto_id
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
    const validos = ["Pendiente", "Pagado", "Descalificado"];
    if (!estatus || !validos.includes(estatus)) return res.status(400).json({ error: "Estatus inválido" });
    await db.query("UPDATE inscripciones SET estatus=?, notas=? WHERE id=?", [estatus, notas || null, req.params.id]);
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

// ─── Auto-registro público ─────────────────────────────────────────────────────
app.post("/api/inscripciones/auto-registro", autoRegistroLimit, async (req, res) => {
  try {
    const {
      etapa_id, campeonato_id: directCampId, categoria_id, numero_piloto,
      vehiculo, modelo_vehiculo, anio_vehiculo, color_vehiculo, apodo_vehiculo,
      // piloto nuevo
      apellido_paterno, apellido_materno, nombres, email,
      telefono, tipo_sangre, contacto_emergencia, telefono_emergencia,
      ciudad, estado, nacionalidad, fecha_nacimiento,
      // contrato
      contrato_aceptado,
    } = req.body;

    if (!categoria_id || !numero_piloto || !vehiculo) {
      return res.status(400).json({ error: "Campos obligatorios incompletos" });
    }
    if (!etapa_id && !directCampId) {
      return res.status(400).json({ error: "Se requiere etapa_id o campeonato_id" });
    }

    // Resolver campeonato desde etapa
    let campId = directCampId;
    let etId   = etapa_id || null;
    if (etapa_id) {
      const [etRow] = await db.query("SELECT campeonato_id FROM etapas WHERE id = ? AND activo = 1 LIMIT 1", [etapa_id]);
      if (etRow.length === 0) return res.status(404).json({ error: "Etapa no encontrada" });
      campId = etRow[0].campeonato_id;
    }

    const ahora   = new Date();
    const esMarzo = ahora.getMonth() >= 2;

    // Buscar piloto existente
    let piloto = null;
    if (email) {
      const [existentes] = await db.query("SELECT * FROM pilotos WHERE email = ? AND activo = 1 LIMIT 1", [email]);
      if (existentes.length > 0) piloto = existentes[0];
    }

    // Verificar número único si es piloto nuevo
    if (!piloto && numero_piloto) {
      const [numUsado] = await db.query("SELECT id FROM pilotos WHERE numero_piloto = ? LIMIT 1", [numero_piloto]);
      if (numUsado.length > 0) {
        return res.status(409).json({ error: `El número ${numero_piloto} ya está asignado a otro piloto` });
      }
    }

    // Crear piloto nuevo si no existe
    if (!piloto) {
      if (!apellido_paterno || !nombres || !tipo_sangre) {
        return res.status(400).json({ error: "Apellido paterno, nombre(s) y tipo de sangre requeridos" });
      }
      const nombre_completo = [nombres, apellido_paterno, apellido_materno].filter(Boolean).join(" ");
      const [result] = await db.query(
        `INSERT INTO pilotos
          (apellido_paterno, apellido_materno, nombres, numero_piloto, nombre_completo,
           telefono, email, tipo_sangre, ciudad, estado, nacionalidad, fecha_nacimiento,
           contacto_emergencia, telefono_emergencia)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          apellido_paterno, apellido_materno || null, nombres, numero_piloto || null,
          nombre_completo, telefono || null, email || null, tipo_sangre,
          ciudad || null, estado || null, nacionalidad || "Mexicana", fecha_nacimiento || null,
          contacto_emergencia || null, telefono_emergencia || null,
        ]
      );
      const [nuevo] = await db.query("SELECT * FROM pilotos WHERE id = ? LIMIT 1", [result.insertId]);
      piloto = nuevo[0];
    }

    const piloto_id = piloto.id;

    // Verificar contrato
    const anioActual = ahora.getFullYear();
    const [contratoExiste] = await db.query(
      "SELECT id FROM contratos_anuales WHERE piloto_id = ? AND anio = ? AND activo = 1 LIMIT 1",
      [piloto_id, anioActual]
    );
    const tieneContrato = contratoExiste.length > 0;

    if (esMarzo && !tieneContrato && !contrato_aceptado) {
      return res.status(403).json({
        error: "Debes firmar el contrato anual para continuar.",
        requiere_contrato: true, piloto_id, anio: anioActual,
      });
    }

    if (contrato_aceptado && !tieneContrato) {
      const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").toString().split(",")[0].trim();
      await db.query(
        "INSERT INTO contratos_anuales (piloto_id,anio,ip_firma) VALUES (?,?,?) ON DUPLICATE KEY UPDATE fecha_firma=NOW(), activo=1",
        [piloto_id, anioActual, ip]
      );
    }

    // Verificar que no esté ya en la misma categoría de la misma etapa
    if (etId) {
      const [dup] = await db.query(
        "SELECT id FROM inscripciones WHERE piloto_id = ? AND etapa_id = ? AND categoria_id = ? LIMIT 1",
        [piloto_id, etId, categoria_id]
      );
      if (dup.length > 0) {
        return res.status(409).json({ error: "Ya estás inscrito en esta categoría para esta etapa" });
      }
    }

    // Inscribir
    const [result] = await db.query(
      `INSERT INTO inscripciones
        (piloto_id, campeonato_id, etapa_id, categoria_id, numero_piloto, vehiculo,
         modelo_vehiculo, anio_vehiculo, color_vehiculo, apodo_vehiculo, auto_registro)
       VALUES (?,?,?,?,?,?,?,?,?,?,1)`,
      [
        piloto_id, campId, etId, categoria_id, numero_piloto, vehiculo,
        modelo_vehiculo || null, anio_vehiculo || null, color_vehiculo || null, apodo_vehiculo || null,
      ]
    );

    const [nueva] = await db.query(
      `SELECT i.*, p.nombre_completo AS piloto_nombre,
              cat.nombre AS categoria_nombre, camp.nombre AS campeonato_nombre,
              e.nombre AS etapa_nombre
       FROM inscripciones i
       JOIN pilotos   p    ON p.id    = i.piloto_id
       JOIN categorias cat  ON cat.id  = i.categoria_id
       JOIN campeonatos camp ON camp.id = i.campeonato_id
       LEFT JOIN etapas e   ON e.id    = i.etapa_id
       WHERE i.id = ? LIMIT 1`,
      [result.insertId]
    );

    const avisoContrato = !tieneContrato && !contrato_aceptado;
    res.status(201).json({
      mensaje: "Pre-inscripción exitosa",
      inscripcion: nueva[0],
      aviso_contrato: avisoContrato ? { piloto_id, anio: anioActual } : null,
    });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "Ya estás inscrito con esa combinación de etapa y categoría" });
    }
    console.error(err);
    res.status(500).json({ error: "Error en auto-registro" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// FORMULARIOS OFICIALES
// ═══════════════════════════════════════════════════════════════════════════════

// Datos completos de un piloto para generar formularios (FEMADAC, Liberación, FJO1)
app.get("/api/formularios/piloto/:pilotoId", autenticar, async (req, res) => {
  try {
    const { pilotoId } = req.params;
    const { etapa_id } = req.query;

    const [pilotos] = await db.query("SELECT * FROM pilotos WHERE id = ? AND activo = 1 LIMIT 1", [pilotoId]);
    if (pilotos.length === 0) return res.status(404).json({ error: "Piloto no encontrado" });
    const p = pilotos[0];

    let inscripcion = null;
    if (etapa_id) {
      const [rows] = await db.query(
        `SELECT i.*,
                cat.nombre AS categoria_nombre,
                camp.nombre AS campeonato_nombre,
                e.nombre AS etapa_nombre, e.numero AS etapa_numero, e.fecha AS etapa_fecha, e.ubicacion AS etapa_ubicacion
         FROM inscripciones i
         JOIN categorias cat    ON cat.id  = i.categoria_id
         JOIN campeonatos camp  ON camp.id = i.campeonato_id
         LEFT JOIN etapas e     ON e.id    = i.etapa_id
         WHERE i.piloto_id = ? AND i.etapa_id = ? LIMIT 1`,
        [pilotoId, etapa_id]
      );
      if (rows.length > 0) inscripcion = rows[0];
    }

    res.json({ piloto: p, inscripcion });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener datos para formulario" });
  }
});

// Lista de pilotos con inscripción en una etapa (para selector de formularios)
app.get("/api/formularios/etapa/:etapaId", autenticar, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT i.id AS inscripcion_id, i.numero_piloto, i.vehiculo, i.modelo_vehiculo, i.anio_vehiculo,
              i.estatus, i.metodo_pago, i.monto_pagado,
              p.id AS piloto_id, p.nombre_completo, p.apellido_paterno, p.apellido_materno, p.nombres,
              p.tipo_sangre, p.telefono, p.email, p.nacionalidad, p.fecha_nacimiento,
              p.ciudad, p.estado, p.contacto_emergencia, p.telefono_emergencia,
              p.curp, p.escolaridad, p.lugar_nacimiento, p.alergias, p.condiciones_medicas,
              p.comision_nacional, p.nombre_equipo, p.calle, p.colonia, p.cp, p.num_ext, p.num_int,
              p.parentesco_emergencia, p.anio_licencia_anterior, p.numero_licencia,
              cat.nombre AS categoria_nombre, cat.color AS categoria_color,
              camp.nombre AS campeonato_nombre,
              e.nombre AS etapa_nombre, e.numero AS etapa_numero, e.fecha AS etapa_fecha, e.ubicacion AS etapa_ubicacion
       FROM inscripciones i
       JOIN pilotos p         ON p.id    = i.piloto_id
       JOIN categorias cat    ON cat.id  = i.categoria_id
       JOIN campeonatos camp  ON camp.id = i.campeonato_id
       LEFT JOIN etapas e     ON e.id    = i.etapa_id
       WHERE i.etapa_id = ?
       ORDER BY p.apellido_paterno ASC, p.nombres ASC`,
      [req.params.etapaId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener pilotos de la etapa" });
  }
});

// Actualizar campos extra del piloto (para formularios)
app.patch("/api/pilotos/:id/datos-formulario", autenticar, async (req, res) => {
  try {
    const { curp, escolaridad, lugar_nacimiento, calle, colonia, cp, num_ext, num_int,
            parentesco_emergencia, alergias, condiciones_medicas, comision_nacional,
            nombre_equipo, anio_licencia_anterior } = req.body;
    await db.query(
      `UPDATE pilotos SET
        curp=?, escolaridad=?, lugar_nacimiento=?, calle=?, colonia=?, cp=?, num_ext=?, num_int=?,
        parentesco_emergencia=?, alergias=?, condiciones_medicas=?, comision_nacional=?,
        nombre_equipo=?, anio_licencia_anterior=?
       WHERE id=?`,
      [curp||null, escolaridad||null, lugar_nacimiento||null, calle||null, colonia||null, cp||null,
       num_ext||null, num_int||null, parentesco_emergencia||null, alergias||null,
       condiciones_medicas||null, comision_nacional||null, nombre_equipo||null,
       anio_licencia_anterior||null, req.params.id]
    );
    const [rows] = await db.query("SELECT * FROM pilotos WHERE id = ? LIMIT 1", [req.params.id]);
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al actualizar datos del piloto" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// REPORTES
// ═══════════════════════════════════════════════════════════════════════════════
app.get("/api/reportes/por-categoria", autenticar, async (req, res) => {
  try {
    const { campeonato_id, etapa_id, categoria_id } = req.query;
    if (!campeonato_id && !etapa_id) return res.status(400).json({ error: "campeonato_id o etapa_id requerido" });

    // Obtener costo de la etapa si aplica
    let costoPorInscripcion = 0;
    if (etapa_id) {
      const [etRow] = await db.query("SELECT costo FROM etapas WHERE id = ? LIMIT 1", [etapa_id]);
      if (etRow.length > 0) costoPorInscripcion = parseFloat(etRow[0].costo) || 0;
    }

    let sql = `
      SELECT i.*,
        p.nombre_completo AS piloto_nombre, p.tipo_sangre, p.telefono AS piloto_telefono,
        p.nacionalidad, p.estatus_licencia,
        cat.nombre AS categoria_nombre, cat.color AS categoria_color, cat.descripcion AS categoria_descripcion,
        e.nombre AS etapa_nombre, e.numero AS etapa_numero
      FROM inscripciones i
      JOIN pilotos   p   ON p.id   = i.piloto_id
      JOIN categorias cat ON cat.id = i.categoria_id
      LEFT JOIN etapas e ON e.id   = i.etapa_id
      WHERE 1=1`;
    const params = [];
    if (etapa_id) { sql += " AND i.etapa_id = ?"; params.push(etapa_id); }
    else if (campeonato_id) { sql += " AND i.campeonato_id = ?"; params.push(campeonato_id); }
    if (categoria_id) { sql += " AND i.categoria_id = ?"; params.push(categoria_id); }
    sql += " ORDER BY cat.nombre ASC, i.numero_piloto ASC";

    const [rows] = await db.query(sql, params);
    const agrupado = {};
    for (const r of rows) {
      const n = r.categoria_nombre;
      if (!agrupado[n]) {
        agrupado[n] = {
          categoria: { nombre: n, color: r.categoria_color, descripcion: r.categoria_descripcion },
          pilotos: [], total: 0, pagados: 0,
          costo: costoPorInscripcion,
          total_esperado: 0, total_cobrado: 0,
        };
      }
      agrupado[n].pilotos.push(r);
      agrupado[n].total++;
      agrupado[n].total_esperado = agrupado[n].total * costoPorInscripcion;
      if (r.estatus === "Pagado") {
        agrupado[n].pagados++;
        agrupado[n].total_cobrado += parseFloat(r.monto_pago) || costoPorInscripcion;
      }
    }
    res.json({ agrupado, total: rows.length, costo_etapa: costoPorInscripcion });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al generar reporte" });
  }
});

app.get("/api/reportes/corte-general", autenticar, autorizar("admin", "inscripciones"), async (req, res) => {
  try {
    const { campeonato_id, etapa_id, todos } = req.query;
    if (!campeonato_id && !etapa_id && !todos) return res.status(400).json({ error: "campeonato_id, etapa_id o todos=true requerido" });

    let etapaInfo = null;
    let campInfo  = null;
    let costoPorInscripcion = 0;

    if (etapa_id) {
      const [et] = await db.query(
        `SELECT e.*, camp.nombre AS campeonato_nombre
         FROM etapas e JOIN campeonatos camp ON camp.id = e.campeonato_id
         WHERE e.id = ? LIMIT 1`,
        [etapa_id]
      );
      if (et.length === 0) return res.status(404).json({ error: "Etapa no encontrada" });
      etapaInfo = et[0];
      costoPorInscripcion = parseFloat(etapaInfo.costo) || 0;
    }

    if (campeonato_id) {
      const [camp] = await db.query("SELECT * FROM campeonatos WHERE id = ? LIMIT 1", [campeonato_id]);
      if (camp.length === 0) return res.status(404).json({ error: "Campeonato no encontrado" });
      campInfo = camp[0];
    }

    let sql = `
      SELECT i.*, p.nombre_completo AS piloto_nombre, p.tipo_sangre, p.telefono AS piloto_telefono,
             cat.nombre AS categoria_nombre, cat.color AS categoria_color,
             e.nombre AS etapa_nombre, e.numero AS etapa_numero,
             camp.nombre AS campeonato_nombre_completo
      FROM inscripciones i
      JOIN pilotos    p    ON p.id    = i.piloto_id
      JOIN categorias cat  ON cat.id  = i.categoria_id
      LEFT JOIN etapas e   ON e.id    = i.etapa_id
      LEFT JOIN campeonatos camp ON camp.id = i.campeonato_id
      WHERE 1=1`;
    const params = [];
    if (etapa_id) { sql += " AND i.etapa_id = ?"; params.push(etapa_id); }
    else if (campeonato_id) { sql += " AND i.campeonato_id = ?"; params.push(campeonato_id); }
    // si todos=true → sin filtro adicional, devuelve toda la BD
    sql += " ORDER BY i.campeonato_id ASC, i.etapa_id ASC, i.numero_piloto ASC";

    const [inscripciones] = await db.query(sql, params);
    const pagados    = inscripciones.filter((r) => r.estatus === "Pagado");
    const pendientes = inscripciones.filter((r) => r.estatus !== "Pagado" && r.estatus !== "Descalificado");
    const efectivo   = pagados.filter((r) => r.metodo_pago === "Efectivo");
    const transferencia = pagados.filter((r) => r.metodo_pago === "Transferencia");
    const ingresos   = pagados.reduce((s, r) => s + (parseFloat(r.monto_pago) || costoPorInscripcion), 0);
    const esperado   = inscripciones.length * costoPorInscripcion;

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
      campeonato:  campInfo || (etapaInfo ? { nombre: etapaInfo.campeonato_nombre } : null),
      etapa:       etapaInfo,
      costo:       costoPorInscripcion,
      resumen: {
        total:          inscripciones.length,
        pagados:        pagados.length,
        pendientes:     pendientes.length,
        efectivo:       efectivo.length,
        transferencia:  transferencia.length,
        ingresos,
        esperado,
      },
      por_categoria,
      inscripciones,
      generado_en:  new Date(),
      generado_por: req.usuario.username,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al generar corte" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// USUARIOS (solo admin)
// ═══════════════════════════════════════════════════════════════════════════════
app.get("/api/usuarios", autenticar, autorizar("admin"), async (req, res) => {
  try {
    const [rows] = await db.query("SELECT id,username,nombre,rol,activo,creado_en FROM usuarios ORDER BY nombre ASC");
    res.json(rows);
  } catch {
    res.status(500).json({ error: "Error al obtener usuarios" });
  }
});

app.post("/api/usuarios", autenticar, autorizar("admin"), async (req, res) => {
  try {
    const { username, password, nombre, rol } = req.body;
    if (!username || !password || !nombre || !rol) return res.status(400).json({ error: "Todos los campos son requeridos" });
    const hash = await bcrypt.hash(password, 10);
    const [result] = await db.query(
      "INSERT INTO usuarios (username,password,nombre,rol) VALUES (?,?,?,?)",
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
    const nuevo = rows[0].activo ? 0 : 1;
    await db.query("UPDATE usuarios SET activo = ? WHERE id = ?", [nuevo, req.params.id]);
    res.json({ activo: nuevo });
  } catch {
    res.status(500).json({ error: "Error al actualizar usuario" });
  }
});

app.patch("/api/usuarios/:id/password", autenticar, autorizar("admin"), async (req, res) => {
  try {
    const { password } = req.body;
    if (!password || password.length < 6) return res.status(400).json({ error: "Mínimo 6 caracteres" });
    const hash = await bcrypt.hash(password, 10);
    await db.query("UPDATE usuarios SET password = ? WHERE id = ?", [hash, req.params.id]);
    res.json({ mensaje: "Contraseña actualizada" });
  } catch {
    res.status(500).json({ error: "Error al cambiar contraseña" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// PERFIL PÚBLICO — pilotos actualizan sus propios datos sin login de admin
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/pilotos/perfil-publico?email=X&numero=Y  → devuelve datos del piloto
app.get("/api/pilotos/perfil-publico", async (req, res) => {
  try {
    const { email, numero } = req.query;
    if (!email || !numero) return res.status(400).json({ error: "Email y número requeridos" });
    const [rows] = await db.query(
      "SELECT * FROM pilotos WHERE email = ? AND numero_piloto = ? AND activo = 1 LIMIT 1",
      [email.trim().toLowerCase(), parseInt(numero)]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Piloto no encontrado" });
    const { password: _, ...piloto } = rows[0];
    res.json(piloto);
  } catch {
    res.status(500).json({ error: "Error al buscar piloto" });
  }
});

// PATCH /api/pilotos/perfil-publico  → valida email+numero y actualiza perfil
app.patch("/api/pilotos/perfil-publico", async (req, res) => {
  try {
    const { email, numero, ...campos } = req.body;
    if (!email || !numero) return res.status(400).json({ error: "Email y número requeridos" });
    const [rows] = await db.query(
      "SELECT id FROM pilotos WHERE email = ? AND numero_piloto = ? AND activo = 1 LIMIT 1",
      [email.trim().toLowerCase(), parseInt(numero)]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Piloto no encontrado" });
    const id = rows[0].id;
    const permitidos = ['telefono','tipo_sangre','contacto_emergencia','telefono_emergencia',
      'curp','escolaridad','lugar_nacimiento','calle','colonia','cp','num_ext','num_int',
      'parentesco_emergencia','alergias','condiciones_medicas','comision_nacional','nombre_equipo',
      'anio_licencia_anterior','ciudad','estado','nacionalidad'];
    const sets = []; const vals = [];
    for (const [k, v] of Object.entries(campos)) {
      if (permitidos.includes(k) && v !== undefined) { sets.push(`${k} = ?`); vals.push(v || null); }
    }
    if (sets.length === 0) return res.status(400).json({ error: "Sin campos para actualizar" });
    vals.push(id);
    await db.query(`UPDATE pilotos SET ${sets.join(', ')} WHERE id = ?`, vals);
    const [updated] = await db.query("SELECT * FROM pilotos WHERE id = ? LIMIT 1", [id]);
    const { password: _, ...piloto } = updated[0];
    res.json(piloto);
  } catch {
    res.status(500).json({ error: "Error al actualizar perfil" });
  }
});

// ─── 404 ───────────────────────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: "Ruta no encontrada" }));

// ═══════════════════════════════════════════════════════════════════════════════
// PORTAL PILOTO — login propio y vista de su historial
// ═══════════════════════════════════════════════════════════════════════════════

// Sistema de puntos F1 para posiciones 1-10
const PUNTOS_POS = [0, 25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
function puntosParaPosicion(pos) { return PUNTOS_POS[pos] ?? 0; }

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

// POST /api/piloto/crear-acceso  — primera vez: verifica email+numero, crea password
app.post("/api/piloto/crear-acceso", loginLimit, async (req, res) => {
  try {
    const { email, numero, password } = req.body;
    if (!email || !numero || !password) return res.status(400).json({ error: "Todos los campos son requeridos" });
    if (password.length < 6) return res.status(400).json({ error: "La contraseña debe tener al menos 6 caracteres" });
    const [rows] = await db.query(
      "SELECT id, password FROM pilotos WHERE email = ? AND numero_piloto = ? AND activo = 1 LIMIT 1",
      [email.trim().toLowerCase(), parseInt(numero)]
    );
    if (rows.length === 0) return res.status(404).json({ error: "No encontramos un piloto con ese email y número" });
    const hash = await bcrypt.hash(password, 10);
    await db.query("UPDATE pilotos SET password = ? WHERE id = ?", [hash, rows[0].id]);
    res.json({ mensaje: "Acceso creado correctamente. Ya puedes iniciar sesión." });
  } catch { res.status(500).json({ error: "Error al crear acceso" }); }
});

// POST /api/piloto/login
app.post("/api/piloto/login", loginLimit, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Email y contraseña requeridos" });
    const [rows] = await db.query(
      "SELECT * FROM pilotos WHERE email = ? AND activo = 1 LIMIT 1",
      [email.trim().toLowerCase()]
    );
    if (rows.length === 0) return res.status(401).json({ error: "Email o contraseña incorrectos" });
    const piloto = rows[0];
    if (!piloto.password) return res.status(401).json({ error: "Aún no tienes acceso creado. Usa la opción 'Crear mi acceso'." });
    const ok = await bcrypt.compare(password, piloto.password);
    if (!ok) return res.status(401).json({ error: "Email o contraseña incorrectos" });
    const token = jwt.sign({ id: piloto.id, numero: piloto.numero_piloto, tipo: "piloto" }, JWT_SECRET, { expiresIn: "7d" });
    const { password: _, ...datos } = piloto;
    res.json({ token, piloto: datos });
  } catch { res.status(500).json({ error: "Error al iniciar sesión" }); }
});

// GET /api/piloto/mi-perfil
app.get("/api/piloto/mi-perfil", autenticarPiloto, async (req, res) => {
  try {
    const [rows] = await db.query("SELECT * FROM pilotos WHERE id = ? AND activo = 1 LIMIT 1", [req.piloto.id]);
    if (rows.length === 0) return res.status(404).json({ error: "Piloto no encontrado" });
    const { password: _, ...datos } = rows[0];
    res.json(datos);
  } catch { res.status(500).json({ error: "Error al obtener perfil" }); }
});

// PATCH /api/piloto/mi-perfil
app.patch("/api/piloto/mi-perfil", autenticarPiloto, async (req, res) => {
  try {
    const permitidos = ['telefono','tipo_sangre','contacto_emergencia','telefono_emergencia',
      'curp','escolaridad','lugar_nacimiento','calle','colonia','cp','num_ext','num_int',
      'parentesco_emergencia','alergias','condiciones_medicas','comision_nacional','nombre_equipo',
      'anio_licencia_anterior','ciudad','estado','nacionalidad','fecha_nacimiento'];
    const sets = [], vals = [];
    for (const [k, v] of Object.entries(req.body)) {
      if (permitidos.includes(k) && v !== undefined) { sets.push(`\`${k}\` = ?`); vals.push(v || null); }
    }
    // Cambio de contraseña opcional
    if (req.body.nueva_password && req.body.nueva_password.length >= 6) {
      sets.push("password = ?");
      vals.push(await bcrypt.hash(req.body.nueva_password, 10));
    }
    if (sets.length === 0) return res.status(400).json({ error: "Sin campos para actualizar" });
    vals.push(req.piloto.id);
    await db.query(`UPDATE pilotos SET ${sets.join(", ")} WHERE id = ?`, vals);
    const [updated] = await db.query("SELECT * FROM pilotos WHERE id = ? LIMIT 1", [req.piloto.id]);
    const { password: _, ...datos } = updated[0];
    res.json(datos);
  } catch { res.status(500).json({ error: "Error al actualizar perfil" }); }
});

// GET /api/piloto/mis-carreras  — historial de inscripciones
app.get("/api/piloto/mis-carreras", autenticarPiloto, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT i.*,
              cat.nombre   AS categoria_nombre, cat.color AS categoria_color,
              e.numero     AS etapa_numero, e.fecha AS etapa_fecha, e.nombre AS etapa_nombre, e.ubicacion AS etapa_ubicacion,
              c.nombre     AS campeonato_nombre,
              r.posicion   AS resultado_posicion, r.puntos AS resultado_puntos
       FROM inscripciones i
       JOIN categorias cat ON cat.id = i.categoria_id
       JOIN etapas e       ON e.id   = i.etapa_id
       JOIN campeonatos c  ON c.id   = i.campeonato_id
       LEFT JOIN resultados r ON r.etapa_id = i.etapa_id AND r.categoria_id = i.categoria_id AND r.piloto_id = i.piloto_id
       WHERE i.piloto_id = ?
       ORDER BY e.fecha DESC, c.nombre ASC`,
      [req.piloto.id]
    );
    res.json(rows);
  } catch { res.status(500).json({ error: "Error al obtener carreras" }); }
});

// GET /api/piloto/mis-stats  — estadísticas globales del piloto
app.get("/api/piloto/mis-stats", autenticarPiloto, async (req, res) => {
  try {
    const [carreras]    = await db.query("SELECT COUNT(*) AS total FROM inscripciones WHERE piloto_id = ?", [req.piloto.id]);
    const [pagadas]     = await db.query("SELECT COUNT(*) AS total FROM inscripciones WHERE piloto_id = ? AND estatus = 'Pagado'", [req.piloto.id]);
    const [resultados]  = await db.query("SELECT posicion, puntos FROM resultados WHERE piloto_id = ?", [req.piloto.id]);
    const totalPuntos   = resultados.reduce((s, r) => s + parseFloat(r.puntos || 0), 0);
    const victorias     = resultados.filter(r => r.posicion === 1).length;
    const podios        = resultados.filter(r => r.posicion <= 3).length;
    const mejorPos      = resultados.length ? Math.min(...resultados.map(r => r.posicion)) : null;
    const [campeonatos] = await db.query(
      "SELECT COUNT(DISTINCT campeonato_id) AS total FROM inscripciones WHERE piloto_id = ?", [req.piloto.id]
    );
    res.json({
      carreras:     carreras[0].total,
      pagadas:      pagadas[0].total,
      campeonatos:  campeonatos[0].total,
      totalPuntos,
      victorias,
      podios,
      mejorPosicion: mejorPos,
    });
  } catch { res.status(500).json({ error: "Error al obtener estadísticas" }); }
});

// GET /api/piloto/clasificacion/:campeonato_id/:categoria_id  — tabla de posiciones general
app.get("/api/piloto/clasificacion/:campeonato_id/:categoria_id", autenticarPiloto, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT p.id, p.nombre_completo, p.numero_piloto,
              SUM(r.puntos) AS puntos_totales,
              COUNT(r.id) AS carreras_corridas,
              SUM(CASE WHEN r.posicion = 1 THEN 1 ELSE 0 END) AS victorias,
              MIN(r.posicion) AS mejor_posicion
       FROM resultados r
       JOIN etapas e ON e.id = r.etapa_id
       JOIN pilotos p ON p.id = r.piloto_id
       WHERE e.campeonato_id = ? AND r.categoria_id = ?
       GROUP BY p.id
       ORDER BY puntos_totales DESC, victorias DESC`,
      [req.params.campeonato_id, req.params.categoria_id]
    );
    res.json(rows);
  } catch { res.status(500).json({ error: "Error al obtener clasificación" }); }
});

// POST /api/resultados  — admin captura posiciones de una etapa
app.post("/api/resultados", autenticar, autorizar("admin", "inscripciones"), async (req, res) => {
  try {
    const { etapa_id, categoria_id, resultados } = req.body;
    if (!etapa_id || !categoria_id || !Array.isArray(resultados)) return res.status(400).json({ error: "Datos incompletos" });
    // Borra y re-inserta (upsert simple)
    await db.query("DELETE FROM resultados WHERE etapa_id = ? AND categoria_id = ?", [etapa_id, categoria_id]);
    if (resultados.length > 0) {
      const vals = resultados.map(r => [etapa_id, categoria_id, r.piloto_id, r.posicion, puntosParaPosicion(r.posicion)]);
      await db.query("INSERT INTO resultados (etapa_id,categoria_id,piloto_id,posicion,puntos) VALUES ?", [vals]);
    }
    res.json({ mensaje: `${resultados.length} resultado(s) guardados` });
  } catch { res.status(500).json({ error: "Error al guardar resultados" }); }
});

// GET /api/resultados?etapa_id=X&categoria_id=Y  — para el modal de admin
app.get("/api/resultados", autenticar, async (req, res) => {
  try {
    const { etapa_id, categoria_id } = req.query;
    if (!etapa_id || !categoria_id) return res.status(400).json({ error: "etapa_id y categoria_id requeridos" });
    const [rows] = await db.query(
      `SELECT r.*, p.nombre_completo, p.numero_piloto
       FROM resultados r JOIN pilotos p ON p.id = r.piloto_id
       WHERE r.etapa_id = ? AND r.categoria_id = ?
       ORDER BY r.posicion ASC`,
      [etapa_id, categoria_id]
    );
    res.json(rows);
  } catch { res.status(500).json({ error: "Error al obtener resultados" }); }
});

// ─── Arrancar ──────────────────────────────────────────────────────────────────
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

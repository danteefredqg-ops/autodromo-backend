const bcrypt = require("bcryptjs");
const db     = require("../configuracion/db");

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

  // 3. Tabla etapas
  await db.query(`CREATE TABLE IF NOT EXISTS etapas (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    campeonato_id INT          NOT NULL,
    numero        INT          NOT NULL DEFAULT 1,
    nombre        VARCHAR(150) NOT NULL,
    fecha         DATE         NOT NULL,
    ubicacion     VARCHAR(150) NOT NULL DEFAULT 'Autódromo Monterrey',
    descripcion   TEXT,
    costo         DECIMAL(10,2),
    fecha_apertura_inscripcion DATE NULL,
    fecha_cierre_inscripcion   DATE NULL,
    activo        TINYINT(1)   NOT NULL DEFAULT 1,
    creado_en     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_camp_etapa (campeonato_id, numero),
    FOREIGN KEY (campeonato_id) REFERENCES campeonatos(id) ON DELETE CASCADE
  )`);
  await addColIfMissing("etapas", "fecha_apertura_inscripcion", "DATE NULL");
  await addColIfMissing("etapas", "fecha_cierre_inscripcion",   "DATE NULL");

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
      metodo_pago     ENUM('Efectivo','Transferencia','Intercambio'),
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
  await addColIfMissing("pilotos", "apellido_paterno",      "VARCHAR(60) NULL AFTER id");
  await addColIfMissing("pilotos", "apellido_materno",      "VARCHAR(60) NULL AFTER apellido_paterno");
  await addColIfMissing("pilotos", "nombres",               "VARCHAR(100) NULL AFTER apellido_materno");
  await addColIfMissing("pilotos", "numero_piloto",         "INT NULL UNIQUE AFTER nombres");
  await addColIfMissing("pilotos", "numero_piloto_anterior","INT NULL AFTER numero_piloto");
  await addColIfMissing("inscripciones", "etapa_id",        "INT NULL AFTER campeonato_id");
  await addColIfMissing("inscripciones", "apodo_vehiculo",  "VARCHAR(100) NULL");
  await addColIfMissing("inscripciones", "modelo_vehiculo", "VARCHAR(100) NULL");
  await addColIfMissing("inscripciones", "anio_vehiculo",   "INT NULL");
  await addColIfMissing("inscripciones", "color_vehiculo",  "VARCHAR(50) NULL");
  await addColIfMissing("pilotos", "curp",                  "VARCHAR(20) NULL");
  await addColIfMissing("pilotos", "escolaridad",           "VARCHAR(60) NULL");
  await addColIfMissing("pilotos", "lugar_nacimiento",      "VARCHAR(100) NULL");
  await addColIfMissing("pilotos", "calle",                 "VARCHAR(150) NULL");
  await addColIfMissing("pilotos", "colonia",               "VARCHAR(100) NULL");
  await addColIfMissing("pilotos", "cp",                    "VARCHAR(10) NULL");
  await addColIfMissing("pilotos", "num_ext",               "VARCHAR(20) NULL");
  await addColIfMissing("pilotos", "num_int",               "VARCHAR(20) NULL");
  await addColIfMissing("pilotos", "parentesco_emergencia", "VARCHAR(50) NULL");
  await addColIfMissing("pilotos", "alergias",              "VARCHAR(200) NULL");
  await addColIfMissing("pilotos", "condiciones_medicas",   "VARCHAR(300) NULL");
  await addColIfMissing("pilotos", "comision_nacional",     "VARCHAR(200) NULL");
  await addColIfMissing("pilotos", "nombre_equipo",         "VARCHAR(100) NULL");
  await addColIfMissing("pilotos", "anio_licencia_anterior","YEAR NULL");
  await addColIfMissing("pilotos", "anio_inicio_autodromo", "YEAR NULL");
  await addColIfMissing("pilotos", "foto_perfil",           "VARCHAR(300) NULL");
  await addColIfMissing("campeonato_categorias", "costo",   "DECIMAL(10,2) NULL");
  await addColIfMissing("categorias", "costo_default",      "DECIMAL(10,2) NULL");
  await addColIfMissing("pilotos", "password",              "VARCHAR(255) NULL");
  await addColIfMissing("pilotos", "foto_vehiculo",         "VARCHAR(300) NULL");

  // Tabla preparadores (mecánicos/crew que registra cada piloto para su seguro)
  await db.query(`CREATE TABLE IF NOT EXISTS preparadores (
    id                     INT AUTO_INCREMENT PRIMARY KEY,
    piloto_id              INT          NOT NULL,
    apellido_paterno       VARCHAR(60)  NOT NULL,
    apellido_materno       VARCHAR(60),
    nombres                VARCHAR(100) NOT NULL,
    nombre_completo        VARCHAR(200) NOT NULL,
    telefono               VARCHAR(20),
    email                  VARCHAR(120),
    tipo_sangre            VARCHAR(5),
    curp                   VARCHAR(20),
    fecha_nacimiento       DATE,
    nacionalidad           VARCHAR(50)  DEFAULT 'Mexicana',
    ciudad                 VARCHAR(100),
    estado                 VARCHAR(100),
    contacto_emergencia    VARCHAR(150),
    telefono_emergencia    VARCHAR(20),
    foto_perfil            VARCHAR(300),
    activo                 TINYINT(1)   NOT NULL DEFAULT 1,
    creado_en              DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (piloto_id) REFERENCES pilotos(id)
  )`);

  // Tabla resultados
  await db.query(`CREATE TABLE IF NOT EXISTS resultados (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    etapa_id     INT              NOT NULL,
    categoria_id INT              NOT NULL,
    piloto_id    INT              NOT NULL,
    posicion     TINYINT UNSIGNED NULL,
    estatus      ENUM('Finalizado','DNF','DSQ') NOT NULL DEFAULT 'Finalizado',
    tiempo_vuelta VARCHAR(20)     NULL,
    puntos       DECIMAL(6,2)     NOT NULL DEFAULT 0,
    notas        VARCHAR(200)     NULL,
    creado_en    DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_res (etapa_id, categoria_id, piloto_id),
    FOREIGN KEY (etapa_id)     REFERENCES etapas(id),
    FOREIGN KEY (categoria_id) REFERENCES categorias(id),
    FOREIGN KEY (piloto_id)    REFERENCES pilotos(id)
  )`);
  await addColIfMissing("resultados", "estatus",       "ENUM('Finalizado','DNF','DSQ') NOT NULL DEFAULT 'Finalizado' AFTER posicion");
  await addColIfMissing("resultados", "tiempo_vuelta", "VARCHAR(20) NULL AFTER estatus");
  try { await db.query("ALTER TABLE resultados MODIFY COLUMN posicion TINYINT UNSIGNED NULL"); } catch {}

  try { await db.query("ALTER TABLE campeonatos MODIFY COLUMN fecha DATE NULL"); } catch {}
  try { await db.query("ALTER TABLE inscripciones MODIFY COLUMN metodo_pago ENUM('Efectivo','Transferencia','Intercambio')"); } catch {}
  try { await db.query("ALTER TABLE pilotos MODIFY COLUMN tipo_sangre VARCHAR(5) NULL"); } catch {}

  // 6. Etapa 1 para campeonatos sin etapas
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
    await db.query(`
      UPDATE inscripciones i
      JOIN etapas e ON e.campeonato_id = i.campeonato_id AND e.numero = 1
      SET i.etapa_id = e.id
      WHERE i.etapa_id IS NULL AND i.campeonato_id IS NOT NULL
    `);
    try { await db.query("ALTER TABLE inscripciones ADD CONSTRAINT fk_insc_etapa FOREIGN KEY (etapa_id) REFERENCES etapas(id)"); } catch {}
  }

  // 7. Unique key en inscripciones
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
    await db.query("INSERT INTO usuarios (username,password,nombre,rol) VALUES (?,?,?,?)", ["admin",        h1, "Administrador General", "admin"]);
    await db.query("INSERT INTO usuarios (username,password,nombre,rol) VALUES (?,?,?,?)", ["inscripciones", h2, "Staff Inscripciones",   "inscripciones"]);
    await db.query("INSERT INTO usuarios (username,password,nombre,rol) VALUES (?,?,?,?)", ["torre",        h3, "Torre de Control",       "torre"]);
    console.log("✅ Usuarios creados");
  }

  // 9. Seed categorías
  const cats = [
    ["BN",                    "Beginner Nacional",      "#22c55e", null],
    ["SR",                    "Super Rookie",           "#3b82f6", null],
    ["Rotax Junior",          "Categoría Junior Rotax", "#f59e0b", null],
    ["Rotax Senior",          "Categoría Senior Rotax", "#ef4444", null],
    ["X30 Junior",            "X30 Junior",             "#8b5cf6", null],
    ["X30 Senior",            "X30 Senior",             "#ec4899", null],
    ["Shifter",               "Kart Shifter",           "#06b6d4", null],
    ["DD2",                   "Dual Drive 2",           "#f97316", null],
    ["Máster",                "Categoría Máster 35+",   "#64748b", null],
    ["BRACKET",               "Bracket",                "#f59e0b", 2300],
    ["BRACKET AVANZADO",      "Bracket Avanzado",       "#f97316", 2500],
    ["BRACKET RAPIDO",        "Bracket Rápido",         "#ef4444", 2500],
    ["BRACKET SPORT",         "Bracket Sport",          "#e63946", 2500],
    ["11 SEGUNDOS",           "11 Segundos",            "#22c55e", 3000],
    ["DRAGSTER",              "Dragster",               "#8b5cf6", 4000],
    ["PRO COMPETITION",       "Pro Competition",        "#ec4899", 4000],
    ["PRO BIKE",              "Pro Bike",               "#06b6d4", 2500],
    ["SUPER QUICK",           "Super Quick",            "#3b82f6", 3500],
    ["JUNIOR DRAGSTER",       "Junior Dragster",        "#64748b", 1800],
    ["PONY 1",                "Pony 1",                 "#22c55e", 3000],
    ["PONY 2",                "Pony 2",                 "#3b82f6", 3000],
    ["PONY LIBRE",            "Pony Libre",             "#f59e0b", 3500],
    ["CMC",                   "CMC",                    "#ef4444", 3500],
    ["CMC LIBRE",             "CMC Libre",              "#e63946", 3500],
    ["AMERICAN IRON",         "American Iron",          "#8b5cf6", 3500],
    ["KA SERIES (1 PILOTO)",  "Ka Series 1 Piloto",    "#ec4899", 3500],
    ["KA SERIES (2 PILOTOS)", "Ka Series 2 Pilotos",   "#06b6d4", 4000],
    ["PRO/AM",                "Pro/Am",                 "#fbbf24", 1000],
    ["INVASIÓN",              "Invasión",               "#64748b", 1500],
  ];
  for (const [nombre, descripcion, color, costo_default] of cats) {
    await db.query(
      "INSERT IGNORE INTO categorias (nombre,descripcion,color,costo_default) VALUES (?,?,?,?)",
      [nombre, descripcion, color, costo_default]
    );
  }
  for (const [nombre, costo] of COSTOS_CONOCIDOS) {
    await db.query(
      "UPDATE categorias SET costo_default = ? WHERE UPPER(nombre) = UPPER(?) AND costo_default IS NULL",
      [costo, nombre]
    ).catch(() => {});
  }
  console.log("✅ Categorías verificadas");
}

module.exports = { inicializarBD, COSTOS_CONOCIDOS, tablaExiste, columnaExiste, indiceExiste, addColIfMissing };

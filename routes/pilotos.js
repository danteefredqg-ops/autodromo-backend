const router = require("express").Router();
const bcrypt = require("bcryptjs");
const path   = require("path");
const multer = require("multer");
const db     = require("../configuracion/db");
const { autenticar, autorizar, autoRegistroLimit } = require("../middleware/auth");
const { PILOTOS_DIR } = require("../configuracion/uploads");

const uploadFoto = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, PILOTOS_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
      cb(null, `${req.params.id}${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!/^image\/(jpeg|png|webp)$/.test(file.mimetype)) return cb(new Error("Solo se permiten imágenes JPG, PNG o WEBP"));
    cb(null, true);
  },
});

// GET /api/pilotos/buscar-por-email  — público, sin auth
router.get("/buscar-por-email", autoRegistroLimit, async (req, res) => {
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

// GET /api/pilotos
router.get("/", autenticar, async (req, res) => {
  try {
    const { buscar, estatus_licencia } = req.query;
    let sql = `
      SELECT p.*,
        (SELECT COUNT(*) FROM inscripciones WHERE piloto_id = p.id) AS total_campeonatos,
        (SELECT cat.nombre FROM inscripciones i2 JOIN categorias cat ON cat.id = i2.categoria_id
         WHERE i2.piloto_id = p.id ORDER BY i2.creado_en DESC LIMIT 1) AS ultima_categoria
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

// GET /api/pilotos/:id — admin/inscripciones (incluye datos sensibles y preparadores)
router.get("/:id", autenticar, autorizar("admin", "inscripciones"), async (req, res) => {
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
    const [preparadores] = await db.query(
      "SELECT * FROM preparadores WHERE piloto_id = ? AND activo = 1 ORDER BY nombre_completo ASC",
      [req.params.id]
    );
    res.json({ ...pilotos[0], inscripciones, preparadores });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener piloto" });
  }
});

// POST /api/pilotos
router.post("/", autenticar, autorizar("admin", "inscripciones"), async (req, res) => {
  try {
    const {
      apellido_paterno, apellido_materno, nombres, numero_piloto,
      nombre_completo: ncInput, telefono, email, tipo_sangre,
      direccion, ciudad, estado, nacionalidad, estatus_licencia,
      numero_licencia, fecha_nacimiento, contacto_emergencia, telefono_emergencia, notas,
    } = req.body;
    const nombre_completo = ncInput || [nombres, apellido_paterno, apellido_materno].filter(Boolean).join(" ");
    if (!nombre_completo) return res.status(400).json({ error: "Nombre requerido" });
    const [result] = await db.query(
      `INSERT INTO pilotos
        (apellido_paterno, apellido_materno, nombres, numero_piloto, nombre_completo,
         telefono, email, tipo_sangre, direccion, ciudad, estado, nacionalidad,
         estatus_licencia, numero_licencia, fecha_nacimiento, contacto_emergencia, telefono_emergencia, notas)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        apellido_paterno || null, apellido_materno || null, nombres || null, numero_piloto || null,
        nombre_completo, telefono || null, email || null, tipo_sangre || null,
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

// PUT /api/pilotos/:id
router.put("/:id", autenticar, autorizar("admin", "inscripciones"), async (req, res) => {
  try {
    const {
      apellido_paterno, apellido_materno, nombres, numero_piloto,
      nombre_completo: ncInput, telefono, email, tipo_sangre,
      direccion, ciudad, estado, nacionalidad, estatus_licencia,
      numero_licencia, fecha_nacimiento, contacto_emergencia, telefono_emergencia, notas,
    } = req.body;
    const nombre_completo = ncInput || [nombres, apellido_paterno, apellido_materno].filter(Boolean).join(" ");
    if (!nombre_completo) return res.status(400).json({ error: "Nombre requerido" });
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
        nombre_completo, telefono || null, email || null, tipo_sangre || null,
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

// PATCH /api/pilotos/:id/numero-uno
router.patch("/:id/numero-uno", autenticar, autorizar("admin", "inscripciones"), async (req, res) => {
  try {
    const [rows] = await db.query("SELECT id, numero_piloto, numero_piloto_anterior FROM pilotos WHERE id = ? AND activo = 1 LIMIT 1", [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: "Piloto no encontrado" });
    const p = rows[0];
    if (p.numero_piloto === 1) {
      const anterior = p.numero_piloto_anterior;
      await db.query("UPDATE pilotos SET numero_piloto = ?, numero_piloto_anterior = NULL WHERE id = ?", [anterior, p.id]);
      return res.json({ mensaje: "Número restaurado", numero_piloto: anterior });
    }
    await db.query(
      "UPDATE pilotos SET numero_piloto = numero_piloto_anterior, numero_piloto_anterior = NULL WHERE numero_piloto = 1 AND id != ?",
      [p.id]
    );
    await db.query("UPDATE pilotos SET numero_piloto_anterior = numero_piloto, numero_piloto = 1 WHERE id = ?", [p.id]);
    res.json({ mensaje: "¡Número 1 asignado al campeón!", numero_piloto: 1, numero_anterior: p.numero_piloto });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al cambiar número" });
  }
});

// DELETE /api/pilotos/:id
router.delete("/:id", autenticar, autorizar("admin"), async (req, res) => {
  try {
    await db.query("UPDATE pilotos SET activo = 0 WHERE id = ?", [req.params.id]);
    res.json({ mensaje: "Piloto desactivado" });
  } catch {
    res.status(500).json({ error: "Error al desactivar piloto" });
  }
});

// PATCH /api/pilotos/:id/reset-password  — admin
router.patch("/:id/reset-password", autenticar, autorizar("admin"), async (req, res) => {
  try {
    const { password } = req.body;
    if (!password || password.length < 6) return res.status(400).json({ error: "Mínimo 6 caracteres" });
    const [rows] = await db.query("SELECT id, nombre_completo FROM pilotos WHERE id = ? AND activo = 1 LIMIT 1", [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: "Piloto no encontrado" });
    const hash = await bcrypt.hash(password, 10);
    await db.query("UPDATE pilotos SET password = ? WHERE id = ?", [hash, req.params.id]);
    res.json({ mensaje: `Contraseña del portal restablecida para ${rows[0].nombre_completo}` });
  } catch {
    res.status(500).json({ error: "Error al restablecer contraseña" });
  }
});

// PATCH /api/pilotos/:id/foto  — admin/inscripciones, para cuando el piloto no puede subirla él mismo
router.patch("/:id/foto", autenticar, autorizar("admin", "inscripciones"), (req, res) => {
  uploadFoto.single("foto")(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message || "Error al subir la foto" });
    if (!req.file) return res.status(400).json({ error: "No se recibió ninguna imagen" });
    try {
      const url = `/uploads/pilotos/${req.file.filename}?v=${Date.now()}`;
      await db.query("UPDATE pilotos SET foto_perfil = ? WHERE id = ?", [url, req.params.id]);
      res.json({ foto_perfil: url });
    } catch {
      res.status(500).json({ error: "Error al guardar la foto" });
    }
  });
});

// PATCH /api/pilotos/:id/datos-formulario
router.patch("/:id/datos-formulario", autenticar, autorizar("admin", "inscripciones"), async (req, res) => {
  try {
    const { curp, escolaridad, lugar_nacimiento, calle, colonia, cp, num_ext, num_int,
            parentesco_emergencia, alergias, condiciones_medicas, comision_nacional,
            nombre_equipo, anio_licencia_anterior, anio_inicio_autodromo } = req.body;
    const anioActual = new Date().getFullYear();
    for (const [campo, valor] of Object.entries({ anio_licencia_anterior, anio_inicio_autodromo })) {
      if (!valor) continue;
      const anio = Number(valor);
      if (!Number.isInteger(anio) || anio < 1990 || anio > anioActual) {
        return res.status(400).json({ error: `Año inválido en ${campo} (debe estar entre 1990 y ${anioActual})` });
      }
    }
    await db.query(
      `UPDATE pilotos SET
        curp=?, escolaridad=?, lugar_nacimiento=?, calle=?, colonia=?, cp=?, num_ext=?, num_int=?,
        parentesco_emergencia=?, alergias=?, condiciones_medicas=?, comision_nacional=?,
        nombre_equipo=?, anio_licencia_anterior=?, anio_inicio_autodromo=?
       WHERE id=?`,
      [curp||null, escolaridad||null, lugar_nacimiento||null, calle||null, colonia||null, cp||null,
       num_ext||null, num_int||null, parentesco_emergencia||null, alergias||null,
       condiciones_medicas||null, comision_nacional||null, nombre_equipo||null,
       anio_licencia_anterior||null, anio_inicio_autodromo||null, req.params.id]
    );
    const [rows] = await db.query("SELECT * FROM pilotos WHERE id = ? LIMIT 1", [req.params.id]);
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al actualizar datos del piloto" });
  }
});

module.exports = router;

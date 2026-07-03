const router = require("express").Router();
const bcrypt = require("bcryptjs");
const db     = require("../configuracion/db");
const { autenticar, autorizar } = require("../middleware/auth");

// GET /api/usuarios
router.get("/", autenticar, autorizar("admin"), async (req, res) => {
  try {
    const [rows] = await db.query("SELECT id,username,nombre,rol,activo,creado_en FROM usuarios ORDER BY nombre ASC");
    res.json(rows);
  } catch {
    res.status(500).json({ error: "Error al obtener usuarios" });
  }
});

// POST /api/usuarios
router.post("/", autenticar, autorizar("admin"), async (req, res) => {
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

// PATCH /api/usuarios/:id/activar
router.patch("/:id/activar", autenticar, autorizar("admin"), async (req, res) => {
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

// PATCH /api/usuarios/:id/password
router.patch("/:id/password", autenticar, autorizar("admin"), async (req, res) => {
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

module.exports = router;

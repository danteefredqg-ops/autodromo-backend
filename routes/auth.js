const router  = require("express").Router();
const bcrypt  = require("bcryptjs");
const jwt     = require("jsonwebtoken");
const db      = require("../configuracion/db");
const { JWT_SECRET, loginLimit, autenticar } = require("../middleware/auth");

// POST /api/auth/login
router.post("/login", loginLimit, async (req, res) => {
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

// GET /api/auth/yo
router.get("/yo", autenticar, async (req, res) => {
  try {
    const [rows] = await db.query("SELECT id,username,nombre,rol,activo FROM usuarios WHERE id = ? LIMIT 1", [req.usuario.id]);
    if (rows.length === 0) return res.status(404).json({ error: "Usuario no encontrado" });
    res.json(rows[0]);
  } catch {
    res.status(500).json({ error: "Error al obtener usuario" });
  }
});

module.exports = router;

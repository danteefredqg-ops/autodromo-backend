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

// POST /api/auth/login-unico — un solo formulario para piloto y personal del sistema.
// Intenta primero como piloto (por email) y si no aplica, como personal (por username),
// en una sola petición para no duplicar el consumo del rate limit de /login.
router.post("/login-unico", loginLimit, async (req, res) => {
  try {
    const { identificador, password } = req.body;
    if (!identificador || !password) return res.status(400).json({ error: "Usuario y contraseña requeridos" });
    const id = identificador.trim();

    const [pilotos] = await db.query(
      "SELECT * FROM pilotos WHERE email = ? AND activo = 1 LIMIT 1",
      [id.toLowerCase()]
    );
    if (pilotos.length > 0 && pilotos[0].password && (await bcrypt.compare(password, pilotos[0].password))) {
      const piloto = pilotos[0];
      const token = jwt.sign({ id: piloto.id, numero: piloto.numero_piloto, tipo: "piloto" }, JWT_SECRET, { expiresIn: "7d" });
      const { password: _, ...datos } = piloto;
      return res.json({ tipo: "piloto", token, piloto: datos });
    }

    const [usuarios] = await db.query("SELECT * FROM usuarios WHERE username = ? AND activo = 1 LIMIT 1", [id]);
    if (usuarios.length > 0 && (await bcrypt.compare(password, usuarios[0].password))) {
      const usuario = usuarios[0];
      const token = jwt.sign(
        { id: usuario.id, username: usuario.username, rol: usuario.rol, nombre: usuario.nombre },
        JWT_SECRET, { expiresIn: "8h" }
      );
      return res.json({ tipo: "sistema", token, usuario: { id: usuario.id, username: usuario.username, rol: usuario.rol, nombre: usuario.nombre } });
    }

    return res.status(401).json({ error: "Credenciales incorrectas" });
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

const router = require("express").Router();
const db     = require("../configuracion/db");
const { autenticar, autorizar } = require("../middleware/auth");

// GET /api/categorias
router.get("/", async (req, res) => {
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

// POST /api/categorias
router.post("/", autenticar, autorizar("admin"), async (req, res) => {
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

// PUT /api/categorias/:id
router.put("/:id", autenticar, autorizar("admin"), async (req, res) => {
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

module.exports = router;

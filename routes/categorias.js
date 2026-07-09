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
    const { nombre, descripcion, color, costo_default } = req.body;
    if (!nombre || !nombre.trim()) return res.status(400).json({ error: "Nombre requerido" });
    const [result] = await db.query(
      "INSERT INTO categorias (nombre,descripcion,color,costo_default) VALUES (?,?,?,?)",
      [nombre.trim(), descripcion || null, color || "#e63946", costo_default || null]
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
    const { nombre, descripcion, color, costo_default } = req.body;
    if (!nombre || !nombre.trim()) return res.status(400).json({ error: "Nombre requerido" });
    await db.query("UPDATE categorias SET nombre=?,descripcion=?,color=?,costo_default=? WHERE id=?",
      [nombre.trim(), descripcion || null, color || "#e63946", costo_default || null, req.params.id]);
    const [rows] = await db.query("SELECT * FROM categorias WHERE id = ? LIMIT 1", [req.params.id]);
    res.json(rows[0]);
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") return res.status(409).json({ error: "Ya existe otra categoría con ese nombre" });
    res.status(500).json({ error: "Error al actualizar categoría" });
  }
});

// DELETE /api/categorias/:id
router.delete("/:id", autenticar, autorizar("admin"), async (req, res) => {
  try {
    const [insc] = await db.query("SELECT COUNT(*) AS cnt FROM inscripciones WHERE categoria_id = ?", [req.params.id]);
    if (insc[0].cnt > 0) return res.status(409).json({ error: "No se puede eliminar: tiene inscripciones registradas" });
    await db.query("UPDATE categorias SET activo = 0 WHERE id = ?", [req.params.id]);
    await db.query("DELETE FROM campeonato_categorias WHERE categoria_id = ?", [req.params.id]);
    res.json({ mensaje: "Categoría eliminada" });
  } catch {
    res.status(500).json({ error: "Error al eliminar categoría" });
  }
});

module.exports = router;

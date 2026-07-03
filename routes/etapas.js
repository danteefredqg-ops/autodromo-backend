const router = require("express").Router();
const db     = require("../configuracion/db");
const { autenticar, autorizar } = require("../middleware/auth");

// PUT /api/etapas/:id
router.put("/:id", autenticar, autorizar("admin"), async (req, res) => {
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

// DELETE /api/etapas/:id
router.delete("/:id", autenticar, autorizar("admin"), async (req, res) => {
  try {
    const [insc] = await db.query("SELECT COUNT(*) AS cnt FROM inscripciones WHERE etapa_id = ?", [req.params.id]);
    if (insc[0].cnt > 0) return res.status(409).json({ error: "No se puede eliminar: tiene inscripciones activas" });
    await db.query("UPDATE etapas SET activo = 0 WHERE id = ?", [req.params.id]);
    res.json({ mensaje: "Etapa eliminada" });
  } catch {
    res.status(500).json({ error: "Error al eliminar etapa" });
  }
});

module.exports = router;

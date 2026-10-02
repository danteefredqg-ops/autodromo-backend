const router = require("express").Router();
const db     = require("../configuracion/db");
const { autenticar, autorizar } = require("../middleware/auth");

// PUT /api/etapas/:id
router.put("/:id", autenticar, autorizar("admin"), async (req, res) => {
  try {
    const { numero, nombre, fecha, ubicacion, descripcion, costo,
            fecha_apertura_inscripcion, fecha_cierre_inscripcion } = req.body;
    if (!fecha) return res.status(400).json({ error: "Fecha requerida" });
    if (fecha_apertura_inscripcion && fecha_cierre_inscripcion && fecha_apertura_inscripcion > fecha_cierre_inscripcion) {
      return res.status(400).json({ error: "La apertura de inscripciones no puede ser después del cierre" });
    }
    const num = parseInt(numero);
    if (!Number.isInteger(num) || num < 1) return res.status(400).json({ error: "El número de etapa es obligatorio" });
    const [existe] = await db.query("SELECT id FROM etapas WHERE id = ? AND activo = 1 LIMIT 1", [req.params.id]);
    if (existe.length === 0) return res.status(404).json({ error: "Etapa no encontrada" });
    // nombre es NOT NULL: el modal manda null si se deja en blanco (igual que al
    // crear, donde se autogenera "Etapa N") y antes eso tronaba con un 500.
    // costo ya no se captura en el modal (el costo va por categoría): si no
    // viene en el body se conserva, en vez de borrarlo en cada edición.
    await db.query(
      `UPDATE etapas SET numero=?,nombre=?,fecha=?,ubicacion=?,descripcion=?,costo=IF(?,?,costo),
        fecha_apertura_inscripcion=?,fecha_cierre_inscripcion=? WHERE id=?`,
      [num, (nombre && String(nombre).trim()) || `Etapa ${num}`, fecha, ubicacion || "Autódromo Monterrey",
       descripcion || null, costo !== undefined, costo || null,
       fecha_apertura_inscripcion || null, fecha_cierre_inscripcion || null, req.params.id]
    );
    const [rows] = await db.query(
      `SELECT e.*, (SELECT COUNT(*) FROM inscripciones WHERE etapa_id = e.id) AS total_inscritos
       FROM etapas e WHERE e.id = ? LIMIT 1`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Etapa no encontrada" });
    res.json(rows[0]);
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") return res.status(409).json({ error: "Ya existe una etapa con ese número" });
    res.status(500).json({ error: "Error al actualizar etapa" });
  }
});

// DELETE /api/etapas/:id — borrado suave. (campeonato_id, numero) es UNIQUE,
// y numero es NOT NULL, así que no se puede simplemente vaciar al desactivar
// (mismo bug de fondo que en pilotos/categorías: un registro desactivado
// seguía ocupando su lugar para siempre). Se usa -id como número: es negativo
// (nunca choca con un número real, que siempre es positivo) y único de por sí
// porque id ya lo es, así que libera el número original sin tocar el esquema.
router.delete("/:id", autenticar, autorizar("admin"), async (req, res) => {
  try {
    const [existe] = await db.query("SELECT id FROM etapas WHERE id = ? AND activo = 1 LIMIT 1", [req.params.id]);
    if (existe.length === 0) return res.status(404).json({ error: "Etapa no encontrada" });
    const [insc] = await db.query("SELECT COUNT(*) AS cnt FROM inscripciones WHERE etapa_id = ?", [req.params.id]);
    if (insc[0].cnt > 0) return res.status(409).json({ error: "No se puede eliminar: tiene inscripciones activas" });
    await db.query("UPDATE etapas SET activo = 0, numero = -id WHERE id = ?", [req.params.id]);
    // Sus imágenes de registro dejan de mostrarse (y de aparecer en el admin).
    await db.query("UPDATE imagenes_registro SET activo = 0 WHERE etapa_id = ?", [req.params.id]);
    res.json({ mensaje: "Etapa eliminada" });
  } catch {
    res.status(500).json({ error: "Error al eliminar etapa" });
  }
});

module.exports = router;

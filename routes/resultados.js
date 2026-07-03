const router = require("express").Router();
const db     = require("../configuracion/db");
const { autenticar, autorizar } = require("../middleware/auth");

const PUNTOS_POS = [0, 25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
function puntosParaPosicion(pos) { return PUNTOS_POS[pos] ?? 0; }

// POST /api/resultados
router.post("/", autenticar, autorizar("admin", "inscripciones"), async (req, res) => {
  try {
    const { etapa_id, categoria_id, resultados } = req.body;
    if (!etapa_id || !categoria_id || !Array.isArray(resultados)) return res.status(400).json({ error: "Datos incompletos" });
    await db.query("DELETE FROM resultados WHERE etapa_id = ? AND categoria_id = ?", [etapa_id, categoria_id]);
    if (resultados.length > 0) {
      const vals = resultados.map(r => [etapa_id, categoria_id, r.piloto_id, r.posicion, puntosParaPosicion(r.posicion)]);
      await db.query("INSERT INTO resultados (etapa_id,categoria_id,piloto_id,posicion,puntos) VALUES ?", [vals]);
    }
    res.json({ mensaje: `${resultados.length} resultado(s) guardados` });
  } catch { res.status(500).json({ error: "Error al guardar resultados" }); }
});

// GET /api/resultados
router.get("/", autenticar, async (req, res) => {
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

module.exports = router;

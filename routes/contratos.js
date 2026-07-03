const router = require("express").Router();
const db     = require("../configuracion/db");
const { autoRegistroLimit } = require("../middleware/auth");

// GET /api/contratos/estado
router.get("/estado", async (req, res) => {
  try {
    const { piloto_id, anio } = req.query;
    if (!piloto_id || !anio) return res.status(400).json({ error: "piloto_id y anio requeridos" });
    const [rows] = await db.query(
      "SELECT * FROM contratos_anuales WHERE piloto_id = ? AND anio = ? AND activo = 1 LIMIT 1",
      [piloto_id, anio]
    );
    res.json({ firmado: rows.length > 0, contrato: rows[0] || null });
  } catch {
    res.status(500).json({ error: "Error al verificar contrato" });
  }
});

// POST /api/contratos/firmar
router.post("/firmar", autoRegistroLimit, async (req, res) => {
  try {
    const { piloto_id, anio } = req.body;
    if (!piloto_id || !anio) return res.status(400).json({ error: "piloto_id y anio requeridos" });
    const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").toString().split(",")[0].trim();
    await db.query(
      "INSERT INTO contratos_anuales (piloto_id,anio,ip_firma) VALUES (?,?,?) ON DUPLICATE KEY UPDATE fecha_firma=NOW(), ip_firma=?, activo=1",
      [piloto_id, anio, ip, ip]
    );
    res.json({ mensaje: "Contrato firmado correctamente" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al registrar contrato" });
  }
});

module.exports = router;

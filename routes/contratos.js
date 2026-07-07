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
    const { piloto_id, anio, email, numero } = req.body;
    if (!piloto_id || !anio || !email || !numero) {
      return res.status(400).json({ error: "piloto_id, anio, email y numero requeridos" });
    }
    const [match] = await db.query(
      "SELECT id FROM pilotos WHERE id = ? AND email = ? AND numero_piloto = ? AND activo = 1 LIMIT 1",
      [piloto_id, String(email).trim().toLowerCase(), parseInt(numero)]
    );
    if (match.length === 0) return res.status(403).json({ error: "No se pudo verificar la identidad del piloto" });
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

const router = require("express").Router();
const { autenticar, autorizar } = require("../middleware/auth");
const { ejecutarBackup, ultimoBackupExitoso } = require("../configuracion/backup");

// GET /api/backup/estado — cuándo fue el último respaldo exitoso
router.get("/estado", autenticar, autorizar("admin"), async (req, res) => {
  try {
    const ultimo = await ultimoBackupExitoso();
    res.json({ ultimo_backup: ultimo });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al consultar el estado del respaldo" });
  }
});

// POST /api/backup/ahora — genera y envía un respaldo inmediatamente
router.post("/ahora", autenticar, autorizar("admin"), async (req, res) => {
  const destino = process.env.BACKUP_EMAIL;
  if (!destino) {
    return res.status(400).json({ error: "BACKUP_EMAIL no está configurado en el servidor." });
  }
  try {
    await ejecutarBackup({ destino });
    res.json({ mensaje: `Respaldo generado y enviado a ${destino}` });
  } catch (err) {
    console.error("Error al generar respaldo:", err);
    res.status(500).json({ error: err.message || "Error al generar el respaldo" });
  }
});

module.exports = router;

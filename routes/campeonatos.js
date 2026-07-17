const router = require("express").Router();
const db     = require("../configuracion/db");
const { autenticar, autorizar } = require("../middleware/auth");

// ─── Campeonatos ──────────────────────────────────────────────────────────────

// GET /api/campeonatos
router.get("/", async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT c.*,
        (SELECT COUNT(*) FROM etapas e WHERE e.campeonato_id = c.id AND e.activo = 1) AS total_etapas,
        (SELECT COUNT(*) FROM inscripciones i JOIN etapas e ON e.id = i.etapa_id WHERE e.campeonato_id = c.id) AS total_inscritos,
        (SELECT e.numero FROM etapas e WHERE e.campeonato_id = c.id AND e.activo = 1 AND e.fecha <= CURDATE() ORDER BY e.fecha DESC, e.numero DESC LIMIT 1) AS etapa_actual_num
       FROM campeonatos c WHERE c.activo = 1 ORDER BY c.creado_en DESC`
    );
    const [catRows] = await db.query(
      `SELECT cc.campeonato_id, cc.costo, cat.id, cat.nombre, cat.color
       FROM campeonato_categorias cc
       JOIN categorias cat ON cat.id = cc.categoria_id
       WHERE cat.activo = 1`
    ).catch(() => [[]]);
    const catsPorCamp = {};
    for (const row of catRows) {
      if (!catsPorCamp[row.campeonato_id]) catsPorCamp[row.campeonato_id] = [];
      catsPorCamp[row.campeonato_id].push({ id: row.id, nombre: row.nombre, color: row.color, costo: row.costo });
    }
    res.json(rows.map(r => ({ ...r, categorias: catsPorCamp[r.id] || [] })));
  } catch (err) {
    console.error("GET /api/campeonatos error:", err.message);
    res.status(500).json({ error: "Error al obtener campeonatos" });
  }
});

// GET /api/campeonatos/:id
router.get("/:id", async (req, res) => {
  try {
    const [rows] = await db.query("SELECT * FROM campeonatos WHERE id = ? LIMIT 1", [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: "Campeonato no encontrado" });
    res.json(rows[0]);
  } catch {
    res.status(500).json({ error: "Error al obtener campeonato" });
  }
});

// GET /api/campeonatos/:id/categorias
router.get("/:id/categorias", async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT cat.*, cc.costo FROM categorias cat
       JOIN campeonato_categorias cc ON cc.categoria_id = cat.id
       WHERE cc.campeonato_id = ? AND cat.activo = 1
       ORDER BY cat.nombre ASC`,
      [req.params.id]
    );
    res.json(rows);
  } catch {
    res.status(500).json({ error: "Error al obtener categorías del campeonato" });
  }
});

// GET /api/campeonatos/:id/etapas
router.get("/:id/etapas", async (req, res) => {
  try {
    let sql = `
      SELECT e.*,
        (SELECT COUNT(*) FROM inscripciones WHERE etapa_id = e.id) AS total_inscritos
       FROM etapas e WHERE e.campeonato_id = ? AND e.activo = 1`;
    const params = [req.params.id];
    if (req.query.disponibles) {
      // No usar CURDATE(): el servidor de MySQL puede correr en UTC y desfasar
      // la fecha varias horas respecto a Monterrey (México ya no usa horario
      // de verano, es UTC-6 fijo).
      const hoyMx = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString().slice(0, 10);
      sql += ` AND (e.fecha_apertura_inscripcion IS NULL OR ? >= e.fecha_apertura_inscripcion)
                AND (e.fecha_cierre_inscripcion   IS NULL OR ? <= e.fecha_cierre_inscripcion)`;
      params.push(hoyMx, hoyMx);
    }
    sql += " ORDER BY e.numero ASC";
    const [rows] = await db.query(sql, params);
    res.json(rows);
  } catch {
    res.status(500).json({ error: "Error al obtener etapas" });
  }
});

// POST /api/campeonatos
router.post("/", autenticar, autorizar("admin"), async (req, res) => {
  try {
    const { nombre, descripcion, ubicacion, categorias } = req.body;
    if (!nombre) return res.status(400).json({ error: "Nombre requerido" });
    const [result] = await db.query(
      "INSERT INTO campeonatos (nombre,descripcion,ubicacion) VALUES (?,?,?)",
      [nombre, descripcion || null, ubicacion || "Autódromo Monterrey"]
    );
    const campId = result.insertId;
    if (Array.isArray(categorias) && categorias.length > 0) {
      const vals = categorias.map((c) => [campId, c.id, c.costo ?? null]);
      await db.query("INSERT INTO campeonato_categorias (campeonato_id,categoria_id,costo) VALUES ?", [vals]);
    }
    const [nuevo] = await db.query("SELECT * FROM campeonatos WHERE id = ? LIMIT 1", [campId]);
    res.status(201).json(nuevo[0]);
  } catch {
    res.status(500).json({ error: "Error al crear campeonato" });
  }
});

// PUT /api/campeonatos/:id
router.put("/:id", autenticar, autorizar("admin"), async (req, res) => {
  try {
    const { nombre, descripcion, ubicacion, categorias } = req.body;
    if (!nombre) return res.status(400).json({ error: "Nombre requerido" });
    // ubicacion es opcional en el modal de edición: si no se manda, conserva la actual
    // en vez de resetearla al valor por defecto.
    await db.query(
      "UPDATE campeonatos SET nombre=?,descripcion=?,ubicacion=COALESCE(?,ubicacion) WHERE id=?",
      [nombre, descripcion || null, ubicacion || null, req.params.id]
    );
    if (Array.isArray(categorias)) {
      await db.query("DELETE FROM campeonato_categorias WHERE campeonato_id = ?", [req.params.id]);
      if (categorias.length > 0) {
        const vals = categorias.map((c) => [req.params.id, c.id, c.costo ?? null]);
        await db.query("INSERT INTO campeonato_categorias (campeonato_id,categoria_id,costo) VALUES ?", [vals]);
      }
    }
    const [rows] = await db.query("SELECT * FROM campeonatos WHERE id = ? LIMIT 1", [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: "Campeonato no encontrado" });
    res.json(rows[0]);
  } catch {
    res.status(500).json({ error: "Error al actualizar campeonato" });
  }
});

// DELETE /api/campeonatos/:id
router.delete("/:id", autenticar, autorizar("admin"), async (req, res) => {
  try {
    const [existe] = await db.query("SELECT id FROM campeonatos WHERE id = ? AND activo = 1 LIMIT 1", [req.params.id]);
    if (existe.length === 0) return res.status(404).json({ error: "Campeonato no encontrado" });
    const [insc] = await db.query(
      "SELECT COUNT(*) AS cnt FROM inscripciones i JOIN etapas e ON e.id = i.etapa_id WHERE e.campeonato_id = ?",
      [req.params.id]
    );
    if (insc[0].cnt > 0) return res.status(409).json({ error: "No se puede eliminar: tiene inscripciones registradas" });
    await db.query("UPDATE etapas SET activo = 0 WHERE campeonato_id = ?", [req.params.id]);
    await db.query("UPDATE campeonatos SET activo = 0 WHERE id = ?", [req.params.id]);
    res.json({ mensaje: "Campeonato eliminado" });
  } catch {
    res.status(500).json({ error: "Error al eliminar campeonato" });
  }
});

// POST /api/campeonatos/:id/etapas
router.post("/:id/etapas", autenticar, autorizar("admin"), async (req, res) => {
  try {
    const campId = req.params.id;
    const { numero, nombre, fecha, ubicacion, descripcion, costo,
            fecha_apertura_inscripcion, fecha_cierre_inscripcion } = req.body;
    if (!fecha) return res.status(400).json({ error: "Fecha requerida" });
    if (fecha_apertura_inscripcion && fecha_cierre_inscripcion && fecha_apertura_inscripcion > fecha_cierre_inscripcion) {
      return res.status(400).json({ error: "La apertura de inscripciones no puede ser después del cierre" });
    }
    let etapaNum = numero;
    if (!etapaNum) {
      const [maxRow] = await db.query(
        "SELECT COALESCE(MAX(numero),0)+1 AS sig FROM etapas WHERE campeonato_id = ?", [campId]
      );
      etapaNum = maxRow[0].sig;
    }
    const [camp] = await db.query("SELECT ubicacion FROM campeonatos WHERE id = ? LIMIT 1", [campId]);
    const defaultUbic = camp.length > 0 ? camp[0].ubicacion : "Autódromo Monterrey";
    const [result] = await db.query(
      `INSERT INTO etapas (campeonato_id,numero,nombre,fecha,ubicacion,descripcion,costo,
        fecha_apertura_inscripcion,fecha_cierre_inscripcion) VALUES (?,?,?,?,?,?,?,?,?)`,
      [campId, etapaNum, nombre || `Etapa ${etapaNum}`, fecha, ubicacion || defaultUbic, descripcion || null, costo || null,
       fecha_apertura_inscripcion || null, fecha_cierre_inscripcion || null]
    );
    const [nueva] = await db.query(
      `SELECT e.*, (SELECT COUNT(*) FROM inscripciones WHERE etapa_id = e.id) AS total_inscritos
       FROM etapas e WHERE e.id = ? LIMIT 1`,
      [result.insertId]
    );
    res.status(201).json(nueva[0]);
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") return res.status(409).json({ error: "Ya existe una etapa con ese número en este campeonato" });
    console.error(err);
    res.status(500).json({ error: "Error al crear etapa" });
  }
});

module.exports = router;

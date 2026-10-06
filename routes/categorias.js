const router = require("express").Router();
const db     = require("../configuracion/db");
const { autenticar, autorizar } = require("../middleware/auth");
const { leerReglasCategoria } = require("../utils/reglasCategorias");

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
    const reglas = leerReglasCategoria(req.body);
    if (reglas.error) return res.status(400).json({ error: reglas.error });
    const { edad_minima, edad_maxima, exclusiva } = reglas.valores;
    const [result] = await db.query(
      "INSERT INTO categorias (nombre,descripcion,color,costo_default,edad_minima,edad_maxima,exclusiva) VALUES (?,?,?,?,?,?,?)",
      [nombre.trim(), descripcion || null, color || "#e63946", costo_default || null, edad_minima, edad_maxima, exclusiva]
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
    const [actual] = await db.query("SELECT * FROM categorias WHERE id = ? LIMIT 1", [req.params.id]);
    if (actual.length === 0) return res.status(404).json({ error: "Categoría no encontrada" });
    // Campos que no vienen en el body se conservan: el modal no manda la
    // descripción, y antes cada edición la borraba.
    const conservar = (campo) => !(campo in req.body);
    const reglas = leerReglasCategoria({
      edad_minima: conservar("edad_minima") ? actual[0].edad_minima : req.body.edad_minima,
      edad_maxima: conservar("edad_maxima") ? actual[0].edad_maxima : req.body.edad_maxima,
      exclusiva:   conservar("exclusiva")   ? actual[0].exclusiva   : req.body.exclusiva,
    });
    if (reglas.error) return res.status(400).json({ error: reglas.error });
    const { edad_minima, edad_maxima, exclusiva } = reglas.valores;
    await db.query(
      "UPDATE categorias SET nombre=?,descripcion=?,color=?,costo_default=?,edad_minima=?,edad_maxima=?,exclusiva=? WHERE id=?",
      [nombre.trim(), conservar("descripcion") ? actual[0].descripcion : (descripcion || null),
       color || "#e63946", costo_default || null, edad_minima, edad_maxima, exclusiva, req.params.id]);
    const [rows] = await db.query("SELECT * FROM categorias WHERE id = ? LIMIT 1", [req.params.id]);
    res.json(rows[0]);
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") return res.status(409).json({ error: "Ya existe otra categoría con ese nombre" });
    res.status(500).json({ error: "Error al actualizar categoría" });
  }
});

// DELETE /api/categorias/:id — borrado suave. `nombre` es UNIQUE, y un
// registro desactivado seguía ocupando el nombre para siempre (mismo bug que
// se encontró y arregló en pilotos): borrar "DRAGSTER" por error y volver a
// crearla tronaba con "Categoría ya existe" aunque ya no apareciera en
// ninguna lista. Se mutila el nombre al desactivar para liberarlo.
router.delete("/:id", autenticar, autorizar("admin"), async (req, res) => {
  const conn = await db.getConnection();
  try {
    const [existe] = await conn.query("SELECT id, nombre FROM categorias WHERE id = ? AND activo = 1 LIMIT 1", [req.params.id]);
    if (existe.length === 0) return res.status(404).json({ error: "Categoría no encontrada" });
    const [insc] = await conn.query("SELECT COUNT(*) AS cnt FROM inscripciones WHERE categoria_id = ?", [req.params.id]);
    if (insc[0].cnt > 0) return res.status(409).json({ error: "No se puede eliminar: tiene inscripciones registradas" });
    const nombreMutilado = `eliminada_${req.params.id}_${existe[0].nombre}`.slice(0, 60);
    await conn.beginTransaction();
    await conn.query("UPDATE categorias SET activo = 0, nombre = ? WHERE id = ?", [nombreMutilado, req.params.id]);
    await conn.query("DELETE FROM campeonato_categorias WHERE categoria_id = ?", [req.params.id]);
    await conn.commit();
    res.json({ mensaje: "Categoría eliminada" });
  } catch {
    await conn.rollback();
    res.status(500).json({ error: "Error al eliminar categoría" });
  } finally {
    conn.release();
  }
});

module.exports = router;

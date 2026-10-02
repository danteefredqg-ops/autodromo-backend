// routes/imagenes.js — imágenes que ve el piloto al inscribirse.
// El admin las sube y elige dónde se muestran: en todo un campeonato
// (etapa_id NULL) o solo en una etapa. El registro público y el portal del
// piloto las piden al elegir campeonato/etapa.
const router = require("express").Router();
const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");
const multer = require("multer");
const db     = require("../configuracion/db");
const { autenticar, autorizar } = require("../middleware/auth");
const { REGISTRO_DIR } = require("../configuracion/uploads");

const EXTENSIONES = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" };

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, REGISTRO_DIR),
    // Nombre aleatorio: no depende de lo que mande el navegador y no choca
    // con otra imagen subida antes.
    filename: (req, file, cb) => cb(null, `${crypto.randomBytes(12).toString("hex")}${EXTENSIONES[file.mimetype]}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!EXTENSIONES[file.mimetype]) return cb(new Error("Solo se permiten imágenes JPG, PNG o WEBP"));
    cb(null, true);
  },
});

const SELECT_IMAGEN = `
  SELECT img.id, img.campeonato_id, img.etapa_id, img.archivo, img.titulo, img.orden, img.creado_en,
         e.numero AS etapa_numero, e.nombre AS etapa_nombre
  FROM imagenes_registro img
  LEFT JOIN etapas e ON e.id = img.etapa_id`;

function borrarArchivo(archivo) {
  // archivo se guarda como "/uploads/registro/<nombre>" — solo se usa el nombre
  // final para no salir nunca de REGISTRO_DIR.
  const nombre = path.basename(String(archivo || "").split("?")[0]);
  if (!nombre) return;
  fs.unlink(path.join(REGISTRO_DIR, nombre), () => {});
}

// Valida que la etapa (si viene) pertenezca al campeonato. Devuelve el
// etapa_id normalizado (número o null) o lanza un error con status.
async function etapaDelCampeonato(campeonatoId, etapaId) {
  if (etapaId === undefined || etapaId === null || etapaId === "") return null;
  const id = parseInt(etapaId);
  const [rows] = await db.query(
    "SELECT id FROM etapas WHERE id = ? AND campeonato_id = ? AND activo = 1 LIMIT 1", [id, campeonatoId]
  );
  if (rows.length === 0) {
    const err = new Error("La etapa no pertenece a este campeonato");
    err.status = 400;
    throw err;
  }
  return id;
}

// GET /api/imagenes-registro?campeonato_id=X[&etapa_id=Y] — público.
// Devuelve las del campeonato completo y, si se indica etapa, también las de esa etapa.
router.get("/", async (req, res) => {
  try {
    const { campeonato_id, etapa_id } = req.query;
    if (!campeonato_id) return res.status(400).json({ error: "campeonato_id requerido" });
    let sql = `${SELECT_IMAGEN}
      JOIN campeonatos c ON c.id = img.campeonato_id AND c.activo = 1
      WHERE img.campeonato_id = ? AND img.activo = 1 AND (img.etapa_id IS NULL`;
    const params = [campeonato_id];
    if (etapa_id) { sql += " OR img.etapa_id = ?"; params.push(etapa_id); }
    // Primero las del campeonato, luego las de la etapa; dentro, por orden y antigüedad.
    sql += ") ORDER BY (img.etapa_id IS NOT NULL) ASC, img.orden ASC, img.id ASC";
    const [rows] = await db.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener imágenes" });
  }
});

// GET /api/imagenes-registro/campeonato/:id — admin: todas las de un campeonato (de cualquier etapa)
router.get("/campeonato/:id", autenticar, autorizar("admin"), async (req, res) => {
  try {
    const [rows] = await db.query(
      `${SELECT_IMAGEN} WHERE img.campeonato_id = ? AND img.activo = 1
       ORDER BY (img.etapa_id IS NOT NULL) ASC, e.numero ASC, img.orden ASC, img.id ASC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener imágenes" });
  }
});

// POST /api/imagenes-registro — admin. multipart: imagen, campeonato_id, etapa_id?, titulo?
router.post("/", autenticar, autorizar("admin"), (req, res) => {
  upload.single("imagen")(req, res, async (errUpload) => {
    if (errUpload) {
      const msg = errUpload.code === "LIMIT_FILE_SIZE" ? "La imagen no puede pesar más de 5MB" : errUpload.message;
      return res.status(400).json({ error: msg || "Error al subir la imagen" });
    }
    if (!req.file) return res.status(400).json({ error: "No se recibió ninguna imagen" });
    const archivo = `/uploads/registro/${req.file.filename}`;
    try {
      const campeonatoId = parseInt(req.body.campeonato_id);
      const [camp] = await db.query("SELECT id FROM campeonatos WHERE id = ? AND activo = 1 LIMIT 1", [campeonatoId]);
      if (camp.length === 0) { borrarArchivo(archivo); return res.status(404).json({ error: "Campeonato no encontrado" }); }
      const etapaId = await etapaDelCampeonato(campeonatoId, req.body.etapa_id);
      const titulo = (req.body.titulo || "").trim().slice(0, 150) || null;
      const [[{ sig }]] = await db.query(
        "SELECT COALESCE(MAX(orden), 0) + 1 AS sig FROM imagenes_registro WHERE campeonato_id = ? AND activo = 1", [campeonatoId]
      );
      const [result] = await db.query(
        "INSERT INTO imagenes_registro (campeonato_id, etapa_id, archivo, titulo, orden) VALUES (?,?,?,?,?)",
        [campeonatoId, etapaId, archivo, titulo, sig]
      );
      const [nueva] = await db.query(`${SELECT_IMAGEN} WHERE img.id = ? LIMIT 1`, [result.insertId]);
      res.status(201).json(nueva[0]);
    } catch (err) {
      // Si algo falla después de guardar el archivo, no dejarlo huérfano en el disco.
      borrarArchivo(archivo);
      if (err.status) return res.status(err.status).json({ error: err.message });
      console.error(err);
      res.status(500).json({ error: "Error al guardar la imagen" });
    }
  });
});

// PATCH /api/imagenes-registro/:id — admin. Cambiar dónde se muestra (etapa_id), título u orden.
router.patch("/:id", autenticar, autorizar("admin"), async (req, res) => {
  try {
    const [rows] = await db.query("SELECT * FROM imagenes_registro WHERE id = ? AND activo = 1 LIMIT 1", [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: "Imagen no encontrada" });
    const img = rows[0];
    const etapaId = "etapa_id" in req.body ? await etapaDelCampeonato(img.campeonato_id, req.body.etapa_id) : img.etapa_id;
    const titulo  = "titulo" in req.body ? ((req.body.titulo || "").trim().slice(0, 150) || null) : img.titulo;
    let orden = img.orden;
    if ("orden" in req.body) {
      orden = parseInt(req.body.orden);
      if (!Number.isInteger(orden)) return res.status(400).json({ error: "Orden inválido" });
    }
    await db.query("UPDATE imagenes_registro SET etapa_id = ?, titulo = ?, orden = ? WHERE id = ?",
      [etapaId, titulo, orden, img.id]);
    const [act] = await db.query(`${SELECT_IMAGEN} WHERE img.id = ? LIMIT 1`, [img.id]);
    res.json(act[0]);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: "Error al actualizar la imagen" });
  }
});

// DELETE /api/imagenes-registro/:id — admin. Borra el registro y el archivo.
router.delete("/:id", autenticar, autorizar("admin"), async (req, res) => {
  try {
    const [rows] = await db.query("SELECT archivo FROM imagenes_registro WHERE id = ? LIMIT 1", [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: "Imagen no encontrada" });
    await db.query("DELETE FROM imagenes_registro WHERE id = ?", [req.params.id]);
    borrarArchivo(rows[0].archivo);
    res.json({ mensaje: "Imagen eliminada" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al eliminar la imagen" });
  }
});

module.exports = router;

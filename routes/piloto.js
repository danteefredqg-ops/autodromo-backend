const router = require("express").Router();
const bcrypt = require("bcryptjs");
const jwt    = require("jsonwebtoken");
const db     = require("../configuracion/db");
const { JWT_SECRET, loginLimit, autenticarPiloto } = require("../middleware/auth");

// POST /api/piloto/crear-acceso
router.post("/crear-acceso", loginLimit, async (req, res) => {
  try {
    const { email, numero, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Email y contraseña son requeridos" });
    if (password.length < 6) return res.status(400).json({ error: "La contraseña debe tener al menos 6 caracteres" });
    let rows;
    if (numero && parseInt(numero) > 0) {
      [rows] = await db.query(
        "SELECT id, password FROM pilotos WHERE email = ? AND numero_piloto = ? AND activo = 1 LIMIT 1",
        [email.trim().toLowerCase(), parseInt(numero)]
      );
      if (rows.length === 0) return res.status(404).json({ error: "No encontramos un piloto con ese email y número. Verifica que el número sea correcto." });
    } else {
      [rows] = await db.query(
        "SELECT id, password FROM pilotos WHERE email = ? AND (numero_piloto IS NULL OR numero_piloto = 0) AND activo = 1 LIMIT 1",
        [email.trim().toLowerCase()]
      );
      if (rows.length === 0) return res.status(404).json({ error: "No encontramos tu cuenta solo con el correo. Si ya tienes número de piloto asignado, inclúyelo para verificar tu identidad." });
    }
    if (rows[0].password) return res.status(409).json({ error: "Ya tienes acceso al portal. Usa tu contraseña para entrar; si la olvidaste, contacta a Autódromo Monterrey." });
    const hash = await bcrypt.hash(password, 10);
    await db.query("UPDATE pilotos SET password = ? WHERE id = ?", [hash, rows[0].id]);
    res.json({ mensaje: "Acceso creado correctamente. Ya puedes iniciar sesión." });
  } catch { res.status(500).json({ error: "Error al crear acceso" }); }
});

// POST /api/piloto/login
router.post("/login", loginLimit, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Email y contraseña requeridos" });
    const [rows] = await db.query(
      "SELECT * FROM pilotos WHERE email = ? AND activo = 1 LIMIT 1",
      [email.trim().toLowerCase()]
    );
    if (rows.length === 0) return res.status(401).json({ error: "Email o contraseña incorrectos" });
    const piloto = rows[0];
    if (!piloto.password) return res.status(401).json({ error: "Aún no tienes acceso creado. Usa la opción 'Crear mi acceso'." });
    const ok = await bcrypt.compare(password, piloto.password);
    if (!ok) return res.status(401).json({ error: "Email o contraseña incorrectos" });
    const token = jwt.sign({ id: piloto.id, numero: piloto.numero_piloto, tipo: "piloto" }, JWT_SECRET, { expiresIn: "7d" });
    const { password: _, ...datos } = piloto;
    res.json({ token, piloto: datos });
  } catch { res.status(500).json({ error: "Error al iniciar sesión" }); }
});

// GET /api/piloto/mi-perfil
router.get("/mi-perfil", autenticarPiloto, async (req, res) => {
  try {
    const [rows] = await db.query("SELECT * FROM pilotos WHERE id = ? AND activo = 1 LIMIT 1", [req.piloto.id]);
    if (rows.length === 0) return res.status(404).json({ error: "Piloto no encontrado" });
    const { password: _, ...datos } = rows[0];
    res.json(datos);
  } catch { res.status(500).json({ error: "Error al obtener perfil" }); }
});

// PATCH /api/piloto/mi-perfil
router.patch("/mi-perfil", autenticarPiloto, async (req, res) => {
  try {
    const permitidos = ['telefono','tipo_sangre','contacto_emergencia','telefono_emergencia',
      'curp','escolaridad','lugar_nacimiento','calle','colonia','cp','num_ext','num_int',
      'parentesco_emergencia','alergias','condiciones_medicas','comision_nacional','nombre_equipo',
      'anio_licencia_anterior','ciudad','estado','nacionalidad','fecha_nacimiento'];
    const sets = [], vals = [];
    for (const [k, v] of Object.entries(req.body)) {
      if (permitidos.includes(k) && v !== undefined) { sets.push(`\`${k}\` = ?`); vals.push(v || null); }
    }
    if (req.body.nueva_password && req.body.nueva_password.length >= 6) {
      sets.push("password = ?");
      vals.push(await bcrypt.hash(req.body.nueva_password, 10));
    }
    if (sets.length === 0) return res.status(400).json({ error: "Sin campos para actualizar" });
    vals.push(req.piloto.id);
    await db.query(`UPDATE pilotos SET ${sets.join(", ")} WHERE id = ?`, vals);
    const [updated] = await db.query("SELECT * FROM pilotos WHERE id = ? LIMIT 1", [req.piloto.id]);
    const { password: _, ...datos } = updated[0];
    res.json(datos);
  } catch { res.status(500).json({ error: "Error al actualizar perfil" }); }
});

// GET /api/piloto/mis-carreras
router.get("/mis-carreras", autenticarPiloto, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT i.*,
              cat.nombre   AS categoria_nombre, cat.color AS categoria_color,
              e.numero     AS etapa_numero, e.fecha AS etapa_fecha, e.nombre AS etapa_nombre, e.ubicacion AS etapa_ubicacion,
              c.nombre     AS campeonato_nombre,
              r.posicion   AS resultado_posicion, r.puntos AS resultado_puntos
       FROM inscripciones i
       JOIN categorias cat  ON cat.id = i.categoria_id
       LEFT JOIN etapas e   ON e.id   = i.etapa_id
       JOIN campeonatos c   ON c.id   = i.campeonato_id
       LEFT JOIN resultados r ON r.etapa_id = i.etapa_id AND r.categoria_id = i.categoria_id AND r.piloto_id = i.piloto_id
       WHERE i.piloto_id = ?
       ORDER BY e.fecha DESC, c.nombre ASC`,
      [req.piloto.id]
    );
    res.json(rows);
  } catch { res.status(500).json({ error: "Error al obtener carreras" }); }
});

// GET /api/piloto/mis-stats
router.get("/mis-stats", autenticarPiloto, async (req, res) => {
  try {
    const [carreras]   = await db.query("SELECT COUNT(*) AS total FROM inscripciones WHERE piloto_id = ?", [req.piloto.id]);
    const [pagadas]    = await db.query("SELECT COUNT(*) AS total FROM inscripciones WHERE piloto_id = ? AND estatus = 'Pagado'", [req.piloto.id]);
    const [resultados] = await db.query("SELECT posicion, puntos FROM resultados WHERE piloto_id = ?", [req.piloto.id]);
    const totalPuntos  = resultados.reduce((s, r) => s + parseFloat(r.puntos || 0), 0);
    const victorias    = resultados.filter(r => r.posicion === 1).length;
    const podios       = resultados.filter(r => r.posicion <= 3).length;
    const mejorPos     = resultados.length ? Math.min(...resultados.map(r => r.posicion)) : null;
    const [campeonatos] = await db.query(
      "SELECT COUNT(DISTINCT campeonato_id) AS total FROM inscripciones WHERE piloto_id = ?", [req.piloto.id]
    );
    res.json({ carreras: carreras[0].total, pagadas: pagadas[0].total, campeonatos: campeonatos[0].total,
               totalPuntos, victorias, podios, mejorPosicion: mejorPos });
  } catch { res.status(500).json({ error: "Error al obtener estadísticas" }); }
});

// GET /api/piloto/clasificacion/:campeonato_id/:categoria_id
router.get("/clasificacion/:campeonato_id/:categoria_id", autenticarPiloto, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT p.id, p.nombre_completo, p.numero_piloto,
              SUM(r.puntos) AS puntos_totales,
              COUNT(r.id) AS carreras_corridas,
              SUM(CASE WHEN r.posicion = 1 THEN 1 ELSE 0 END) AS victorias,
              MIN(r.posicion) AS mejor_posicion
       FROM resultados r
       JOIN etapas e ON e.id = r.etapa_id
       JOIN pilotos p ON p.id = r.piloto_id
       WHERE e.campeonato_id = ? AND r.categoria_id = ?
       GROUP BY p.id
       ORDER BY puntos_totales DESC, victorias DESC`,
      [req.params.campeonato_id, req.params.categoria_id]
    );
    res.json(rows);
  } catch { res.status(500).json({ error: "Error al obtener clasificación" }); }
});

module.exports = router;

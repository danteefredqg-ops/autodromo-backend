const router = require("express").Router();
const db     = require("../configuracion/db");
const { autenticar, autorizar, autoRegistroLimit } = require("../middleware/auth");

// GET /api/inscripciones
router.get("/", autenticar, async (req, res) => {
  try {
    const { campeonato_id, etapa_id, categoria_id, estatus, piloto_id } = req.query;
    let sql = `
      SELECT i.*,
        p.nombre_completo AS piloto_nombre, p.tipo_sangre, p.telefono AS piloto_telefono,
        p.nacionalidad AS piloto_nacionalidad,
        camp.nombre AS campeonato_nombre,
        e.nombre AS etapa_nombre, e.numero AS etapa_numero, e.fecha AS etapa_fecha,
        cat.nombre AS categoria_nombre, cat.color AS categoria_color,
        COALESCE(cc.costo, cat.costo_default, e.costo, 0) AS costo_categoria
      FROM inscripciones i
      JOIN pilotos   p      ON p.id    = i.piloto_id
      JOIN campeonatos camp  ON camp.id = i.campeonato_id
      LEFT JOIN etapas e    ON e.id    = i.etapa_id
      JOIN categorias cat   ON cat.id  = i.categoria_id
      LEFT JOIN campeonato_categorias cc ON cc.campeonato_id = i.campeonato_id AND cc.categoria_id = i.categoria_id
      WHERE 1=1`;
    const params = [];
    if (piloto_id)        { sql += " AND i.piloto_id = ?";     params.push(piloto_id); }
    if (etapa_id)         { sql += " AND i.etapa_id = ?";      params.push(etapa_id); }
    else if (campeonato_id) { sql += " AND i.campeonato_id = ?"; params.push(campeonato_id); }
    if (categoria_id)     { sql += " AND i.categoria_id = ?";  params.push(categoria_id); }
    if (estatus)          { sql += " AND i.estatus = ?";        params.push(estatus); }
    sql += " ORDER BY i.creado_en DESC, cat.nombre ASC, i.numero_piloto ASC";
    const [rows] = await db.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener inscripciones" });
  }
});

// POST /api/inscripciones  — admin/inscripciones
router.post("/", autenticar, autorizar("admin", "inscripciones"), async (req, res) => {
  try {
    const {
      piloto_id, etapa_id, campeonato_id: directCampId, categoria_id, numero_piloto,
      vehiculo, modelo_vehiculo, anio_vehiculo, color_vehiculo, apodo_vehiculo,
    } = req.body;
    if (!piloto_id || !categoria_id || !numero_piloto || !vehiculo) {
      return res.status(400).json({ error: "Campos obligatorios incompletos" });
    }
    if (!etapa_id && !directCampId) {
      return res.status(400).json({ error: "Se requiere etapa_id o campeonato_id" });
    }
    let campId = directCampId;
    let etId   = etapa_id || null;
    if (etapa_id) {
      const [etRow] = await db.query("SELECT campeonato_id FROM etapas WHERE id = ? AND activo = 1 LIMIT 1", [etapa_id]);
      if (etRow.length === 0) return res.status(404).json({ error: "Etapa no encontrada" });
      campId = etRow[0].campeonato_id;
    }
    if (etId) {
      const [dup] = await db.query(
        "SELECT id FROM inscripciones WHERE piloto_id = ? AND etapa_id = ? AND categoria_id = ? LIMIT 1",
        [piloto_id, etId, categoria_id]
      );
      if (dup.length > 0) return res.status(409).json({ error: "Este piloto ya está inscrito en esta categoría para esta etapa" });
    }
    const [result] = await db.query(
      `INSERT INTO inscripciones
        (piloto_id, campeonato_id, etapa_id, categoria_id, numero_piloto, vehiculo,
         modelo_vehiculo, anio_vehiculo, color_vehiculo, apodo_vehiculo)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [piloto_id, campId, etId, categoria_id, numero_piloto, vehiculo,
       modelo_vehiculo || null, anio_vehiculo || null, color_vehiculo || null, apodo_vehiculo || null]
    );
    const [nueva] = await db.query(
      `SELECT i.*, p.nombre_completo AS piloto_nombre, p.tipo_sangre,
              cat.nombre AS categoria_nombre, cat.color AS categoria_color,
              camp.nombre AS campeonato_nombre,
              e.nombre AS etapa_nombre, e.numero AS etapa_numero
       FROM inscripciones i
       JOIN pilotos   p    ON p.id    = i.piloto_id
       JOIN categorias cat  ON cat.id  = i.categoria_id
       JOIN campeonatos camp ON camp.id = i.campeonato_id
       LEFT JOIN etapas e   ON e.id    = i.etapa_id
       WHERE i.id = ? LIMIT 1`,
      [result.insertId]
    );
    res.status(201).json(nueva[0]);
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") return res.status(409).json({ error: "El piloto ya está inscrito con esa combinación" });
    console.error(err);
    res.status(500).json({ error: "Error al inscribir piloto" });
  }
});

// PATCH /api/inscripciones/:id/pagar
router.patch("/:id/pagar", autenticar, autorizar("admin", "inscripciones"), async (req, res) => {
  try {
    const { metodo_pago, monto_pago } = req.body;
    const metodo = ["Efectivo", "Transferencia", "Intercambio"].includes(metodo_pago) ? metodo_pago : "Efectivo";
    await db.query(
      "UPDATE inscripciones SET estatus='Pagado', metodo_pago=?, monto_pago=?, pagado_en=NOW(), pagado_por=? WHERE id=?",
      [metodo, monto_pago || null, req.usuario.username, req.params.id]
    );
    const [rows] = await db.query(
      `SELECT i.*, p.nombre_completo AS piloto_nombre, cat.nombre AS categoria_nombre
       FROM inscripciones i
       JOIN pilotos   p   ON p.id   = i.piloto_id
       JOIN categorias cat ON cat.id = i.categoria_id
       WHERE i.id = ? LIMIT 1`,
      [req.params.id]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al registrar pago" });
  }
});

// PATCH /api/inscripciones/:id/vehiculo — admin/inscripciones/torre (torre solo puede tocar esto)
router.patch("/:id/vehiculo", autenticar, autorizar("admin", "inscripciones", "torre"), async (req, res) => {
  try {
    const { vehiculo, modelo_vehiculo, anio_vehiculo, color_vehiculo, apodo_vehiculo } = req.body;
    if (!vehiculo || !vehiculo.trim()) return res.status(400).json({ error: "La marca del vehículo es obligatoria" });
    await db.query(
      "UPDATE inscripciones SET vehiculo=?, modelo_vehiculo=?, anio_vehiculo=?, color_vehiculo=?, apodo_vehiculo=? WHERE id=?",
      [vehiculo.trim(), modelo_vehiculo || null, anio_vehiculo || null, color_vehiculo || null, apodo_vehiculo || null, req.params.id]
    );
    const [rows] = await db.query(
      `SELECT i.*, p.nombre_completo AS piloto_nombre, cat.nombre AS categoria_nombre
       FROM inscripciones i
       JOIN pilotos   p   ON p.id   = i.piloto_id
       JOIN categorias cat ON cat.id = i.categoria_id
       WHERE i.id = ? LIMIT 1`,
      [req.params.id]
    );
    res.json(rows[0]);
  } catch {
    res.status(500).json({ error: "Error al actualizar vehículo" });
  }
});

// PATCH /api/inscripciones/:id/estatus
router.patch("/:id/estatus", autenticar, autorizar("admin", "inscripciones"), async (req, res) => {
  try {
    const { estatus, notas } = req.body;
    const validos = ["Pendiente", "Pagado", "Descalificado"];
    if (!estatus || !validos.includes(estatus)) return res.status(400).json({ error: "Estatus inválido" });
    await db.query("UPDATE inscripciones SET estatus=?, notas=? WHERE id=?", [estatus, notas || null, req.params.id]);
    res.json({ mensaje: "Estatus actualizado" });
  } catch {
    res.status(500).json({ error: "Error al actualizar estatus" });
  }
});

// DELETE /api/inscripciones/:id
router.delete("/:id", autenticar, autorizar("admin"), async (req, res) => {
  try {
    await db.query("DELETE FROM inscripciones WHERE id = ?", [req.params.id]);
    res.json({ mensaje: "Inscripción eliminada" });
  } catch {
    res.status(500).json({ error: "Error al eliminar inscripción" });
  }
});

// POST /api/inscripciones/auto-registro  — público
router.post("/auto-registro", autoRegistroLimit, async (req, res) => {
  try {
    const {
      etapa_id, campeonato_id: directCampId, categoria_id, numero_piloto,
      vehiculo, modelo_vehiculo, anio_vehiculo, color_vehiculo, apodo_vehiculo,
      apellido_paterno, apellido_materno, nombres, email,
      telefono, tipo_sangre, contacto_emergencia, telefono_emergencia,
      ciudad, estado, nacionalidad, fecha_nacimiento,
      contrato_aceptado,
    } = req.body;

    if (!categoria_id || !numero_piloto || !vehiculo) {
      return res.status(400).json({ error: "Campos obligatorios incompletos" });
    }
    if (!etapa_id && !directCampId) {
      return res.status(400).json({ error: "Se requiere etapa_id o campeonato_id" });
    }

    let campId = directCampId;
    let etId   = etapa_id || null;
    if (etapa_id) {
      const [etRow] = await db.query(
        "SELECT campeonato_id, fecha_apertura_inscripcion, fecha_cierre_inscripcion FROM etapas WHERE id = ? AND activo = 1 LIMIT 1",
        [etapa_id]
      );
      if (etRow.length === 0) return res.status(404).json({ error: "Etapa no encontrada" });
      campId = etRow[0].campeonato_id;
      // No usar CURDATE(): el servidor de MySQL puede correr en UTC y desfasar
      // la fecha varias horas respecto a Monterrey (UTC-6 fijo, sin horario de verano).
      const hoyMx = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const { fecha_apertura_inscripcion: apertura, fecha_cierre_inscripcion: cierre } = etRow[0];
      if (apertura && hoyMx < apertura.toISOString().slice(0, 10)) {
        return res.status(403).json({ error: "Las inscripciones para esta etapa aún no abren" });
      }
      if (cierre && hoyMx > cierre.toISOString().slice(0, 10)) {
        return res.status(403).json({ error: "Las inscripciones para esta etapa ya cerraron" });
      }
    }

    const ahora   = new Date();
    const esMarzo = ahora.getMonth() >= 2;

    let piloto = null;
    if (email) {
      const [existentes] = await db.query("SELECT * FROM pilotos WHERE email = ? AND activo = 1 LIMIT 1", [email]);
      if (existentes.length > 0) piloto = existentes[0];
    }

    if (!piloto && numero_piloto) {
      const [numUsado] = await db.query("SELECT id FROM pilotos WHERE numero_piloto = ? LIMIT 1", [numero_piloto]);
      if (numUsado.length > 0) {
        return res.status(409).json({ error: `El número ${numero_piloto} ya está asignado a otro piloto` });
      }
    }

    if (!piloto) {
      if (!apellido_paterno || !nombres || !tipo_sangre) {
        return res.status(400).json({ error: "Apellido paterno, nombre(s) y tipo de sangre requeridos" });
      }
      const nombre_completo = [nombres, apellido_paterno, apellido_materno].filter(Boolean).join(" ");
      const [result] = await db.query(
        `INSERT INTO pilotos
          (apellido_paterno, apellido_materno, nombres, numero_piloto, nombre_completo,
           telefono, email, tipo_sangre, ciudad, estado, nacionalidad, fecha_nacimiento,
           contacto_emergencia, telefono_emergencia)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          apellido_paterno, apellido_materno || null, nombres, numero_piloto || null,
          nombre_completo, telefono || null, email || null, tipo_sangre,
          ciudad || null, estado || null, nacionalidad || "Mexicana", fecha_nacimiento || null,
          contacto_emergencia || null, telefono_emergencia || null,
        ]
      );
      const [nuevo] = await db.query("SELECT * FROM pilotos WHERE id = ? LIMIT 1", [result.insertId]);
      piloto = nuevo[0];
    }

    const piloto_id  = piloto.id;
    const anioActual = ahora.getFullYear();

    const [contratoExiste] = await db.query(
      "SELECT id FROM contratos_anuales WHERE piloto_id = ? AND anio = ? AND activo = 1 LIMIT 1",
      [piloto_id, anioActual]
    );
    const tieneContrato = contratoExiste.length > 0;

    if (esMarzo && !tieneContrato && !contrato_aceptado) {
      return res.status(403).json({
        error: "Debes firmar el contrato anual para continuar.",
        requiere_contrato: true, piloto_id, anio: anioActual,
      });
    }

    if (contrato_aceptado && !tieneContrato) {
      const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").toString().split(",")[0].trim();
      await db.query(
        "INSERT INTO contratos_anuales (piloto_id,anio,ip_firma) VALUES (?,?,?) ON DUPLICATE KEY UPDATE fecha_firma=NOW(), activo=1",
        [piloto_id, anioActual, ip]
      );
    }

    // Sin etapa_id, el UNIQUE KEY (etapa_id, categoria_id, piloto_id) no protege el
    // duplicado porque MySQL trata cada NULL como distinto. Se usa una transacción
    // que primero bloquea la fila del piloto (SELECT ... FOR UPDATE) para serializar
    // dos envíos casi simultáneos del mismo piloto — sin esto, ambos podían pasar el
    // chequeo de "ya estás inscrito" y crear una inscripción duplicada.
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query("SELECT id FROM pilotos WHERE id = ? FOR UPDATE", [piloto_id]);

      const [dup] = etId
        ? await conn.query(
            "SELECT id FROM inscripciones WHERE piloto_id = ? AND etapa_id = ? AND categoria_id = ? LIMIT 1",
            [piloto_id, etId, categoria_id]
          )
        : await conn.query(
            "SELECT id FROM inscripciones WHERE piloto_id = ? AND campeonato_id = ? AND categoria_id = ? AND etapa_id IS NULL LIMIT 1",
            [piloto_id, campId, categoria_id]
          );
      if (dup.length > 0) {
        await conn.rollback();
        return res.status(409).json({ error: "Ya estás inscrito en esta categoría para este campeonato" });
      }

      const [result] = await conn.query(
        `INSERT INTO inscripciones
          (piloto_id, campeonato_id, etapa_id, categoria_id, numero_piloto, vehiculo,
           modelo_vehiculo, anio_vehiculo, color_vehiculo, apodo_vehiculo, auto_registro)
         VALUES (?,?,?,?,?,?,?,?,?,?,1)`,
        [piloto_id, campId, etId, categoria_id, numero_piloto, vehiculo,
         modelo_vehiculo || null, anio_vehiculo || null, color_vehiculo || null, apodo_vehiculo || null]
      );

      const [nueva] = await conn.query(
        `SELECT i.*, p.nombre_completo AS piloto_nombre,
                cat.nombre AS categoria_nombre, camp.nombre AS campeonato_nombre,
                e.nombre AS etapa_nombre
         FROM inscripciones i
         JOIN pilotos   p    ON p.id    = i.piloto_id
         JOIN categorias cat  ON cat.id  = i.categoria_id
         JOIN campeonatos camp ON camp.id = i.campeonato_id
         LEFT JOIN etapas e   ON e.id    = i.etapa_id
         WHERE i.id = ? LIMIT 1`,
        [result.insertId]
      );

      await conn.commit();
      res.status(201).json({
        mensaje: "Pre-inscripción exitosa",
        inscripcion: nueva[0],
        aviso_contrato: (!tieneContrato && !contrato_aceptado) ? { piloto_id, anio: anioActual } : null,
      });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "Ya estás inscrito con esa combinación de etapa y categoría" });
    }
    console.error(err);
    res.status(500).json({ error: "Error en auto-registro" });
  }
});

module.exports = router;

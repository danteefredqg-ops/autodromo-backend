const router = require("express").Router();
const db     = require("../configuracion/db");
const { autenticar } = require("../middleware/auth");

// GET /api/formularios/piloto/:pilotoId
router.get("/piloto/:pilotoId", autenticar, async (req, res) => {
  try {
    const { pilotoId } = req.params;
    const { etapa_id } = req.query;
    const [pilotos] = await db.query("SELECT * FROM pilotos WHERE id = ? AND activo = 1 LIMIT 1", [pilotoId]);
    if (pilotos.length === 0) return res.status(404).json({ error: "Piloto no encontrado" });
    const p = pilotos[0];
    let inscripcion = null;
    if (etapa_id) {
      const [rows] = await db.query(
        `SELECT i.*,
                cat.nombre AS categoria_nombre,
                camp.nombre AS campeonato_nombre,
                e.nombre AS etapa_nombre, e.numero AS etapa_numero, e.fecha AS etapa_fecha, e.ubicacion AS etapa_ubicacion
         FROM inscripciones i
         JOIN categorias cat    ON cat.id  = i.categoria_id
         JOIN campeonatos camp  ON camp.id = i.campeonato_id
         LEFT JOIN etapas e     ON e.id    = i.etapa_id
         WHERE i.piloto_id = ? AND i.etapa_id = ? LIMIT 1`,
        [pilotoId, etapa_id]
      );
      if (rows.length > 0) inscripcion = rows[0];
    }
    res.json({ piloto: p, inscripcion });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener datos para formulario" });
  }
});

// GET /api/formularios/etapa/:etapaId
router.get("/etapa/:etapaId", autenticar, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT i.id AS inscripcion_id, i.numero_piloto, i.vehiculo, i.modelo_vehiculo, i.anio_vehiculo,
              i.estatus, i.metodo_pago, i.monto_pago,
              p.id AS piloto_id, p.nombre_completo, p.apellido_paterno, p.apellido_materno, p.nombres,
              p.tipo_sangre, p.telefono, p.email, p.nacionalidad, p.fecha_nacimiento,
              p.ciudad, p.estado, p.contacto_emergencia, p.telefono_emergencia,
              p.curp, p.escolaridad, p.lugar_nacimiento, p.alergias, p.condiciones_medicas,
              p.comision_nacional, p.nombre_equipo, p.calle, p.colonia, p.cp, p.num_ext, p.num_int,
              p.parentesco_emergencia, p.anio_licencia_anterior, p.numero_licencia,
              cat.nombre AS categoria_nombre, cat.color AS categoria_color,
              camp.nombre AS campeonato_nombre,
              e.nombre AS etapa_nombre, e.numero AS etapa_numero, e.fecha AS etapa_fecha, e.ubicacion AS etapa_ubicacion
       FROM inscripciones i
       JOIN pilotos p         ON p.id    = i.piloto_id
       JOIN categorias cat    ON cat.id  = i.categoria_id
       JOIN campeonatos camp  ON camp.id = i.campeonato_id
       LEFT JOIN etapas e     ON e.id    = i.etapa_id
       WHERE i.etapa_id = ?
       ORDER BY p.apellido_paterno ASC, p.nombres ASC`,
      [req.params.etapaId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener pilotos de la etapa" });
  }
});

module.exports = router;

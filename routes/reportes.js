const router = require("express").Router();
const db     = require("../configuracion/db");
const { autenticar, autorizar } = require("../middleware/auth");

// GET /api/reportes/por-categoria
router.get("/por-categoria", autenticar, async (req, res) => {
  try {
    const { campeonato_id, etapa_id, categoria_id } = req.query;
    if (!campeonato_id && !etapa_id) return res.status(400).json({ error: "campeonato_id o etapa_id requerido" });

    let costoPorInscripcion = 0;
    if (etapa_id) {
      const [etRow] = await db.query("SELECT costo FROM etapas WHERE id = ? LIMIT 1", [etapa_id]);
      if (etRow.length > 0) costoPorInscripcion = parseFloat(etRow[0].costo) || 0;
    }

    let sql = `
      SELECT i.*,
        p.nombre_completo AS piloto_nombre, p.tipo_sangre, p.telefono AS piloto_telefono,
        p.nacionalidad, p.estatus_licencia,
        cat.nombre AS categoria_nombre, cat.color AS categoria_color, cat.descripcion AS categoria_descripcion,
        e.nombre AS etapa_nombre, e.numero AS etapa_numero
      FROM inscripciones i
      JOIN pilotos   p   ON p.id   = i.piloto_id
      JOIN categorias cat ON cat.id = i.categoria_id
      LEFT JOIN etapas e ON e.id   = i.etapa_id
      WHERE 1=1`;
    const params = [];
    if (etapa_id)      { sql += " AND i.etapa_id = ?";      params.push(etapa_id); }
    else if (campeonato_id) { sql += " AND i.campeonato_id = ?"; params.push(campeonato_id); }
    if (categoria_id)  { sql += " AND i.categoria_id = ?";  params.push(categoria_id); }
    sql += " ORDER BY cat.nombre ASC, i.numero_piloto ASC";

    const [rows] = await db.query(sql, params);
    const agrupado = {};
    for (const r of rows) {
      const n = r.categoria_nombre;
      if (!agrupado[n]) {
        agrupado[n] = {
          categoria: { nombre: n, color: r.categoria_color, descripcion: r.categoria_descripcion },
          pilotos: [], total: 0, pagados: 0,
          costo: costoPorInscripcion, total_esperado: 0, total_cobrado: 0,
        };
      }
      agrupado[n].pilotos.push(r);
      agrupado[n].total++;
      agrupado[n].total_esperado = agrupado[n].total * costoPorInscripcion;
      if (r.estatus === "Pagado") {
        agrupado[n].pagados++;
        agrupado[n].total_cobrado += parseFloat(r.monto_pago) || costoPorInscripcion;
      }
    }
    res.json({ agrupado, total: rows.length, costo_etapa: costoPorInscripcion });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al generar reporte" });
  }
});

// GET /api/reportes/corte-general
router.get("/corte-general", autenticar, autorizar("admin", "inscripciones"), async (req, res) => {
  try {
    const { campeonato_id, etapa_id, todos } = req.query;
    if (!campeonato_id && !etapa_id && !todos) return res.status(400).json({ error: "campeonato_id, etapa_id o todos=true requerido" });

    let etapaInfo = null;
    let campInfo  = null;
    let costoPorInscripcion = 0;

    if (etapa_id) {
      const [et] = await db.query(
        `SELECT e.*, camp.nombre AS campeonato_nombre
         FROM etapas e JOIN campeonatos camp ON camp.id = e.campeonato_id
         WHERE e.id = ? LIMIT 1`,
        [etapa_id]
      );
      if (et.length === 0) return res.status(404).json({ error: "Etapa no encontrada" });
      etapaInfo = et[0];
      costoPorInscripcion = parseFloat(etapaInfo.costo) || 0;
    }
    if (campeonato_id) {
      const [camp] = await db.query("SELECT * FROM campeonatos WHERE id = ? LIMIT 1", [campeonato_id]);
      if (camp.length === 0) return res.status(404).json({ error: "Campeonato no encontrado" });
      campInfo = camp[0];
    }

    let sql = `
      SELECT i.*, p.nombre_completo AS piloto_nombre, p.tipo_sangre, p.telefono AS piloto_telefono,
             cat.nombre AS categoria_nombre, cat.color AS categoria_color,
             e.nombre AS etapa_nombre, e.numero AS etapa_numero,
             camp.nombre AS campeonato_nombre_completo
      FROM inscripciones i
      JOIN pilotos    p    ON p.id    = i.piloto_id
      JOIN categorias cat  ON cat.id  = i.categoria_id
      LEFT JOIN etapas e   ON e.id    = i.etapa_id
      LEFT JOIN campeonatos camp ON camp.id = i.campeonato_id
      WHERE 1=1`;
    const params = [];
    if (etapa_id)      { sql += " AND i.etapa_id = ?";      params.push(etapa_id); }
    else if (campeonato_id) { sql += " AND i.campeonato_id = ?"; params.push(campeonato_id); }
    sql += " ORDER BY i.campeonato_id ASC, i.etapa_id ASC, i.numero_piloto ASC";

    const [inscripciones] = await db.query(sql, params);
    const pagados      = inscripciones.filter(r => r.estatus === "Pagado");
    const pendientes   = inscripciones.filter(r => r.estatus !== "Pagado" && r.estatus !== "Descalificado");
    const efectivo     = pagados.filter(r => r.metodo_pago === "Efectivo");
    const transferencia = pagados.filter(r => r.metodo_pago === "Transferencia");
    const ingresos     = pagados.reduce((s, r) => s + (parseFloat(r.monto_pago) || costoPorInscripcion), 0);
    const esperado     = inscripciones.length * costoPorInscripcion;

    const por_categoria = {};
    for (const r of inscripciones) {
      const n = r.categoria_nombre;
      if (!por_categoria[n]) {
        por_categoria[n] = { categoria: { nombre: n, color: r.categoria_color }, total: 0, pagados: 0 };
      }
      por_categoria[n].total++;
      if (r.estatus === "Pagado") por_categoria[n].pagados++;
    }

    res.json({
      campeonato:  campInfo || (etapaInfo ? { nombre: etapaInfo.campeonato_nombre } : null),
      etapa:       etapaInfo,
      costo:       costoPorInscripcion,
      resumen: {
        total: inscripciones.length, pagados: pagados.length, pendientes: pendientes.length,
        efectivo: efectivo.length, transferencia: transferencia.length, ingresos, esperado,
      },
      por_categoria,
      inscripciones,
      generado_en:  new Date(),
      generado_por: req.usuario.username,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al generar corte" });
  }
});

module.exports = router;

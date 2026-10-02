const router = require("express").Router();
const db     = require("../configuracion/db");
const { autenticar, autorizar } = require("../middleware/auth");

// Costo de una inscripción: el mismo criterio que GET /api/inscripciones (y el
// que ve el staff al cobrar). El costo dejó de capturarse por etapa y ahora va
// por categoría del campeonato; los reportes seguían leyendo solo etapas.costo,
// así que el "esperado" salía en $0 y los pagos sin monto capturado no sumaban.
const COSTO_INSCRIPCION_SQL = "COALESCE(cc.costo, cat.costo_default, e.costo, 0)";
const JOIN_COSTO_SQL = "LEFT JOIN campeonato_categorias cc ON cc.campeonato_id = i.campeonato_id AND cc.categoria_id = i.categoria_id";

// Lo que realmente entró a caja por una inscripción pagada. Un monto de 0 es
// válido (Intercambio sin costo) — solo un monto NULL cae al costo de lista.
const montoCobrado = (r) => (r.monto_pago !== null && r.monto_pago !== undefined)
  ? parseFloat(r.monto_pago) : parseFloat(r.costo_inscripcion) || 0;
// Un descalificado no se espera que pague (igual que no cuenta como pendiente).
const montoEsperado = (r) => (r.estatus === "Descalificado" ? 0 : parseFloat(r.costo_inscripcion) || 0);

// GET /api/reportes/por-categoria — incluye montos/método de pago por piloto,
// igual que corte-general: debe llevar la misma restricción de rol para que
// torre (solo lectura de pista) no tenga acceso a cifras de caja por otra puerta.
router.get("/por-categoria", autenticar, autorizar("admin", "inscripciones"), async (req, res) => {
  try {
    const { campeonato_id, etapa_id, categoria_id, todos } = req.query;
    if (!campeonato_id && !etapa_id && !todos) return res.status(400).json({ error: "campeonato_id, etapa_id o todos=true requerido" });

    let sql = `
      SELECT i.*,
        p.nombre_completo AS piloto_nombre, p.tipo_sangre, p.telefono AS piloto_telefono,
        p.nacionalidad, p.estatus_licencia,
        cat.nombre AS categoria_nombre, cat.color AS categoria_color, cat.descripcion AS categoria_descripcion,
        e.nombre AS etapa_nombre, e.numero AS etapa_numero,
        ${COSTO_INSCRIPCION_SQL} AS costo_inscripcion
      FROM inscripciones i
      JOIN pilotos   p   ON p.id   = i.piloto_id
      JOIN categorias cat ON cat.id = i.categoria_id
      LEFT JOIN etapas e ON e.id   = i.etapa_id
      ${JOIN_COSTO_SQL}
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
      const costo = parseFloat(r.costo_inscripcion) || 0;
      if (!agrupado[n]) {
        agrupado[n] = {
          categoria: { nombre: n, color: r.categoria_color, descripcion: r.categoria_descripcion },
          pilotos: [], total: 0, pagados: 0,
          costo, total_esperado: 0, total_cobrado: 0,
        };
      }
      const g = agrupado[n];
      // Con "todos los campeonatos" una misma categoría puede tener precios
      // distintos por campeonato: en ese caso no hay un costo único que mostrar.
      if (g.costo !== costo) g.costo = null;
      g.pilotos.push(r);
      g.total++;
      g.total_esperado += montoEsperado(r);
      if (r.estatus === "Pagado") {
        g.pagados++;
        g.total_cobrado += montoCobrado(r);
      }
    }
    res.json({ agrupado, total: rows.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al generar reporte" });
  }
});

// GET /api/reportes/corte-general
router.get("/corte-general", autenticar, autorizar("admin", "inscripciones"), async (req, res) => {
  try {
    const { campeonato_id, etapa_id, categoria_id, todos } = req.query;
    if (!campeonato_id && !etapa_id && !todos) return res.status(400).json({ error: "campeonato_id, etapa_id o todos=true requerido" });

    let etapaInfo = null;
    let campInfo  = null;

    if (etapa_id) {
      const [et] = await db.query(
        `SELECT e.*, camp.nombre AS campeonato_nombre
         FROM etapas e JOIN campeonatos camp ON camp.id = e.campeonato_id
         WHERE e.id = ? LIMIT 1`,
        [etapa_id]
      );
      if (et.length === 0) return res.status(404).json({ error: "Etapa no encontrada" });
      etapaInfo = et[0];
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
             camp.nombre AS campeonato_nombre_completo,
             ${COSTO_INSCRIPCION_SQL} AS costo_inscripcion
      FROM inscripciones i
      JOIN pilotos    p    ON p.id    = i.piloto_id
      JOIN categorias cat  ON cat.id  = i.categoria_id
      LEFT JOIN etapas e   ON e.id    = i.etapa_id
      LEFT JOIN campeonatos camp ON camp.id = i.campeonato_id
      ${JOIN_COSTO_SQL}
      WHERE 1=1`;
    const params = [];
    if (etapa_id)      { sql += " AND i.etapa_id = ?";      params.push(etapa_id); }
    else if (campeonato_id) { sql += " AND i.campeonato_id = ?"; params.push(campeonato_id); }
    // El selector de categoría de la pantalla de reportes también se manda aquí;
    // antes se ignoraba y el corte "de una categoría" sumaba todas.
    if (categoria_id)  { sql += " AND i.categoria_id = ?";  params.push(categoria_id); }
    sql += " ORDER BY i.campeonato_id ASC, i.etapa_id ASC, i.numero_piloto ASC";

    const [inscripciones] = await db.query(sql, params);
    const pagados      = inscripciones.filter(r => r.estatus === "Pagado");
    const pendientes   = inscripciones.filter(r => r.estatus !== "Pagado" && r.estatus !== "Descalificado");
    const efectivo     = pagados.filter(r => r.metodo_pago === "Efectivo");
    const transferencia = pagados.filter(r => r.metodo_pago === "Transferencia");
    const intercambio  = pagados.filter(r => r.metodo_pago === "Intercambio");
    const ingresos     = pagados.reduce((s, r) => s + montoCobrado(r), 0);
    const ingresosEfectivo = efectivo.reduce((s, r) => s + montoCobrado(r), 0);
    const esperado     = inscripciones.reduce((s, r) => s + montoEsperado(r), 0);

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
      resumen: {
        total: inscripciones.length, pagados: pagados.length, pendientes: pendientes.length,
        efectivo: efectivo.length, transferencia: transferencia.length, intercambio: intercambio.length,
        ingresos, ingresosEfectivo, esperado,
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

// GET /api/reportes/clasificacion
router.get("/clasificacion", autenticar, async (req, res) => {
  try {
    const { campeonato_id, categoria_id } = req.query;
    if (!campeonato_id || !categoria_id) return res.status(400).json({ error: "campeonato_id y categoria_id requeridos" });
    const [rows] = await db.query(
      `SELECT p.id, p.nombre_completo, p.numero_piloto,
              COALESCE(SUM(r.puntos), 0) AS puntos_totales,
              COUNT(r.id) AS carreras_corridas,
              COALESCE(SUM(CASE WHEN r.posicion = 1 THEN 1 ELSE 0 END), 0) AS victorias,
              MIN(r.posicion) AS mejor_posicion
       FROM resultados r
       JOIN etapas e ON e.id = r.etapa_id
       JOIN pilotos p ON p.id = r.piloto_id
       WHERE e.campeonato_id = ? AND r.categoria_id = ?
       GROUP BY p.id
       ORDER BY puntos_totales DESC, victorias DESC`,
      [campeonato_id, categoria_id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener clasificación" });
  }
});

module.exports = router;

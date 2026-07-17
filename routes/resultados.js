const router = require("express").Router();
const db     = require("../configuracion/db");
const { autenticar, autorizar } = require("../middleware/auth");

const PUNTOS_POS = [0, 25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
function puntosParaPosicion(pos, estatus) {
  if (estatus && estatus !== "Finalizado") return 0;
  return PUNTOS_POS[pos] ?? 0;
}

// POST /api/resultados
router.post("/", autenticar, autorizar("admin", "inscripciones"), async (req, res) => {
  try {
    const { etapa_id, categoria_id, resultados } = req.body;
    if (!etapa_id || !categoria_id || !Array.isArray(resultados)) {
      return res.status(400).json({ error: "Datos incompletos" });
    }

    const posicionesUsadas = new Set();
    const pilotosUsados = new Set();
    for (const r of resultados) {
      if (!r.piloto_id) return res.status(400).json({ error: "piloto_id requerido en cada resultado" });
      if (pilotosUsados.has(r.piloto_id)) {
        return res.status(400).json({ error: `piloto_id ${r.piloto_id} está duplicado en el envío` });
      }
      pilotosUsados.add(r.piloto_id);
      const estatus = r.estatus || "Finalizado";
      if (!["Finalizado", "DNF", "DSQ"].includes(estatus)) {
        return res.status(400).json({ error: `estatus inválido para piloto_id ${r.piloto_id}` });
      }
      if (estatus === "Finalizado") {
        const pos = Number(r.posicion);
        if (!r.posicion || !Number.isInteger(pos) || pos < 1) {
          return res.status(400).json({ error: `posición requerida y debe ser un entero positivo (piloto_id ${r.piloto_id})` });
        }
        if (posicionesUsadas.has(pos)) {
          return res.status(400).json({ error: `posición ${pos} está duplicada` });
        }
        posicionesUsadas.add(pos);
      }
    }

    const pilotoIds = resultados.map(r => r.piloto_id);
    if (pilotoIds.length > 0) {
      const [validos] = await db.query(
        `SELECT piloto_id FROM inscripciones
         WHERE etapa_id = ? AND categoria_id = ? AND estatus = 'Pagado' AND piloto_id IN (?)`,
        [etapa_id, categoria_id, pilotoIds]
      );
      const validosSet = new Set(validos.map(v => v.piloto_id));
      const invalido = pilotoIds.find(id => !validosSet.has(id));
      if (invalido) {
        return res.status(400).json({ error: `piloto_id ${invalido} no tiene inscripción Pagado en esta etapa/categoría` });
      }
    }

    // DELETE+INSERT dentro de una transacción: si dos envíos para la misma
    // etapa+categoría llegan casi simultáneos, uno espera al otro en vez de
    // entrelazarse y perder/duplicar resultados.
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query("DELETE FROM resultados WHERE etapa_id = ? AND categoria_id = ?", [etapa_id, categoria_id]);
      if (resultados.length > 0) {
        const vals = resultados.map(r => {
          const estatus = r.estatus || "Finalizado";
          const posicion = estatus === "Finalizado" ? Number(r.posicion) : null;
          return [
            etapa_id, categoria_id, r.piloto_id, posicion, estatus,
            r.tiempo_vuelta || null, puntosParaPosicion(posicion, estatus), r.notas || null,
          ];
        });
        await conn.query(
          "INSERT INTO resultados (etapa_id,categoria_id,piloto_id,posicion,estatus,tiempo_vuelta,puntos,notas) VALUES ?",
          [vals]
        );
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
    res.json({ mensaje: `${resultados.length} resultado(s) guardados` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al guardar resultados" });
  }
});

// GET /api/resultados
router.get("/", autenticar, async (req, res) => {
  try {
    const { etapa_id, categoria_id } = req.query;
    if (!etapa_id || !categoria_id) return res.status(400).json({ error: "etapa_id y categoria_id requeridos" });
    const [rows] = await db.query(
      `SELECT r.*, p.nombre_completo, p.numero_piloto
       FROM resultados r JOIN pilotos p ON p.id = r.piloto_id
       WHERE r.etapa_id = ? AND r.categoria_id = ?
       ORDER BY (r.posicion IS NULL) ASC, r.posicion ASC`,
      [etapa_id, categoria_id]
    );
    res.json(rows);
  } catch { res.status(500).json({ error: "Error al obtener resultados" }); }
});

module.exports = router;

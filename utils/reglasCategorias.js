// utils/reglasCategorias.js — reglas por categoría al inscribir:
//   - edad_minima / edad_maxima: edad del piloto el día de la carrera (fecha de
//     la etapa; si la inscripción es a nivel campeonato, el día de hoy).
//   - exclusiva: quien corre en ella no puede estar en otra categoría de la
//     misma etapa (p.ej. Junior Dragster: un menor no corre además en una
//     categoría de adultos).
// Las aplican tanto el auto-registro público como la inscripción desde el
// dashboard, dentro de la misma transacción que inserta (ver inscripciones.js).

// Fecha → "AAAA-MM-DD". mysql2 entrega DATE como objeto Date (medianoche del
// servidor, que en Railway es UTC); los formularios la mandan como texto.
function aFechaISO(valor) {
  if (!valor) return null;
  if (valor instanceof Date) return isNaN(valor) ? null : valor.toISOString().slice(0, 10);
  const s = String(valor).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

// Años cumplidos en fechaRef (ambas "AAAA-MM-DD").
function edadEn(fechaNacimiento, fechaRef) {
  const [an, mn, dn] = fechaNacimiento.split("-").map(Number);
  const [ar, mr, dr] = fechaRef.split("-").map(Number);
  let edad = ar - an;
  if (mr < mn || (mr === mn && dr < dn)) edad--;
  return edad;
}

const { hoyMx } = require("./fechas");

// Devuelve un mensaje de error (string) si alguna regla no se cumple, o null.
//   conn            conexión/pool con .query (usar la de la transacción)
//   pilotoId        piloto que se inscribe
//   fechaNacimiento fecha de nacimiento del piloto (Date o texto) o null
//   categoriaIds    categorías que se quieren agregar ahora
//   etapaId/campId  dónde se inscribe (etapaId null = a nivel campeonato)
//   fechaCarrera    fecha de la etapa (Date o texto) o null
async function validarReglasCategorias(conn, { pilotoId, fechaNacimiento, categoriaIds, etapaId, campId, fechaCarrera }) {
  if (!categoriaIds.length) return null;
  const [cats] = await conn.query(
    "SELECT id, nombre, edad_minima, edad_maxima, exclusiva FROM categorias WHERE id IN (?)", [categoriaIds]
  );

  // ── Edad ──
  const conLimite = cats.filter(c => c.edad_minima != null || c.edad_maxima != null);
  if (conLimite.length) {
    const nacimiento = aFechaISO(fechaNacimiento);
    if (!nacimiento) {
      return `La categoría ${conLimite[0].nombre} tiene límite de edad: necesitamos tu fecha de nacimiento. ` +
        "Agrégala en tu perfil del portal o pide ayuda en ventanilla.";
    }
    const referencia = aFechaISO(fechaCarrera) || hoyMx();
    const edad = edadEn(nacimiento, referencia);
    for (const c of conLimite) {
      if (c.edad_maxima != null && edad > c.edad_maxima) {
        return `La categoría ${c.nombre} es para pilotos de hasta ${c.edad_maxima} años (el día de la carrera tendrás ${edad}).`;
      }
      if (c.edad_minima != null && edad < c.edad_minima) {
        return `La categoría ${c.nombre} es para pilotos de ${c.edad_minima} años o más (el día de la carrera tendrás ${edad}).`;
      }
    }
  }

  // ── Categoría exclusiva ──
  // Se juntan las que ya tiene en esta etapa con las nuevas: si en el total hay
  // una exclusiva y más de una categoría, no se permite.
  const [yaInscrito] = etapaId
    ? await conn.query(
        `SELECT cat.id, cat.nombre, cat.exclusiva FROM inscripciones i JOIN categorias cat ON cat.id = i.categoria_id
         WHERE i.piloto_id = ? AND i.etapa_id = ?`, [pilotoId, etapaId])
    : await conn.query(
        `SELECT cat.id, cat.nombre, cat.exclusiva FROM inscripciones i JOIN categorias cat ON cat.id = i.categoria_id
         WHERE i.piloto_id = ? AND i.campeonato_id = ? AND i.etapa_id IS NULL`, [pilotoId, campId]);
  const total = new Map([...yaInscrito, ...cats].map(c => [c.id, c]));
  if (total.size > 1) {
    const exclusiva = [...total.values()].find(c => c.exclusiva);
    if (exclusiva) {
      const otras = [...total.values()].filter(c => c.id !== exclusiva.id).map(c => c.nombre).join(", ");
      return `Quien corre en ${exclusiva.nombre} no puede inscribirse en otra categoría de la misma etapa (${otras}).`;
    }
  }
  return null;
}

// Valida los campos de reglas que manda el admin al crear/editar una categoría.
// Devuelve { error } o { valores: { edad_minima, edad_maxima, exclusiva } }.
function leerReglasCategoria(body) {
  const edad = (v) => {
    if (v === undefined || v === null || v === "") return null;
    const n = Number(v);
    return Number.isInteger(n) && n >= 0 && n <= 99 ? n : NaN;
  };
  const edad_minima = edad(body.edad_minima);
  const edad_maxima = edad(body.edad_maxima);
  if (Number.isNaN(edad_minima) || Number.isNaN(edad_maxima)) return { error: "Las edades deben ser números enteros entre 0 y 99" };
  if (edad_minima != null && edad_maxima != null && edad_minima > edad_maxima) {
    return { error: "La edad mínima no puede ser mayor que la máxima" };
  }
  return { valores: { edad_minima, edad_maxima, exclusiva: body.exclusiva ? 1 : 0 } };
}

module.exports = { validarReglasCategorias, leerReglasCategoria, edadEn, aFechaISO };

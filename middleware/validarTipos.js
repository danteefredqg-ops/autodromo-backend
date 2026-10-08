// middleware/validarTipos.js — filtro de tipos para todo body JSON, antes de
// llegar a las rutas. Las rutas asumen que el texto es texto (hacen .trim(),
// .length, bcrypt.hash…): un atacante que mandaba `"password": true` o
// `"nombre": {"a":1}` provocaba un error 500 en vez de un 400. Encontrado con
// un fuzzer contra las 68 rutas (test/fuzz-rutas.js).
//
// Reglas, por nombre de campo:
//   - Arreglos: solo en ARREGLOS, con elementos primitivos u objetos planos de
//     valores primitivos (p.ej. resultados: [{piloto_id, posicion, ...}]).
//   - Booleanos: solo en BOOLEANOS.
//   - Números: en campos numéricos se aceptan número o texto; en campos de
//     texto un número se convierte a texto ("8112345678" vs 8112345678).
//   - Objetos sueltos: nunca.
const ARREGLOS  = new Set(["categoria_ids", "categorias", "resultados"]);
const BOOLEANOS = new Set(["contrato_aceptado", "exclusiva"]);
const NUMERICOS_EXACTOS = new Set([
  "numero", "numero_piloto", "numero_piloto_anterior", "monto_pago", "anio", "anio_vehiculo",
  "anio_licencia_anterior", "anio_inicio_autodromo", "edad_minima", "edad_maxima", "orden",
  "costo", "costo_default", "posicion",
]);
const esNumerico = (campo) => campo === "id" || campo.endsWith("_id") || NUMERICOS_EXACTOS.has(campo);

const esPrimitivo = (v) => v === null || ["string", "number", "boolean"].includes(typeof v);
const esObjetoPlano = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

function errorDeCampo(campo, valor) {
  if (valor === null || valor === undefined) return null;
  if (Array.isArray(valor)) {
    if (!ARREGLOS.has(campo)) return `${campo} no puede ser una lista`;
    const elementoMalo = valor.find(el => !(esPrimitivo(el) || (esObjetoPlano(el) && Object.values(el).every(esPrimitivo))));
    return elementoMalo === undefined ? null : `${campo} contiene un valor inválido`;
  }
  if (esObjetoPlano(valor)) return `${campo} tiene un formato inválido`;
  if (typeof valor === "boolean" && !BOOLEANOS.has(campo)) return `${campo} tiene un formato inválido`;
  if (typeof valor === "number" && !Number.isFinite(valor)) return `${campo} no es un número válido`;
  return null;
}

function validarTipos(req, res, next) {
  const body = req.body;
  if (!esObjetoPlano(body)) {
    // express.json acepta también un arreglo o un valor suelto como cuerpo.
    if (body === undefined || (typeof body === "object" && body !== null && Object.keys(body).length === 0)) return next();
    return res.status(400).json({ error: "El cuerpo de la petición debe ser un objeto JSON" });
  }
  for (const [campo, valor] of Object.entries(body)) {
    const error = errorDeCampo(campo, valor);
    if (error) return res.status(400).json({ error });
    // Texto que llegó como número: se pasa a texto para que .trim()/.length funcionen.
    if (typeof valor === "number" && !esNumerico(campo) && !BOOLEANOS.has(campo)) body[campo] = String(valor);
  }
  next();
}

module.exports = { validarTipos };

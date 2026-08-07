// utils/validadores.js — reglas de formato compartidas entre rutas

// Teléfono mexicano: exactamente 10 dígitos, sin importar cómo lo haya
// escrito el usuario (con espacios, guiones o paréntesis) — se limpia antes
// de contar. No usar para exigir teléfono siempre: solo valida el formato
// SI el valor viene presente (el caller decide si es obligatorio o no).
function telefonoValido(tel) {
  if (!tel) return true;
  return /^\d{10}$/.test(String(tel).replace(/[\s\-()]/g, ""));
}

function limpiarTelefono(tel) {
  return tel ? String(tel).replace(/[\s\-()]/g, "") : tel;
}

// CURP oficial (18 caracteres): 4 letras, 6 dígitos de nacimiento (AAMMDD),
// sexo H/M, entidad de nacimiento (o NE/extranjero), 3 consonantes internas,
// y los 2 caracteres de homoclave/dígito verificador.
const CURP_REGEX = /^[A-Z][AEIOUX][A-Z]{2}\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])[HM](AS|BC|BS|CC|CL|CM|CS|DF|DG|GT|GR|HG|JC|MC|MN|MS|NT|NL|OC|PL|QO|QR|SP|SL|SR|TC|TS|TL|VZ|YN|ZS|NE)[B-DF-HJ-NP-TV-Z]{3}[A-Z\d][0-9]$/;

function curpValido(curp) {
  if (!curp) return true;
  return CURP_REGEX.test(String(curp).trim().toUpperCase());
}

module.exports = { telefonoValido, limpiarTelefono, curpValido, CURP_REGEX };

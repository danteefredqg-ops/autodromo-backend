// test/validadores.test.js — pruebas unitarias de utils/validadores.js
// Corre con: node --test test/validadores.test.js
// No necesita base de datos ni red — son funciones puras.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  telefonoValido, limpiarTelefono, curpValido, vehiculoValido,
} = require("../utils/validadores");

test("telefonoValido — acepta 10 dígitos exactos", () => {
  assert.equal(telefonoValido("8112345678"), true);
});
test("telefonoValido — acepta con espacios/guiones/paréntesis y los ignora", () => {
  assert.equal(telefonoValido("(811) 234-5678"), true);
  assert.equal(telefonoValido("811 234 5678"), true);
});
test("telefonoValido — rechaza menos de 10 dígitos", () => {
  assert.equal(telefonoValido("811234567"), false);
});
test("telefonoValido — rechaza más de 10 dígitos", () => {
  assert.equal(telefonoValido("81123456789"), false);
});
test("telefonoValido — rechaza letras", () => {
  assert.equal(telefonoValido("811234567a"), false);
});
test("telefonoValido — vacío/undefined se considera válido (campo opcional, el caller exige presencia si aplica)", () => {
  assert.equal(telefonoValido(""), true);
  assert.equal(telefonoValido(undefined), true);
  assert.equal(telefonoValido(null), true);
});
test("limpiarTelefono — quita espacios, guiones y paréntesis", () => {
  assert.equal(limpiarTelefono("(811) 234-5678"), "8112345678");
});

test("curpValido — acepta un CURP con formato oficial válido", () => {
  assert.equal(curpValido("VECJ880326HDFRRR05"), true);
});
test("curpValido — rechaza longitud incorrecta", () => {
  assert.equal(curpValido("VECJ880326HDF"), false);
});
test("curpValido — rechaza mes inválido (13)", () => {
  assert.equal(curpValido("VECJ881326HDFRRR05"), false);
});
test("curpValido — rechaza día inválido (32)", () => {
  assert.equal(curpValido("VECJ880332HDFRRR05"), false);
});
test("curpValido — rechaza sexo inválido (ni H ni M)", () => {
  assert.equal(curpValido("VECJ880326XDFRRR05"), false);
});
test("curpValido — no distingue mayúsculas/minúsculas ni espacios extra", () => {
  assert.equal(curpValido("  vecj880326hdfrrr05  "), true);
});
test("curpValido — vacío se considera válido (campo opcional)", () => {
  assert.equal(curpValido(""), true);
});

test("vehiculoValido — acepta marcas de vehículos motorizados normales", () => {
  assert.equal(vehiculoValido("Honda"), true);
  assert.equal(vehiculoValido("Tony Kart"), true);
  assert.equal(vehiculoValido("Ford Mustang"), true);
});
test("vehiculoValido — rechaza bicicleta (con y sin acento, mayúsculas)", () => {
  assert.equal(vehiculoValido("bicicleta"), false);
  assert.equal(vehiculoValido("Bicicleta"), false);
  assert.equal(vehiculoValido("BICI"), false);
});
test("vehiculoValido — rechaza cosas sin motor / no terrestres", () => {
  assert.equal(vehiculoValido("Avión"), false);
  assert.equal(vehiculoValido("avion"), false);
  assert.equal(vehiculoValido("Dron DJI"), false);
  assert.equal(vehiculoValido("Helicóptero"), false);
  assert.equal(vehiculoValido("Patín del diablo"), false);
});
test("vehiculoValido — no debe dar falso positivo con marcas parecidas", () => {
  // Asegura que el chequeo es por palabra completa, no por substring
  assert.equal(vehiculoValido("Triciclosa Racing"), true, "no debe bloquear por contener 'ciclo' como parte de otra palabra");
});
test("vehiculoValido — vacío se considera válido (el caller exige presencia si aplica)", () => {
  assert.equal(vehiculoValido(""), true);
});

// test/frontend-estatico.test.js — revisiones de caja negra sobre el HTML del
// frontend (repo hermano ../frontend). No levanta un navegador: reproduce lo
// que hace el navegador con un atributo onclick (decodificar entidades HTML y
// luego interpretar el resultado como JavaScript) para atrapar inyecciones.
// Corre con: node --test test/frontend-estatico.test.js
"use strict";

const test   = require("node:test");
const assert = require("node:assert/strict");
const fs     = require("fs");
const path   = require("path");
const vm     = require("vm");

const FRONTEND = path.join(__dirname, "..", "..", "frontend");
const hayFrontend = fs.existsSync(path.join(FRONTEND, "admin", "config.js"));
const leer = (rel) => fs.readFileSync(path.join(FRONTEND, rel), "utf8");

// esc() real del frontend, cargado desde admin/config.js.
function cargarEsc() {
  const src = leer("admin/config.js");
  const inicio = src.indexOf("function esc(");
  const fin = src.indexOf("\n}", inicio) + 2;
  const ctx = {};
  vm.runInNewContext(src.slice(inicio, fin) + "\nthis.esc = esc;", ctx);
  return ctx.esc;
}

// Lo que hace el navegador con el valor de un atributo antes de ejecutarlo.
const decodificarAtributo = (s) => s
  .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">").replace(/&amp;/g, "&");

test("pilotos.html: un nombre con comillas no inyecta JavaScript en el visor de foto", { skip: !hayFrontend }, () => {
  const esc = cargarEsc();
  const nombre = "x');globalThis.inyectado=true;//";
  const html = leer("dashboard/pilotos.html");

  // El onclick del avatar ya no debe armar código JS con el nombre adentro.
  assert.ok(!/verFotoGrande\('\$\{/.test(html), "el onclick no debe interpolar texto libre dentro del JS");
  assert.match(html, /data-nombre="\$\{esc\(p\.nombre_completo\)\}"/);

  // Y el patrón anterior sí era explotable: esto documenta por qué.
  const viejo = `verFotoGrande('/f.jpg','${esc(nombre).replace(/'/g, "\\'")}')`;
  const ctx = { verFotoGrande() {}, globalThis: null };
  ctx.globalThis = ctx;
  vm.runInNewContext(decodificarAtributo(viejo), ctx);
  assert.equal(ctx.inyectado, true, "el patrón anterior ejecutaba código del nombre");
});

test("campeonatos.html: los botones de etapa solo pasan ids (una descripción multilínea no los rompe)", { skip: !hayFrontend }, () => {
  const html = leer("dashboard/campeonatos.html");
  assert.match(html, /onclick="editarEtapaPorId\(\$\{campId\},\$\{e\.id\}\)"/);
  assert.match(html, /onclick="eliminarEtapa\(\$\{campId\},\$\{e\.id\}\)"/);
  assert.ok(!/e\.descripcion\|\|''\)\.replace/.test(html), "la descripción ya no se mete en el onclick");

  // Una descripción con salto de línea dentro de un literal JS era un SyntaxError.
  assert.throws(() => new vm.Script("editarEtapa(1,2,'línea 1\nlínea 2')"), SyntaxError);
});

test("ningún onclick del dashboard interpola nombre/descripción/ubicación", { skip: !hayFrontend }, () => {
  const dir = path.join(FRONTEND, "dashboard");
  for (const archivo of fs.readdirSync(dir).filter(f => f.endsWith(".html"))) {
    const html = fs.readFileSync(path.join(dir, archivo), "utf8");
    const malos = html.match(/onclick="[^"]*\$\{[^}]*(nombre|descripcion|ubicacion)[^}]*\}[^"]*"/g) || [];
    assert.deepEqual(malos, [], `${archivo} interpola texto libre en un onclick`);
  }
});

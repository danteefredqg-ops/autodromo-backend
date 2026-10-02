// test/imagenes.test.js — imágenes de registro (admin las sube y asigna a
// campeonato/etapa; el registro público y el portal del piloto las muestran).
// Corre con: node --test test/imagenes.test.js
"use strict";

const test   = require("node:test");
const assert = require("node:assert/strict");
const fs     = require("fs");
const path   = require("path");
const h      = require("./helpers/app-prueba");
const { REGISTRO_DIR } = require("../configuracion/uploads");

const ADMIN = () => h.tokenSistema("admin");
// PNG de 1×1 píxel, suficiente para pasar el filtro de tipo.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
const esperar = (ms) => new Promise(ok => setTimeout(ok, ms)); // fs.unlink del servidor es asíncrono

let antes;
test.before(async () => { await h.iniciar(); antes = new Set(fs.readdirSync(REGISTRO_DIR)); });
test.after(async () => {
  // No dejar archivos de prueba en la carpeta de uploads.
  for (const f of fs.readdirSync(REGISTRO_DIR)) if (!antes.has(f)) fs.unlinkSync(path.join(REGISTRO_DIR, f));
  await h.detener();
});

const nuevosArchivos = () => fs.readdirSync(REGISTRO_DIR).filter(f => !antes.has(f));

async function subir({ token = ADMIN(), tipo = "image/png", contenido = PNG, campos = {} } = {}) {
  const fd = new FormData();
  fd.append("imagen", new Blob([contenido], { type: tipo }), "foto.png");
  for (const [k, v] of Object.entries({ campeonato_id: "1", ...campos })) fd.append(k, v);
  const base = await h.iniciar();
  const res = await fetch(`${base}/imagenes-registro`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd });
  return { status: res.status, data: await res.json().catch(() => null) };
}

function bdCampeonato({ etapaValida = true } = {}) {
  return (sql) => {
    if (/SELECT id FROM campeonatos WHERE id = \? AND activo = 1/.test(sql)) return [{ id: 1 }];
    if (/SELECT id FROM etapas WHERE id = \? AND campeonato_id = \?/.test(sql)) return etapaValida ? [{ id: 3 }] : [];
    if (/MAX\(orden\)/.test(sql)) return [{ sig: 1 }];
    if (/INSERT INTO imagenes_registro/.test(sql)) return { insertId: 9, affectedRows: 1 };
    if (/WHERE img.id = \?/.test(sql)) return [{ id: 9, campeonato_id: 1, etapa_id: null, archivo: "/uploads/registro/x.png" }];
  };
}

test("Imágenes: el público ve las del campeonato y, al elegir etapa, también las de esa etapa", async () => {
  h.reiniciar((sql) => (/FROM imagenes_registro/.test(sql) ? [{ id: 1, archivo: "/uploads/registro/a.png" }] : undefined));
  assert.equal((await h.pedir("GET", "/imagenes-registro")).status, 400, "requiere campeonato_id");

  const r = await h.pedir("GET", "/imagenes-registro?campeonato_id=1");
  assert.equal(r.status, 200);
  let [q] = h.buscar(/FROM imagenes_registro/);
  assert.match(q.sql, /img\.etapa_id IS NULL\)/);
  assert.match(q.sql, /c\.activo = 1/, "un campeonato eliminado no muestra imágenes");

  h.reiniciar((sql) => (/FROM imagenes_registro/.test(sql) ? [] : undefined));
  await h.pedir("GET", "/imagenes-registro?campeonato_id=1&etapa_id=3");
  [q] = h.buscar(/FROM imagenes_registro/);
  assert.match(q.sql, /img\.etapa_id IS NULL OR img\.etapa_id = \?/);
  assert.deepEqual(q.params, ["1", "3"]);
});

test("Imágenes: solo admin sube, cambia o elimina (staff, torre y público no)", async () => {
  h.reiniciar(bdCampeonato());
  for (const token of [h.tokenSistema("inscripciones"), h.tokenSistema("torre")]) {
    assert.equal((await subir({ token })).status, 403);
    assert.equal((await h.pedir("PATCH", "/imagenes-registro/9", { token, body: { titulo: "x" } })).status, 403);
    assert.equal((await h.pedir("DELETE", "/imagenes-registro/9", { token })).status, 403);
    assert.equal((await h.pedir("GET", "/imagenes-registro/campeonato/1", { token })).status, 403);
  }
  assert.equal((await h.pedir("DELETE", "/imagenes-registro/9")).status, 401);
  assert.equal(nuevosArchivos().length, 0, "un rechazo por permisos no deja archivos");
});

test("Imágenes: admin sube una imagen para todo el campeonato", async () => {
  h.reiniciar(bdCampeonato());
  const r = await subir({ campos: { etapa_id: "", titulo: "  Reglamento 2026  " } });
  assert.equal(r.status, 201);
  const [ins] = h.buscar(/INSERT INTO imagenes_registro/);
  assert.equal(ins.params[0], 1);
  assert.equal(ins.params[1], null, "sin etapa = todo el campeonato");
  assert.match(ins.params[2], /^\/uploads\/registro\/[0-9a-f]{24}\.png$/, "nombre aleatorio, no el del navegador");
  assert.equal(ins.params[3], "Reglamento 2026");
  assert.equal(nuevosArchivos().length, 1);
});

test("Imágenes: una etapa de otro campeonato se rechaza y no deja el archivo en disco", async () => {
  const previos = nuevosArchivos().length;
  h.reiniciar(bdCampeonato({ etapaValida: false }));
  const r = await subir({ campos: { etapa_id: "77" } });
  assert.equal(r.status, 400);
  assert.equal(h.buscar(/INSERT INTO imagenes_registro/).length, 0);
  await esperar(50);
  assert.equal(nuevosArchivos().length, previos, "el archivo subido se borra");
});

test("Imágenes: rechaza archivos que no son imagen", async () => {
  h.reiniciar(bdCampeonato());
  const r = await subir({ tipo: "text/html", contenido: Buffer.from("<script>alert(1)</script>") });
  assert.equal(r.status, 400);
  assert.equal(h.buscar(/INSERT INTO imagenes_registro/).length, 0);
});

test("Imágenes: cambiar el destino valida que la etapa sea del mismo campeonato", async () => {
  h.reiniciar((sql) => {
    if (/SELECT \* FROM imagenes_registro WHERE id = \?/.test(sql)) return [{ id: 9, campeonato_id: 1, etapa_id: null, titulo: null, orden: 1 }];
    if (/SELECT id FROM etapas WHERE id = \? AND campeonato_id = \?/.test(sql)) return [];
  });
  assert.equal((await h.pedir("PATCH", "/imagenes-registro/9", { token: ADMIN(), body: { etapa_id: 77 } })).status, 400);
  assert.equal(h.buscar(/UPDATE imagenes_registro/).length, 0);

  h.reiniciar((sql) => {
    if (/SELECT \* FROM imagenes_registro WHERE id = \?/.test(sql)) return [{ id: 9, campeonato_id: 1, etapa_id: 3, titulo: "T", orden: 1 }];
    if (/WHERE img.id = \?/.test(sql)) return [{ id: 9 }];
  });
  const r = await h.pedir("PATCH", "/imagenes-registro/9", { token: ADMIN(), body: { etapa_id: null } });
  assert.equal(r.status, 200);
  const [upd] = h.buscar(/UPDATE imagenes_registro/);
  assert.deepEqual(upd.params, [null, "T", 1, 9], "pasa a todo el campeonato y conserva título/orden");
});

test("Imágenes: eliminar borra el registro y el archivo, sin salir de la carpeta de uploads", async () => {
  const nombre = "prueba-borrar.png";
  fs.writeFileSync(path.join(REGISTRO_DIR, nombre), PNG);
  h.reiniciar((sql) => (/SELECT archivo FROM imagenes_registro/.test(sql) ? [{ archivo: `/uploads/registro/${nombre}` }] : undefined));
  const r = await h.pedir("DELETE", "/imagenes-registro/9", { token: ADMIN() });
  assert.equal(r.status, 200);
  assert.equal(h.buscar(/DELETE FROM imagenes_registro/).length, 1);
  await esperar(50);
  assert.ok(!fs.existsSync(path.join(REGISTRO_DIR, nombre)));

  // Una ruta manipulada en la BD no puede borrar nada fuera de REGISTRO_DIR.
  const fuera = path.join(REGISTRO_DIR, "..", "no-borrar.txt");
  fs.writeFileSync(fuera, "x");
  h.reiniciar((sql) => (/SELECT archivo FROM imagenes_registro/.test(sql) ? [{ archivo: "/uploads/registro/../no-borrar.txt" }] : undefined));
  await h.pedir("DELETE", "/imagenes-registro/9", { token: ADMIN() });
  await esperar(50);
  assert.ok(fs.existsSync(fuera));
  fs.unlinkSync(fuera);
});

test("Imágenes: al eliminar una etapa sus imágenes dejan de mostrarse", async () => {
  h.reiniciar((sql) => {
    if (/SELECT id FROM etapas WHERE id = \? AND activo = 1/.test(sql)) return [{ id: 3 }];
    if (/COUNT\(\*\) AS cnt FROM inscripciones/.test(sql)) return [{ cnt: 0 }];
  });
  assert.equal((await h.pedir("DELETE", "/etapas/3", { token: ADMIN() })).status, 200);
  const [upd] = h.buscar(/UPDATE imagenes_registro SET activo = 0 WHERE etapa_id = \?/);
  assert.deepEqual(upd.params, ["3"]);
});

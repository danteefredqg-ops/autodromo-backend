// test/entrega.test.js — entrega "en ceros" al cliente: el vaciado de la BD
// (scripts/vaciar-produccion.js) y la limpieza de fotos sin dueño al arrancar.
// Corre con: node --test test/entrega.test.js
"use strict";

const test   = require("node:test");
const assert = require("node:assert/strict");
const fs     = require("fs");
const os     = require("os");
const path   = require("path");
const { BORRADOS, contar, vaciar } = require("../scripts/vaciar-produccion");
const { limpiarArchivosHuerfanos } = require("../configuracion/limpiezaUploads");

function conexionFalsa({ fallaEn = null } = {}) {
  const log = [];
  return {
    log,
    beginTransaction: async () => log.push("BEGIN"),
    commit: async () => log.push("COMMIT"),
    rollback: async () => log.push("ROLLBACK"),
    query: async (sql) => {
      log.push(sql);
      if (fallaEn && sql.includes(fallaEn)) throw new Error("falla simulada");
      return [[{ n: 3 }]];
    },
  };
}

test("Vaciar: borra todo lo operativo dentro de una sola transacción", async () => {
  const conn = conexionFalsa();
  await vaciar(conn);
  assert.equal(conn.log[0], "BEGIN");
  assert.equal(conn.log.at(-1), "COMMIT");
  for (const t of ["resultados", "imagenes_registro", "inscripciones", "contratos_anuales", "preparadores", "pilotos", "campeonato_categorias", "etapas", "campeonatos"]) {
    assert.ok(conn.log.includes(`DELETE FROM ${t}`), `falta borrar ${t}`);
  }
});

test("Vaciar: conserva cuentas del sistema y categorías activas", async () => {
  const conn = conexionFalsa();
  await vaciar(conn);
  const sql = conn.log.join("\n");
  assert.ok(!/usuarios/.test(sql), "no debe tocar usuarios");
  assert.ok(!/DELETE FROM categorias\s*$/m.test(sql), "no debe borrar todas las categorías");
  assert.match(sql, /DELETE FROM categorias WHERE activo = 0/, "solo las que el admin ya había eliminado");
});

test("Vaciar: usa DELETE, nunca TRUNCATE (los ids no se reinician → sesiones viejas no secuestran cuentas nuevas)", async () => {
  const conn = conexionFalsa();
  await vaciar(conn);
  assert.ok(!conn.log.some(q => /TRUNCATE|AUTO_INCREMENT|DROP/i.test(q)));
});

test("Vaciar: el orden respeta las llaves foráneas (hijos antes que padres)", () => {
  const orden = BORRADOS.map(b => b.tabla);
  const antes = (a, b) => assert.ok(orden.indexOf(a) < orden.indexOf(b), `${a} debe borrarse antes que ${b}`);
  antes("resultados", "etapas");
  antes("inscripciones", "pilotos");
  antes("inscripciones", "campeonatos");
  antes("contratos_anuales", "pilotos");
  antes("preparadores", "pilotos");
  antes("imagenes_registro", "etapas");
  antes("etapas", "campeonatos");
  antes("campeonato_categorias", "categorias eliminadas");
});

test("Vaciar: si un borrado falla se revierte todo y no sigue borrando", async () => {
  const conn = conexionFalsa({ fallaEn: "DELETE FROM pilotos" });
  await assert.rejects(() => vaciar(conn));
  assert.equal(conn.log.at(-1), "ROLLBACK");
  assert.ok(!conn.log.includes("DELETE FROM campeonatos"));
  assert.ok(!conn.log.includes("COMMIT"));
});

test("Contar: cuenta lo que se borra y lo que se conserva sin modificar nada", async () => {
  const conn = conexionFalsa();
  const { borrar, conservar } = await contar(conn);
  assert.equal(borrar.length, BORRADOS.length);
  assert.equal(conservar.length, 2);
  assert.ok(conn.log.every(q => /^SELECT COUNT\(\*\)/.test(q)), "contar solo debe leer");
});

// ── Limpieza de uploads ──────────────────────────────────────────────────────
function carpetaTemporal() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "uploads-prueba-"));
  const escribir = (nombre, minutosAtras) => {
    const ruta = path.join(dir, nombre);
    fs.writeFileSync(ruta, "x");
    const t = (Date.now() - minutosAtras * 60000) / 1000;
    fs.utimesSync(ruta, t, t);
  };
  return { dir, escribir };
}

const bdCon = (fotos) => ({
  query: async (sql) => [/FROM pilotos/.test(sql) ? fotos.map(url => ({ url })) : []],
});

test("Limpieza: borra fotos sin dueño y conserva las que están en uso", async () => {
  const { dir, escribir } = carpetaTemporal();
  escribir("7.jpg", 60);    // en uso
  escribir("3.png", 60);    // de un piloto ya borrado
  escribir("viejo.webp", 60);
  fs.mkdirSync(path.join(dir, "subcarpeta"));
  const n = await limpiarArchivosHuerfanos(bdCon(["/uploads/pilotos/7.jpg?v=123"]), [dir]);
  assert.equal(n, 2);
  assert.deepEqual(fs.readdirSync(dir).sort(), ["7.jpg", "subcarpeta"]);
  fs.rmSync(dir, { recursive: true });
});

test("Limpieza: no toca archivos recién subidos (la subida guarda el archivo antes de anotarlo en la BD)", async () => {
  const { dir, escribir } = carpetaTemporal();
  escribir("recien.png", 1);
  assert.equal(await limpiarArchivosHuerfanos(bdCon([]), [dir]), 0);
  assert.ok(fs.existsSync(path.join(dir, "recien.png")));
  fs.rmSync(dir, { recursive: true });
});

test("Limpieza: si la BD no responde, no borra nada", async () => {
  const { dir, escribir } = carpetaTemporal();
  escribir("foto.jpg", 60);
  await assert.rejects(() => limpiarArchivosHuerfanos({ query: async () => { throw new Error("BD caída"); } }, [dir]));
  assert.ok(fs.existsSync(path.join(dir, "foto.jpg")));
  fs.rmSync(dir, { recursive: true });
});

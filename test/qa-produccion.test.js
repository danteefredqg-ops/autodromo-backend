// test/qa-produccion.test.js — detalles que solo se notan en producción
// (revisión de QA, octubre 2026): zona horaria de Monterrey vs UTC del
// servidor, errores que respondían HTML, IP falsificable, etc.
// Corre con: node --test test/qa-produccion.test.js
"use strict";

const test   = require("node:test");
const assert = require("node:assert/strict");
const fs     = require("fs");
const path   = require("path");
const { execFileSync } = require("child_process");
const h      = require("./helpers/app-prueba");

test.before(() => h.iniciar());
test.after(() => h.detener());

// ── Fechas: el frontend en un navegador de Monterrey ─────────────────────────
// Se corre en un proceso aparte con TZ=America/Monterrey, como el navegador real.
function formatEnMonterrey(valores) {
  const config = path.join(__dirname, "..", "..", "frontend", "admin", "config.js");
  const codigo = `
    const src = require("fs").readFileSync(${JSON.stringify(config)}, "utf8");
    const a = src.indexOf("function fechaLocal"), b = src.indexOf("function formatFecha");
    eval(src.slice(a, src.indexOf("\\n}", b) + 2));
    console.log(JSON.stringify(${JSON.stringify(valores)}.map(formatFecha)));`;
  const salida = execFileSync(process.execPath, ["-e", codigo], { env: { ...process.env, TZ: "America/Monterrey" } });
  return JSON.parse(salida.toString());
}

test("Fechas: una etapa del 13 de octubre se ve como 13 (no 12) en Monterrey", { skip: !fs.existsSync(path.join(__dirname, "..", "..", "frontend")) }, () => {
  const [etapa, soloFecha, nacimiento, fechaHora] = formatEnMonterrey([
    "2026-10-13T00:00:00.000Z", // así llega una columna DATE desde el API
    "2026-10-13",
    "2012-05-10T00:00:00.000Z",
    "2026-10-07T03:00:00.000Z", // fecha-hora real: 6 oct, 9 pm en Monterrey
  ]);
  assert.match(etapa, /^13 oct/);
  assert.match(soloFecha, /^13 oct/);
  assert.match(nacimiento, /^10 may/);
  assert.match(fechaHora, /^06 oct/, "una fecha-hora real sí se convierte a hora local");
});

test("Fechas: el PDF FEMADAC usa fechaLocal para nacimiento y fecha del evento", { skip: !fs.existsSync(path.join(__dirname, "..", "..", "frontend")) }, () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "..", "frontend", "dashboard", "formularios.html"), "utf8");
  assert.ok(!/new Date\((p|prep)\.fecha_nacimiento\)/.test(html));
  assert.ok(!/new Date\(i\.etapa_fecha\)/.test(html));
});

// ── Fechas del backend: "hoy" de Monterrey, no del servidor en UTC ───────────
test("hoyMx/anioMx/mesMx: el 31 de dic a las 7 pm en Monterrey sigue siendo ese año", () => {
  const { hoyMx, anioMx, mesMx } = require("../utils/fechas");
  const real = Date.now;
  try {
    Date.now = () => Date.parse("2027-01-01T01:00:00Z"); // = 31 dic 2026, 7 pm en Monterrey
    assert.equal(hoyMx(), "2026-12-31");
    assert.equal(anioMx(), 2026);
    assert.equal(mesMx(), 12);
    Date.now = () => Date.parse("2026-03-01T05:00:00Z"); // = 28 feb, 11 pm en Monterrey
    assert.equal(mesMx(), 2, "todavía no es marzo: el contrato aún no es obligatorio");
  } finally { Date.now = real; }
});

test("No queda ningún CURDATE() ni getFullYear()/getMonth() del servidor en las rutas", () => {
  const dir = path.join(__dirname, "..", "routes");
  for (const f of fs.readdirSync(dir)) {
    const sinComentarios = fs.readFileSync(path.join(dir, f), "utf8").replace(/\/\/[^\n]*/g, "");
    assert.ok(!/CURDATE\(\)/.test(sinComentarios), `${f} usa CURDATE()`);
    assert.ok(!/\.getFullYear\(\)|\.getMonth\(\)/.test(sinComentarios), `${f} usa la fecha del servidor (UTC)`);
  }
});

// ── Errores: siempre JSON ─────────────────────────────────────────────────────
test("JSON mal formado responde 400 en JSON (no una página HTML)", async () => {
  const base = await h.iniciar();
  const res = await fetch(`${base}/piloto/forgot-password`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: '{"email": ',
  });
  assert.equal(res.status, 400);
  assert.match(res.headers.get("content-type"), /application\/json/);
  assert.match((await res.json()).error, /JSON/);
});

test("Cuerpo demasiado grande responde 413 en JSON", async () => {
  const base = await h.iniciar();
  const res = await fetch(`${base}/piloto/forgot-password`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ x: "a".repeat(200000) }),
  });
  assert.equal(res.status, 413);
  assert.match(res.headers.get("content-type"), /application\/json/);
});

// ── Robustez ──────────────────────────────────────────────────────────────────
test("Eliminar categoría con la BD caída responde 503 en vez de tumbar el servidor", async () => {
  const { dbFalsa } = h;
  const original = dbFalsa.getConnection;
  dbFalsa.getConnection = async () => { throw new Error("ECONNREFUSED"); };
  try {
    const r = await h.pedir("DELETE", "/categorias/5", { token: h.tokenSistema("admin") });
    assert.equal(r.status, 503);
  } finally { dbFalsa.getConnection = original; }
});

test("La IP del contrato no se puede falsificar con un X-Forwarded-For inventado", () => {
  for (const f of ["contratos.js", "inscripciones.js"]) {
    const src = fs.readFileSync(path.join(__dirname, "..", "routes", f), "utf8");
    assert.ok(!/x-forwarded-for/i.test(src.replace(/\/\/[^\n]*/g, "")), `${f} lee X-Forwarded-For a mano`);
    assert.match(src, /const ip = req\.ip/);
  }
});

test("Firmar contrato: solo el año en curso o el siguiente", async () => {
  const { anioMx } = require("../utils/fechas");
  h.reiniciar((sql) => (/SELECT id FROM pilotos WHERE id = \? AND email/.test(sql) ? [{ id: 5 }] : undefined));
  const firmar = (anio) => h.pedir("POST", "/contratos/firmar", { body: { piloto_id: 5, anio, email: "a@b.com", numero: 7 } });
  assert.equal((await firmar(2099)).status, 400);
  assert.equal((await firmar(anioMx() - 1)).status, 400);
  assert.equal((await firmar(anioMx())).status, 200);
});

// ── Segunda pasada ────────────────────────────────────────────────────────────
test("Sesión: un usuario desactivado pierde el acceso de inmediato (no hasta que expire su token)", async () => {
  h.reiniciar();
  const token = h.tokenSistema("inscripciones");
  assert.equal((await h.pedir("GET", "/inscripciones?etapa_id=1", { token })).status, 200);
  h.inactivos.add(2); // el admin lo desactiva
  const r = await h.pedir("GET", "/inscripciones?etapa_id=1", { token });
  assert.equal(r.status, 401);
  assert.match(r.data.error, /desactivado/);
});

test("Sesión: el rol se toma de la BD, no del token (un token viejo de admin no sirve si ya no es admin)", async () => {
  h.reiniciar();
  const jwt = require("jsonwebtoken");
  // Token firmado cuando era admin, pero en la BD el usuario 2 hoy es "inscripciones".
  const tokenViejo = jwt.sign({ id: 2, username: "x", rol: "admin", nombre: "X" }, process.env.JWT_SECRET);
  assert.equal((await h.pedir("GET", "/usuarios", { token: tokenViejo })).status, 403);
});

test("Sesión: un piloto eliminado pierde el acceso al portal de inmediato", async () => {
  h.reiniciar((sql) => (/FROM preparadores/.test(sql) ? [] : undefined));
  const token = h.tokenPiloto(5);
  assert.equal((await h.pedir("GET", "/piloto/mis-preparadores", { token })).status, 200);
  h.inactivos.add("piloto:5");
  assert.equal((await h.pedir("GET", "/piloto/mis-preparadores", { token })).status, 401);
});

test("Número #1: restaurar sin número anterior ya no deja al piloto sin número", async () => {
  h.reiniciar((sql) => (/FROM pilotos WHERE id = \? AND activo = 1 LIMIT 1 FOR UPDATE/.test(sql)
    ? [{ id: 5, nombre_completo: "Campeón", numero_piloto: 1, numero_piloto_anterior: null }] : undefined));
  const r = await h.pedir("PATCH", "/pilotos/5/numero-uno", { token: h.tokenSistema("admin") });
  assert.equal(r.status, 409);
  assert.equal(h.buscar(/UPDATE pilotos SET numero_piloto/).length, 0);
});

test("Número #1: el número anterior del campeón queda reservado (nadie más lo puede tomar)", async () => {
  h.reiniciar((sql, params) => {
    if (/SELECT campeonato_id, fecha, fecha_apertura_inscripcion/.test(sql)) return [{ campeonato_id: 1, fecha: null, fecha_apertura_inscripcion: null, fecha_cierre_inscripcion: null }];
    // El 23 lo tenía el campeón actual antes de tomar el #1.
    if (/SELECT id FROM pilotos WHERE numero_piloto = \? OR numero_piloto_anterior = \?/.test(sql)) return params[0] === 23 ? [{ id: 5 }] : [];
  });
  const r = await h.pedir("POST", "/inscripciones/auto-registro", {
    body: { etapa_id: 1, categoria_ids: [2], numero_piloto: 23, vehiculo: "Ford", apellido_paterno: "X", nombres: "Y", tipo_sangre: "O+" },
  });
  assert.equal(r.status, 409);
  assert.equal(h.buscar(/INSERT INTO (pilotos|inscripciones)/).length, 0);
});

test("Usuarios: no se crean con contraseña corta; cambiar la de uno inexistente da 404", async () => {
  h.reiniciar((sql) => (/UPDATE usuarios SET password/.test(sql) ? { affectedRows: 0 } : undefined));
  const admin = h.tokenSistema("admin");
  assert.equal((await h.pedir("POST", "/usuarios", { token: admin, body: { username: "x", password: "1", nombre: "X", rol: "torre" } })).status, 400);
  assert.equal((await h.pedir("PATCH", "/usuarios/999/password", { token: admin, body: { password: "123456" } })).status, 404);
});

test("Correo de recuperación: el nombre del piloto va escapado", () => {
  const { correoRecuperacion } = require("../configuracion/mailer");
  const html = correoRecuperacion('<img src=x onerror="alert(1)">', "https://x/y");
  assert.ok(!html.includes("<img"));
});

test("server.js: sin x-powered-by, con manejador de errores, red para promesas y cierre limpio", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.match(src, /app\.disable\("x-powered-by"\)/);
  assert.match(src, /app\.use\(manejarErrores\)/);
  assert.match(src, /process\.on\("unhandledRejection"/);
  assert.match(src, /process\.on\("SIGTERM"/);
});

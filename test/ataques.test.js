// test/ataques.test.js — intentos de "hackeo" contra el API (pruebas de
// penetración propias, octubre 2026). Cada prueba es un ataque concreto que
// debe fallar. Corre con: node --test test/ataques.test.js
// Barrido completo de todas las rutas con datos raros: node test/fuzz-rutas.js
"use strict";

const test   = require("node:test");
const assert = require("node:assert/strict");
const fs     = require("fs");
const path   = require("path");
const jwt    = require("jsonwebtoken");
const h      = require("./helpers/app-prueba");
const { PILOTOS_DIR } = require("../configuracion/uploads");

test.before(() => h.iniciar());
test.after(() => h.detener());

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");

// ── Tokens falsificados ──────────────────────────────────────────────────────
test("Token con algoritmo 'none' (sin firma) se rechaza", async () => {
  h.reiniciar();
  const falso = `${b64({ alg: "none", typ: "JWT" })}.${b64({ id: 1, rol: "admin" })}.`;
  assert.equal((await h.pedir("GET", "/usuarios", { token: falso })).status, 401);
});

test("Token firmado con otra clave se rechaza", async () => {
  h.reiniciar();
  const falso = jwt.sign({ id: 1, rol: "admin" }, "clave-adivinada");
  assert.equal((await h.pedir("GET", "/usuarios", { token: falso })).status, 401);
});

test("Token vencido se rechaza", async () => {
  h.reiniciar();
  const vencido = jwt.sign({ id: 1, rol: "admin", exp: Math.floor(Date.now() / 1000) - 60 }, process.env.JWT_SECRET);
  assert.equal((await h.pedir("GET", "/usuarios", { token: vencido })).status, 401);
});

test("Token viejo de la clave comprometida 'autodromo_mty_secreto_2024' no sirve", async () => {
  h.reiniciar();
  const viejo = jwt.sign({ id: 1, rol: "admin" }, "autodromo_mty_secreto_2024");
  assert.equal((await h.pedir("GET", "/usuarios", { token: viejo })).status, 401);
});

test("Token de un usuario que no existe se rechaza", async () => {
  h.reiniciar();
  const fantasma = jwt.sign({ id: 999, rol: "admin" }, process.env.JWT_SECRET);
  assert.equal((await h.pedir("GET", "/usuarios", { token: fantasma })).status, 401);
});

test("Un piloto no puede usar su token en rutas del staff (ni un staff en las del piloto)", async () => {
  h.reiniciar();
  assert.equal((await h.pedir("GET", "/pilotos", { token: h.tokenPiloto(5) })).status, 403);
  assert.equal((await h.pedir("GET", "/reportes/corte-general?todos=true", { token: h.tokenPiloto(5) })).status, 403);
  assert.equal((await h.pedir("GET", "/piloto/mi-perfil", { token: h.tokenSistema("admin") })).status, 403);
});

// ── Acceso a datos de otro (IDOR) ────────────────────────────────────────────
test("Un piloto no puede editar, borrar ni cambiar la foto del preparador de otro piloto", async () => {
  // La BD solo encuentra el preparador 9 si es del piloto 6.
  h.reiniciar((sql, p) => (/FROM preparadores WHERE id = \? AND piloto_id = \?/.test(sql) ? (p[1] === 6 ? [{ id: 9 }] : []) : undefined));
  const intruso = h.tokenPiloto(5);
  const body = { apellido_paterno: "X", nombres: "Y" };
  assert.equal((await h.pedir("PUT", "/piloto/mis-preparadores/9", { token: intruso, body })).status, 404);
  assert.equal((await h.pedir("DELETE", "/piloto/mis-preparadores/9", { token: intruso })).status, 404);
  assert.equal(h.buscar(/UPDATE preparadores/).length, 0);
});

test("Un piloto no puede ver el perfil completo de otro (datos médicos, CURP)", async () => {
  h.reiniciar();
  assert.equal((await h.pedir("GET", "/pilotos/6", { token: h.tokenPiloto(5) })).status, 403);
  assert.equal((await h.pedir("GET", "/formularios/piloto/6", { token: h.tokenPiloto(5) })).status, 403);
  // Torre tampoco: no ve datos sensibles.
  assert.equal((await h.pedir("GET", "/pilotos/6", { token: h.tokenSistema("torre") })).status, 403);
});

// ── Asignación masiva ────────────────────────────────────────────────────────
test("Mi perfil: un piloto no puede cambiarse número, correo, estado, ni contraseña sin el campo propio", async () => {
  h.reiniciar((sql) => (/SELECT \* FROM pilotos WHERE id = \?/.test(sql) ? [{ id: 5 }] : undefined));
  const r = await h.pedir("PATCH", "/piloto/mi-perfil", {
    token: h.tokenPiloto(5),
    body: { telefono: "8112345678", numero_piloto: 1, email: "otro@x.com", activo: 1, password: "hackeada",
            reset_token_hash: "x", nombre_completo: "Otro", id: 6, foto_perfil: "/x.html" },
  });
  assert.equal(r.status, 200);
  const [upd] = h.buscar(/UPDATE pilotos SET/);
  assert.match(upd.sql, /`telefono` = \?/);
  for (const prohibido of ["numero_piloto", "email", "activo", "password", "reset_token_hash", "nombre_completo", "foto_perfil"]) {
    assert.ok(!upd.sql.includes(prohibido), `no debe poder cambiar ${prohibido}`);
  }
  assert.equal(upd.params.at(-1), 5, "siempre sobre su propio id, nunca el del body");
});

test("Crear usuario: no se puede inventar un rol", async () => {
  h.reiniciar();
  const r = await h.pedir("POST", "/usuarios", { token: h.tokenSistema("admin"), body: { username: "x", password: "123456", nombre: "X", rol: "superadmin" } });
  assert.equal(r.status, 400);
});

// ── Subida de archivos ───────────────────────────────────────────────────────
test("Foto de perfil: un .html disfrazado de imagen se guarda como imagen, nunca como .html", async () => {
  const antes = new Set(fs.readdirSync(PILOTOS_DIR));
  h.reiniciar();
  const fd = new FormData();
  fd.append("foto", new Blob(["<script>alert(document.domain)</script>"], { type: "image/png" }), "ataque.html");
  const base = await h.iniciar();
  const res = await fetch(`${base}/piloto/mi-foto`, { method: "POST", headers: { Authorization: `Bearer ${h.tokenPiloto(5)}` }, body: fd });
  const nuevos = fs.readdirSync(PILOTOS_DIR).filter(f => !antes.has(f));
  try {
    assert.equal(res.status, 200);
    assert.deepEqual(nuevos, ["5.png"]);
  } finally {
    for (const f of nuevos) fs.unlinkSync(path.join(PILOTOS_DIR, f));
  }
});

test("Foto de perfil: un tipo que no es imagen se rechaza", async () => {
  h.reiniciar();
  const fd = new FormData();
  fd.append("foto", new Blob(["<html>"], { type: "text/html" }), "x.html");
  const base = await h.iniciar();
  const res = await fetch(`${base}/piloto/mi-foto`, { method: "POST", headers: { Authorization: `Bearer ${h.tokenPiloto(5)}` }, body: fd });
  assert.equal(res.status, 400);
});

test("server.js sirve /uploads con X-Content-Type-Options: nosniff", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.match(src, /express\.static\(UPLOADS_DIR, \{\s*setHeaders: \(res\) => res\.set\("X-Content-Type-Options", "nosniff"\)/);
});

// ── Carreras entre pestañas / doble clic ─────────────────────────────────────
test("Cobro: la misma inscripción no se puede cobrar dos veces (dos pestañas o dos cajeros)", async () => {
  let pagada = false;
  h.reiniciar((sql) => {
    if (/UPDATE inscripciones SET estatus='Pagado'/.test(sql)) {
      // Como MySQL: solo afecta la fila si sigue Pendiente.
      if (pagada) return { affectedRows: 0 };
      pagada = true; return { affectedRows: 1 };
    }
    if (/SELECT estatus, pagado_por FROM inscripciones/.test(sql)) return [{ estatus: "Pagado", pagado_por: "caja1" }];
    if (/FROM inscripciones i/.test(sql)) return [{ id: 4 }];
  });
  const staff = h.tokenSistema("inscripciones");
  const body = { metodo_pago: "Efectivo", monto_pago: 2300 };
  const [a, b] = await Promise.all([
    h.pedir("PATCH", "/inscripciones/4/pagar", { token: staff, body }),
    h.pedir("PATCH", "/inscripciones/4/pagar", { token: staff, body }),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  assert.match((a.status === 409 ? a : b).data.error, /ya fue cobrada por caja1/);
  assert.match(h.buscar(/UPDATE inscripciones SET estatus='Pagado'/)[0].sql, /AND estatus = 'Pendiente'/);
});

// ── Datos con tipos raros (antes: error 500) ─────────────────────────────────
test("Tipos inesperados en el body responden 400, no 500", async () => {
  h.reiniciar();
  const admin = h.tokenSistema("admin");
  const casos = [
    ["PATCH", "/usuarios/1/password", { password: true }],
    ["POST", "/categorias", { nombre: { a: 1 } }],
    ["PATCH", "/inscripciones/1/vehiculo", { vehiculo: true }],
    ["POST", "/inscripciones", { categoria_id: { toString: 1 } }],
    ["POST", "/piloto/forgot-password", { email: true }],
    ["POST", "/auth/login-unico", { identificador: ["admin"], password: "x" }],
    ["PATCH", "/inscripciones/1/pagar", { monto_pago: { $gt: 0 } }],
  ];
  for (const [metodo, ruta, body] of casos) {
    const r = await h.pedir(metodo, ruta, { token: admin, body, headers: { "X-Forwarded-For": `10.9.${Math.random() * 250 | 0}.1` } });
    assert.equal(r.status, 400, `${metodo} ${ruta} ${JSON.stringify(body)} → ${r.status}`);
  }
});

test("Texto que llega como número se acepta (p.ej. teléfono numérico)", async () => {
  h.reiniciar((sql) => (/SELECT \* FROM pilotos WHERE id = \?/.test(sql) ? [{ id: 5 }] : undefined));
  const r = await h.pedir("PATCH", "/piloto/mi-perfil", { token: h.tokenPiloto(5), body: { telefono: 8112345678 } });
  assert.equal(r.status, 200);
  assert.equal(h.buscar(/UPDATE pilotos SET/)[0].params[0], "8112345678");
});

// ── Inyección SQL ────────────────────────────────────────────────────────────
test("Ninguna consulta SQL arma texto con datos del usuario (todo va con parámetros ?)", () => {
  const dir = path.join(__dirname, "..", "routes");
  for (const f of fs.readdirSync(dir)) {
    const src = fs.readFileSync(path.join(dir, f), "utf8");
    // ${...} dentro de una consulta solo puede ser una constante del código.
    for (const m of src.matchAll(/query\(\s*`[^`]*\$\{([^}]+)\}/g)) {
      // (CAMPOS_PREPARADOR es la lista fija de columnas de preparadores, no texto del usuario.)
      assert.match(m[1].trim(), /^(SELECT_IMAGEN|sets\.join\(", "\)|COSTO_INSCRIPCION_SQL|JOIN_COSTO_SQL|CAMPOS_PREPARADOR\.(join|map)\b.*)$/, `${f}: interpolación sospechosa \${${m[1]}}`);
    }
    assert.ok(!/sql \+= [^;]*req\./.test(src), `${f}: concatena req.* en el SQL`);
  }
});

// test/proxy.test.js — los límites de intentos deben contarse por visitante,
// no por la IP del proxy de Railway (ver "trust proxy" en server.js).
// Corre con: node --test test/proxy.test.js
"use strict";

process.env.JWT_SECRET = process.env.JWT_SECRET || "secreto-solo-para-pruebas";

const test    = require("node:test");
const assert  = require("node:assert/strict");
const fs      = require("fs");
const path    = require("path");
const express = require("express");
const rateLimit = require("express-rate-limit");

// Misma configuración que forgotPasswordLimit (3 cada 15 min), pero una
// instancia propia por app para que las pruebas no compartan contador.
const limite = () => rateLimit({ windowMs: 15 * 60 * 1000, max: 3, standardHeaders: true, legacyHeaders: false, validate: false });

async function levantar(confiarProxy) {
  const app = express();
  if (confiarProxy) app.set("trust proxy", 1);
  app.post("/x", limite(), (req, res) => res.json({ ok: true }));
  const srv = await new Promise(ok => { const s = app.listen(0, () => ok(s)); });
  const url = `http://127.0.0.1:${srv.address().port}/x`;
  // Simula al proxy de Railway: agrega la IP real del visitante en X-Forwarded-For.
  const desde = (ip) => fetch(url, { method: "POST", headers: { "X-Forwarded-For": ip } }).then(r => r.status);
  return { srv, desde };
}

test("Sin 'trust proxy' todos los visitantes comparten el límite (el bug que había)", async () => {
  const { srv, desde } = await levantar(false);
  for (let i = 0; i < 3; i++) assert.equal(await desde("201.1.1.1"), 200);
  assert.equal(await desde("187.2.2.2"), 429, "otra persona ya quedaba bloqueada");
  srv.close();
});

test("Con 'trust proxy' cada visitante tiene su propio límite", async () => {
  const { srv, desde } = await levantar(true);
  for (let i = 0; i < 3; i++) assert.equal(await desde("201.1.1.1"), 200);
  assert.equal(await desde("201.1.1.1"), 429, "el que abusa sí se bloquea");
  assert.equal(await desde("187.2.2.2"), 200, "otra persona no se ve afectada");
  srv.close();
});

test("Login: 30 personas en el mismo WiFi entran sin bloquearse; los intentos fallidos sí se limitan", async () => {
  const { loginLimit } = require("../middleware/auth");
  const app = express();
  app.set("trust proxy", 1);
  app.post("/login", loginLimit, (req, res) => (req.query.ok ? res.json({ ok: true }) : res.status(401).json({ error: "x" })));
  const srv = await new Promise(ok => { const s = app.listen(0, () => ok(s)); });
  const url = `http://127.0.0.1:${srv.address().port}/login`;
  const intento = (ip, ok) => fetch(`${url}${ok ? "?ok=1" : ""}`, { method: "POST", headers: { "X-Forwarded-For": ip } }).then(r => r.status);

  for (let i = 0; i < 30; i++) assert.equal(await intento("201.1.1.1", true), 200, `login correcto #${i + 1}`);
  for (let i = 0; i < 15; i++) assert.equal(await intento("187.9.9.9", false), 401);
  assert.equal(await intento("187.9.9.9", false), 429, "quien adivina contraseñas sí se bloquea");
  assert.equal(await intento("201.1.1.1", true), 200, "y no afecta al WiFi del autódromo");
  srv.close();
});

test("server.js confía en exactamente 1 proxy (el edge de Railway)", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.match(src, /app\.set\("trust proxy", 1\)/);
  // Debe ir antes de montar las rutas (que es donde están los límites).
  assert.ok(src.indexOf('app.set("trust proxy", 1)') < src.indexOf('app.use("/api/auth"'));
});

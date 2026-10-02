// test/helpers/app-prueba.js — arma la app de Express con las rutas reales,
// pero con la base de datos reemplazada por un doble en memoria. Sirve para
// pruebas de integración (HTTP → middleware → ruta → SQL) sin necesitar MySQL.
//
// Cada prueba registra "manejadores": una función que recibe (sql, params) y
// devuelve las filas a responder, o undefined para dejar pasar al siguiente.
// Todas las consultas quedan registradas en `consultas` para poder revisar
// qué SQL y qué parámetros llegaron a la base de datos.
"use strict";

const path = require("path");
const jwt  = require("jsonwebtoken");

process.env.JWT_SECRET = process.env.JWT_SECRET || "secreto-solo-para-pruebas";

const consultas = [];
let manejadores = [];

function responder(sql, params) {
  consultas.push({ sql, params });
  for (const m of manejadores) {
    const r = m(sql, params);
    if (r !== undefined) return r;
  }
  // Por defecto: SELECT sin filas, escrituras que afectan 1 fila.
  if (/^\s*(SELECT|SHOW)/i.test(sql)) return [];
  return { affectedRows: 1, insertId: 1 };
}

const dbFalsa = {
  query: async (sql, params) => [responder(sql, params)],
  getConnection: async () => ({
    query: async (sql, params) => [responder(sql, params)],
    beginTransaction: async () => {},
    commit: async () => {},
    rollback: async () => {},
    release: () => {},
  }),
};

// Reemplaza el módulo de la BD antes de que cualquier ruta lo requiera.
const rutaDb = require.resolve(path.join(__dirname, "..", "..", "configuracion", "db"));
require.cache[rutaDb] = { id: rutaDb, filename: rutaDb, loaded: true, exports: dbFalsa };

function crearApp() {
  const express = require("express");
  const app = express();
  app.use(express.json());
  const r = (n) => require(path.join(__dirname, "..", "..", "routes", n));
  app.use("/api/auth",          r("auth"));
  app.use("/api/pilotos",       r("pilotos"));
  app.use("/api/categorias",    r("categorias"));
  app.use("/api/campeonatos",   r("campeonatos"));
  app.use("/api/etapas",        r("etapas"));
  app.use("/api/contratos",     r("contratos"));
  app.use("/api/inscripciones", r("inscripciones"));
  app.use("/api/formularios",   r("formularios"));
  app.use("/api/reportes",      r("reportes"));
  app.use("/api/usuarios",      r("usuarios"));
  app.use("/api/piloto",        r("piloto"));
  app.use("/api/resultados",    r("resultados"));
  app.use("/api/imagenes-registro", r("imagenes"));
  return app;
}

let servidor = null;
let base = null;

async function iniciar() {
  if (servidor) return base;
  const app = crearApp();
  await new Promise((ok) => { servidor = app.listen(0, ok); });
  base = `http://127.0.0.1:${servidor.address().port}/api`;
  return base;
}

async function detener() {
  if (servidor) await new Promise((ok) => servidor.close(ok));
  servidor = null;
}

function reiniciar(...nuevos) {
  consultas.length = 0;
  manejadores = nuevos;
}

function tokenSistema(rol, extra = {}) {
  return jwt.sign({ id: 1, username: `usuario_${rol}`, rol, nombre: "Prueba", ...extra }, process.env.JWT_SECRET);
}

function tokenPiloto(id = 1) {
  return jwt.sign({ id, numero: 7, tipo: "piloto" }, process.env.JWT_SECRET);
}

async function pedir(metodo, ruta, { token, body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${base}${ruta}`, { method: metodo, headers, body: body ? JSON.stringify(body) : undefined });
  let data = null;
  try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

const buscar = (patron) => consultas.filter(c => patron.test(c.sql));

module.exports = { dbFalsa, consultas, iniciar, detener, reiniciar, tokenSistema, tokenPiloto, pedir, buscar };

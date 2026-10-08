// test/reglas.test.js — reglas por categoría (edad, categoría única) y los
// reportes del cliente de octubre 2026: Jr Dragster hasta 14 años y sin
// combinar con otra categoría, número duplicado y varias categorías por etapa.
// Corre con: node --test test/reglas.test.js
"use strict";

const test   = require("node:test");
const assert = require("node:assert/strict");
const h      = require("./helpers/app-prueba");
const { edadEn, aFechaISO, leerReglasCategoria } = require("../utils/reglasCategorias");

const ADMIN = () => h.tokenSistema("admin");
const STAFF = () => h.tokenSistema("inscripciones");

test.before(() => h.iniciar());
test.after(() => h.detener());

// ── Unitarias ─────────────────────────────────────────────────────────────────
test("edadEn: cumple años el mismo día, no antes", () => {
  assert.equal(edadEn("2012-05-10", "2026-05-09"), 13);
  assert.equal(edadEn("2012-05-10", "2026-05-10"), 14);
  assert.equal(edadEn("2011-05-10", "2026-05-10"), 15);
  assert.equal(edadEn("2012-02-29", "2026-02-28"), 13);
});

test("aFechaISO acepta Date de mysql2 y texto", () => {
  assert.equal(aFechaISO(new Date("2026-10-11T00:00:00Z")), "2026-10-11");
  assert.equal(aFechaISO("2026-10-11T06:00:00.000Z"), "2026-10-11");
  assert.equal(aFechaISO(""), null);
  assert.equal(aFechaISO("basura"), null);
});

test("leerReglasCategoria valida edades", () => {
  assert.deepEqual(leerReglasCategoria({ edad_maxima: "14", exclusiva: true }).valores, { edad_minima: null, edad_maxima: 14, exclusiva: 1 });
  assert.ok(leerReglasCategoria({ edad_minima: 15, edad_maxima: 14 }).error);
  assert.ok(leerReglasCategoria({ edad_maxima: -1 }).error);
  assert.ok(leerReglasCategoria({ edad_maxima: "abc" }).error);
});

// ── Integración: auto-registro (registro público y portal) ───────────────────
const JR  = { id: 15, nombre: "JUNIOR DRAGSTER", edad_minima: null, edad_maxima: 14, exclusiva: 1 };
const BRK = { id: 10, nombre: "BRACKET", edad_minima: null, edad_maxima: null, exclusiva: 0 };

// BD simulada: etapa del 2026-10-11; `piloto` existente (o ninguno);
// `yaInscrito` = categorías que ya tiene en esa etapa.
function bd({ piloto = null, yaInscrito = [] } = {}) {
  return (sql, params = []) => {
    if (/SELECT campeonato_id, fecha, fecha_apertura_inscripcion/.test(sql)) {
      return [{ campeonato_id: 1, fecha: new Date("2026-10-11T00:00:00Z"), fecha_apertura_inscripcion: null, fecha_cierre_inscripcion: null }];
    }
    if (/FROM categorias WHERE id IN/.test(sql)) return [JR, BRK].filter(c => params[0].includes(c.id));
    if (/FROM inscripciones i JOIN categorias cat/.test(sql)) return yaInscrito;
    if (/SELECT \* FROM pilotos WHERE email = \?/.test(sql)) return piloto ? [piloto] : [];
    if (/SELECT id FROM pilotos WHERE numero_piloto = \? OR numero_piloto_anterior = \?/.test(sql)) return [];
    if (/INSERT INTO pilotos/.test(sql)) return { insertId: 50, affectedRows: 1 };
    if (/SELECT \* FROM pilotos WHERE id = \?/.test(sql)) return [{ id: 50, numero_piloto: 77, fecha_nacimiento: "2014-01-01" }];
    if (/FROM contratos_anuales/.test(sql)) return [{ id: 1 }];
    if (/INSERT INTO inscripciones/.test(sql)) return { insertId: 100 + params[3], affectedRows: 1 };
    if (/WHERE i.id IN/.test(sql)) return params[0].map(id => ({ id }));
  };
}

const registro = (extra) => h.pedir("POST", "/inscripciones/auto-registro", {
  body: { etapa_id: 1, numero_piloto: 77, vehiculo: "Dragster", email: "jr@correo.com", ...extra },
});
const nuevo = { apellido_paterno: "Pérez", nombres: "Ana", tipo_sangre: "O+" };

test("Jr Dragster: un piloto nuevo de 15 años el día de la carrera se rechaza y NO se le crea cuenta", async () => {
  h.reiniciar(bd());
  const r = await registro({ categoria_ids: [15], fecha_nacimiento: "2011-10-01", ...nuevo });
  assert.equal(r.status, 409);
  assert.match(r.data.error, /hasta 14 años/);
  assert.equal(h.buscar(/INSERT INTO pilotos/).length, 0);
  assert.equal(h.buscar(/INSERT INTO inscripciones/).length, 0);
});

test("Jr Dragster: se cuenta la edad al día de la carrera (cumple 15 después → sí entra)", async () => {
  h.reiniciar(bd());
  const r = await registro({ categoria_ids: [15], fecha_nacimiento: "2011-10-12", ...nuevo });
  assert.equal(r.status, 201);
  assert.equal(h.buscar(/INSERT INTO inscripciones/).length, 1);
});

test("Jr Dragster: sin fecha de nacimiento no se puede inscribir", async () => {
  h.reiniciar(bd({ piloto: { id: 10, numero_piloto: 77, fecha_nacimiento: null } }));
  const r = await registro({ categoria_ids: [15] });
  assert.equal(r.status, 409);
  assert.match(r.data.error, /fecha de nacimiento/);
});

test("Jr Dragster: piloto existente sin fecha que la manda en el formulario → se guarda y se valida", async () => {
  h.reiniciar(bd({ piloto: { id: 10, numero_piloto: 77, fecha_nacimiento: null } }));
  const r = await registro({ categoria_ids: [15], fecha_nacimiento: "2013-03-03" });
  assert.equal(r.status, 201);
  const [upd] = h.buscar(/UPDATE pilotos SET fecha_nacimiento/);
  assert.deepEqual(upd.params, ["2013-03-03", 10]);
});

test("Jr Dragster: no se puede combinar con otra categoría en el mismo envío", async () => {
  h.reiniciar(bd({ piloto: { id: 10, numero_piloto: 77, fecha_nacimiento: "2013-03-03" } }));
  const r = await registro({ categoria_ids: [15, 10] });
  assert.equal(r.status, 409);
  assert.match(r.data.error, /no puede inscribirse en otra categoría/);
  assert.equal(h.buscar(/INSERT INTO inscripciones/).length, 0);
});

test("Jr Dragster: si ya está en Bracket en esa etapa, no puede agregar Jr Dragster (ni al revés)", async () => {
  h.reiniciar(bd({ piloto: { id: 10, numero_piloto: 77, fecha_nacimiento: "2013-03-03" }, yaInscrito: [BRK] }));
  assert.equal((await registro({ categoria_ids: [15] })).status, 409);
  h.reiniciar(bd({ piloto: { id: 10, numero_piloto: 77, fecha_nacimiento: "2013-03-03" }, yaInscrito: [JR] }));
  assert.equal((await registro({ categoria_ids: [10] })).status, 409);
  assert.equal(h.buscar(/INSERT INTO inscripciones/).length, 0);
});

test("Categorías normales: varias en un envío crean una inscripción por categoría", async () => {
  const otra = { ...BRK, id: 11, nombre: "PONY 1" };
  h.reiniciar((sql, params = []) => {
    if (/FROM categorias WHERE id IN/.test(sql)) return [BRK, otra];
    return bd({ piloto: { id: 10, numero_piloto: 77, fecha_nacimiento: null } })(sql, params);
  });
  const r = await registro({ categoria_ids: [10, 11] });
  assert.equal(r.status, 201);
  assert.deepEqual(h.buscar(/INSERT INTO inscripciones/).map(c => c.params[3]), [10, 11]);
  assert.equal(r.data.inscripciones.length, 2);
});

// ── Integración: inscripción desde el dashboard (staff) ──────────────────────
function bdStaff({ numeroPiloto = null, numeroUsado = false, yaInscrito = [] } = {}) {
  return (sql, params = []) => {
    if (/SELECT numero_piloto, fecha_nacimiento FROM pilotos/.test(sql)) return [{ numero_piloto: numeroPiloto, fecha_nacimiento: "2013-03-03" }];
    if (/SELECT id FROM pilotos WHERE \(numero_piloto = \? OR numero_piloto_anterior = \?\) AND id <> \?/.test(sql)) return numeroUsado ? [{ id: 99 }] : [];
    if (/SELECT campeonato_id, fecha FROM etapas/.test(sql)) return [{ campeonato_id: 1, fecha: "2026-10-11" }];
    if (/FROM categorias WHERE id IN/.test(sql)) return [JR, BRK, { ...BRK, id: 11, nombre: "PONY 1" }].filter(c => params[0].includes(c.id));
    if (/FROM inscripciones i JOIN categorias cat/.test(sql)) return yaInscrito;
    if (/INSERT INTO inscripciones/.test(sql)) return { insertId: 100 + params[3], affectedRows: 1 };
    if (/WHERE i.id IN/.test(sql)) return params[0].map(id => ({ id }));
  };
}
const inscribir = (body) => h.pedir("POST", "/inscripciones", {
  token: STAFF(), body: { piloto_id: 10, etapa_id: 1, numero_piloto: 77, vehiculo: "Ford", ...body },
});

test("Dashboard: piloto sin número no puede quedarse con el número de otro piloto", async () => {
  h.reiniciar(bdStaff({ numeroUsado: true }));
  const r = await inscribir({ categoria_ids: [10] });
  assert.equal(r.status, 409);
  assert.match(r.data.error, /ya está asignado a otro piloto/);
  assert.equal(h.buscar(/INSERT INTO inscripciones/).length, 0);
});

test("Dashboard: piloto sin número recibe el número elegido si está libre", async () => {
  h.reiniciar(bdStaff());
  assert.equal((await inscribir({ categoria_ids: [10] })).status, 201);
  const [upd] = h.buscar(/UPDATE pilotos SET numero_piloto/);
  assert.deepEqual(upd.params, [77, 10]);
});

test("Dashboard: varias categorías en una sola inscripción", async () => {
  h.reiniciar(bdStaff({ numeroPiloto: 77 }));
  const r = await inscribir({ categoria_ids: [10, 11] });
  assert.equal(r.status, 201);
  assert.deepEqual(h.buscar(/INSERT INTO inscripciones/).map(c => c.params[3]), [10, 11]);
  assert.equal(r.data.inscripciones.length, 2);
});

test("Dashboard: también aplica la regla de Jr Dragster", async () => {
  h.reiniciar(bdStaff({ numeroPiloto: 77 }));
  assert.equal((await inscribir({ categoria_ids: [15, 10] })).status, 409);
  assert.equal(h.buscar(/INSERT INTO inscripciones/).length, 0);
});

// ── Categorías: el admin configura las reglas ────────────────────────────────
test("Categorías: el admin guarda edad máxima y categoría única; editar no borra la descripción", async () => {
  h.reiniciar((sql) => {
    if (/SELECT \* FROM categorias WHERE id = \?/.test(sql)) {
      return [{ id: 15, nombre: "JUNIOR DRAGSTER", descripcion: "Junior Dragster", color: "#64748b", edad_minima: null, edad_maxima: 14, exclusiva: 1 }];
    }
  });
  const r = await h.pedir("PUT", "/categorias/15", {
    token: ADMIN(), body: { nombre: "JUNIOR DRAGSTER", color: "#64748b", edad_maxima: 13, exclusiva: true },
  });
  assert.equal(r.status, 200);
  const [upd] = h.buscar(/UPDATE categorias SET/);
  assert.equal(upd.params[1], "Junior Dragster", "la descripción se conserva");
  assert.deepEqual(upd.params.slice(4, 7), [null, 13, 1]);

  const mala = await h.pedir("PUT", "/categorias/15", { token: ADMIN(), body: { nombre: "X", edad_minima: 15, edad_maxima: 14 } });
  assert.equal(mala.status, 400);
  assert.equal((await h.pedir("PUT", "/categorias/15", { token: STAFF(), body: { nombre: "X" } })).status, 403);
});

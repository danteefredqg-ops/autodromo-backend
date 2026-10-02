// test/integracion.test.js — pruebas de integración de las rutas del API
// (Express + middleware + rutas reales, BD reemplazada por un doble en memoria).
// Corre con: node --test test/integracion.test.js
// Cada bloque reproduce un bug encontrado en la revisión de octubre 2026: la
// prueba falla con el código anterior y pasa con la corrección.
"use strict";

const test   = require("node:test");
const assert = require("node:assert/strict");
const h      = require("./helpers/app-prueba");

const ADMIN = () => h.tokenSistema("admin");
const STAFF = () => h.tokenSistema("inscripciones");

test.before(() => h.iniciar());
test.after(() => h.detener());

// ── Bug 1 ─────────────────────────────────────────────────────────────────────
test("PUT /pilotos/:id conserva apellidos/nombres si el body solo trae nombre_completo", async () => {
  h.reiniciar((sql) => {
    if (/SELECT apellido_paterno, apellido_materno, nombres FROM pilotos/.test(sql)) {
      return [{ apellido_paterno: "Pérez", apellido_materno: "López", nombres: "Juan" }];
    }
    if (/SELECT \* FROM pilotos/.test(sql)) return [{ id: 5, nombre_completo: "Juan Pérez López" }];
  });
  const r = await h.pedir("PUT", "/pilotos/5", {
    token: STAFF(), body: { nombre_completo: "Juan Pérez López", telefono: "8112345678", tipo_sangre: "O+" },
  });
  assert.equal(r.status, 200);
  const [upd] = h.buscar(/UPDATE pilotos SET/);
  assert.deepEqual(upd.params.slice(0, 3), ["Pérez", "López", "Juan"]);
});

test("PUT /pilotos/:id de un piloto inexistente da 404", async () => {
  h.reiniciar();
  const r = await h.pedir("PUT", "/pilotos/999", { token: STAFF(), body: { nombre_completo: "X" } });
  assert.equal(r.status, 404);
  assert.equal(h.buscar(/UPDATE pilotos SET/).length, 0);
});

// ── Bug 4 ─────────────────────────────────────────────────────────────────────
test("PUT /etapas/:id sin nombre usa 'Etapa N' (antes: 500 por NOT NULL) y no borra el costo", async () => {
  h.reiniciar((sql) => {
    if (/SELECT id FROM etapas WHERE id = \? AND activo = 1/.test(sql)) return [{ id: 3 }];
    if (/FROM etapas e WHERE e.id = \?/.test(sql)) return [{ id: 3, numero: 2, nombre: "Etapa 2" }];
  });
  const r = await h.pedir("PUT", "/etapas/3", {
    token: ADMIN(), body: { numero: 2, nombre: null, fecha: "2026-11-01", ubicacion: "Autódromo Monterrey" },
  });
  assert.equal(r.status, 200);
  const [upd] = h.buscar(/UPDATE etapas SET/);
  assert.equal(upd.params[1], "Etapa 2");
  assert.match(upd.sql, /costo=IF\(\?,\?,costo\)/);
  assert.equal(upd.params[5], false, "sin costo en el body se conserva el actual");
});

// ── Bugs 5 y 6 ────────────────────────────────────────────────────────────────
test("GET /reportes/corte-general usa el costo por categoría, filtra categoría y respeta montos de $0", async () => {
  h.reiniciar((sql) => {
    if (/FROM campeonatos WHERE id = \?/.test(sql)) return [{ id: 1, nombre: "Campeonato 2026" }];
    if (/FROM inscripciones i/.test(sql)) {
      return [
        { estatus: "Pagado", metodo_pago: "Efectivo", monto_pago: null, costo_inscripcion: "2300.00", categoria_nombre: "BRACKET" },
        { estatus: "Pagado", metodo_pago: "Intercambio", monto_pago: "0.00", costo_inscripcion: "2300.00", categoria_nombre: "BRACKET" },
        { estatus: "Pendiente", metodo_pago: null, monto_pago: null, costo_inscripcion: "2300.00", categoria_nombre: "BRACKET" },
        { estatus: "Descalificado", metodo_pago: null, monto_pago: null, costo_inscripcion: "2300.00", categoria_nombre: "BRACKET" },
      ];
    }
  });
  const r = await h.pedir("GET", "/reportes/corte-general?campeonato_id=1&categoria_id=9", { token: ADMIN() });
  assert.equal(r.status, 200);
  const [q] = h.buscar(/FROM inscripciones i/);
  assert.match(q.sql, /COALESCE\(cc\.costo, cat\.costo_default, e\.costo, 0\)/);
  assert.match(q.sql, /AND i\.categoria_id = \?/);
  assert.ok(q.params.includes("9"));
  assert.equal(r.data.resumen.ingresos, 2300, "el Intercambio de $0 no se cuenta como $2300");
  assert.equal(r.data.resumen.ingresosEfectivo, 2300);
  assert.equal(r.data.resumen.esperado, 6900, "3 inscripciones no descalificadas × $2300");
});

test("GET /reportes/por-categoria calcula esperado/cobrado por categoría", async () => {
  h.reiniciar((sql) => {
    if (/FROM inscripciones i/.test(sql)) {
      return [
        { estatus: "Pagado", monto_pago: null, costo_inscripcion: "4000.00", categoria_nombre: "DRAGSTER" },
        { estatus: "Pendiente", monto_pago: null, costo_inscripcion: "4000.00", categoria_nombre: "DRAGSTER" },
      ];
    }
  });
  const r = await h.pedir("GET", "/reportes/por-categoria?etapa_id=2", { token: ADMIN() });
  assert.equal(r.status, 200);
  const g = r.data.agrupado.DRAGSTER;
  assert.equal(g.costo, 4000);
  assert.equal(g.total_cobrado, 4000);
  assert.equal(g.total_esperado, 8000);
});

// ── Bug 7 ─────────────────────────────────────────────────────────────────────
test("PATCH /inscripciones/:id/pagar guarda un monto de 0 como 0 (no NULL)", async () => {
  h.reiniciar((sql) => {
    if (/FROM inscripciones i/.test(sql)) return [{ id: 4, estatus: "Pagado" }];
  });
  const r = await h.pedir("PATCH", "/inscripciones/4/pagar", {
    token: STAFF(), body: { metodo_pago: "Intercambio", monto_pago: 0 },
  });
  assert.equal(r.status, 200);
  const [upd] = h.buscar(/UPDATE inscripciones SET estatus='Pagado'/);
  assert.equal(upd.params[1], 0);
});

test("PATCH /inscripciones/:id/pagar rechaza montos negativos y da 404 si no existe", async () => {
  h.reiniciar((sql) => (/UPDATE inscripciones/.test(sql) ? { affectedRows: 0 } : undefined));
  const neg = await h.pedir("PATCH", "/inscripciones/4/pagar", { token: STAFF(), body: { monto_pago: -50 } });
  assert.equal(neg.status, 400);
  const nf = await h.pedir("PATCH", "/inscripciones/999/pagar", { token: STAFF(), body: { monto_pago: 100 } });
  assert.equal(nf.status, 404);
});

// ── Bug 8 ─────────────────────────────────────────────────────────────────────
test("auto-registro con el correo de otro piloto y otro número se rechaza sin inscribir", async () => {
  h.reiniciar((sql) => {
    if (/SELECT campeonato_id, fecha_apertura_inscripcion/.test(sql)) {
      return [{ campeonato_id: 1, fecha_apertura_inscripcion: null, fecha_cierre_inscripcion: null }];
    }
    if (/SELECT \* FROM pilotos WHERE email = \?/.test(sql)) return [{ id: 10, numero_piloto: 23, email: "ajeno@correo.com" }];
  });
  const r = await h.pedir("POST", "/inscripciones/auto-registro", {
    body: {
      etapa_id: 1, categoria_ids: [2], numero_piloto: 77, vehiculo: "Ford",
      email: "ajeno@correo.com", apellido_paterno: "Impostor", nombres: "X", tipo_sangre: "O+",
    },
  });
  assert.equal(r.status, 409);
  assert.equal(h.buscar(/INSERT INTO inscripciones/).length, 0);
});

test("auto-registro del propio piloto (correo + su número) sí inscribe", async () => {
  h.reiniciar((sql) => {
    if (/SELECT campeonato_id, fecha_apertura_inscripcion/.test(sql)) {
      return [{ campeonato_id: 1, fecha_apertura_inscripcion: null, fecha_cierre_inscripcion: null }];
    }
    if (/SELECT \* FROM pilotos WHERE email = \?/.test(sql)) return [{ id: 10, numero_piloto: 23 }];
    if (/FROM contratos_anuales/.test(sql)) return [{ id: 1 }];
    if (/WHERE i.id IN/.test(sql)) return [{ id: 1 }];
  });
  const r = await h.pedir("POST", "/inscripciones/auto-registro", {
    body: { etapa_id: 1, categoria_ids: [2], numero_piloto: 23, vehiculo: "Ford", email: "yo@correo.com" },
  });
  assert.equal(r.status, 201);
  assert.equal(h.buscar(/INSERT INTO inscripciones/).length, 1);
});

test("POST /inscripciones (staff) no acepta un número distinto al del piloto", async () => {
  h.reiniciar((sql) => (/SELECT numero_piloto FROM pilotos/.test(sql) ? [{ numero_piloto: 23 }] : undefined));
  const r = await h.pedir("POST", "/inscripciones", {
    token: STAFF(), body: { piloto_id: 10, etapa_id: 1, categoria_id: 2, numero_piloto: 5, vehiculo: "Ford" },
  });
  assert.equal(r.status, 409);
  assert.equal(h.buscar(/INSERT INTO inscripciones/).length, 0);
});

// ── Bug 9 ─────────────────────────────────────────────────────────────────────
test("Ninguna respuesta con datos de piloto incluye el hash de contraseña ni el token de recuperación", async () => {
  const fila = { id: 5, nombre_completo: "Juan", password: "$2a$10$hash", reset_token_hash: "abc", reset_token_expira: "2026-10-02" };
  h.reiniciar((sql) => (/SELECT \* FROM pilotos/.test(sql) ? [{ ...fila }] : undefined));
  const respuestas = [
    await h.pedir("GET", "/pilotos/5", { token: STAFF() }),
    await h.pedir("GET", "/formularios/piloto/5", { token: STAFF() }),
    await h.pedir("GET", "/piloto/mi-perfil", { token: h.tokenPiloto(5) }),
  ];
  for (const r of respuestas) {
    assert.equal(r.status, 200);
    const texto = JSON.stringify(r.data);
    assert.ok(!texto.includes("$2a$10$hash"), "no debe filtrar el hash de la contraseña");
    assert.ok(!texto.includes("reset_token"), "no debe filtrar el token de recuperación");
  }
});

// ── Bug 10 ────────────────────────────────────────────────────────────────────
test("GET /contratos/estado (público) no expone la IP de firma", async () => {
  h.reiniciar((sql) => {
    if (/FROM contratos_anuales/.test(sql)) {
      // Simula lo que devuelve MySQL según las columnas pedidas.
      return /SELECT \*/.test(sql)
        ? [{ id: 1, piloto_id: 5, anio: 2026, fecha_firma: "2026-02-01", ip_firma: "201.141.1.1" }]
        : [{ anio: 2026, fecha_firma: "2026-02-01" }];
    }
  });
  const r = await h.pedir("GET", "/contratos/estado?piloto_id=5&anio=2026");
  assert.equal(r.status, 200);
  assert.equal(r.data.firmado, true);
  assert.ok(!JSON.stringify(r.data).includes("201.141.1.1"));
});

// ── Menores ───────────────────────────────────────────────────────────────────
test("PATCH /piloto/mi-perfil rechaza una nueva contraseña corta en vez de ignorarla", async () => {
  h.reiniciar();
  const r = await h.pedir("PATCH", "/piloto/mi-perfil", { token: h.tokenPiloto(5), body: { telefono: "8112345678", nueva_password: "123" } });
  assert.equal(r.status, 400);
  assert.equal(h.buscar(/UPDATE pilotos SET/).length, 0);
});

// ── Bug 11 ────────────────────────────────────────────────────────────────────
// Simula una BD ya migrada: todas las tablas/columnas existen. `etapasDe`
// indica qué etapas tiene cada campeonato y `nulasDe` cuántas inscripciones
// sin etapa (formato de antes de que existieran las etapas).
function bdArrancada({ etapasDe, nulasDe }) {
  return (sql, params = []) => {
    if (/information_schema\.TABLES/.test(sql)) return [{ cnt: 1 }];
    if (/information_schema\.COLUMNS/.test(sql)) return [{ cnt: params.includes("carrera_id") ? 0 : 1 }];
    if (/^SHOW INDEX/.test(sql)) return params.includes("uk_campeonato_numero") ? [] : [{ Key_name: params[0] }];
    if (/FROM usuarios WHERE username = 'admin'/.test(sql)) return [{ id: 1 }];
    // Consulta anterior: cualquier campeonato activo, luego "¿tiene etapa numero=1?"
    if (/SELECT \* FROM campeonatos WHERE activo = 1/.test(sql)) return [{ id: 1, fecha: null, ubicacion: "AM" }];
    if (/FROM etapas WHERE campeonato_id = \? AND numero = 1/.test(sql)) {
      return (etapasDe[params[0]] || []).filter(n => n === 1).map(() => ({ id: 99 }));
    }
    // Consulta nueva: solo campeonatos sin ninguna etapa y con inscripciones sin etapa.
    if (/NOT EXISTS \(SELECT 1 FROM etapas/.test(sql)) {
      return Object.keys(nulasDe).map(Number)
        .filter(id => !(etapasDe[id] || []).length && nulasDe[id] > 0)
        .map(id => ({ id, fecha: null, ubicacion: "AM" }));
    }
    if (/INSERT INTO etapas/.test(sql)) return { insertId: 500, affectedRows: 1 };
  };
}

test("inicializarBD no resucita la Etapa 1 borrada ni mueve inscripciones en cada arranque", async () => {
  const { inicializarBD } = require("../db/init");
  // Campeonato 1: su Etapa 1 se borró (numero = -id) y quedó la Etapa 2.
  h.reiniciar(bdArrancada({ etapasDe: { 1: [-7, 2] }, nulasDe: { 1: 0 } }));
  await inicializarBD();
  assert.equal(h.buscar(/INSERT INTO etapas/).length, 0, "no debe crear una Etapa 1 nueva");
  assert.equal(h.buscar(/UPDATE inscripciones\s+(i\s+JOIN|SET etapa_id)/).length, 0, "no debe reasignar inscripciones");
});

test("inicializarBD sí migra un campeonato legado sin etapas con inscripciones sin etapa", async () => {
  const { inicializarBD } = require("../db/init");
  h.reiniciar(bdArrancada({ etapasDe: { 3: [] }, nulasDe: { 3: 4 } }));
  await inicializarBD();
  assert.equal(h.buscar(/INSERT INTO etapas/).length, 1);
  const [upd] = h.buscar(/UPDATE inscripciones SET etapa_id/);
  assert.deepEqual(upd.params, [500, 3]);
});

// ── Roles (hoja "ROLES DEL SISTEMA", octubre 2026) ────────────────────────────
const TORRE = () => h.tokenSistema("torre");

test("Roles: corte de caja solo admin (staff y torre 403)", async () => {
  h.reiniciar();
  assert.equal((await h.pedir("GET", "/reportes/corte-general?todos=true", { token: STAFF() })).status, 403);
  assert.equal((await h.pedir("GET", "/reportes/corte-general?todos=true", { token: TORRE() })).status, 403);
  assert.equal((await h.pedir("GET", "/reportes/corte-general?todos=true", { token: ADMIN() })).status, 200);
});

test("Roles: staff ve el reporte de inscripciones por categoría pero sin montos; torre no lo ve", async () => {
  h.reiniciar((sql) => (/FROM inscripciones i/.test(sql)
    ? [{ estatus: "Pagado", metodo_pago: "Efectivo", monto_pago: "2300.00", costo_inscripcion: "2300.00", categoria_nombre: "PONY 1" }]
    : undefined));
  const staff = await h.pedir("GET", "/reportes/por-categoria?etapa_id=1", { token: STAFF() });
  assert.equal(staff.status, 200);
  const g = staff.data.agrupado["PONY 1"];
  assert.equal(g.pagados, 1);
  assert.ok(!("total_cobrado" in g) && !("total_esperado" in g) && !("costo" in g));
  assert.ok(!JSON.stringify(staff.data).includes("2300"), "staff no recibe ninguna cifra de dinero");
  const admin = await h.pedir("GET", "/reportes/por-categoria?etapa_id=1", { token: ADMIN() });
  assert.equal(admin.data.agrupado["PONY 1"].total_cobrado, 2300);
  assert.equal((await h.pedir("GET", "/reportes/por-categoria?etapa_id=1", { token: TORRE() })).status, 403);
});

test("Roles: cambiar estatus solo torre y admin (staff 403)", async () => {
  h.reiniciar((sql) => (/SELECT pagado_en, notas FROM inscripciones/.test(sql) ? [{ pagado_en: null, notas: null }] : undefined));
  const body = { estatus: "Descalificado" };
  assert.equal((await h.pedir("PATCH", "/inscripciones/4/estatus", { token: STAFF(), body })).status, 403);
  assert.equal((await h.pedir("PATCH", "/inscripciones/4/estatus", { token: TORRE(), body })).status, 200);
  assert.equal((await h.pedir("PATCH", "/inscripciones/4/estatus", { token: ADMIN(), body })).status, 200);
});

test("Roles: torre no puede marcar 'Pagado' una inscripción que nunca se cobró", async () => {
  h.reiniciar((sql) => (/SELECT pagado_en, notas FROM inscripciones/.test(sql) ? [{ pagado_en: null, notas: null }] : undefined));
  const r = await h.pedir("PATCH", "/inscripciones/4/estatus", { token: TORRE(), body: { estatus: "Pagado" } });
  assert.equal(r.status, 409);
  assert.equal(h.buscar(/UPDATE inscripciones SET estatus/).length, 0);
  // Pero sí puede reactivar como Pagado a quien ya había pagado y fue descalificado.
  h.reiniciar((sql) => (/SELECT pagado_en, notas FROM inscripciones/.test(sql) ? [{ pagado_en: "2026-10-01 10:00:00", notas: null }] : undefined));
  assert.equal((await h.pedir("PATCH", "/inscripciones/4/estatus", { token: TORRE(), body: { estatus: "Pagado" } })).status, 200);
});

test("Roles: capturar resultados solo torre y admin (staff 403)", async () => {
  h.reiniciar((sql) => (/FROM inscripciones\s+WHERE etapa_id/.test(sql) ? [{ piloto_id: 7 }] : undefined));
  const body = { etapa_id: 1, categoria_id: 2, resultados: [{ piloto_id: 7, posicion: 1 }] };
  assert.equal((await h.pedir("POST", "/resultados", { token: STAFF(), body })).status, 403);
  assert.equal((await h.pedir("POST", "/resultados", { token: TORRE(), body })).status, 200);
  assert.equal((await h.pedir("POST", "/resultados", { token: ADMIN(), body })).status, 200);
});

test("Roles: cobrar sigue siendo de staff; torre no puede marcar pagos", async () => {
  h.reiniciar((sql) => (/FROM inscripciones i/.test(sql) ? [{ id: 4 }] : undefined));
  const body = { metodo_pago: "Efectivo", monto_pago: 100 };
  assert.equal((await h.pedir("PATCH", "/inscripciones/4/pagar", { token: TORRE(), body })).status, 403);
  assert.equal((await h.pedir("PATCH", "/inscripciones/4/pagar", { token: STAFF(), body })).status, 200);
});

test("Roles: la lista de inscripciones no manda dinero ni contacto a torre, ni montos cobrados a staff", async () => {
  const fila = {
    id: 1, vehiculo: "Ford", vehiculo_original: "Ford", estatus: "Pagado", pagado_en: "2026-10-01",
    monto_pago: "2300.00", metodo_pago: "Efectivo", pagado_por: "caja1", costo_categoria: "2300.00",
    piloto_telefono: "8112345678", piloto_nacionalidad: "Mexicana",
  };
  h.reiniciar((sql) => (/FROM inscripciones i/.test(sql) ? [{ ...fila }] : undefined));
  const [torre] = (await h.pedir("GET", "/inscripciones?etapa_id=1", { token: TORRE() })).data;
  for (const campo of ["monto_pago", "metodo_pago", "pagado_por", "costo_categoria", "piloto_telefono", "piloto_nacionalidad"]) {
    assert.ok(!(campo in torre), `torre no debe recibir ${campo}`);
  }
  assert.equal(torre.pagado_en, "2026-10-01", "torre necesita saber si hubo cobro para reactivar como Pagado");
  const [staff] = (await h.pedir("GET", "/inscripciones?etapa_id=1", { token: STAFF() })).data;
  assert.ok(!("monto_pago" in staff));
  assert.equal(staff.costo_categoria, "2300.00", "staff necesita el costo para cobrar");
  const [admin] = (await h.pedir("GET", "/inscripciones?etapa_id=1", { token: ADMIN() })).data;
  assert.equal(admin.monto_pago, "2300.00");
});

test("Roles: detalle de piloto no manda el monto cobrado a staff", async () => {
  h.reiniciar((sql) => {
    if (/SELECT \* FROM pilotos/.test(sql)) return [{ id: 5, nombre_completo: "Juan" }];
    if (/FROM inscripciones i/.test(sql)) return [{ id: 1, monto_pago: "2300.00" }];
  });
  const staff = await h.pedir("GET", "/pilotos/5", { token: STAFF() });
  assert.ok(!("monto_pago" in staff.data.inscripciones[0]));
  const admin = await h.pedir("GET", "/pilotos/5", { token: ADMIN() });
  assert.equal(admin.data.inscripciones[0].monto_pago, "2300.00");
});

test("Roles: lo exclusivo de admin sigue cerrado para staff y torre", async () => {
  h.reiniciar();
  for (const token of [STAFF(), TORRE()]) {
    assert.equal((await h.pedir("POST", "/campeonatos", { token, body: { nombre: "X" } })).status, 403);
    assert.equal((await h.pedir("DELETE", "/pilotos/5", { token })).status, 403);
    assert.equal((await h.pedir("PATCH", "/pilotos/5/reset-password", { token, body: { password: "123456" } })).status, 403);
    assert.equal((await h.pedir("GET", "/usuarios", { token })).status, 403);
  }
  // Torre no registra pilotos ni inscribe.
  assert.equal((await h.pedir("POST", "/pilotos", { token: TORRE(), body: { nombre_completo: "X" } })).status, 403);
  assert.equal((await h.pedir("POST", "/inscripciones", { token: TORRE(), body: {} })).status, 403);
});

test("Roles: una inscripción ya cobrada no puede volver a 'Pendiente' (evita doble cobro)", async () => {
  h.reiniciar((sql) => (/SELECT pagado_en, notas FROM inscripciones/.test(sql) ? [{ pagado_en: "2026-10-01 10:00:00", notas: null }] : undefined));
  const r = await h.pedir("PATCH", "/inscripciones/4/estatus", { token: TORRE(), body: { estatus: "Pendiente" } });
  assert.equal(r.status, 409);
  assert.equal(h.buscar(/UPDATE inscripciones SET estatus/).length, 0);
});

test("Corte: el dinero de alguien descalificado después de pagar sigue contando en caja", async () => {
  h.reiniciar((sql) => {
    if (/FROM campeonatos WHERE id = \?/.test(sql)) return [{ id: 1, nombre: "C" }];
    if (/FROM inscripciones i/.test(sql)) {
      return [
        { estatus: "Pagado", pagado_en: "2026-10-01", metodo_pago: "Efectivo", monto_pago: "1000.00", costo_inscripcion: "1000.00", categoria_nombre: "A" },
        { estatus: "Descalificado", pagado_en: "2026-10-01", metodo_pago: "Efectivo", monto_pago: "1000.00", costo_inscripcion: "1000.00", categoria_nombre: "A" },
        { estatus: "Descalificado", pagado_en: null, metodo_pago: null, monto_pago: null, costo_inscripcion: "1000.00", categoria_nombre: "A" },
      ];
    }
  });
  const r = await h.pedir("GET", "/reportes/corte-general?campeonato_id=1", { token: ADMIN() });
  assert.equal(r.data.resumen.ingresos, 2000);
  assert.equal(r.data.resumen.ingresosEfectivo, 2000, "el arqueo debe esperar ambos cobros en efectivo");
  assert.equal(r.data.resumen.esperado, 2000, "el descalificado sin cobro no se espera");
  assert.equal(r.data.resumen.pagados, 1);
});

// test/smoke-produccion.js — pruebas de caja negra contra el sistema YA DESPLEGADO
// (no localhost). Deliberadamente NO escriben datos reales: cada caso o es de
// solo lectura, o manda datos que el servidor debe RECHAZAR antes de guardar
// nada (así no se ensucia la base de datos limpia de producción).
//
// Correr con: node test/smoke-produccion.js
"use strict";

const API = "https://api.inscripcionesautodromomty.com/api";
const FRONTEND = "https://inscripcionesautodromomty.com";

let ok = 0, fail = 0;

function reportar(nombre, pasa, detalle) {
  if (pasa) { ok++; console.log(`✅ ${nombre}`); }
  else { fail++; console.log(`❌ ${nombre}${detalle ? " — " + detalle : ""}`); }
}

async function jsonSeguro(res) {
  try { return await res.json(); } catch { return null; }
}

async function main() {
  console.log(`Probando contra:\n  API:      ${API}\n  Frontend: ${FRONTEND}\n`);

  // 1. Backend vivo
  try {
    const res = await fetch(`${API}/health`);
    const data = await jsonSeguro(res);
    reportar("Backend responde /api/health", res.status === 200 && data && data.ok === true);
  } catch (e) { reportar("Backend responde /api/health", false, e.message); }

  // 2. Frontend vivo
  try {
    const res = await fetch(FRONTEND, { redirect: "follow" });
    reportar("Frontend carga (dominio propio, SSL válido)", res.status === 200);
  } catch (e) { reportar("Frontend carga (dominio propio, SSL válido)", false, e.message); }

  // 3. config.js del frontend apunta al backend correcto
  try {
    const res = await fetch(`${FRONTEND}/admin/config.js`);
    const texto = await res.text();
    reportar("Frontend apunta al backend correcto (API_URL)", texto.includes("api.inscripcionesautodromomty.com"));
  } catch (e) { reportar("Frontend apunta al backend correcto (API_URL)", false, e.message); }

  // 4. CORS acepta el origen real del frontend
  try {
    const res = await fetch(`${API}/health`, { headers: { Origin: FRONTEND } });
    reportar("CORS permite el origen real del frontend", res.headers.get("access-control-allow-origin") === FRONTEND);
  } catch (e) { reportar("CORS permite el origen real del frontend", false, e.message); }

  // 5. CORS rechaza un origen falso (que no sea un "permite todo" disfrazado)
  try {
    const res = await fetch(`${API}/health`, { headers: { Origin: "https://sitio-impostor-cualquiera.com" } });
    const permitioOrigenFalso = res.headers.get("access-control-allow-origin") === "https://sitio-impostor-cualquiera.com";
    reportar("CORS RECHAZA un origen que no es el del frontend", !permitioOrigenFalso);
  } catch (e) { reportar("CORS RECHAZA un origen que no es el del frontend", false, e.message); }

  // 6. Login con credenciales incorrectas — debe rechazar sin tronar ni filtrar info
  try {
    const res = await fetch(`${API}/auth/login-unico`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identificador: "no-existe-esta-cuenta@correo-falso.com", password: "loquesea123" }),
    });
    const data = await jsonSeguro(res);
    reportar("Login con credenciales falsas se rechaza (401, sin filtrar detalles)", res.status === 401 && !!data && !!data.error);
  } catch (e) { reportar("Login con credenciales falsas se rechaza (401, sin filtrar detalles)", false, e.message); }

  // 7. Recuperar contraseña con correo que no existe — no debe delatarlo (anti-enumeración)
  //    y no debe escribir nada en la BD (el código solo actualiza si el piloto existe).
  try {
    const res = await fetch(`${API}/piloto/forgot-password`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "esta-cuenta-no-existe-de-verdad@correo-falso.com" }),
    });
    const data = await jsonSeguro(res);
    reportar("Recuperar contraseña con correo inexistente da mensaje genérico (no delata)", res.status === 200 && !!data && !!data.mensaje);
  } catch (e) { reportar("Recuperar contraseña con correo inexistente da mensaje genérico (no delata)", false, e.message); }

  // 8. Auto-registro rechaza un vehículo no válido ANTES de guardar nada
  try {
    const res = await fetch(`${API}/inscripciones/auto-registro`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        categoria_ids: [999999], numero_piloto: 999999, vehiculo: "Bicicleta",
        campeonato_id: 999999, apellido_paterno: "Prueba", nombres: "Smoke Test", tipo_sangre: "O+",
      }),
    });
    const data = await jsonSeguro(res);
    reportar("Auto-registro RECHAZA un vehículo inválido (bicicleta) sin guardar nada", res.status === 400 && !!data && !!data.error);
  } catch (e) { reportar("Auto-registro RECHAZA un vehículo inválido (bicicleta) sin guardar nada", false, e.message); }

  // 9. Auto-registro rechaza cuando faltan campos obligatorios
  try {
    const res = await fetch(`${API}/inscripciones/auto-registro`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoria_ids: [] }),
    });
    reportar("Auto-registro rechaza una solicitud sin categoría/vehículo/número", res.status === 400);
  } catch (e) { reportar("Auto-registro rechaza una solicitud sin categoría/vehículo/número", false, e.message); }

  // 10. Rutas protegidas exigen token — no se puede leer nada sin iniciar sesión
  try {
    const res = await fetch(`${API}/pilotos`);
    reportar("Endpoint protegido (/pilotos) exige token (401 sin uno)", res.status === 401);
  } catch (e) { reportar("Endpoint protegido (/pilotos) exige token (401 sin uno)", false, e.message); }

  // 11. Ruta inexistente da 404 limpio, no un error crudo del servidor
  try {
    const res = await fetch(`${API}/esto-no-existe-para-nada`);
    reportar("Ruta inexistente da 404 controlado", res.status === 404);
  } catch (e) { reportar("Ruta inexistente da 404 controlado", false, e.message); }

  console.log(`\n${ok} pasaron, ${fail} fallaron.`);
  if (fail > 0) process.exit(1);
}

main();

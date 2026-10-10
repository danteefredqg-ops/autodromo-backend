// scripts/vaciar-produccion.js — deja la base de datos "en ceros" para la
// entrega al cliente: borra todo lo operativo (pilotos, inscripciones,
// campeonatos, etapas, resultados, contratos, preparadores, imágenes) y
// CONSERVA las cuentas del sistema (usuarios) y las categorías activas con sus
// precios y reglas.
//
// Uso (desde la carpeta backend):
//   node scripts/vaciar-produccion.js
// Pide la URL pública de MySQL de Railway (servicio MySQL → Variables →
// MYSQL_PUBLIC_URL, formato mysql://usuario:contraseña@host:puerto/base). También
// se puede pasar en la variable de entorno MYSQL_PUBLIC_URL.
//
// Pasos: 1) respaldo .sql completo en <proyecto>/respaldos/ (fuera de los repos
// de git), 2) muestra cuánto va a borrar, 3) pide escribir CONFIRMAR, 4) borra
// todo en UNA transacción (si algo falla no se borra nada), 5) verifica.
//
// Se usa DELETE y no TRUNCATE a propósito: TRUNCATE reinicia los ids, y un
// piloto viejo con su sesión aún abierta (dura 7 días) quedaría apuntando al
// mismo id que el primer piloto nuevo — entraría a su cuenta. Con DELETE los
// ids siguen desde donde iban y esas sesiones viejas quedan inválidas.
"use strict";

const fs       = require("fs");
const path     = require("path");
const readline = require("readline");

// Orden seguro para las llaves foráneas: primero lo que apunta a otras tablas.
const BORRADOS = [
  { tabla: "resultados",            sql: "DELETE FROM resultados" },
  { tabla: "imagenes_registro",     sql: "DELETE FROM imagenes_registro" },
  { tabla: "inscripciones",         sql: "DELETE FROM inscripciones" },
  { tabla: "contratos_anuales",     sql: "DELETE FROM contratos_anuales" },
  { tabla: "preparadores",          sql: "DELETE FROM preparadores" },
  { tabla: "pilotos",               sql: "DELETE FROM pilotos" },
  { tabla: "campeonato_categorias", sql: "DELETE FROM campeonato_categorias" },
  { tabla: "etapas",                sql: "DELETE FROM etapas" },
  { tabla: "campeonatos",           sql: "DELETE FROM campeonatos" },
  // Categorías que el admin ya había eliminado (ocultas, nombre "eliminada_…").
  { tabla: "categorias eliminadas", sql: "DELETE FROM categorias WHERE activo = 0" },
];
const CONSERVADAS = [
  { tabla: "usuarios (cuentas del sistema)", sql: "SELECT COUNT(*) AS n FROM usuarios" },
  { tabla: "categorías activas",             sql: "SELECT COUNT(*) AS n FROM categorias WHERE activo = 1" },
];

const contarSQL = (b) => b.sql.replace(/^DELETE FROM/, "SELECT COUNT(*) AS n FROM");

async function contar(conn) {
  const borrar = [];
  for (const b of BORRADOS) {
    const [[{ n }]] = await conn.query(contarSQL(b));
    borrar.push({ tabla: b.tabla, n: Number(n) });
  }
  const conservar = [];
  for (const c of CONSERVADAS) {
    const [[{ n }]] = await conn.query(c.sql);
    conservar.push({ tabla: c.tabla, n: Number(n) });
  }
  return { borrar, conservar };
}

// Todo o nada: si un DELETE falla, se revierten los anteriores.
async function vaciar(conn) {
  await conn.beginTransaction();
  try {
    for (const b of BORRADOS) await conn.query(b.sql);
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  }
}

function preguntar(rl, texto) {
  return new Promise((ok) => rl.question(texto, (r) => ok(r.trim())));
}

async function main() {
  const mysql = require("mysql2/promise");
  const { generarBackupSQL } = require("../configuracion/backup");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let conn;
  try {
    const url = process.env.MYSQL_PUBLIC_URL || await preguntar(rl, "URL pública de MySQL (MYSQL_PUBLIC_URL de Railway): ");
    if (!/^mysql:\/\//.test(url)) throw new Error("La URL debe empezar con mysql://");
    const destino = new URL(url);
    conn = await mysql.createConnection({ uri: url, charset: "utf8mb4", dateStrings: true });
    console.log(`\nConectado a ${destino.hostname}:${destino.port} / base "${destino.pathname.slice(1)}"`);

    // 1) Respaldo completo antes de tocar nada.
    const carpeta = path.join(__dirname, "..", "..", "respaldos");
    fs.mkdirSync(carpeta, { recursive: true });
    const sello = new Date(Date.now() - 6 * 3600 * 1000).toISOString().slice(0, 16).replace(/[T:]/g, "-");
    const archivo = path.join(carpeta, `antes-de-vaciar-${sello}.sql`);
    console.log("\n1) Generando respaldo completo...");
    fs.writeFileSync(archivo, await generarBackupSQL(conn), "utf8");
    console.log(`   ✅ Guardado en ${archivo} (${(fs.statSync(archivo).size / 1024).toFixed(1)} KB)`);
    console.log("   Guárdalo: es la única copia de lo que se va a borrar.");

    // 2) Qué se va a borrar y qué se queda.
    const { borrar, conservar } = await contar(conn);
    console.log("\n2) Se BORRARÁ:");
    for (const b of borrar) console.log(`   - ${b.tabla.padEnd(24)} ${b.n}`);
    console.log("   Se CONSERVA:");
    for (const c of conservar) console.log(`   + ${c.tabla.padEnd(32)} ${c.n}`);

    // 3) Confirmación explícita.
    const respuesta = await preguntar(rl, '\n3) Esto NO se puede deshacer (salvo con el respaldo). Escribe CONFIRMAR para borrar: ');
    if (respuesta !== "CONFIRMAR") {
      console.log("   Cancelado. No se borró nada.");
      return;
    }

    // 4) Borrado en una sola transacción.
    console.log("\n4) Borrando...");
    await vaciar(conn);

    // 5) Verificación.
    const despues = await contar(conn);
    const quedan = despues.borrar.filter(b => b.n > 0);
    if (quedan.length) throw new Error(`Quedaron registros: ${quedan.map(b => `${b.tabla}=${b.n}`).join(", ")}`);
    console.log("   ✅ Base de datos en ceros. Se conservaron:");
    for (const c of despues.conservar) console.log(`   + ${c.tabla.padEnd(32)} ${c.n}`);
    console.log("\nSiguiente paso: en Railway, reinicia el servicio del backend (Deployments → ⋮ → Restart).");
    console.log("Al arrancar borra las fotos e imágenes que ya no pertenecen a nadie (ver logs: \"🧹\").");
  } catch (err) {
    console.error(`\n❌ ${err.message}\nNo se completó el borrado.`);
    process.exitCode = 1;
  } finally {
    rl.close();
    if (conn) await conn.end().catch(() => {});
  }
}

if (require.main === module) main();

module.exports = { BORRADOS, CONSERVADAS, contar, vaciar };

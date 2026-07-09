// Borra (definitivamente) todos los pilotos creados por seed-pilotos-prueba.js
// Uso:  node scripts/borrar-pilotos-prueba.js

const db = require("../configuracion/db");

async function main() {
  const [result] = await db.query(
    "DELETE FROM pilotos WHERE notas LIKE 'PILOTO DE PRUEBA%'"
  );
  console.log(`✓ ${result.affectedRows} piloto(s) de prueba eliminados.`);
  process.exit(0);
}

main().catch(err => {
  console.error("Error al borrar pilotos de prueba:", err.message);
  process.exit(1);
});

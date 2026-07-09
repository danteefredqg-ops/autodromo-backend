// Genera pilotos de prueba para ver el dashboard/base de datos con volumen de datos.
// Uso:  node scripts/seed-pilotos-prueba.js [cantidad]
// Requiere las mismas variables de entorno que el servidor (MYSQLHOST, MYSQLUSER, etc.)
// — o un archivo .env cargado antes de correrlo (ver backend/.env.example).
//
// Todos quedan marcados con notas = 'PILOTO DE PRUEBA' y numero_piloto muy por encima
// de cualquier número real, para poder identificarlos y borrarlos fácilmente después
// con:  node scripts/borrar-pilotos-prueba.js

const db = require("../configuracion/db");

const CANTIDAD = parseInt(process.argv[2]) || 250;

const NOMBRES = [
  "Juan","Carlos","Miguel","Luis","José","Jorge","Alejandro","Fernando","Ricardo","Eduardo",
  "Diego","Roberto","Francisco","Manuel","Sergio","Raúl","Óscar","Iván","Gerardo","Adrián",
  "María","Ana","Sofía","Daniela","Fernanda","Paola","Andrea","Valeria","Camila","Ximena",
  "Gabriela","Alejandra","Karla","Mariana","Regina","Lucía","Renata","Natalia","Jimena","Diana",
];
const APELLIDOS = [
  "García","Martínez","López","Hernández","González","Pérez","Sánchez","Ramírez","Flores","Rivera",
  "Torres","Díaz","Vargas","Castillo","Jiménez","Morales","Ortiz","Gómez","Cruz","Reyes",
  "Guerrero","Medina","Aguilar","Vázquez","Contreras","Salinas","Cavazos","Villarreal","Elizondo","Garza",
];
const SANGRES = ["O+","O-","A+","A-","B+","B-","AB+","AB-"];

function elegir(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

async function main() {
  const [[{ maxNum }]] = await db.query("SELECT COALESCE(MAX(numero_piloto),0) AS maxNum FROM pilotos");
  const inicio = Math.max(maxNum + 1, 9000) + 1000; // margen amplio para no chocar con números reales

  const vals = [];
  for (let i = 0; i < CANTIDAD; i++) {
    const nombres = elegir(NOMBRES);
    const apPat = elegir(APELLIDOS);
    const apMat = elegir(APELLIDOS);
    const numero = inicio + i;
    const nombreCompleto = `${nombres} ${apPat} ${apMat}`;
    vals.push([
      apPat, apMat, nombres, numero, nombreCompleto,
      `81${String(10000000 + Math.floor(Math.random() * 89999999))}`,
      `prueba.${numero}@test.local`,
      elegir(SANGRES),
      "Monterrey", "Nuevo León", "Mexicana", "Vigente",
      "PILOTO DE PRUEBA — generado con seed-pilotos-prueba.js, se puede borrar",
    ]);
  }

  await db.query(
    `INSERT INTO pilotos
      (apellido_paterno, apellido_materno, nombres, numero_piloto, nombre_completo,
       telefono, email, tipo_sangre, ciudad, estado, nacionalidad, estatus_licencia, notas)
     VALUES ?`,
    [vals]
  );

  console.log(`✓ ${CANTIDAD} pilotos de prueba creados (numero_piloto ${inicio}–${inicio + CANTIDAD - 1}).`);
  console.log(`  Para borrarlos después: node scripts/borrar-pilotos-prueba.js`);
  process.exit(0);
}

main().catch(err => {
  console.error("Error al generar pilotos de prueba:", err.message);
  process.exit(1);
});

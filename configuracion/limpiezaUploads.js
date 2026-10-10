// configuracion/limpiezaUploads.js — al arrancar, borra fotos e imágenes que
// ya no pertenecen a ningún registro (p.ej. después de vaciar la base de datos
// con scripts/vaciar-produccion.js, o de pilotos que cambiaron de foto con otra
// extensión). Sin esto quedaban en el Volume de Railway fotos de personas que
// ya no están en el sistema, accesibles a quien adivinara la URL.
//
// Candados:
//   - Solo toca las 3 carpetas de uploads conocidas, y solo archivos (no carpetas).
//   - Un archivo se conserva si su nombre aparece en la BD (foto de piloto, de
//     preparador o imagen de registro) — se compara por nombre de archivo.
//   - Nunca borra archivos modificados en los últimos 10 minutos: una subida
//     guarda el archivo un instante antes de anotarlo en la BD.
//   - Si la consulta a la BD falla, no borra nada.
const fs   = require("fs");
const path = require("path");
const { PILOTOS_DIR, PREPARADORES_DIR, REGISTRO_DIR } = require("./uploads");

const MARGEN_MS = 10 * 60 * 1000;
const nombreDeUrl = (url) => path.basename(String(url || "").split("?")[0]);

async function limpiarArchivosHuerfanos(db, carpetas = [PILOTOS_DIR, PREPARADORES_DIR, REGISTRO_DIR]) {
  const [fotosPilotos]  = await db.query("SELECT foto_perfil AS url FROM pilotos WHERE foto_perfil IS NOT NULL");
  const [fotosPrep]     = await db.query("SELECT foto_perfil AS url FROM preparadores WHERE foto_perfil IS NOT NULL");
  const [imagenes]      = await db.query("SELECT archivo AS url FROM imagenes_registro");
  const enUso = new Set([...fotosPilotos, ...fotosPrep, ...imagenes].map(r => nombreDeUrl(r.url)).filter(Boolean));

  let borrados = 0;
  for (const carpeta of carpetas) {
    if (!fs.existsSync(carpeta)) continue;
    for (const nombre of fs.readdirSync(carpeta)) {
      const ruta = path.join(carpeta, nombre);
      const info = fs.statSync(ruta);
      if (!info.isFile() || enUso.has(nombre)) continue;
      if (Date.now() - info.mtimeMs < MARGEN_MS) continue;
      fs.unlinkSync(ruta);
      borrados++;
    }
  }
  if (borrados) console.log(`🧹 ${borrados} archivo(s) sin dueño borrados de uploads`);
  return borrados;
}

module.exports = { limpiarArchivosHuerfanos };

// configuracion/uploads.js — dónde se guardan archivos subidos (fotos de perfil, etc.)
//
// En Railway: conecta un Volume al servicio backend y monta el env var
// UPLOADS_DIR apuntando a esa ruta (ej. /data/uploads) para que las fotos
// sobrevivan entre despliegues. Sin esa variable, cae a una carpeta local
// dentro del proyecto — funciona para desarrollo, pero Railway la borra en
// cada deploy si no hay un Volume real montado ahí.

const fs   = require("fs");
const path = require("path");

const UPLOADS_DIR      = process.env.UPLOADS_DIR || path.join(__dirname, "..", "uploads");
const PILOTOS_DIR      = path.join(UPLOADS_DIR, "pilotos");
const PREPARADORES_DIR = path.join(UPLOADS_DIR, "preparadores");

for (const dir of [UPLOADS_DIR, PILOTOS_DIR, PREPARADORES_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// Visible en los logs de arranque para confirmar de un vistazo si las fotos
// van a sobrevivir el próximo deploy (Volume montado) o no (carpeta efímera).
console.log(
  process.env.UPLOADS_DIR
    ? `📁 Uploads: ${UPLOADS_DIR} (persistente — UPLOADS_DIR configurado)`
    : `📁 Uploads: ${UPLOADS_DIR} (⚠️ efímero — se borra en cada deploy, falta UPLOADS_DIR)`
);

module.exports = { UPLOADS_DIR, PILOTOS_DIR, PREPARADORES_DIR };

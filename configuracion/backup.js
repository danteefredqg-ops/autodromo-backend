// configuracion/backup.js — genera un dump SQL completo de la base de datos
// y lo manda por correo (vía Resend) como respaldo fuera de Railway.
const mysqlProm = require("mysql2/promise");
const { escape } = require("mysql2");
const db = require("./db");
const { enviarCorreo } = require("./mailer");

async function generarBackupSQL() {
  // Conexión aparte (no el pool compartido) con dateStrings:true — así las
  // columnas DATE/DATETIME vuelven como el texto exacto que tiene MySQL, sin
  // que mysql2 las reinterprete como objetos Date con la zona horaria local
  // de Node (eso podía correr las fechas un día si el servidor no está en UTC).
  const conn = await mysqlProm.createConnection({
    host: process.env.MYSQLHOST,
    user: process.env.MYSQLUSER,
    password: process.env.MYSQLPASSWORD,
    database: process.env.MYSQLDATABASE,
    port: process.env.MYSQLPORT || 3306,
    charset: "utf8mb4",
    dateStrings: true,
  });

  try {
    const [tablas] = await conn.query(
      "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'"
    );

    let sql = `-- Respaldo Autódromo Monterrey — ${new Date().toISOString()}\nSET FOREIGN_KEY_CHECKS=0;\n\n`;

    for (const { TABLE_NAME: tabla } of tablas) {
      const [[creacion]] = await conn.query(`SHOW CREATE TABLE \`${tabla}\``);
      sql += `-- ── ${tabla} ──\nDROP TABLE IF EXISTS \`${tabla}\`;\n${creacion["Create Table"]};\n\n`;

      const [filas] = await conn.query(`SELECT * FROM \`${tabla}\``);
      if (filas.length > 0) {
        const columnas = Object.keys(filas[0]);
        const listaColumnas = columnas.map(c => `\`${c}\``).join(",");
        const valores = filas.map(fila => `(${columnas.map(c => escape(fila[c])).join(",")})`);
        sql += `INSERT INTO \`${tabla}\` (${listaColumnas}) VALUES\n${valores.join(",\n")};\n\n`;
      }
    }

    sql += "SET FOREIGN_KEY_CHECKS=1;\n";
    return sql;
  } finally {
    await conn.end();
  }
}

// Registra cada intento en backup_log — así el programador sabe cuándo fue
// el último respaldo exitoso aunque el servidor se haya reiniciado (no se
// puede confiar en un setInterval solo, porque Railway reinicia el proceso
// en cada deploy y perdería la cuenta).
async function registrarBackup(ok, detalle) {
  await db.query("INSERT INTO backup_log (ok, detalle) VALUES (?, ?)", [ok ? 1 : 0, detalle || null]);
}

async function ultimoBackupExitoso() {
  const [rows] = await db.query(
    "SELECT creado_en FROM backup_log WHERE ok = 1 ORDER BY creado_en DESC LIMIT 1"
  );
  return rows.length ? new Date(rows[0].creado_en) : null;
}

async function ejecutarBackup({ destino }) {
  const fecha = new Date().toISOString().slice(0, 10);
  try {
    const sql = await generarBackupSQL();
    await enviarCorreo({
      to: destino,
      subject: `Respaldo Autódromo Monterrey — ${fecha}`,
      html: `<p>Adjunto el respaldo completo de la base de datos generado el ${fecha}.</p>
             <p style="color:#777;font-size:0.85rem">Para restaurarlo: <code>mysql -u usuario -p base_de_datos &lt; respaldo.sql</code></p>`,
      attachments: [{ filename: `autodromo-backup-${fecha}.sql`, content: Buffer.from(sql, "utf8") }],
    });
    await registrarBackup(true, `Enviado a ${destino}`);
    return { ok: true };
  } catch (err) {
    await registrarBackup(false, err.message);
    throw err;
  }
}

const DIAS_ENTRE_BACKUPS   = 7;
const INTERVALO_CHEQUEO_MS = 24 * 60 * 60 * 1000; // revisa una vez al día si toca respaldar

// No se usa un solo setInterval largo (ej. cada 7 días) porque Railway reinicia
// el proceso en cada deploy y el conteo se perdería — nunca llegaría a dispararse
// si hay deploys seguidos. En vez de eso, se revisa a diario contra la fecha real
// del último respaldo guardado en la BD (backup_log), que sí sobrevive reinicios.
function iniciarProgramadorBackup() {
  const destino = process.env.BACKUP_EMAIL;
  if (!destino) {
    console.warn("⚠️  BACKUP_EMAIL no configurado — el respaldo automático semanal está desactivado.");
    return;
  }
  const chequear = async () => {
    try {
      const ultimo = await ultimoBackupExitoso();
      const vencido = !ultimo || (Date.now() - ultimo.getTime()) >= DIAS_ENTRE_BACKUPS * 24 * 60 * 60 * 1000;
      if (vencido) {
        console.log("📦 Generando respaldo automático de la base de datos...");
        await ejecutarBackup({ destino });
        console.log(`✅ Respaldo automático enviado a ${destino}`);
      }
    } catch (err) {
      console.error("❌ Error en el respaldo automático:", err.message);
    }
  };
  chequear(); // por si el servidor estuvo apagado más de una semana
  setInterval(chequear, INTERVALO_CHEQUEO_MS);
}

module.exports = { generarBackupSQL, ejecutarBackup, ultimoBackupExitoso, iniciarProgramadorBackup };

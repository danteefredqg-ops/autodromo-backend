// Exploración (no es prueba): manda datos con tipos inesperados a TODAS las
// rutas del API, con cada tipo de sesión, y reporta cualquier 500 (= error no
// controlado) o respuesta que filtre datos secretos.
// Corre con: node test/fuzz-rutas.js
"use strict";
const h = require("./helpers/app-prueba");

const RARO = [
  null, 0, -1, 1e309, "", " ", "0", "-1", "abc", "1 OR 1=1", "1'; DROP TABLE pilotos; --",
  "<script>alert(1)</script>", "../../etc/passwd", "a".repeat(5000),
  [], [1, 2], ["x"], {}, { "$gt": "" }, { toString: 1 }, true, false,
];
const CAMPOS = ["email","password","nombre","numero_piloto","categoria_ids","categoria_id","etapa_id","campeonato_id",
  "piloto_id","vehiculo","resultados","estatus","monto_pago","metodo_pago","telefono","curp","anio","identificador","token",
  "username","rol","nombre_completo","nombres","apellido_paterno","tipo_sangre","fecha_nacimiento","edad_maxima","titulo",
  "numero","notas","nueva_password","credential","categorias","descripcion","fecha","contrato_aceptado"];

async function main() {
  await h.iniciar();
  const rutas = [];
  const archivos = ["auth","pilotos","categorias","campeonatos","etapas","contratos","inscripciones","formularios","reportes","usuarios","piloto","resultados","imagenes"];
  for (const f of archivos) {
    for (const capa of require(`../routes/${f}`).stack) {
      if (!capa.route) continue;
      for (const metodo of Object.keys(capa.route.methods)) {
        rutas.push({ metodo: metodo.toUpperCase(), ruta: `/${f === "imagenes" ? "imagenes-registro" : f}${capa.route.path}` });
      }
    }
  }
  const tokens = {
    publico: null, piloto: h.tokenPiloto(5), torre: h.tokenSistema("torre"),
    staff: h.tokenSistema("inscripciones"), admin: h.tokenSistema("admin"),
  };
  // BD simulada "permisiva": devuelve una fila genérica a casi todo, para que
  // el código avance lo más posible con datos raros. Solo un SELECT * de
  // pilotos/usuarios trae los campos secretos (como la BD real).
  h.reiniciar((sql) => {
    if (!/^\s*SELECT/i.test(sql)) return undefined;
    const conSecretos = /SELECT\s+(\*|p\.\*)[\s\S]*FROM\s+(pilotos|usuarios)\b/i.test(sql);
    return [{
      ...(conSecretos ? { password: "$2a$10$abcdefghijklmnopqrstuv", reset_token_hash: "zz" } : {}),
      id: 1, cnt: 0, sig: 1, numero_piloto: 7, campeonato_id: 1, etapa_id: 1, piloto_id: 5,
      nombre: "X", nombre_completo: "X", estatus: "Pendiente", pagado_en: null, activo: 1,
      archivo: "/uploads/registro/x.png", fecha: "2026-10-11", rol: "admin", orden: 1, titulo: null,
      email: "a@b.com", fecha_nacimiento: null, numero_piloto_anterior: null,
    }];
  });
  const hallazgos = [];
  let total = 0;
  for (const { metodo, ruta } of rutas) {
    const url = ruta.replace(/:([a-zA-Z_]+)/g, "1");
    for (const [quien, token] of Object.entries(tokens)) {
      const cuerpos = (metodo === "GET" || metodo === "DELETE") ? [null]
        : [{}, ...CAMPOS.flatMap(campo => RARO.map(v => ({ [campo]: v })))];
      for (const body of cuerpos) {
        total++;
        // IP distinta por petición: así los límites de intentos no frenan al
        // fuzzer y también se prueban login, registro público, etc.
        const ip = `10.${(total >> 16) & 255}.${(total >> 8) & 255}.${total & 255}`;
        const qs = metodo === "GET" ? "?campeonato_id[]=1&etapa_id=abc&email[$ne]=x&categoria_id=1" : "";
        let r;
        try { r = await h.pedir(metodo, url + qs, { token, body, headers: { "X-Forwarded-For": ip } }); }
        catch (e) { hallazgos.push(`${metodo} ${url} [${quien}] → la conexión falló: ${e.message}`); continue; }
        const texto = JSON.stringify(r.data ?? "");
        if (r.status >= 500) hallazgos.push(`${metodo} ${url} [${quien}] ${JSON.stringify(body)?.slice(0, 70)} → ${r.status} ${texto.slice(0, 70)}`);
        if (/\$2a\$10\$|reset_token_hash/.test(texto)) hallazgos.push(`${metodo} ${url} [${quien}] → FILTRA SECRETO`);
      }
    }
  }
  await h.detener();
  const unicos = [...new Map(hallazgos.map(x => [x.split(" [")[0], x])).values()];
  console.log(`${total} peticiones a ${rutas.length} rutas. Rutas con hallazgos: ${unicos.length}`);
  for (const x of unicos) console.log(" -", x);
}
main();

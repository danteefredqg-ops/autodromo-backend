// utils/fechas.js — "hoy" según Monterrey, no según el servidor.
// Railway (y su MySQL) corren en UTC: new Date().getFullYear(), getMonth() o
// CURDATE() cambian de día a las 6 pm de Monterrey. México ya no usa horario
// de verano, así que Monterrey es UTC-6 fijo todo el año.
const OFFSET_MTY_MS = 6 * 60 * 60 * 1000;

// Fecha de hoy en Monterrey, "AAAA-MM-DD".
const hoyMx = () => new Date(Date.now() - OFFSET_MTY_MS).toISOString().slice(0, 10);
// Año actual en Monterrey (número).
const anioMx = () => Number(hoyMx().slice(0, 4));
// Mes actual en Monterrey, 1 = enero … 12 = diciembre.
const mesMx = () => Number(hoyMx().slice(5, 7));

module.exports = { hoyMx, anioMx, mesMx };

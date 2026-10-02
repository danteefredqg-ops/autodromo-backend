// utils/sanitizar.js — quitar campos secretos de un piloto antes de mandarlo al cliente

// `SELECT * FROM pilotos` trae el hash de la contraseña y el hash/expiración
// del token de recuperación. Ninguno debe salir nunca en una respuesta, ni
// siquiera hacia el staff: con el hash se puede montar un ataque offline.
function sinSecretos(piloto) {
  if (!piloto) return piloto;
  const { password, reset_token_hash, reset_token_expira, ...datos } = piloto;
  return datos;
}

module.exports = { sinSecretos };

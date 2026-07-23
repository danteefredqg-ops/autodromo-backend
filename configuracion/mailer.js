// configuracion/mailer.js — envío de correos transaccionales vía Resend
const { Resend } = require("resend");

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM || "Autódromo Monterrey <onboarding@resend.dev>";

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

// Mientras no se verifique un dominio propio en Resend, el remitente de
// prueba (onboarding@resend.dev) solo entrega a la cuenta dueña de la API
// key — no a pilotos reales. Basta con verificar un dominio y cambiar
// EMAIL_FROM; el código no necesita tocarse.
async function enviarCorreo({ to, subject, html }) {
  if (!resend) {
    throw new Error(
      "RESEND_API_KEY no está configurado — agrega esta variable de entorno para poder enviar correos."
    );
  }
  const { error } = await resend.emails.send({ from: EMAIL_FROM, to, subject, html });
  if (error) {
    throw new Error(`Error al enviar correo: ${error.message || JSON.stringify(error)}`);
  }
}

function correoRecuperacion(nombre, link) {
  return `
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px">
      <h2 style="color:#c1121f;margin-bottom:4px">Autódromo Monterrey</h2>
      <p style="color:#555;font-size:0.9rem;margin-top:0">Recuperación de contraseña</p>
      <p>Hola${nombre ? " " + nombre : ""},</p>
      <p>Recibimos una solicitud para restablecer la contraseña de tu cuenta de piloto. Si tú la pediste, da clic en el siguiente botón:</p>
      <p style="text-align:center;margin:28px 0">
        <a href="${link}" style="background:#c1121f;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block">Restablecer contraseña</a>
      </p>
      <p style="font-size:0.85rem;color:#777">Este enlace es válido por 1 hora. Si tú no pediste este cambio, puedes ignorar este correo — tu contraseña actual sigue funcionando.</p>
      <p style="font-size:0.75rem;color:#999;margin-top:24px">Si el botón no funciona, copia y pega este enlace en tu navegador:<br/>${link}</p>
    </div>
  `;
}

module.exports = { enviarCorreo, correoRecuperacion };

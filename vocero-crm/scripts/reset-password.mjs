/**
 * Restablecer la contraseña de un usuario SIN correo.
 *
 * Vocero no tiene flujo de "olvidé mi contraseña" —sería una dependencia
 * externa, y la constitución las prohíbe en v1— y el registro público se cierra
 * en cuanto existe la primera organización. Cuando la contraseña se pierde, la
 * única salida es reescribir el hash en la base.
 *
 * Este script NO toca ninguna base de datos: no abre conexión, no lee
 * DATABASE_URL, no escribe nada. Genera el hash y te imprime el `UPDATE` listo
 * para pegar. Quien decide aplicarlo es un humano con acceso al servidor, que
 * es exactamente la barrera que uno quiere para una operación así.
 *
 * Uso (bash):
 *   NEW_PASSWORD='tu-contraseña-nueva' node scripts/reset-password.mjs correo@ejemplo.com
 *
 * Uso (PowerShell):
 *   $env:NEW_PASSWORD='tu-contraseña-nueva'; node scripts/reset-password.mjs correo@ejemplo.com
 */
import { hashPassword, verifyPassword } from "better-auth/crypto";

/** Mismo mínimo que pide el registro; no tiene sentido abrir una puerta más débil. */
const MIN_PASSWORD_LENGTH = 8;

const email = process.argv[2];
// Por variable de entorno y no por argumento: un argumento queda en el
// historial del shell y es visible en `ps` para cualquier otro usuario de la
// máquina mientras el proceso corre. En un servidor suele haber más de una
// sesión abierta.
const password = process.env.NEW_PASSWORD;

if (!email || !password) {
  console.error(
    "Faltan datos.\n" +
      "  bash:       NEW_PASSWORD='...' node scripts/reset-password.mjs correo@ejemplo.com\n" +
      "  PowerShell: $env:NEW_PASSWORD='...'; node scripts/reset-password.mjs correo@ejemplo.com"
  );
  process.exit(1);
}

if (password.length < MIN_PASSWORD_LENGTH) {
  console.error(
    `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`
  );
  process.exit(1);
}

// El hash sale de `better-auth/crypto`, la MISMA función con la que el login
// verifica. Reimplementar scrypt aquí significaría duplicar sus parámetros: el
// día que la librería los cambie, este script seguiría generando hashes viejos
// y el login los rechazaría sin decir por qué — justo el escenario que este
// script existe para resolver, y con el usuario ya fuera de su cuenta.
const hash = await hashPassword(password);

// Se verifica el hash recién generado antes de imprimir nada. Vale más fallar
// aquí que dejar a alguien pegando un `UPDATE` que lo deja igual de fuera.
if (!(await verifyPassword({ hash, password }))) {
  console.error(
    "El hash generado no se verifica a sí mismo. NO uses el SQL: algo cambió " +
      "en la versión de Better Auth y hay que revisarlo."
  );
  process.exit(1);
}

/** Escapa un valor para un literal SQL entre comillas simples. */
const lit = (value) => value.replace(/'/g, "''");

// `lower(email)` porque el correo pudo guardarse con mayúsculas, y un
// `UPDATE 0` silencioso es peor que un error: parece que funcionó.
const sql =
  `UPDATE "account" SET "password" = '${lit(hash)}', "updated_at" = now() ` +
  `WHERE "provider_id" = 'credential' AND "user_id" = ` +
  `(SELECT "id" FROM "user" WHERE lower("email") = lower('${lit(email)}'));`;

console.log(`
Hash verificado. Pega este comando en la terminal del contenedor de Postgres
(en Coolify: el recurso de la base → pestaña Terminal):

psql -U postgres -d vocero -c "${sql.replace(/"/g, '\\"')}"

Debe responder: UPDATE 1
Si responde UPDATE 0, el correo no coincide. Míralos con:
psql -U postgres -d vocero -c 'SELECT email FROM "user";'
`);

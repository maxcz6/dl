import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getEnv } from "@/lib/env";
import * as schema from "./schema";

/**
 * Opciones de conexión comunes a TODA conexión que abra este repo (app, seeds,
 * migraciones, arneses E2E).
 *
 * `TimeZone: "UTC"` no es cosmético, es el invariante de tiempo del proyecto.
 * Las columnas son `timestamp without time zone`, y Drizzle las trata siempre
 * como UTC en ambas direcciones: al leer hace `new Date(valor + "+0000")` y al
 * escribir hace `valor.toISOString()`. El único escritor que se sale de ese
 * marco es SQL: `now()` de los `defaultNow()` se castea a `timestamp` usando
 * la zona de la SESIÓN, así que en un Postgres que no corra en UTC escribe
 * hora LOCAL y ese mismo valor se vuelve a leer como si fuera UTC.
 *
 * Síntoma real (Postgres en UTC-6): un saliente mostraba 08:59 en la burbuja
 * del hilo (`message.created_at`, escrito por `now()`) y 14:59 en la lista
 * (`conversation.last_message_at`, escrito desde JS). Fijar la zona de sesión
 * en UTC alinea `now()` con Drizzle y con eso TODAS las columnas
 * `defaultNow()` del esquema de golpe, sin migración y sin depender de cómo
 * esté configurado el servidor de BD. En Docker los contenedores ya corren en
 * UTC — esto hace que el dev local y cualquier Postgres self-hosted se
 * comporten igual.
 */
export const PG_CONNECTION_OPTIONS = {
  onnotice: () => {},
  connection: { TimeZone: "UTC" },
} as const;

/**
 * Cliente de BD único por proceso. En dev, Next recarga módulos: se cachea en
 * globalThis para no agotar conexiones.
 */
const globalForDb = globalThis as unknown as {
  __voceroSql?: ReturnType<typeof postgres>;
};

function createClient() {
  const env = getEnv();
  return postgres(env.DATABASE_URL, {
    max: 10,
    ...PG_CONNECTION_OPTIONS,
  });
}

export function getSql() {
  if (!globalForDb.__voceroSql) globalForDb.__voceroSql = createClient();
  return globalForDb.__voceroSql;
}

let cachedDb: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDb() {
  if (!cachedDb) cachedDb = drizzle(getSql(), { schema });
  return cachedDb;
}

export { schema };

import { sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

/**
 * 019 — Piezas de SQL que comparten los cuatro bloques de Resultados.
 *
 * Son subconsultas CORRELACIONADAS con la columna que reciben. Van en WHERE, en
 * condiciones de JOIN o en consultas con JOIN: en la lista de SELECT de una
 * consulta de una sola tabla, drizzle le quita la tabla a la columna
 * interpolada y la subconsulta se correlacionaría consigo misma (ver
 * `conversacionId` en bot.ts).
 */

/**
 * El Laboratorio NO existe para la analítica (spec 019, D6).
 *
 * Sus corridas generan conversaciones completas con respuestas del modelo y
 * escalamientos; sin este filtro, una tarde de autopruebas inflaría
 * conversaciones, tasa de respuesta y tiempos, y el dueño tomaría decisiones
 * sobre personas que no existen.
 *
 * Se excluye al contacto cuya ÚNICA conversación es de prueba. Un contacto real
 * que además tenga una conversación de laboratorio sigue contando: lo real pesa
 * más que lo simulado.
 */
export function notLabContact(contactIdColumn: PgColumn): SQL {
  return sql`(
    not exists (
      select 1 from "conversation" lab
      where lab."contact_id" = ${contactIdColumn} and lab."is_test" = true
    )
    or exists (
      select 1 from "conversation" real_conv
      where real_conv."contact_id" = ${contactIdColumn} and real_conv."is_test" = false
    )
  )`;
}

/**
 * Fecha local del negocio para agrupar series. Las columnas son `timestamp`
 * sin zona y guardan UTC: el primer `AT TIME ZONE` las interpreta como UTC y
 * el segundo las lleva a la hora del negocio.
 */
export function localDateExpr(
  column: PgColumn,
  timezone: string,
  byMonth: boolean
): SQL<string> {
  const format = byMonth ? "YYYY-MM" : "YYYY-MM-DD";
  return sql<string>`to_char((${column} at time zone 'UTC' at time zone ${timezone}), ${format})`;
}

/**
 * El origen EFECTIVO del contacto, en SQL: el capturado manda; sin capturar,
 * «anuncio» si su PRIMER anuncio de origen es un anuncio (no una publicación);
 * si no, NULL (= sin identificar).
 *
 * Es la misma regla que la ficha del contacto (018: la primera fila de
 * `ad_attribution` + `cuentaComoAnuncio` + `effectiveSource`): si Resultados
 * dedujera distinto, la tabla por origen contradiría lo que el dueño ve en la
 * ficha.
 */
export function effectiveSourceExpr(
  organizationIdColumn: PgColumn,
  contactIdColumn: PgColumn,
  sourceColumn: PgColumn
): SQL<string | null> {
  return sql<string | null>`coalesce(${sourceColumn}, (
    select case when coalesce(primero."source_type", 'ad') = 'post' then null else 'anuncio' end
    from "ad_attribution" primero
    where primero."organization_id" = ${organizationIdColumn}
      and primero."contact_id" = ${contactIdColumn}
    order by primero."created_at" asc, primero."id" asc
    limit 1
  ))`;
}

/**
 * La primera fila de `ad_attribution` del contacto, la misma que enseña su
 * ficha: un contacto cuenta UNA vez, con el anuncio que lo trajo primero.
 */
export function firstAttributionIdExpr(
  organizationIdColumn: PgColumn,
  contactIdColumn: PgColumn
): SQL<string | null> {
  return sql<string | null>`(
    select primero."id" from "ad_attribution" primero
    where primero."organization_id" = ${organizationIdColumn}
      and primero."contact_id" = ${contactIdColumn}
    order by primero."created_at" asc, primero."id" asc
    limit 1
  )`;
}

# Data Model — 021

## `dispatch` (nueva)

El outbox del despachador. Mismos nombres de tabla, columnas, estados e índices
que la tabla `dispatch` de Vocero Cloud, sin lo que allá es de la plataforma
(`brain_generation`, `expires_at`, `brain_kind`, `responded_message_id`): los
dos repos comparten la forma y cloud queda como superconjunto. Un índice
difiere, y se explica abajo.

| Columna | Tipo | Nulo | Notas |
|---|---|---|---|
| `id` | text PK | no | `dsp_…`. Es el `dispatchId` que viaja al cerebro: la clave de idempotencia. |
| `organization_id` | text | no | FK `organization.id` `ON DELETE CASCADE`. |
| `conversation_id` | text | no | FK `conversation.id` `ON DELETE CASCADE`. |
| `status` | text | no | `pendiente` · `en_vuelo` · `entregado` · `caducado_a_humano` · `descartado`. Default `pendiente`. |
| `attempts` | integer | no | Sube al tomar la fila. Distingue a dos dueños de un lease. Default 0. |
| `not_before` | timestamp | no | La ventana de agrupado: cada mensaje nuevo la empuja. El worker solo toma filas vencidas. |
| `first_message_at` | timestamp | no | Cuándo se abrió el despacho. |
| `last_message_at` | timestamp | no | Último mensaje que lo extendió. |
| `leased_until` | timestamp | sí | Hasta cuándo es de quien la tomó. Vencido, otro la retoma. |
| `last_error` | text | sí | Motivo del último fallo, hasta 300 caracteres. Nunca el cuerpo ni la llave. |
| `created_at`, `updated_at` | timestamp | no | |

Índices:

- **`dispatch_conversation_vivo_uq`**: único parcial sobre `conversation_id`
  donde `status in ('pendiente','en_vuelo')`. Como máximo un despacho vivo por
  conversación: de aquí salen el agrupado de ráfagas y el orden, y los
  garantiza Postgres, no el worker.
- `dispatch_org_status_updated_idx` (`organization_id`, `status`,
  `updated_at`): la tarjeta «Quién responde» pregunta por el último entregado
  y el último fallido. Con `updated_at` en el índice esa pregunta cuesta lo
  mismo con cien filas que con un millón; el `dispatch_org_status_idx` de
  cloud (sin esa columna) obligaba a ordenar todo el histórico en cada
  refresco. Sustituye a aquel: es su prefijo.
- `dispatch_status_notbefore_idx` (`status`, `not_before`): la consulta del
  worker.

Migración `0016`: aditiva. Una instalación que no configure
`BRAIN_DISPATCH_URL` nunca escribe en la tabla.

La tabla crece una fila por turno y no se purga: es el registro de qué se le
entregó al cerebro y qué no. Son filas pequeñas (sin el cuerpo del evento) y
todas las consultas van por índice; la retención, si hiciera falta, es otra
entrega.

## `conversation` (sin cambios)

Caer a un humano usa lo que ya hay: `ai_enabled = false`, `handoff_at` y
`handoff_reason = 'error'`, solo en la transición.

## Entorno

| Variable | Notas |
|---|---|
| `BRAIN_DISPATCH_URL` | Nueva, opcional. A dónde se despacha, p. ej. `http://nea:8000/vocero/dispatch`. No se valida en el esquema del entorno, como `BRAIN_HEALTH_URL`: una URL mal escrita no debe tumbar el CRM. |
| `BOT_API_KEY` | Ya existía. Ahora además firma el despacho. |
| `AGENT_COALESCE_MS` | Ya existía. Es también la ventana de agrupado del despacho. |

## DTO

```ts
// GET /api/agent/brain-status (aditivo)
BrainStatusDto.dispatch: {
  /** URL válida + llave: el CRM está empujando turnos. */
  active: boolean;
  /** Solo host[:puerto]. null si no hay BRAIN_DISPATCH_URL o no es una URL. */
  host: string | null;
  /** "url": no es http(s). "sin_llave": falta BOT_API_KEY. */
  problem: "url" | "sin_llave" | null;
  lastDeliveredAt: string | null;
  lastFailure: { at: string; detail: string } | null;
  pending: number;
};
```

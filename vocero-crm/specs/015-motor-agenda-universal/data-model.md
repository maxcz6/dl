# Fase 1 — Modelo de datos

Feature: `015-motor-agenda-universal`. Cinco tablas nuevas, todas con
`organization_id NOT NULL` org-first (Constitución III) y accedidas por
`scoped()`. La migración es **`drizzle/0009_motor_agenda.sql`** (la rama vieja
004 usaba `0002`, número ya tomado por main — research D10), puramente aditiva,
re-ejecutable (`IF NOT EXISTS` + DO-blocks) y **aplicada siempre**, con la
bandera apagada o encendida (ADR-001: estructura idéntica en todas las
instancias; apagada es inerte).

Prefijos de id (en `src/lib/db/ids.ts`): `cal_`, `bk_`, `ofs_`, `zcred_`,
`gcred_` — nanoid alfabeto `0-9a-z`, longitud 20, como el resto.

---

## `calendar_settings` — la agenda del negocio

Una fila por organización (UNIQUE), creada al primer guardado; sin fila, el
sistema responde defaults en memoria (una instancia recién encendida no se
rompe).

| Columna | Tipo | Notas |
|---|---|---|
| `id` | text PK | `cal_<nanoid>` |
| `organization_id` | text NOT NULL UNIQUE | FK → organization, cascade |
| `weekly_hours` | jsonb NOT NULL | `{"mon":[{"start":"09:00","end":"18:00"}], …}` — hora de **pared** |
| `slot_minutes` | integer NOT NULL default 30 | 10–240 |
| `buffer_minutes` | integer NOT NULL default 0 | 0–120 |
| `min_notice_hours` | integer NOT NULL default 2 | 0–72 |
| `max_days_ahead` | integer NOT NULL default 7 | 1–60 |
| `timezone` | text NOT NULL default `America/Mexico_City` | IANA, validada contra el runtime (desconocida → 422) |
| `connector` | text NOT NULL default `enlace-fijo` | `enlace-fijo` \| `zoom` \| `google` (catálogo del código; un fork agrega el suyo) |
| `meeting_link` | text NULL | la sala fija del conector `enlace-fijo`; vacío ⇒ reservas sin link |
| `created_at` / `updated_at` | timestamp NOT NULL | |

**Validación**: intervalos `HH:mm` con `start < end`; días sin intervalos
válidos se omiten (cerrado); enteros fuera de rango se recortan; `connector`
fuera del catálogo → 422. Elegir `zoom`/`google` NO exige credenciales en ese
instante (se pueden pegar después), pero sin credenciales el efecto degrada a
link pendiente — la UI lo avisa.

---

## `booking` — la cita

| Columna | Tipo | Notas |
|---|---|---|
| `id` | text PK | `bk_<nanoid>` |
| `organization_id` | text NOT NULL | FK → organization, cascade |
| `kind` | text NOT NULL default `session` | `session` \| `block` (bloqueo manual, sin contacto) |
| `status` | text NOT NULL default `agendada` | `agendada` \| `realizada` \| `no_show` \| `cancelada` |
| `source` | text NOT NULL default `manual` | `manual` \| `ai` |
| `contact_id` | text NULL | FK → contact, cascade; obligatorio en la práctica para `session` |
| `conversation_id` | text NULL | FK → conversation, set null |
| `lead_id` | text NULL | FK → lead, set null |
| `scheduled_at` | timestamp NOT NULL | **instante UTC** |
| `duration_minutes` | integer NOT NULL | capturada al crear; no se reescribe |
| `connector` | text NULL | con qué conector nació la ENTREGA (`enlace-fijo`/`zoom`/`google`); null en bloqueos. Reprogramar/cancelar hablan con ESTE conector aunque el activo haya cambiado |
| `external_ref` | text NULL | id de la reunión/evento en el proveedor (`null` para `enlace-fijo`) |
| `meeting_link` | text NULL | el link entregado (join_url de Zoom, link de Meet, o copia del enlace fijo vigente al crear — histórico fiel) |
| `link_pending` | boolean NOT NULL default false | el proveedor falló al crear; visible y reintentable en "Citas" |
| `is_test` | boolean NOT NULL default false | conversación del Laboratorio |
| `notes` | text NULL | |
| `created_at` / `updated_at` | timestamp NOT NULL | |

**Índices**:
- `booking_org_when_idx (organization_id, scheduled_at)` — ventana de
  disponibilidad y listado.
- `booking_org_status_idx (organization_id, status)`.
- **`booking_org_active_slot_uq` — UNIQUE parcial sobre
  `(organization_id, scheduled_at)` WHERE `status IN ('agendada','realizada')
  AND is_test = false`**. Es la garantía atómica de FR-006: dos confirmaciones
  simultáneas del mismo instante no pueden ganar las dos; la perdedora recibe
  el `23505` de Postgres, que el servicio mapea a `409 slot_taken` con
  alternativas frescas (research D7). Las citas de prueba quedan fuera: no
  consumen la agenda real.

**Por qué `meeting_link` y `connector` se copian en la cita**: la cita es un
hecho histórico, no una vista de la configuración actual. Si el negocio cambia
de sala o de proveedor, las citas confirmadas siguen contando la verdad que se
le dijo al cliente, y sus efectos posteriores (mover/cancelar) hablan con el
proveedor correcto.

**Transiciones de estado**:

```text
                 ┌──────────► realizada
   agendada ─────┼──────────► no_show
                 └──────────► cancelada   (idempotente: cancelar dos veces no falla)

   reprogramar: agendada → agendada (otro scheduled_at; libera el hueco anterior;
                updateMeeting sobre el MISMO external_ref — el link no cambia)
   una cita cancelada NO se reprograma (422)
   link_pending: true → false vía "Reintentar enlace" (createMeeting tardío
                 contra booking.connector; éxito escribe external_ref + link)
```

Solo `agendada` y `realizada` ocupan agenda. `cancelada` y `no_show` liberan.

**Efectos hacia el proveedor** (siempre DESPUÉS de escribir la verdad del CRM,
best-effort, y JAMÁS para `is_test` — la aserción va antes de la bifurcación
por conector, simétrica en las tres mutaciones):

| Mutación | Efecto |
|---|---|
| crear | `createMeeting` → guarda `external_ref` + `meeting_link`; fallo ⇒ `link_pending = true` |
| reprogramar | `updateMeeting(external_ref)` si existe; fallo ⇒ warn (el link previo sigue siendo válido en la mayoría de proveedores) |
| cancelar | `deleteMeeting(external_ref)`; 404 del proveedor = éxito |
| 401 del proveedor en cualquiera | además: `status = 'error'` en la credencial del conector (tarjeta de reconexión en Ajustes) |

---

## `offered_slot` — la memoria de lo ofrecido

Idéntica al 004: sin fila aquí, no hay reserva (FR-005).

| Columna | Tipo | Notas |
|---|---|---|
| `id` | text PK | `ofs_<nanoid>` |
| `organization_id` | text NOT NULL | FK → organization, cascade |
| `conversation_id` | text NOT NULL | FK → conversation, cascade |
| `start_utc` | timestamp NOT NULL | instante ofrecido |
| `label` | text NOT NULL | la etiqueta exacta mostrada al cliente (con día en palabras) |
| `offered_at` | timestamp NOT NULL default now | |

**Índice**: `(conversation_id, start_utc)`.

**Ciclo**: ofrecer = reemplazo completo en transacción (la oferta vigente es
siempre la última); reservar con éxito = limpiar; `slot_taken` = reemplazar por
las alternativas frescas devueltas; borrar la conversación = cascade, sin
huérfanos.

---

## `zoom_credentials` — conector Zoom (S2S)

Misma forma que `meta_credentials`/`instagram_credentials`: tabla explícita
por proveedor (no jsonb genérico — "unas credenciales tienen forma fija y
conocida: así conservan tipado e índices"), secreto cifrado con los helpers
AES-256-GCM existentes (`src/lib/crypto`) — un segundo mecanismo de cifrado
sería un segundo mecanismo que auditar.

| Columna | Tipo | Notas |
|---|---|---|
| `id` | text PK | `zcred_<nanoid>` |
| `organization_id` | text NOT NULL UNIQUE | FK → organization, cascade |
| `account_id` | text NOT NULL | en claro (no es secreto) |
| `client_id` | text NOT NULL | en claro |
| `secret_cipher` / `secret_iv` / `secret_tag` | text NOT NULL | client secret cifrado |
| `status` | text NOT NULL default `connected` | `connected` \| `error` — y `error` SE ESCRIBE (FR-016; en el fork el enum existe y nunca se escribe) |
| `created_at` / `updated_at` | timestamp NOT NULL | |

---

## `google_credentials` — conector Google Calendar + Meet

| Columna | Tipo | Notas |
|---|---|---|
| `id` | text PK | `gcred_<nanoid>` |
| `organization_id` | text NOT NULL UNIQUE | FK → organization, cascade |
| `client_id` | text NOT NULL | en claro |
| `client_secret_cipher` / `_iv` / `_tag` | text NOT NULL | cifrado |
| `refresh_token_cipher` / `_iv` / `_tag` | text NOT NULL | cifrado |
| `calendar_id` | text NOT NULL default `primary` | calendario destino |
| `status` | text NOT NULL default `connected` | `connected` \| `error` |
| `created_at` / `updated_at` | timestamp NOT NULL | |

Hacia afuera, ambas tablas exponen solo `last4` del secreto y `status` (patrón
`tokenLast4()` existente). Un fork que agregue un conector crea SU tabla con SU
forma en una migración aditiva posterior — la guía lo documenta.

---

## Relaciones

```text
organization ─┬─ calendar_settings   (1:1)
              ├─ booking             (1:N) ─── contact (N:1, opcional en bloqueos)
              │                        └───── conversation (N:1, opcional)
              │                        └───── lead (N:1, opcional)
              ├─ offered_slot        (1:N) ─── conversation (N:1, cascade)
              ├─ zoom_credentials    (1:1)
              └─ google_credentials  (1:1)
```

## Migración `drizzle/0009_motor_agenda.sql`

Generada con `pnpm db:generate` y revisada a mano para ser re-ejecutable
(Constitución IV): `CREATE TABLE IF NOT EXISTS` × 5, índices
`IF NOT EXISTS` (incluido el UNIQUE parcial), FKs en
`DO $$ … EXCEPTION WHEN duplicate_object THEN null $$`. No toca ninguna tabla
existente: aplicarla sobre una instancia con datos no puede perder nada, y se
aplica al arranque del contenedor como todas (`migrate.mjs`).

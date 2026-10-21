# Data Model — 016 Atribución de anuncios y Conversions API

Migración `drizzle/0010_atribucion_capi.sql`: **aditiva**, re-ejecutable y
aplicada **siempre** al arrancar el contenedor. Con la bandera apagada las tres
tablas quedan vacías e inertes — ese es el trato de ADR-001: todas las instancias
comparten la misma estructura y solo paga peso quien enciende.

Prefijos de id nuevos en `src/lib/db/ids.ts`: `att` (atribución), `cve` (evento
de conversión), `capi` (configuración).

---

## `ad_attribution` — de qué anuncio vino la conversación

| Columna | Tipo | Notas |
|---|---|---|
| `id` | text PK | `att_…` |
| `organization_id` | text NOT NULL → `organization` (cascade) | Multi-tenancy (III). |
| `contact_id` | text NOT NULL → `contact` (cascade) | |
| `conversation_id` | text NOT NULL → `conversation` (cascade) | |
| `ctwa_clid` | text | El identificador del clic. **Es la llave de todo**: sin él no hay nada que reportar. Nullable porque hay referrals de anuncio sin clid (p. ej. orgánicos de otras superficies). |
| `source_id` | text | Id del anuncio. |
| `source_type` | text | `ad`, `post`… |
| `source_url` | text | |
| `headline` | text | Titular del anuncio: lo único de esto que se muestra hoy (en la actividad). |
| `body` | text | |
| `media_type` | text | |
| `raw` | jsonb NOT NULL | Payload íntegro del referral. Es la póliza contra "Meta agregó un campo": nada se pierde y un fork puede pintar el creativo sin migrar. |
| `created_at` | timestamp NOT NULL default now | |

**Índices**

- `ad_attribution_org_conversation_uq` UNIQUE (`organization_id`,
  `conversation_id`) — **el primer referral gana**. Es lo que vuelve idempotente
  la ingesta ante los reintentos de Meta (IV): el insert es
  `ON CONFLICT DO NOTHING`, no un "consulta y luego inserta" que dos webhooks
  simultáneos ganarían los dos.
- `ad_attribution_org_contact_idx` (`organization_id`, `contact_id`).

---

## `conversion_event` — cada intento de reportarle algo a Meta

| Columna | Tipo | Notas |
|---|---|---|
| `id` | text PK | `cve_…` |
| `organization_id` | text NOT NULL → `organization` (cascade) | |
| `conversation_id` | text NOT NULL → `conversation` (cascade) | |
| `attribution_id` | text → `ad_attribution` (set null) | Con qué atribución se mandó. |
| `event_name` | text NOT NULL | Nombre del catálogo de Meta tal cual (D7). |
| `status` | text NOT NULL default `pending` | `pending` \| `sent` \| `failed` \| `skipped`. |
| `error` | text | Motivo legible: por qué se omitió o qué dijo Meta. |
| `fb_trace_id` | text | Acuse del envío. La única referencia que Meta pide para rastrear un evento; sin persistirla, un `sent` no se puede reclamar. |
| `sent_at` | timestamp | |
| `created_at` | timestamp NOT NULL default now | |

**Índices**

- `conversion_event_org_conv_name_uq` UNIQUE (`organization_id`,
  `conversation_id`, `event_name`) — el dedup **es** este índice. La fila se
  inserta ANTES de hablar con Meta y con `ON CONFLICT DO NOTHING`: si no vuelve
  fila, alguien más ya reportó ese evento y no se hace nada. Dos movimientos
  simultáneos del mismo lead no pueden mandar dos compras.

**Ciclo de vida**: `pending` (insertada) → `sent` (Meta acusó ≥ 1) ·
`failed` (Meta rechazó, o 200 con cero recibidos, o red caída) · `skipped` (no
había nada que reportar: sin `ctwa_clid`, sin dataset configurado).

Las filas `skipped` **no son basura**: son la respuesta a "¿por qué este lead no
aparece en Meta?", que sin ellas se contesta adivinando.

---

## `capi_settings` — la conexión del negocio

| Columna | Tipo | Notas |
|---|---|---|
| `id` | text PK | `capi_…` |
| `organization_id` | text NOT NULL → `organization` (cascade) | |
| `dataset_id` | text NOT NULL | Id del dataset de Meta. |
| `token_cipher` / `token_iv` / `token_tag` | text NOT NULL | Token cifrado AES-256-GCM con `lib/crypto` — el mismo mecanismo que las credenciales de WhatsApp, no un segundo (I). |
| `qualified_stage_id` | text → `pipeline_stage` (set null) | La etapa que este negocio considera "lead calificado" (D4). NULL = no se emite ese evento. `set null` a propósito: borrar la etapa apaga el evento, no rompe el guardado. |
| `status` | text NOT NULL default `connected` | `connected` \| `error`. |
| `created_at` / `updated_at` | timestamp NOT NULL | |

**Índice**: `capi_settings_org_uq` UNIQUE (`organization_id`) — una conexión por
negocio; guardar de nuevo es un upsert.

---

## Lo que NO se agrega

- **Ninguna columna nueva en `lead`, `conversation` o `contact`.** La atribución
  cuelga por FK; el monto de la venta se lee de `lead.amount_cents` /
  `lead.currency`, que ya existen.
- **Ninguna tabla de traducción de eventos** (D7).
- **`thumbnail`** del creativo: fuera de alcance; el binario del CDN de Meta
  caduca en días y guardarlo es una descarga dentro de la ingesta. `raw` conserva
  la URL para quien la quiera.

# Data Model — Vocero CRM v1 (001-vocero-core)

Convenciones globales:

- IDs: `text` con nanoid prefijado (`ct_`, `cv_`, `msg_`, `ld_`, `stg_`, `cred_`, `agp_`,
  `kb_`, `tpl_`, `run_`, `case_`). Los del plugin de auth conservan su formato propio.
- Toda tabla de dominio lleva `organization_id text NOT NULL` con FK a `organization`
  (`ON DELETE CASCADE`) e índice org-first (`(organization_id, ...)`).
- Timestamps: `created_at` / `updated_at` `timestamptz` con default `now()`.
- Enums como `text` con CHECK vía Drizzle enum de texto (portabilidad de migraciones).

## Auth (Better Auth + plugin organization — schema generado por la librería)

`user`, `session`, `account`, `verification`, `organization`, `member`, `invitation`
(sin UI de invitaciones en v1; la tabla existe porque el plugin la requiere).

## Dominio

### contact
| Columna | Tipo | Notas |
|---|---|---|
| id | text PK | `ct_` |
| organization_id | text NOT NULL FK→organization CASCADE | índice org-first |
| phone | text NOT NULL | E.164 sin `+` (formato wa_id de Meta) |
| profile_name | text | nombre del perfil WA (editable) |
| notes | text | notas libres |
| archived_at | timestamptz NULL | archivado reversible |
| created_at / updated_at | timestamptz | |

UNIQUE `(organization_id, phone)`. Avatar = iniciales + color estable derivado del id
(hash → paleta), no se persiste.

### pipeline_stage
| Columna | Tipo | Notas |
|---|---|---|
| id | text PK | `stg_` |
| organization_id | text NOT NULL FK CASCADE | |
| name | text NOT NULL | |
| position | integer NOT NULL | orden en el kanban |
| color | text NOT NULL | color de la etapa |
| kind | text NOT NULL default 'open' | `open` \| `won` \| `lost` (anclas) |
| created_at / updated_at | | |

Seed: Nuevo → En conversación → Interesado → Cliente(won) → Perdido(lost). Regla: no se
puede eliminar la última etapa `won` ni la última `lost`; eliminar etapa con leads exige
etapa destino.

### lead
| Columna | Tipo | Notas |
|---|---|---|
| id | text PK | `ld_` |
| organization_id | text NOT NULL FK CASCADE | |
| contact_id | text NOT NULL FK→contact CASCADE | UNIQUE (1 lead activo por contacto en v1) |
| stage_id | text NOT NULL FK→pipeline_stage | |
| position | integer NOT NULL default 0 | orden dentro de la columna |
| value_note | text | dato libre del negocio (p. ej. monto) |
| last_activity_at | timestamptz | para la tarjeta |
| created_at / updated_at | | |

### conversation
| Columna | Tipo | Notas |
|---|---|---|
| id | text PK | `cv_` |
| organization_id | text NOT NULL FK CASCADE | |
| contact_id | text NOT NULL FK→contact CASCADE | |
| is_test | boolean NOT NULL default false | Laboratorio; excluida de bandeja/SSE |
| ai_enabled | boolean NOT NULL default true | toggle por conversación |
| handoff_at | timestamptz NULL | badge "atención humana"; IA silenciada si NOT NULL |
| handoff_reason | text NULL | `cliente` \| `modelo` \| `error` \| `ventana` |
| last_inbound_at | timestamptz NULL | base del cálculo ventana 24h |
| last_message_at | timestamptz NULL | orden de bandeja + catch-up SSE |
| unread_count | integer NOT NULL default 0 | |
| created_at / updated_at | | |

UNIQUE parcial `(organization_id, contact_id) WHERE is_test = false` (una conversación
real por contacto; las de test son N).

### message
| Columna | Tipo | Notas |
|---|---|---|
| id | text PK | `msg_` |
| organization_id | text NOT NULL FK CASCADE | |
| conversation_id | text NOT NULL FK→conversation CASCADE | índice `(conversation_id, created_at)` |
| direction | text NOT NULL | `in` \| `out` |
| type | text NOT NULL default 'text' | `text` \| `image` \| `audio` \| `video` \| `document` \| `sticker` \| `template` \| `unsupported` |
| body | text | texto o cuerpo renderizado de plantilla |
| wa_message_id | text UNIQUE NULL | idempotencia (los `is_test` no llevan) |
| status | text NOT NULL default 'pending' | out: `pending`→`sent`→`delivered`→`read` \| `failed`; in: `received` |
| error_detail | text NULL | fallo de envío |
| ai_generated | boolean NOT NULL default false | respuesta del agente |
| wa_timestamp | timestamptz NULL | timestamp de Meta (override en mock) |
| created_at | timestamptz | |

### meta_credentials
| Columna | Tipo | Notas |
|---|---|---|
| id | text PK | `cred_` |
| organization_id | text NOT NULL FK CASCADE UNIQUE | 1 conexión por org (v1) |
| waba_id | text NOT NULL | |
| phone_number_id | text NOT NULL UNIQUE | ruteo del webhook |
| display_phone | text | número legible (de la validación) |
| verified_name | text | nombre verificado (de la validación) |
| token_cipher / token_iv / token_tag | text NOT NULL | AES-256-GCM |
| status | text NOT NULL default 'connected' | `connected` \| `invalid` |
| created_at / updated_at | | |

### agent_profile
| Columna | Tipo | Notas |
|---|---|---|
| id | text PK | `agp_` |
| organization_id | text NOT NULL FK CASCADE UNIQUE | 1 perfil por org |
| enabled | boolean NOT NULL default false | toggle global |
| name | text NOT NULL default 'Asistente' | |
| tone | text | |
| instructions | text | |
| escalation_rules | text | |
| greeting | text | |
| created_at / updated_at | | |

### kb_entry
| Columna | Tipo | Notas |
|---|---|---|
| id | text PK | `kb_` |
| organization_id | text NOT NULL FK CASCADE | |
| kind | text NOT NULL | `qa` \| `block` |
| question | text NULL | requerido si kind=qa |
| answer | text NULL | requerido si kind=qa |
| content | text NULL | requerido si kind=block |
| position | integer NOT NULL default 0 | |
| created_at / updated_at | | |

### template
| Columna | Tipo | Notas |
|---|---|---|
| id | text PK | `tpl_` |
| organization_id | text NOT NULL FK CASCADE | |
| name | text NOT NULL | snake_case exigido por Meta |
| language | text NOT NULL | p. ej. `es_MX` |
| category | text NOT NULL | `MARKETING` \| `UTILITY` |
| body | text NOT NULL | máx. UNA variable `{{1}}` |
| status | text NOT NULL default 'draft' | `draft` \| `pending` \| `approved` \| `rejected` |
| rejection_reason | text NULL | |
| wa_template_id | text NULL | id devuelto por Graph |
| created_at / updated_at | | |

UNIQUE `(organization_id, name, language)`.

### agent_test_run
| Columna | Tipo | Notas |
|---|---|---|
| id | text PK | `run_` |
| organization_id | text NOT NULL FK CASCADE | |
| status | text NOT NULL default 'running' | `running` \| `completed` \| `failed` |
| score | integer NULL | 0–100 al completar |
| error | text NULL | |
| started_at / finished_at | timestamptz | |

Lock de concurrencia: UNIQUE parcial `(organization_id) WHERE status = 'running'`
(máx. 1 corrida activa por org, a nivel BD). Al boot: `UPDATE ... SET status='failed'
WHERE status='running'`.

### agent_test_case
| Columna | Tipo | Notas |
|---|---|---|
| id | text PK | `case_` |
| organization_id | text NOT NULL FK CASCADE | |
| run_id | text NOT NULL FK→agent_test_run CASCADE | |
| persona | text NOT NULL | clave de la persona guionada |
| conversation_id | text NULL FK→conversation SET NULL | la conversación `is_test` |
| transcript | jsonb NOT NULL default '[]' | `[{role:'cliente'\|'agente', text, at}]` |
| veredicto | text NULL | `verde` \| `amarillo` \| `rojo` (NULL = juez falló) |
| hallazgos | jsonb NOT NULL default '[]' | `[{tipo, evidencia, sugerencia?}]` |
| status | text NOT NULL default 'pending' | `pending` \| `running` \| `done` \| `judge_failed` |
| created_at | | |

## Relaciones (resumen)

organization 1—N {contact, pipeline_stage, lead, conversation, message, kb_entry,
template, agent_test_run, agent_test_case} · 1—1 {meta_credentials, agent_profile} ·
contact 1—1 lead · contact 1—1 conversación real (N de test) · conversation 1—N message ·
agent_test_run 1—6 agent_test_case.

## Score del Laboratorio

`score = round(100 * (verdes + 0.5 * amarillos) / casos_con_veredicto)`; los
`judge_failed` se excluyen del denominador y se muestran aparte. Delta = score corrida
actual − score corrida anterior completada.

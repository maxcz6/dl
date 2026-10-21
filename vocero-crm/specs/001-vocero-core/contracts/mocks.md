# Contrato: Entorno de pruebas interno (wa-mock + ai-mock)

Ambos gated por `WA_MOCK_ENABLED=true` **y** `NODE_ENV !== 'production'` → si no,
**404 incondicional** (unit test). No aparecen en `.env.example`.

## wa-mock — harness de Cloud API

Intercepción: `META_GRAPH_BASE_URL` apunta a `http://localhost:3000/api/dev/wa-mock/graph`
(el cliente Graph usa esa base para TODAS las llamadas).

- `POST /api/dev/wa-mock/inbound` — simula un mensaje entrante: `{ phoneNumberId, from,
  name?, type?, text?, waMessageId?, timestamp? }`. Construye el payload real de Meta,
  lo firma con `META_APP_SECRET` (si está configurado) y hace POST interno al webhook
  público (URL con webhookToken). Overrides: `waMessageId` (test de dedup), `timestamp`
  (test ventana 24h).
- `POST /api/dev/wa-mock/status` — simula status: `{ waMessageId, status }` → payload
  `statuses` al webhook.
- `POST /api/dev/wa-mock/template-status` — simula `message_template_status_update`:
  `{ name, language, event: 'APPROVED'|'REJECTED', reason? }`.
- `ANY /api/dev/wa-mock/graph/*` — imita Graph API:
  - `POST .../{phoneNumberId}/messages` → `200 { messages: [{ id: "wamid.mock..." }] }`
    y registra en el **outbox** en memoria. Si el body es plantilla, registra
    componentes.
  - `GET .../{phoneNumberId}?fields=...` → valida el token de prueba: token con sufijo
    mágico `-invalid` → `401 { error: { code: 190, ... } }` (test camino infeliz del
    wizard); si no → `200 { display_phone_number, verified_name, id }`.
  - `POST .../{wabaId}/message_templates` → `200 { id: "tplmock..." , status: "PENDING" }`.
- `GET /api/dev/wa-mock/outbox` — lista de envíos capturados (aserciones E2E).
- `DELETE /api/dev/wa-mock/outbox` — limpia el estado del harness.

## ai-mock — proveedor LLM determinista

`POST /api/dev/ai-mock/chat/completions` (OpenAI-compatible; en self-test
`OPENROUTER_BASE_URL=http://localhost:3000/api/dev/ai-mock`). Decide por contenido del
último mensaje `user`:

- Contiene marcador de JUEZ (el prompt del juez incluye `[JUEZ]`): veredicto fijo —
  persona `fuera_de_kb` → `rojo` con 1 hallazgo `fuera_de_kb` + sugerencia
  `{pregunta, respuesta}`; resto → `verde` sin hallazgos.
- "quiero hablar con un humano" (u otra frase de la persona `pide_humano`) →
  `{"action":"handoff"}`.
- Intención de compra ("lo compro", "quiero comprar", persona compradora) →
  `{"action":"move_stage","stage":"Interesado","reply":"..."}`.
- Cualquier otro caso → `{"action":"reply","text":"Respuesta de prueba sobre: <eco>"}`.
- `GET /api/dev/ai-mock/v1/models` → `{ data: [{ id: "mock/agente", name }, { id: "mock/juez", name }] }`
  (#85, para «Traer modelos» de Ajustes → IA).
- Llave con sufijo `-invalid` → 401 y con `-sin-saldo` → 402, en ambas rutas (#85):
  ejercitan la pausa del proveedor de IA sin un proveedor real. Cualquier otra
  llave se acepta.

Respuesta con shape OpenRouter: `{ choices: [{ message: { content: "<json>" } }] }`.
El ai-mock NUNCA es fallback en runtime: solo se usa si `OPENROUTER_BASE_URL` apunta a
él explícitamente (entorno de test/dev).

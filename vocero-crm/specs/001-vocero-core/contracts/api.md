# Contrato: API interna (App Router route handlers)

Todas autenticadas por sesión Better Auth y scoped a la organización del usuario
(helpers de `lib/db/tenant`). Validación Zod en todo body/query. Errores:
`{ error: { code, message } }` con status apropiado; nunca stack traces ni secretos.

| Método y ruta | Propósito |
|---|---|
| `GET /api/health` | healthcheck deploy: `{ ok: true }` + check de BD |
| `GET /api/events` | SSE (ver sse.md) |
| `GET /api/conversations?since=` | lista bandeja (excluye `is_test`) |
| `GET /api/conversations/:id/messages?since=` | hilo + catch-up |
| `POST /api/conversations/:id/messages` | enviar texto `{ text }` — 409 si ventana cerrada |
| `POST /api/conversations/:id/messages/template` | enviar plantilla `{ templateId, variable }` |
| `PATCH /api/conversations/:id` | `{ aiEnabled? , reactivate? }` (quita handoff) |
| `GET/POST /api/contacts`, `PATCH /api/contacts/:id` | lista/búsqueda `?q=`, notas, archivar |
| `GET/POST/PATCH/DELETE /api/pipeline/stages(/:id)` | etapas (DELETE exige `moveTo`) |
| `PATCH /api/pipeline/leads/:id` | `{ stageId, position }` (drag & drop) |
| `GET/PUT /api/agent/profile` | comportamiento + toggle global |
| `GET/POST/PATCH/DELETE /api/kb(/:id)` | knowledge base CRUD |
| `GET /api/kb/size` | tamaño estimado del KB (contador/aviso) |
| `POST /api/lab/runs` | lanzar corrida — 409 si hay una `running` |
| `GET /api/lab/runs` / `GET /api/lab/runs/:id` | historial con delta / detalle+progreso |
| `POST /api/lab/suggestions/apply` | `{ caseId, hallazgoIndex, pregunta, respuesta }` → crea kb_entry |
| `GET/POST /api/templates` | lista / crear+enviar a aprobación |
| `POST /api/templates/sync` | sincronizar estados por Graph (pull; cubre modo agencia) |
| `GET /api/pipeline/board` | etapas + tarjetas del kanban en una llamada |
| `GET/PUT/DELETE /api/settings/whatsapp` | estado conexión / guardar credenciales y registrar el webhook en Meta (`webhook` en la respuesta) / desconectar el número (no toca conversaciones) |
| `POST /api/settings/whatsapp/test` | probar conexión (valida token↔número, NO guarda) |
| `GET/POST /api/settings/webhook` | URL completa del webhook + estado firma / registrar el webhook en Meta con la conexión guardada (409 sin conexión, 422/503 con el motivo de Meta) |
| `GET/POST /api/settings/team` | miembros / crear cuenta (owner only) |
| `POST /api/seed/demo` | cargar demo (solo BD vacía de dominio; idempotente) |
| `POST /api/auth/[...all]` | Better Auth (registro gated por 1ª org / `ALLOW_SIGNUP`) |

Rate limiting in-process por IP en endpoints de auth (login/registro): ventana
deslizante, 10 intentos / 10 min → 429.

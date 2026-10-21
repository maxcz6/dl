# Contrato: Acciones del agente y juez del Laboratorio

## Adaptador LLM (frontera única)

`lib/ai`: cliente `fetch` OpenRouter-compatible. Con quién habla lo resuelve
`lib/ai/provider.ts` (#85): primero la fila `ai_credentials` de la organización
(Ajustes → IA: base URL, modelo y llave cifrada; una fila pausada por 401/402 del
proveedor NO cae al entorno) y, sin fila, el entorno: `OPENROUTER_API_TOKEN`
(opcional — sin nada, agente/Laboratorio deshabilitados con estado vacío),
`OPENROUTER_BASE_URL` (default `https://openrouter.ai/api`), `OPENROUTER_MODEL`,
`OPENROUTER_JUDGE_MODEL` (default = `OPENROUTER_MODEL`; con fila, el juez usa el
modelo de la fila). API: `chatJson<T>(schema, messages, opts)` (`opts.organizationId`
elige la fila) → parsea con
extracción robusta (bloque ```json, primer `{...}` balanceado), valida con Zod,
reintenta ante fallo de red/parseo/validación (2 reintentos, backoff corto). Un hipo del
proveedor NUNCA propaga excepción al turno: agota reintentos → resultado `error` tipado.

## Acción del agente (una por turno)

```ts
const AgentAction = z.discriminatedUnion('action', [
  z.object({ action: z.literal('none') }),
  z.object({ action: z.literal('reply'), text: z.string().min(1) }),
  z.object({ action: z.literal('update_lead'), note: z.string().min(1),
             reply: z.string().optional() }),
  z.object({ action: z.literal('move_stage'), stage: z.string().min(1),
             reply: z.string().optional() }),
  z.object({ action: z.literal('handoff'), reason: z.string().optional(),
             farewell: z.string().optional() }),
])
```

- `move_stage.stage` se resuelve contra nombres de etapas de la org (fuzzy exacto →
  lower-case); sin match → se degrada a `reply` si trae texto, o `none`.
- Regex de respaldo de handoff (se evalúa sobre el mensaje del cliente ANTES del LLM):
  `/(hablar|comunicar|contactar)[\s\S]{0,40}?(asesor|humano|persona|alguien)|un asesor|atenci[oó]n humana/i`
  — "somos 4 personas" NO matchea (unit test).
- Disparadores de turno: ingesta de mensaje entrante en conversación con IA activa
  (global + conversación + sin handoff). Debounce (coalesce) 6s producción / 0 en
  Laboratorio; lock in-process por `conversation_id`; los mensajes que llegan durante el
  turno se re-encolan.
- Ventana cerrada o error persistente del proveedor → handoff automático
  (`handoff_reason: 'ventana' | 'error'`), sin enviar texto libre.

## Juez del Laboratorio (una llamada por conversación)

Input: transcript completo + KB + comportamiento. Output (Zod):

```ts
const Verdict = z.object({
  veredicto: z.enum(['verde', 'amarillo', 'rojo']),
  hallazgos: z.array(z.object({
    tipo: z.enum(['alucinacion', 'fuera_de_kb', 'debio_escalar', 'tono']),
    evidencia: z.string(),
    sugerencia: z.object({ pregunta: z.string(), respuesta: z.string() }).optional(),
  })),
})
```

Juez inválido tras reintentos → caso `judge_failed` (excluido del score, visible en el
reporte); la corrida continúa.

## Personas guionadas (fijas, sin LLM)

6 claves: `comprador_decidido`, `pregunton_precios`, `cliente_enojado`, `fuera_de_kb`,
`pide_humano`, `errores_modismos`. Cada una: 4–5 mensajes predefinidos; el runner envía
mensaje → espera el turno del agente (pipeline real, debounce 0) → siguiente. Fin del
guion o primer handoff → juez.

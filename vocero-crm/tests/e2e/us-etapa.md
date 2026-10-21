# US — El cerebro mueve la etapa (038)

Arnés: `scripts/e2e-etapa.mjs` con el cerebro falso
(`scripts/lib/cerebro-falso.mjs`). Spec:
[038](../../specs/038-cerebro-mueve-etapa/spec.md).

## Preparación

La app con la configuración estándar de los guiones (mocks de WhatsApp,
`BOT_API_KEY`, `BRAIN_DISPATCH_URL` a esta máquina, `AGENT_COALESCE_MS`
corto). El operador carga el preset Calificador, que enciende «Mover de
etapa», y enciende el interruptor del Agente.

## Pasos y criterios

1. **Un WhatsApp real.** Entra «ya califica, quiero una cotización». El CRM lo
   despacha; el cerebro falso pide el contexto, ve `lead.nextStages` (las
   abiertas después de la primera, en orden) y mueve al lead a la primera de
   ellas con `POST /api/bot/stage`. → 200 `changed: true`; el Pipeline lo
   enseña ahí; la bitácora de etapas dice `source = bot`, de la primera a la
   segunda. El cerebro además contesta al cliente.
2. **Repetir.** La misma etapa en mayúsculas → 200 `changed: false`, sin
   evento nuevo.
3. **Lo que no puede.** Hacia atrás, a la ganada y a la perdida → 409
   `etapa_no_permitida` con las válidas en el mensaje; un nombre que no existe
   → 422 `etapa_desconocida`; conversación inexistente → 404; llave
   equivocada → 401; sin `stage` → 422. El lead no se movió.
4. **Herramienta apagada.** Desde la pantalla Agente se deja `["ficha",
   "salida"]`: el perfil del cerebro ya no trae `etapa` y mover da 409
   `herramienta_apagada`. Encendida otra vez, mueve (por id). En la última
   abierta, `nextStages` viene vacía.
5. **Con una persona al frente.** Tras un handoff, mover da 409 `ai_paused`.

Al terminar, el guion deja el preset Calificador y el interruptor apagado.

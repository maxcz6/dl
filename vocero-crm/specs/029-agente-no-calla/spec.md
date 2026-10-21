# 029 — El agente no se queda callado ante un saludo

**Feature Branch**: `feat/029-agente-no-calla`

**Created**: 2026-10-14

**Status**: Especificada antes de escribir código. Implementada; gates y
guiones E2E en verde. D5 se añadió al implementar (marcado abajo).

**Input**: hallazgo de la prueba en vivo de la 027 (bitácora, 2026-10-14). Los
«Hola prueba 1» de Kevin a Instagram, a Messenger y por WhatsApp se quedaron
sin respuesta, y ya había pasado en la clase con la 1.5.1. No es una regresión
de la 1.6.0: es el prompt del agente incluido.

**Carril**: ligero (Principio VI). Solo cambia el texto del prompt del agente
incluido (`src/server/ai/prompts.ts`). No toca el modelo de datos, ni las
acciones que el agente puede tomar, ni ningún contrato publicado. Nea no tiene
una acción de callar: no le aplica.

## Problema

En cada turno el agente elige una acción, y una de ellas es `none`. El prompt
la describe solo como «no responder nada», sin decir cuándo usarla, y el
modelo la usa cuando decide que el mensaje no va en serio. Reproducido fuera
de la app con el prompt, el perfil, el conocimiento y el modelo
(`openai/gpt-4o-mini`) de `vocero-clase`, ocho vueltas por mensaje:

| Mensaje del cliente | Se queda sin respuesta |
|---|---|
| «Hola», «Buenas tardes» | 0 de 8 |
| «Hola prueba 1» (conversación nueva) | 8 de 8 |
| «Hola prueba 1» después del saludo del agente | 8 de 8 |
| «prueba» | 5 de 8 |
| «Ok gracias», «👍» después de una respuesta | 8 de 8 (correcto) |

«Hola, prueba» es lo primero que escribe un dueño al estrenar su agente, y lo
que escribe cualquier cliente para ver si alguien contesta. Si no contesta
nadie, el dueño concluye que Vocero no funciona y el cliente que nadie atiende.

Hay un camino más al mismo silencio: `update_lead` y `move_stage` llevan la
respuesta como opcional, y el modelo puede guardar la nota o mover el lead sin
contestarle nada a quien preguntó.

## Decisiones

**D1 — Callar solo cuando el cliente cierra.** `none` queda descrito como «no
enviar nada», y solo para cuando el último mensaje del cliente cierra la
conversación sin pedir nada («ok», «gracias», un emoji) y lo que preguntó ya
tiene respuesta. Se queda como acción: obligar a contestar cada «👍» hace que
el agente parezca un contestador.

**D2 — Todo lo demás se contesta.** Una regla dura más: un saludo, un mensaje
corto, raro o confuso, o un «hola prueba» se contestan (se saluda y se ofrece
ayuda). El agente nunca supone que es una prueba o un error.

**D3 — La nota y el cambio de etapa no sustituyen la respuesta.** Si el
cliente escribió algo que espera respuesta, `update_lead` y `move_stage` llevan
`reply`.

**D4 — Solo prompt, sin red de seguridad en código.** Se consideró que el
servidor contestara un saludo fijo cuando el modelo eligiera `none`. Se
descarta: decidir desde código qué mensaje «merece» respuesta es adivinar con
reglas lo que el modelo ya entiende, y un texto fijo del sistema contradice el
tono que el negocio configuró. Si un modelo sigue callando con el prompt
nuevo, el arreglo es el prompt.

**D5 — Recordatorio de formato al final del turno** (añadido al implementar).
Al medir apareció un segundo defecto, previo a esta spec: las respuestas
anteriores del agente le llegan al modelo como texto plano, y con ellas a la
vista contesta en texto plano. `chatJson` lo rescata con un reintento, pero
eso pasaba en **todos** los turnos después del primero (8 de 8 con el prompt de
`main`): el doble de espera y de gasto en cada respuesta. Una línea de sistema
al final de los mensajes del turno —después del historial, como el mapa de
huecos de la 015— pide el JSON de la acción. Medido: 0 reintentos.

## Resultado de la medición

`scripts/eval-silencios.ts` (`pnpm eval:silencios`), seis vueltas por mensaje,
con el prompt nuevo:

| Modelo | Saludos, pruebas y preguntas sin respuesta | Reintentos | Cierres en silencio |
|---|---|---|---|
| `openai/gpt-4o-mini` | 0 de 42 | 0 | «Ok gracias» 6/6, «👍» 2/6 |
| `anthropic/claude-sonnet-4.5` | 0 de 42 | 0 | 6/6 y 6/6 |

Con el perfil y el conocimiento de `vocero-clase` y `gpt-4o-mini`, ocho
vueltas: de 22 mensajes sin respuesta con el prompt de `main` a 0.

## Código

| Archivo | Qué |
|---|---|
| `src/server/ai/prompts.ts` | D1 a D3 en la lista de acciones y las reglas duras; `TURN_FORMAT_REMINDER` (D5) |
| `src/server/ai/pipeline.ts` | D5: el recordatorio va al final de los mensajes del turno |
| `scripts/eval-silencios.ts` (nuevo) · `pnpm eval:silencios` | La medición de arriba como guion del repo, contra el modelo real |
| `tests/unit/agent-prompt.test.ts` (nuevo) | Que el prompt diga cuándo se calla y que lo demás se contesta |

## Pruebas

- **Unitarias**: el prompt describe `none` con su condición de cierre, trae la
  regla de contestar saludos y pruebas, y pide `reply` en `update_lead` y
  `move_stage`; con y sin agenda.
- **Guion `scripts/eval-silencios.ts`** (gasta centavos, con la llave y el
  modelo del `.env`; no corre en CI): un negocio de ejemplo y los mensajes de
  la tabla, varias vueltas cada uno. Pasa si los saludos y las pruebas se
  contestan siempre y los cierres pueden quedar en silencio. Se corre con
  `gpt-4o-mini` (el de `vocero-clase`) y con el modelo por defecto del
  `.env.example`.
- **Los guiones E2E existentes** siguen en verde: corren con el ai-mock, que
  no lee el prompt, así que solo confirman que nada más se movió.
- **En vivo** (Principio IX): con la imagen nueva en `vocero-clase`, Kevin
  manda «Hola prueba 2» a Instagram o a la página y el agente contesta. Si no
  se puede, queda «pendiente de verificación humana».

## Constitution Check

| Principio | Cómo se cumple |
|---|---|
| I · Seguridad | Sin secretos nuevos; el guion de evaluación lee la llave del `.env` y no la imprime |
| II · Soberanía | Sin dependencias nuevas |
| III · Multi-tenancy | No toca datos |
| IV · Idempotencia | No toca escritura |
| V · Calidad | Cuatro gates, unitarias y la medición contra el modelo real |
| VI · Specs | Este documento, antes del código; carril ligero declarado |
| VII · Trazabilidad | D1 a D4; bitácora al cerrar |
| VIII · Foco | El agente de conversación, nada más |
| IX · En vivo | Lo descrito arriba |

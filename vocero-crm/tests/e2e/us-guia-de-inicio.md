# Guion E2E — Guía de inicio: la primera pantalla (#86, 036)

> Automatizado en `scripts/e2e-selftest.mjs` (sección «guía de inicio»),
> contra `pnpm dev` con los mocks (`WA_MOCK_ENABLED=true`,
> `META_GRAPH_BASE_URL` → wa-mock, `OPENROUTER_BASE_URL` → ai-mock). Los pasos
> de pantalla (ver la lista, pulsar «Encender») se conducen a mano o con
> Playwright; el arnés verifica la decisión del servidor y la API.

Lo que se protege: que quien instala Vocero vea PRIMERO qué le falta —y nada
más—, que cada paso se marque solo cuando la pieza de verdad funciona, y que
el botón final encienda el agente solo cuando hay uno conectado. Desde la 036
el CRM no trae agente: «Conecta tu agente» es opcional, y sin él Vocero es una
bandeja manual, no un error. Y que a nadie se le encierre: la guía captura
solo la raíz; el menú lleva a cualquier pantalla.

## Primer login

1. Registrarse (crea la organización) o iniciar sesión como propietario.
   ✅ `router.push("/")`: la raíz decide. `GET /` con la sesión → **307** a
   `/onboarding` mientras falte un paso obligatorio, o haya un agente
   conectado y siga apagado.
2. Abrir `/onboarding`.
   ✅ Cabecera «Deja listo tu CRM en N pasos» (N = 4; 5 con `AGENDA=on`),
   barra de avance «0 de N listos», la lista numerada con el paso 1 resaltado
   (`ring`); «Conecta tu agente» lleva la insignia **Opcional**. Al final, la
   tarjeta «Al final: encender a tu agente» explica que empieza apagado y que
   el botón aparece con los pasos listos y el agente conectado. En el menú,
   arriba de Bandeja: **Guía de inicio**.
3. `GET /api/onboarding/status` con la sesión.
   ✅ **200** `{steps, enabled:false, guide}`; `steps` trae `profile`, `ai`,
   `whatsapp`, `brain` y `calendar` (`not_applicable` sin agenda, y entonces
   `guide` no lo incluye). `guide.brainConnected` dice si hay agente sano. Sin sesión → **401**; un miembro del equipo → **403**.

## Los pasos se marcan solos

4. Paso 1 — `PUT /api/agent/profile {name, instructions}` (o cargar
   conocimiento en Agente).
   ✅ `profile` pasa a `ready`; en la pantalla, check verde y «Listo · revisar».
   Antes, con el nombre de fábrica y sin instrucciones ni conocimiento, el paso
   decía qué faltaba («Dale un nombre y escribe sus instrucciones…»).
5. Paso 2 — Ajustes → IA: `PUT /api/settings/ai {provider, baseUrl, model,
   token}`.
   ✅ `ai` → `ready` con «Llave guardada en Ajustes → IA». Si el entorno trae
   `OPENROUTER_API_TOKEN`, el paso ya estaba listo como «Respaldo del entorno»
   (la fila manda; el entorno es respaldo) y al borrar la fila
   (`DELETE /api/settings/ai`) vuelve a él. Una llave pausada por 401/402 se
   ve como pendiente con la pista en ámbar («El proveedor rechazó tu llave…»;
   unit: `onboarding-status.test.ts`).
6. Paso 3 — Ajustes → WhatsApp: `PUT /api/settings/whatsapp` con IDs de prueba
   (wa-mock).
   ✅ `whatsapp` → `ready`. Tras `DELETE /api/settings/whatsapp` vuelve a
   `pending`; con `reconnect_required` la pista dice que hay que reconectar.
7. Paso 4 — Conecta tu agente (036, opcional). La dirección vive en el
   entorno (`BRAIN_DISPATCH_URL`, `BRAIN_HEALTH_URL`, `BOT_API_KEY`), no en
   una pantalla: el botón «Cómo conectarlo» abre la receta del par
   (`docs/migrar-a-2.0.md`).
   ✅ Sin despacho: `brain` → `pending` con la pista de qué variable falta.
   Con despacho y el `/health` del cerebro caído: `pending` con «El /health
   de <host> no responde». Con el `/health` sano: `ready` y
   `guide.brainConnected:true`.
8. Paso 5 (solo con `AGENDA=on`) — Ajustes → Agenda.
   ✅ Con `weeklyHours` vacío (todos los días cerrados) el paso queda
   `pending`; al guardar L-V 09:00-18:00 con `enlace-fijo` pasa a `ready` sin
   pedir credenciales de nadie. Con Zoom/Google elegido y sin credencial, la
   pista lo dice.

## Encender

9. **Sin agente** (036): los pasos obligatorios listos y sin despacho.
   ✅ `guide.complete:true`, `brainConnected:false`; la tarjeta final dice
   «Listo: Vocero funciona como bandeja manual» con el enlace a la receta, sin
   botón de encender. `GET /` → **307** a `/inbox`: la bandeja manual no se
   queda atrapada en la guía.
   ✅ `PUT /api/agent/profile {enabled:true}` → **409** `sin_cerebro`.
10. **Con agente** conectado y sano, y el interruptor apagado.
   ✅ `guide.complete:true`, `brainConnected:true`, `enabled:false`; `GET /`
   sigue mandando a `/onboarding`; la tarjeta final ofrece **Encender a
   <nombre>**.
11. Pulsar **Encender** (`PUT /api/agent/profile {enabled:true}`).
    ✅ `enabled:true`; la tarjeta dice «<nombre> ya está contestando» con
    «Ir a la Bandeja»; `GET /` → **307** a `/inbox`: la guía dejó de ser la
    primera pantalla (sigue en el menú para revisarla).

## Camino infeliz y guardas

12. Un miembro del equipo (`role: member`) abre `/onboarding` → redirige a
    `/inbox`; su `GET /` → `/inbox` siempre; en su menú no hay «Guía de
    inicio».
13. Un negocio demo recién sembrado («Cargar datos de demostración»): el seed
    deja configurado el agente (paso 1 listo) pero no puede vincular una llave
    de IA, un número ni un agente → la guía sigue siendo la primera pantalla y
    lo dice; la Bandeja con la demo está a un clic en el menú.

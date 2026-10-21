# Guion E2E — US1: Bandeja de WhatsApp en tiempo real

> Conducido con Playwright (MCP) contra `pnpm dev` con el entorno de pruebas
> interno activo (`WA_MOCK_ENABLED=true`, `META_GRAPH_BASE_URL` → wa-mock).
> Requiere: usuario registrado y número conectado (mock, phoneNumberId `123456789`).

## Preparación

1. `DELETE /api/dev/wa-mock/outbox` — limpiar el harness.
2. Login en `/login` y abrir `/inbox`.

## Camino feliz

3. **Entrante en tiempo real (SC-001)**: `POST /api/dev/wa-mock/inbound`
   `{ phoneNumberId, from: "5215522223333", name: "Cliente E2E", text: "Hola, ¿tienen taladros?" }`.
   ✅ La conversación aparece en la lista en ≤2 s SIN recargar, con nombre y preview.
4. **Abrir el hilo**: clic en la conversación.
   ✅ El mensaje entrante se ve en burbuja; el contador de no-leídos se limpia.
5. **Responder**: escribir "¡Sí! ¿Qué modelo buscas?" y enviar.
   ✅ El mensaje aparece en el hilo (dirección out, reloj de pending).
   ✅ `GET /api/dev/wa-mock/outbox` contiene el envío con `to: 525522223333`
   (normalización MX) y el texto.
6. **Estados**: `POST /api/dev/wa-mock/status` con `delivered` y luego `read`.
   ✅ Los ticks progresan a ✓✓ y a ✓✓ azul sin recargar.
7. **Avatares**: la conversación muestra iniciales "CE" con color estable.

## Envío instantáneo

Automatizado en `scripts/e2e-envio-instantaneo.mjs`.

8. **Enter no espera a Meta**: escribir un renglón y pulsar Enter.
   ✅ El campo queda libre de inmediato (menos de 300 ms), sin esperar el viaje
   a Meta, que tarda ~1,5 s.
   ✅ En el hilo aparece ya la burbuja con reloj de "enviando".
9. **Dos renglones seguidos**: sin esperar, escribir el siguiente y pulsar Enter.
   ✅ Salen DOS mensajes separados, no uno con todo pegado.
   ✅ Llegan a WhatsApp en el mismo orden en que se escribieron: los envíos
   salen encolados, porque dos POST simultáneos pueden llegar a Meta en desorden.
   ✅ Cuando el mensaje real llega, la burbuja provisional se retira sin dejar
   duplicado y sin parpadeo.

## Ficha del lead

Automatizado en `scripts/e2e-ficha-lead.mjs`. `PUT /api/bot/ficha` ya dejaba al
agente guardar lo que averigua; sin esta sección era un cajón que se llenaba y
no se abría.

10. **Lo que sabe el agente se ve.** En el panel de detalles, bajo la etapa.
    ✅ Las claves se leen bonito (`dolor_principal` → "Dolor principal") sin que
    cambie lo guardado: renombrarlas rompería al agente, que las busca exactas.
    ✅ Los booleanos se muestran Sí/No — nadie califica en `true`.
    ✅ Aparece en vivo mientras el agente conversa, sin recargar.
11. **Se puede corregir.** Un dato equivocado que el dueño ve pero no puede
    arreglar enseña a desconfiar de toda la ficha.
    ✅ Editar NO cambia el tipo: `presupuesto: 50000` corregido a "60000" sigue
    siendo número, porque del otro lado hay un bot que puede estar comparando.
    ✅ El bote de basura quita la clave; vaciar el campo NO la borra.
12. **Nadie le pisa el trabajo al otro.** El agente sigue escribiendo mientras
    el dueño corrige.
    ✅ Es merge, no reemplazo: lo nuevo del agente entra sin borrar la
    corrección, y viceversa.
    ✅ Objetos y arreglos se ignoran en silencio en vez de tirar la ficha.
    ✅ Un contacto de otra organización → **404**, no una escritura a ciegas.

## Caminos infelices

13. **Dedup (SC-004)**: enviar dos veces el mismo `waMessageId` `wamid.dedup.1`.
   ✅ El hilo muestra UNA sola vez el mensaje.
14. **Ventana cerrada (SC-005)**: inbound de contacto nuevo con
   `timestamp` de hace 25 horas → abrir su conversación.
   ✅ El composer está bloqueado con la explicación de la ventana y ofrece
   plantillas (estado vacío si no hay aprobadas).
   ✅ `POST /api/conversations/:id/messages` responde 409 `window_closed`.
15. **Webhook segmento incorrecto**: `POST /api/webhooks/wa/token-falso` → 404
    y no aparece nada nuevo en la bandeja.
16. **Reconexión**: (cubierto por diseño: EventSource reconecta y el cliente
    refetch-ea con el evento `open`; verificación funcional en el checkpoint
    de compose).

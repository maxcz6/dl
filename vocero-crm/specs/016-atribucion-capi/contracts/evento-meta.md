# Contrato — El evento que sale hacia Meta

Frontera de salida única: `graphRequest` de `src/lib/meta/client.ts`, el mismo
cliente con el que el CRM manda mensajes. No hay un segundo camino a internet.

`POST {META_GRAPH_BASE_URL}/{version}/{datasetId}/events`
`Authorization: Bearer <token del dataset>`

```jsonc
{
  "data": [
    {
      "event_name": "QualifiedLead",        // catálogo CERRADO (abajo)
      "event_time": 1787000000,             // epoch en SEGUNDOS
      "action_source": "business_messaging",
      "messaging_channel": "whatsapp",
      "user_data": {
        "ctwa_clid": "ARAaB…",              // el clic, NO el teléfono
        "whatsapp_business_account_id": "1593715272371283"
      },
      "custom_data": { "lead_stage": "qualified" }
    }
  ],
  "partner_agent": "vocero-crm"
}
```

Para `Purchase` con monto capturado, `custom_data` lleva además
`{ "value": 450.5, "currency": "MXN" }` — **unidades de la moneda**, no centavos.

## Catálogo cerrado de `business_messaging`

`Purchase` · `LeadSubmitted` · `QualifiedLead` · `InitiateCheckout` ·
`AddToCart` · `ViewContent` · `OrderCreated` · `OrderShipped` ·
`OrderDelivered` · `OrderCanceled` · `OrderReturned` · `CartAbandoned` ·
`RatingProvided` · `ReviewProvided`

Cualquier otro nombre es un `400` opaco de Meta. Se valida **antes** de salir y
se falla con el motivo escrito. Vocero solo emite dos de ellos; la constante
existe para que un fork que agregue el suyo no descubra el catálogo a golpes.

## La respuesta, y la trampa

```jsonc
{ "events_received": 1, "messages": [], "fbtrace_id": "AkiF9pt…" }
```

**Meta responde `200` aunque descarte el evento.** `events_received` es el único
acuse real: con `0`, el evento se registra como **fallido** con su `fbtrace_id`,
nunca como enviado (D5). Errores conocidos que llegan así o como `400`:

| Señal | Qué pasó |
|---|---|
| `code 100 / error_subcode 2804087` | `ctwa_clid` inválido — Meta lo valida contra un clic real: **no existe evento sintético**. |
| `events_received: 0` sin explicación | Suele ser antigüedad del clid: fuera de la ventana de atribución. |
| `OAuthException 190` | Token vencido o sin permiso sobre el dataset. |

## Invariantes

1. Nunca sale un evento sin `ctwa_clid` (sin él Meta no puede empatar nada).
2. Nunca sale un evento de una conversación `is_test` (guardrail del Laboratorio).
3. Nunca sale el mismo evento dos veces para la misma conversación (UNIQUE en la
   base, no un `if` en el código).
4. Un fallo aquí jamás propaga: quien disparó la conversión no se entera.

# 027 — Importar contactos y contactos «sin agente»

**Feature Branch**: `feat/027-importar-contactos`

**Created**: 2026-10-13

**Status**: Especificada antes de escribir código. Implementada; gates y
guiones E2E en verde. Probada en vivo con la imagen `1.6.0-rc.4` (bitácora).

**Input**: sexta spec de la 1.6.0 (`PLAN-2.0.md`, aprobado por el dueño el
2026-10-13). Puerto de Vocero Cloud #108 (`a6d1bdf`): `src/lib/contact-import.ts`,
`src/server/contacts-import.ts`, `POST /api/contacts/import`, el diálogo y la
columna `contact.ai_paused`. Sin el aislamiento entre organizaciones de su
guion: en el raíz una instancia es un negocio.

**Carril**: ligero, con el modelo de datos dentro de esta spec (el mismo
precedente que la 020). Toca el modelo —una columna, migración aditiva
`0019_contact_ai_paused`— pero no ningún contrato publicado: `/api/bot/*` y el
despacho no cambian de forma, y lo que el cerebro ve de un contacto «sin
agente» es lo que ya veía de una conversación en pausa.

## Problema

Quien instala Vocero ya tiene a sus clientes en otro lado: una hoja de cálculo,
la lista de una comunidad, el export de otro sistema. Hoy solo puede darlos de
alta uno por uno. Y cuando alguno de ellos escribe, el agente le contesta como
a un desconocido, cuando el dueño quería atenderlos él.

## Decisiones

**D1 — El archivo se lee en el navegador y se enseña antes de escribir nada.**
Un CSV con una columna de nombre y una de teléfono en el primer renglón
(`nombre`/`name`/`contacto`; `telefono`/`phone`/`whatsapp`/`celular`…; una de
apellidos se une al nombre). Acepta coma, punto y coma o tabulador, comillas y
BOM. La vista previa dice cuántos entran, enseña los primeros y lista los que
se quedan fuera con su motivo. Un CSV mal armado se descubre ahí, no con
doscientos contactos basura creados.

**D2 — El servidor valida otra vez, con la misma función.** Lo que llega por la
red no es de fiar. Hasta 2,000 renglones por importación.

**D3 — El teléfono lleva código de país**, igual que el alta manual: diez
dígitos son un número local en varios países, y asumir uno crearía un contacto
que nunca casa con quien escriba después. Se guarda como lo guarda la ingesta
(521… → 52…), para que el importado y quien escribe sean la misma ficha.

| Motivo | Cuándo |
|---|---|
| `sin_telefono` | La celda no trae dígitos |
| `sin_codigo_pais` | Menos de 11 dígitos |
| `telefono_invalido` | Más de 15 dígitos |
| `repetido` | El mismo teléfono ya salió antes en el archivo |

**D4 — No duplica y no pisa.** A quien ya existía (por identidad o por
teléfono) no se le duplica ni se le cambia el nombre: pudo editarlo el dueño.
Importar dos veces el mismo archivo deja lo mismo que una.

**D4b — El nombre del archivo es del dueño.** Queda como escrito a mano
(`name_source = manual`): cuando el importado escriba, su nombre de perfil de
WhatsApp no lo pisa. Un renglón sin nombre entra con el teléfono como nombre y
sí toma el de WhatsApp en cuanto exista. (Añadido al implementar: el raíz
distingue los dos orígenes del nombre y cloud no.)

**D5 — No crea conversación ni lead.** Un hilo vacío ensuciaría la bandeja, y
una lista importada no es un embudo: meterla al Pipeline lo llenaría de gente
que no es prospecto. Son contactos de WhatsApp.

**D6 — «El agente no les responde».** Una casilla al importar, y otra en
«Editar» de cada contacto. Se guarda en el contacto (`ai_paused`) y:

- la conversación **la hereda al nacer**, en el mismo `INSERT`: el importado
  que escribe después llega a la bandeja con la IA en pausa, sin que el agente
  incluido conteste y sin que el cerebro reciba un despacho;
- si la persona ya tenía conversación, se le apaga ahí también; al reencender
  desde el contacto, vuelve. Reencender no levanta un traspaso que el agente
  decidió: eso se hace desde la bandeja, donde se ve por qué ocurrió;
- vive en el contacto y no solo en la conversación porque el importado todavía
  no tiene conversación, y porque tras eliminar un hilo (026) el siguiente
  nacería con el agente encendido;
- en la lista de Contactos sale la etiqueta «Sin agente».

## Modelo de datos

```sql
ALTER TABLE "contact" ADD COLUMN "ai_paused" boolean DEFAULT false NOT NULL;
```

Aditiva y con valor por defecto: los contactos existentes quedan con agente,
como estaban. Corre sola al arrancar.

## API interna (sesión)

| Ruta | Qué |
|---|---|
| `POST /api/contacts/import` | `{ contacts: [{ name, phone }], aiPaused? }` → `{ created, existing, paused, skipped: [{ line, name, reason }] }`. 422 `nothing_to_import` si ningún renglón sirve |
| `PATCH /api/contacts/{id}` | Acepta `aiPaused` y lo lleva a su conversación |
| `GET /api/contacts` y `/{id}` | El contacto trae `aiPaused` |

## Código

| Archivo | Qué |
|---|---|
| `src/lib/contact-import.ts` (nuevo) | Puro: leer el CSV, detectar columnas, normalizar teléfonos, preparar filas |
| `src/server/contacts-import.ts` (nuevo) | Importar en lotes; llevar la pausa a las conversaciones |
| `src/app/api/contacts/import/route.ts` (nuevo) | D2 |
| `src/server/inbox/ingest.ts` | La conversación hereda la pausa al crearse |
| `src/lib/db/schema.ts`, `drizzle/0019_contact_ai_paused.sql` | La columna |
| `src/components/contacts/import-contacts-dialog.tsx` (nuevo), `contacts-client.tsx` | D1, D6 |

## Pruebas

- **Unitarias** del lector: separadores, comillas, BOM, encabezados con
  acentos, apellidos, teléfonos (con `+`, espacios y el 1 de móvil mexicano),
  cada motivo de rechazo, el tope de renglones.
- **Guion `scripts/e2e-importar.mjs`** con simuladores y el agente incluido
  encendido: un CSV de 50 renglones entra completo y al repetirlo no duplica;
  los rechazados vuelven con su motivo; no nace conversación ni lead; a quien
  ya existía no se le cambia el nombre y su conversación queda en pausa; el
  importado que escribe cae en su misma ficha, con la IA en pausa, y el agente
  no le contesta; a un desconocido sí; reencender desde el contacto.
- Los guiones existentes siguen en verde.
- **Interfaz** en local: el diálogo con la vista previa y los rechazados, la
  etiqueta «Sin agente» y la casilla de «Editar», en claro y oscuro.
- **En vivo** (Principio IX): en `vocero-clase`, importar un contacto de
  prueba «sin agente» con el teléfono de la línea cliente no aplica (esa línea
  ya tiene conversación y es la que se usa para probar al agente); se importa
  un número de prueba que no existe y se elimina después. Que el agente calle
  ante un importado real queda cubierto por el guion.

## Constitution Check

| Principio | Cómo se cumple |
|---|---|
| I · Seguridad | El archivo no sale del navegador más que como filas ya leídas; el servidor revalida. Sin secretos |
| II · Soberanía | Sin dependencias nuevas: el CSV lo lee código propio |
| III · Multi-tenancy | Toda búsqueda e inserción pasa por `scoped()`; el índice único incluye la organización |
| IV · Idempotencia | Re-ejecutable: `ON CONFLICT DO NOTHING` sobre la llave del contacto y búsqueda previa |
| V · Calidad | Cuatro gates, unitarias y guion E2E |
| VI · Specs | Este documento, antes del código; carril ligero con el modelo de datos dentro, declarado |
| VII · Trazabilidad | Decisiones D1 a D6; bitácora al cerrar |
| VIII · Foco | Contactos del CRM de conversaciones; no se les envía nada al importarlos |
| IX · En vivo | Lo descrito arriba; lo que no se puede probar sin escribirle a terceros queda dicho |

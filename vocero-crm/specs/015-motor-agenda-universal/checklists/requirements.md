# Checklist de calidad del spec — 015-motor-agenda-universal

**Propósito**: validar que el spec está completo y listo para planear.
**Fecha**: 2026-08-26

## Calidad de contenido

- [x] Describe comportamiento observable, no implementación (las rutas y
      códigos citados son contrato observable, no diseño interno)
- [x] Historias priorizadas e independientemente entregables (P1 bandera +
      motor; P2 operador + Zoom; P3 Google — recortable sin romper la promesa)
- [x] La historia del alcance está completa: cita el 004, el README que hoy
      dice "fuera de alcance" (y lo revierte con argumentos) y el ADR-001
- [x] Escrito para el dueño del producto, sin jerga de framework

## Completitud de requisitos

- [x] Cero `[NEEDS CLARIFICATION]` pendientes en el spec (los supuestos están
      en Assumptions con su porqué; el único NEEDS VERIFICATION vive en
      research D6/contracts —conferencia síncrona de Google— y es de
      implementación, no de alcance)
- [x] Los dos requisitos innegociables del 004 sobreviven íntegros (FR-005,
      FR-006) y ganan la garantía atómica en base de datos
- [x] Cada requisito es verificable; los códigos HTTP y el sobre de error son
      contrato explícito verificado por el arnés (FR-007)
- [x] Edge cases cubren: bandera apagada a media vida, proveedor caído, cambio
      de conector con citas vivas, credenciales borradas, DST, carrera,
      mensaje repetido, Laboratorio
- [x] Success criteria medibles y tecnológicamente agnósticos (SC-001..007)
- [x] Fuera de alcance explícito: free-busy, recordatorios, multi-calendario,
      composición de conectores, cancelación por bot, OAuth con redirect

## Puerta constitucional (obligatoria en ambos carriles)

- [x] Carril declarado ANTES de código: ciclo completo (toca modelo de datos y
      contrato publicado `/api/bot/*`)
- [x] La violación del Principio II está nombrada, no escondida: enmienda
      propuesta por escrito (1.3.0 → 1.4.0) con procedimiento y plan B si se
      rechaza (recortar a bandera + motor + enlace-fijo)
- [x] Sandbox del Laboratorio tratado como requisito (FR-017) con la lección
      de asimetría del fork nombrada
- [x] Multi-tenancy e idempotencia declaradas (FR-019, migración re-ejecutable,
      cancelación idempotente, 404 del proveedor = éxito)

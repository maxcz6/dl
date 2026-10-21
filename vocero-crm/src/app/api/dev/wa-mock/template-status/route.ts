import { z } from "zod";
import { mockGuard } from "@/lib/dev-guard";
import { apiError, parseBody } from "@/lib/api";
import { getWaMockState } from "@/server/dev/wa-mock-state";
import {
  buildTemplateStatusPayload,
  deliverToWebhook,
} from "@/server/dev/wa-mock-inbound";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  wabaId: z.string().min(1),
  name: z.string().min(1),
  language: z.string().min(1),
  event: z.enum(["APPROVED", "REJECTED"]),
  reason: z.string().optional(),
  /** Meta reclasifica al aprobar (UTILITY → MARKETING). Solo lado "Meta". */
  category: z.string().optional(),
  /**
   * `false` = mueve solo el panel simulado de Meta, sin entregar el webhook.
   * Reproduce el modo agencia real, donde `message_template_status_update` va
   * al callback a nivel app y esta instancia jamás lo ve: el único camino es
   * el pull de `POST /api/templates/sync`.
   */
  notify: z.boolean().optional(),
});

export async function POST(req: Request) {
  const guard = mockGuard();
  if (guard) return guard;

  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;

  // Mantener coherente el estado del "panel de Meta" simulado (para el sync).
  const state = getWaMockState();
  const tpl = state.templates.find(
    (t) => t.name === body.data.name && t.language === body.data.language
  );
  if (tpl) {
    tpl.status = body.data.event;
    if (body.data.category) tpl.category = body.data.category;
  }

  if (body.data.notify === false) {
    return Response.json({ delivered: false, metaStatus: body.data.event });
  }

  const payload = buildTemplateStatusPayload({
    ...body.data,
    templateId: tpl?.id,
  });
  const res = await deliverToWebhook(payload);
  return res.ok
    ? Response.json({ delivered: true })
    : apiError(502, "webhook_error", `El webhook respondió ${res.status}`);
}

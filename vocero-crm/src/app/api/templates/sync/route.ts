import { apiError, withAuth } from "@/lib/api";
import {
  syncTemplates,
  TemplateError,
  templateErrorStatus,
} from "@/server/whatsapp/templates";

export const dynamic = "force-dynamic";

/**
 * Sincroniza estados de plantillas por Graph API (pull). Vía universal para
 * el modo agencia: los webhooks de plantillas no siguen el override de
 * callback (limitación de Meta documentada en el README).
 */
export const POST = withAuth(async (session) => {
  try {
    const updated = await syncTemplates(session.organizationId);
    return Response.json({ ok: true, updated });
  } catch (err) {
    if (err instanceof TemplateError) {
      return apiError(templateErrorStatus(err), err.code, err.message);
    }
    throw err;
  }
});

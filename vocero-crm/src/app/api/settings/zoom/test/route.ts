import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { agendaDisabledResponse, agendaEnabled } from "@/server/agenda/flag";
import { zoomConnector } from "@/server/agenda/connectors/zoom";
import { getZoomCredentials } from "@/server/agenda/connectors/zoom-credentials";

export const dynamic = "force-dynamic";

const schema = z.object({
  accountId: z.string().trim().optional(),
  clientId: z.string().trim().optional(),
  clientSecret: z.string().trim().optional(),
});

/**
 * Probar sin guardar. Con los campos vacíos prueba las credenciales YA
 * guardadas — así el operador puede verificar una conexión sin volver a pegar
 * un secreto que la UI nunca le devolvió.
 */
export const POST = withAuth(async (session, req: Request) => {
  if (!agendaEnabled()) return agendaDisabledResponse();
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;

  const stored = await getZoomCredentials(session.organizationId);
  const accountId = body.data.accountId || stored?.accountId;
  const clientId = body.data.clientId || stored?.clientId;
  const clientSecret = body.data.clientSecret || stored?.clientSecret;

  if (!accountId || !clientId || !clientSecret) {
    return apiError(422, "invalid_body", "Faltan credenciales que probar");
  }

  const check = await zoomConnector.testConnection({
    accountId,
    clientId,
    clientSecret,
    status: "connected",
  });
  if (!check.ok) return apiError(422, "zoom_invalid", check.error);
  return Response.json({ ok: true, detail: check.detail ?? null });
});

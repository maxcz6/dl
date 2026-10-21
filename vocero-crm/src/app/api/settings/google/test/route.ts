import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { agendaDisabledResponse, agendaEnabled } from "@/server/agenda/flag";
import { googleConnector } from "@/server/agenda/connectors/google";
import { getGoogleCredentials } from "@/server/agenda/connectors/google-credentials";

export const dynamic = "force-dynamic";

const schema = z.object({
  clientId: z.string().trim().optional(),
  clientSecret: z.string().trim().optional(),
  refreshToken: z.string().trim().optional(),
  calendarId: z.string().trim().optional(),
});

/** Probar sin guardar; con los campos vacíos prueba lo ya guardado. */
export const POST = withAuth(async (session, req: Request) => {
  if (!agendaEnabled()) return agendaDisabledResponse();
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;

  const stored = await getGoogleCredentials(session.organizationId);
  const clientId = body.data.clientId || stored?.clientId;
  const clientSecret = body.data.clientSecret || stored?.clientSecret;
  const refreshToken = body.data.refreshToken || stored?.refreshToken;
  const calendarId =
    body.data.calendarId || stored?.calendarId || "primary";

  if (!clientId || !clientSecret || !refreshToken) {
    return apiError(422, "invalid_body", "Faltan credenciales que probar");
  }

  const check = await googleConnector.testConnection({
    clientId,
    clientSecret,
    refreshToken,
    calendarId,
    status: "connected",
  });
  if (!check.ok) return apiError(422, "google_invalid", check.error);
  return Response.json({ ok: true, detail: check.detail ?? null });
});

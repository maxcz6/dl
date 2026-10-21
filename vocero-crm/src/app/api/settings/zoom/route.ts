import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { agendaDisabledResponse, agendaEnabled } from "@/server/agenda/flag";
import { zoomConnector } from "@/server/agenda/connectors/zoom";
import {
  deleteZoomCredentials,
  getZoomCredentials,
  saveZoomCredentials,
  secretLast4,
} from "@/server/agenda/connectors/zoom-credentials";

export const dynamic = "force-dynamic";

/**
 * 015 — Conexión de Zoom. El secreto entra, pero nunca vuelve a salir: hacia
 * el navegador solo van sus últimos 4 y el estado.
 */

export const GET = withAuth(async (session) => {
  if (!agendaEnabled()) return agendaDisabledResponse();
  const creds = await getZoomCredentials(session.organizationId);
  if (!creds) return Response.json({ connection: null });
  return Response.json({
    connection: {
      status: creds.status,
      secretLast4: secretLast4(creds.clientSecret),
      fields: { accountId: creds.accountId, clientId: creds.clientId },
    },
  });
});

const credsSchema = z.object({
  accountId: z.string().trim().min(1),
  clientId: z.string().trim().min(1),
  clientSecret: z.string().trim().min(1),
});

/** Guarda validando ANTES contra Zoom: unas credenciales que no sirven no llegan a la base. */
export const PUT = withAuth(async (session, req: Request) => {
  if (!agendaEnabled()) return agendaDisabledResponse();
  const body = await parseBody(req, credsSchema);
  if (!body.ok) return body.response;

  const check = await zoomConnector.testConnection({
    ...body.data,
    status: "connected",
  });
  if (!check.ok) return apiError(422, "zoom_invalid", check.error);

  await saveZoomCredentials({
    organizationId: session.organizationId,
    ...body.data,
  });

  return Response.json({
    connection: {
      status: "connected",
      secretLast4: secretLast4(body.data.clientSecret),
      fields: { accountId: body.data.accountId, clientId: body.data.clientId },
    },
  });
});

export const DELETE = withAuth(async (session) => {
  if (!agendaEnabled()) return agendaDisabledResponse();
  await deleteZoomCredentials(session.organizationId);
  return Response.json({ ok: true });
});

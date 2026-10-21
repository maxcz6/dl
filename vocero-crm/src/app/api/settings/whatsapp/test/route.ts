import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { testConnection } from "@/server/whatsapp/connect";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  phoneNumberId: z.string().trim().min(1),
  token: z.string().trim().min(1),
});

/** Prueba de conexión: valida token↔número, NO guarda (FR-040). */
export const POST = withAuth(async (_session, req: Request) => {
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;

  const check = await testConnection(body.data.phoneNumberId, body.data.token);
  if (!check.ok) {
    const status = check.code === "meta_unavailable" ? 503 : 422;
    return apiError(status, check.code, check.message);
  }
  return Response.json({
    ok: true,
    displayPhoneNumber: check.displayPhoneNumber,
    verifiedName: check.verifiedName,
  });
});

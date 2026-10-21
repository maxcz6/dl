import { apiError, parseBody, withAuth } from "@/lib/api";
import { listModels } from "@/lib/ai/probe";
import {
  aiModelsSchema,
  baseUrlEfectiva,
  llaveParaProbar,
} from "@/server/ai/settings";

export const dynamic = "force-dynamic";

/**
 * «Traer modelos»: `GET {base}/v1/models` con la llave escrita (o la
 * guardada). Un proveedor que no publica la lista no es un error: se dice
 * (`soportado: false`) y el modelo se escribe a mano.
 */
export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, aiModelsSchema);
  if (!body.ok) return body.response;

  const llave = await llaveParaProbar(session.organizationId, body.data.token);
  if (!llave) {
    return apiError(
      422,
      "sin_token",
      "Pega la llave del proveedor para traer sus modelos"
    );
  }

  const baseUrl = baseUrlEfectiva(body.data.provider, body.data.baseUrl);
  const result = await listModels({ baseUrl, token: llave.token });
  if (result.ok) {
    return Response.json({ soportado: true, modelos: result.modelos });
  }
  if (result.code === "unsupported") {
    return Response.json({
      soportado: false,
      modelos: [],
      mensaje: result.message,
    });
  }
  const status =
    result.code === "invalid_token" || result.code === "bad_url" ? 422 : 503;
  return apiError(status, result.code, result.message);
});

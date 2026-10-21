import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { IMPORT_MAX_ROWS, prepareImport } from "@/lib/contact-import";
import { importContacts } from "@/server/contacts-import";

export const dynamic = "force-dynamic";

const importSchema = z.object({
  contacts: z
    .array(
      z.object({
        name: z.string().max(200),
        phone: z.string().max(40),
      })
    )
    .min(1)
    .max(IMPORT_MAX_ROWS),
  /** El agente no les responde: los atiende el dueño. */
  aiPaused: z.boolean().optional(),
});

/**
 * Importación de contactos en lote (CSV leído en el navegador).
 *
 * El navegador ya validó para enseñar la vista previa, pero aquí se valida
 * otra vez con la MISMA función: lo que llega por la red no es de fiar, y un
 * teléfono sin código de país crearía un contacto que nunca casa con quien
 * escriba después.
 */
export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, importSchema);
  if (!body.ok) return body.response;

  const { valid, problems } = prepareImport(body.data.contacts);
  if (valid.length === 0) {
    return apiError(
      422,
      "nothing_to_import",
      "Ningún renglón trae un teléfono válido con código de país"
    );
  }

  const result = await importContacts(session.organizationId, valid, {
    aiPaused: body.data.aiPaused ?? false,
  });
  return Response.json({ ...result, skipped: problems });
});

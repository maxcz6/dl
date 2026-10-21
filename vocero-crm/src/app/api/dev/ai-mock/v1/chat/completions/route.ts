import { mockGuard } from "@/lib/dev-guard";
import {
  aiMockAuthFailure,
  aiMockCompletion,
  aiMockEstado,
  aiMockRegistrar,
} from "@/server/dev/ai-mock";

export const dynamic = "force-dynamic";

/** 025 — Consultar o configurar el mock (demora y peticiones recibidas). */
export async function GET(req: Request) {
  const guard = mockGuard();
  if (guard) return guard;
  const e = aiMockEstado(new URL(req.url).searchParams);
  return Response.json({ demoraMs: e.demoraMs, peticiones: e.peticiones });
}

export async function POST(req: Request) {
  const guard = mockGuard();
  if (guard) return guard;

  // Como el wa-mock con su sufijo `-invalid`: una llave con sufijo conocido
  // se rechaza con el código que daría el proveedor, para ejercitar la pausa.
  const rechazo = aiMockAuthFailure(req.headers.get("authorization"));
  if (rechazo) return Response.json(rechazo.body, { status: rechazo.status });

  const body = (await req.json().catch(() => ({}))) as {
    messages?: { role: string; content: string }[];
  };
  await aiMockRegistrar(body.messages ?? []);
  const content = aiMockCompletion(body.messages ?? []);
  return Response.json({
    id: "aimock",
    choices: [{ index: 0, message: { role: "assistant", content } }],
  });
}

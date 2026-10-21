import { mockGuard } from "@/lib/dev-guard";
import { getWaMockState, resetWaMockState } from "@/server/dev/wa-mock-state";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = mockGuard();
  if (guard) return guard;
  return Response.json({ outbox: getWaMockState().outbox });
}

export async function DELETE() {
  const guard = mockGuard();
  if (guard) return guard;
  resetWaMockState();
  return Response.json({ cleared: true });
}

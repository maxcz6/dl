import { notFound } from "next/navigation";
import { AgendaClient } from "@/components/settings/agenda-client";
import { agendaEnabled } from "@/server/agenda/flag";

export const dynamic = "force-dynamic";

export default function AgendaSettingsPage() {
  // Sin la bandera esta pantalla no existe en esta instancia.
  if (!agendaEnabled()) notFound();
  return <AgendaClient />;
}

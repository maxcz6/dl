import { notFound } from "next/navigation";
import { InstagramClient } from "@/components/settings/instagram-client";
import { isChannelEnabled } from "@/server/channels/enabled";

export const dynamic = "force-dynamic";

export default function InstagramSettingsPage() {
  // Sin el canal encendido esta pantalla no existe en esta instancia (ADR-001).
  if (!isChannelEnabled("instagram")) notFound();
  return <InstagramClient />;
}

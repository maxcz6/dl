import { notFound } from "next/navigation";
import { TiktokClient } from "@/components/settings/tiktok-client";
import { isChannelEnabled } from "@/server/channels/enabled";

export const dynamic = "force-dynamic";

export default function TiktokSettingsPage() {
  // Sin el canal encendido esta pantalla no existe en esta instancia (ADR-001).
  if (!isChannelEnabled("tiktok")) notFound();
  return <TiktokClient />;
}

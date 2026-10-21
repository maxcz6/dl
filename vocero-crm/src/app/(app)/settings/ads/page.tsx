import { notFound } from "next/navigation";
import { AdsClient } from "@/components/settings/ads-client";
import { atribucionEnabled } from "@/server/attribution/flag";

export const dynamic = "force-dynamic";

export default function AdsSettingsPage() {
  // Sin la bandera esta pantalla no existe en esta instancia.
  if (!atribucionEnabled()) notFound();
  return <AdsClient />;
}

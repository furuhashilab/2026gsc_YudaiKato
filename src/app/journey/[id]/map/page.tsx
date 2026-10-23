import { requireJourneyReadyUser } from "@/lib/route-guards";

import { JourneyMapView } from "./journey-map-view.tsx";

export default async function JourneyMapPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireJourneyReadyUser();
  const { id } = await params;

  return (
    <main className="journey-map">
      <h1>Journey地図</h1>
      <JourneyMapView journeyId={id} />
    </main>
  );
}

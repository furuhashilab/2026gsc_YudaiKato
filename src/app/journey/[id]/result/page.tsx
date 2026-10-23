import { requireJourneyReadyUser } from "@/lib/route-guards";

import { JourneyResultView } from "./journey-result-view.tsx";

export default async function JourneyResultPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireJourneyReadyUser();
  const { id } = await params;

  return (
    <main className="journey-result">
      <h1>記録結果</h1>
      <JourneyResultView journeyId={id} />
    </main>
  );
}

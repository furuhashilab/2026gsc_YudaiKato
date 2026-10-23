import { requireJourneyReadyUser } from "@/lib/route-guards";

import { JourneyRecorder } from "./journey-recorder.tsx";

export default async function JourneyRecordPage() {
  await requireJourneyReadyUser();

  return (
    <main className="journey-record">
      <h1>Journey記録</h1>
      <p className="notice">
        記録にはログインと位置情報の利用許可が必要です。スマートフォンではHTTPS（またはlocalhost）で開いてください。
      </p>
      <JourneyRecorder />
    </main>
  );
}

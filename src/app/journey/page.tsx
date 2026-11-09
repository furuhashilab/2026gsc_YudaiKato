import Link from "next/link";

import { countConfirmedListeningEventsBySession } from "@/lib/listening-events";
import { countLocationSamplesBySession } from "@/lib/location-samples";
import { listJourneys } from "@/lib/journeys";
import type { Journey } from "@/lib/journeys";
import { listRecordingSessions } from "@/lib/recording-sessions";
import type { RecordingSession } from "@/lib/recording-sessions";
import { requireJourneyReadyUser } from "@/lib/route-guards";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server-client.ts";

import { ResumeSessionButton } from "./resume-session-button.tsx";

function formatDateTime(value: string) {
  // Server Componentで実行されるため、実行環境のタイムゾーンに依存させず明示的にJSTで表示する。
  return new Date(value).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
}

function formatDuration(startedAt: string, endedAt: string | null) {
  if (!endedAt) return "—";
  const totalSeconds = Math.max(0, Math.floor((Date.parse(endedAt) - Date.parse(startedAt)) / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

type CompletedRow = {
  kind: "completed";
  startedAt: string;
  journey: Journey;
  locationSampleCount: number;
  trackCount: number;
};

type IncompleteRow = {
  kind: "incomplete";
  startedAt: string;
  session: RecordingSession;
};

type Row = CompletedRow | IncompleteRow;

export default async function JourneyListPage() {
  const user = await requireJourneyReadyUser();

  const db = createSupabaseServiceRoleClient();
  const [journeys, recordingSessions] = await Promise.all([
    listJourneys(db, user.id),
    listRecordingSessions(db, user.id),
  ]);

  // 記録を最後まで終えずタブを閉じた場合や、Journey作成APIの呼び出しだけ失敗した場合、
  // recording_sessionsには行が残るがjourneysには対応する行が無いままになる。
  // そうしたセッションも一覧に出し、「未完了」として結果画面への導線を用意する。
  const sessionIdsWithJourney = new Set(journeys.map((journey) => journey.sessionId));
  const incompleteSessions = recordingSessions.filter(
    (session) => !sessionIdsWithJourney.has(session.id),
  );

  const completedRows: CompletedRow[] = await Promise.all(
    journeys.map(async (journey) => {
      const [locationSampleCount, trackCount] = await Promise.all([
        countLocationSamplesBySession(db, journey.sessionId),
        countConfirmedListeningEventsBySession(db, journey.sessionId),
      ]);
      return {
        kind: "completed",
        startedAt: journey.startedAt,
        journey,
        locationSampleCount,
        trackCount,
      };
    }),
  );

  const incompleteRows: IncompleteRow[] = incompleteSessions.map((session) => ({
    kind: "incomplete",
    startedAt: session.startedAt,
    session,
  }));

  const rows: Row[] = [...completedRows, ...incompleteRows].sort(
    (a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt),
  );

  return (
    <main className="journey-list">
      <h1>Journey一覧</h1>

      {rows.length === 0 ? (
        <p className="summary">
          まだJourneyの記録がありません。<Link href="/journey/record">記録を始める</Link>
        </p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>記録日時</th>
                <th>記録時間</th>
                <th>GPS点数</th>
                <th>曲数</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) =>
                row.kind === "completed" ? (
                  <tr key={row.journey.id}>
                    <td>{formatDateTime(row.journey.startedAt)}</td>
                    <td>{formatDuration(row.journey.startedAt, row.journey.endedAt)}</td>
                    <td>{row.locationSampleCount}件</td>
                    <td>{row.trackCount}曲</td>
                    <td>
                      <a href={`/journey/${row.journey.id}/result`}>結果</a>{" "}
                      <a href={`/journey/${row.journey.id}/map`}>地図</a>
                    </td>
                  </tr>
                ) : (
                  <tr key={row.session.id}>
                    <td>{formatDateTime(row.session.startedAt)}</td>
                    <td>—</td>
                    <td>—</td>
                    <td>—</td>
                    <td>
                      <span className="notice">未完了</span>{" "}
                      <ResumeSessionButton sessionId={row.session.id} />
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

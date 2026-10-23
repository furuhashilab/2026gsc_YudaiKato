"use client";

import { useCallback, useEffect, useState } from "react";

type JourneyStatus = {
  journey: { id: string; startedAt: string; endedAt: string | null };
  recordingSession: { id: string; status: "recording" | "completed" | "cancelled"; endedAt: string | null };
  locationSampleCount: number;
  listeningEventCount: number;
  joinResultCount: number;
  hasJoinRun: boolean;
};

type ViewState = "loading" | "running" | "done" | "error";

async function requestJson<T>(url: string, options?: { method?: string }): Promise<T> {
  const response = await fetch(url, { method: options?.method ?? "GET", cache: "no-store" });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string"
        ? (data as { error: string }).error
        : `リクエストに失敗しました（HTTP ${response.status}）。`;
    throw new Error(message);
  }
  return data as T;
}

function fetchStatus(journeyId: string): Promise<JourneyStatus> {
  return requestJson<JourneyStatus>(`/api/journeys/${journeyId}/status`);
}

type Props = { journeyId: string };

export function JourneyResultView({ journeyId }: Props) {
  const [status, setStatus] = useState<JourneyStatus | null>(null);
  const [viewState, setViewState] = useState<ViewState>("loading");
  const [error, setError] = useState<string | null>(null);

  // GPS flush→セッション終了→Scrobble取得→結合の一連の処理を実行する。
  // どのステップも再実行して安全なため（終了済みセッションは無害、Scrobbleはupsert、結合は新しいjoin_runを作るだけ）、
  // 初回の自動実行にも「復旧」ボタンからの再試行にも同じ関数を使える。
  const runPendingSteps = useCallback(async () => {
    setViewState("running");
    setError(null);

    try {
      const current = await fetchStatus(journeyId);

      if (current.recordingSession.status !== "completed") {
        try {
          await requestJson(`/api/recording-sessions/${current.recordingSession.id}`, { method: "PATCH" });
        } catch (cause) {
          const alreadyEnded = cause instanceof Error && cause.message.includes("すでに終了");
          if (!alreadyEnded) throw cause;
        }
      }

      await requestJson(`/api/recording-sessions/${current.recordingSession.id}/scrobbles`, { method: "POST" });
      await requestJson(`/api/journeys/${journeyId}/join`, { method: "POST" });

      const finalStatus = await fetchStatus(journeyId);
      setStatus(finalStatus);
      setViewState("done");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "予期しないエラーが発生しました。");
      setViewState("error");
    }
  }, [journeyId]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setViewState("loading");
      setError(null);
      try {
        const initialStatus = await fetchStatus(journeyId);
        if (cancelled) return;
        setStatus(initialStatus);

        if (initialStatus.hasJoinRun) {
          setViewState("done");
        } else {
          await runPendingSteps();
        }
      } catch (cause) {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : "予期しないエラーが発生しました。");
        setViewState("error");
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [journeyId]);

  if (viewState === "loading") {
    return <p className="summary">読み込み中…</p>;
  }

  if (viewState === "running") {
    return <p className="notice">GPSログとLast.fmの再生履歴を結合しています…</p>;
  }

  if (viewState === "error") {
    return (
      <>
        <p className="error" role="alert"><strong>エラー:</strong> {error}</p>
        <div className="actions">
          <button type="button" onClick={() => void runPendingSteps()}>復旧する</button>
        </div>
      </>
    );
  }

  return (
    <>
      <section className="status-grid" aria-label="記録結果">
        <div><strong>GPS保存件数</strong><span>{status?.locationSampleCount ?? 0}件</span></div>
        <div><strong>Scrobble取得件数</strong><span>{status?.listeningEventCount ?? 0}件</span></div>
        <div><strong>結合件数</strong><span>{status?.joinResultCount ?? 0}件</span></div>
      </section>

      <div className="actions">
        <a href={`/journey/${journeyId}/map`}>地図で見る</a>
        <a href="/journey/record">もう一度記録する</a>
      </div>
    </>
  );
}

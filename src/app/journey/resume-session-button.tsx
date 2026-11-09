"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type JourneyResponse = { journey: { id: string } };

async function requestJson<T>(url: string, options: { method: string; body?: unknown }): Promise<T> {
  const init: RequestInit = { method: options.method };
  if (options.body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(options.body);
  }

  const response = await fetch(url, init);
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

type Props = { sessionId: string };

/**
 * journeysにまだ行が無いrecording_session（記録が最後まで終わらなかった、
 * またはJourney作成だけ失敗したセッション）向け。
 * POST /api/journeysはsessionId指定でget-or-createするため、新規APIを増やさずに
 * 「Journeyを作って結果画面へ進む」導線を再現できる。
 */
export function ResumeSessionButton({ sessionId }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = async () => {
    setPending(true);
    setError(null);
    try {
      const { journey } = await requestJson<JourneyResponse>("/api/journeys", {
        method: "POST",
        body: { sessionId },
      });
      router.push(`/journey/${journey.id}/result`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "予期しないエラーが発生しました。");
      setPending(false);
    }
  };

  return (
    <>
      <button type="button" onClick={() => void handleClick()} disabled={pending}>
        結果画面へ
      </button>
      {error && (
        <span className="error" role="alert">
          {error}
        </span>
      )}
    </>
  );
}

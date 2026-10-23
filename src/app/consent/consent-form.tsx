"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";

export function ConsentForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConsent = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/research-consents", { method: "POST" });
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message =
          data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string"
            ? (data as { error: string }).error
            : `同意の保存に失敗しました（HTTP ${response.status}）。`;
        throw new Error(message);
      }
      router.push("/journey/record");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "予期しないエラーが発生しました。");
      setLoading(false);
    }
  }, [router]);

  return (
    <>
      <div className="actions">
        <button type="button" onClick={() => void handleConsent()} disabled={loading}>
          同意する
        </button>
      </div>
      {error && <p className="error" role="alert"><strong>エラー:</strong> {error}</p>}
    </>
  );
}

"use client";

import { useCallback, useState } from "react";

type Props = {
  initialUsername: string;
};

export function MusicAccountForm({ initialUsername }: Props) {
  const [username, setUsername] = useState(initialUsername);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setSaving(true);
      setError(null);
      setSaved(false);

      try {
        const response = await fetch("/api/music-accounts", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lastfmUsername: username }),
        });
        const data: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          const message =
            data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string"
              ? (data as { error: string }).error
              : `保存に失敗しました（HTTP ${response.status}）。`;
          throw new Error(message);
        }
        setSaved(true);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "予期しないエラーが発生しました。");
      } finally {
        setSaving(false);
      }
    },
    [username],
  );

  return (
    <>
      <form onSubmit={(event) => void handleSubmit(event)}>
        <label>
          Last.fmユーザー名
          <input
            type="text"
            value={username}
            onChange={(event) => {
              setUsername(event.target.value);
              setSaved(false);
            }}
            required
          />
        </label>
        <button type="submit" disabled={saving}>保存</button>
      </form>

      {error && <p className="error" role="alert"><strong>エラー:</strong> {error}</p>}
      {saved && (
        <p className="summary">
          保存しました。続けて<a href="/journey/record">Journeyを記録する</a>ことができます。
        </p>
      )}
    </>
  );
}

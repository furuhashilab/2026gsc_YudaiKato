"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser-client.ts";

type Phase =
  | "idle"
  | "recording"
  | "ending"
  | "fetching_scrobbles"
  | "creating_journey"
  | "joining"
  | "done"
  | "error";

const PHASE_LABEL: Record<Phase, string> = {
  idle: "未記録",
  recording: "記録中",
  ending: "GPSログを送信中",
  fetching_scrobbles: "Last.fmのScrobbleを取得中",
  creating_journey: "Journeyを作成中",
  joining: "位置情報と再生履歴を結合中",
  done: "完了",
  error: "エラー",
};

type PendingLocationSample = {
  sampleId: string;
  recordedAt: string;
  geolocationRecordedAt: string | null;
  positionAgeAtReceiptMs: number;
  latitude: number;
  longitude: number;
  accuracyM: number | null;
  speedMps: number | null;
  headingDeg: number | null;
  altitudeM: number | null;
  visibilityState: "visible" | "hidden";
  intervalFromPrevMs: number | null;
};

type RecordingSessionResponse = {
  recordingSession: { id: string; startedAt: string };
};
type ScrobbleResponse = { fetchedCount: number; savedCount: number };
type JourneyResponse = { journey: { id: string } };
type JoinResponse = {
  joinRunId: string;
  algorithmVersion: string;
  listeningEventCount: number;
  locationSampleCount: number;
  joinedCount: number;
};

type JourneyResult = ScrobbleResponse & JoinResponse;

const BATCH_SIZE = 5;
const BATCH_INTERVAL_MS = 30_000;
const GEOLOCATION_ERROR_CODE = {
  PERMISSION_DENIED: 1,
  POSITION_UNAVAILABLE: 2,
  TIMEOUT: 3,
} as const;
const WATCH_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 20_000,
  maximumAge: 0,
};

function geolocationErrorName(code: number) {
  switch (code) {
    case GEOLOCATION_ERROR_CODE.PERMISSION_DENIED:
      return "PERMISSION_DENIED";
    case GEOLOCATION_ERROR_CODE.POSITION_UNAVAILABLE:
      return "POSITION_UNAVAILABLE";
    case GEOLOCATION_ERROR_CODE.TIMEOUT:
      return "TIMEOUT";
    default:
      return "UNKNOWN";
  }
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString("ja-JP") : "—";
}

function formatDuration(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

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

async function sendLocationSamples(sessionId: string, samples: PendingLocationSample[]): Promise<void> {
  await requestJson("/api/location-samples", { method: "POST", body: { sessionId, samples } });
}

export default function JourneyRecorderPage() {
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [journeyId, setJourneyId] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [now, setNow] = useState<Date | null>(null);
  const [sentCount, setSentCount] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [uploadWarning, setUploadWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<JourneyResult | null>(null);

  const watchIdRef = useRef<number | null>(null);
  const watchGenerationRef = useRef(0);
  const sessionIdRef = useRef<string | null>(null);
  const recordingRef = useRef(false);
  const bufferRef = useRef<PendingLocationSample[]>([]);
  const flushingRef = useRef(false);
  const batchTimerRef = useRef<number | null>(null);
  const lastReceivedAtRef = useRef<number | null>(null);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();

    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
      setAuthChecked(true);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.subscription.unsubscribe();
  }, []);

  const stopGpsWatch = useCallback(() => {
    watchGenerationRef.current += 1;
    const watchId = watchIdRef.current;
    watchIdRef.current = null;
    if (watchId !== null && "geolocation" in navigator) {
      navigator.geolocation.clearWatch(watchId);
    }
  }, []);

  const stopBatchTimer = useCallback(() => {
    if (batchTimerRef.current !== null) {
      window.clearInterval(batchTimerRef.current);
      batchTimerRef.current = null;
    }
  }, []);

  const flushBuffer = useCallback(() => {
    const sid = sessionIdRef.current;
    if (!sid || flushingRef.current || bufferRef.current.length === 0) return;

    flushingRef.current = true;
    const batch = bufferRef.current;
    bufferRef.current = [];
    setPendingCount(0);

    sendLocationSamples(sid, batch)
      .then(() => {
        setSentCount((count) => count + batch.length);
        setUploadWarning(null);
      })
      .catch((cause: unknown) => {
        bufferRef.current = [...batch, ...bufferRef.current];
        setPendingCount(bufferRef.current.length);
        setUploadWarning(
          cause instanceof Error
            ? `GPSログの送信に失敗しました: ${cause.message}（次の送信タイミングで再送します）`
            : "GPSログの送信に失敗しました（次の送信タイミングで再送します）。",
        );
      })
      .finally(() => {
        flushingRef.current = false;
      });
  }, []);

  const startBatchTimer = useCallback(() => {
    stopBatchTimer();
    batchTimerRef.current = window.setInterval(() => flushBuffer(), BATCH_INTERVAL_MS);
  }, [flushBuffer, stopBatchTimer]);

  const handlePosition = useCallback((position: GeolocationPosition, generation: number) => {
    if (generation !== watchGenerationRef.current || !recordingRef.current) return;

    const receivedAtMs = Date.now();
    const previousReceivedAtMs = lastReceivedAtRef.current;
    lastReceivedAtRef.current = receivedAtMs;

    const sample: PendingLocationSample = {
      sampleId: crypto.randomUUID(),
      recordedAt: new Date(receivedAtMs).toISOString(),
      geolocationRecordedAt: new Date(position.timestamp).toISOString(),
      positionAgeAtReceiptMs: receivedAtMs - position.timestamp,
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracyM: position.coords.accuracy,
      speedMps: position.coords.speed,
      headingDeg: position.coords.heading,
      altitudeM: position.coords.altitude,
      visibilityState: document.visibilityState === "hidden" ? "hidden" : "visible",
      intervalFromPrevMs: previousReceivedAtMs === null ? null : receivedAtMs - previousReceivedAtMs,
    };

    bufferRef.current.push(sample);
    setPendingCount(bufferRef.current.length);
    setGpsError(null);

    if (bufferRef.current.length >= BATCH_SIZE) {
      flushBuffer();
    }
  }, [flushBuffer]);

  const handleGeolocationError = useCallback((positionError: GeolocationPositionError) => {
    const name = geolocationErrorName(positionError.code);
    const guidance = positionError.code === GEOLOCATION_ERROR_CODE.PERMISSION_DENIED
      ? "ブラウザのサイト設定で位置情報を許可してください。"
      : positionError.code === GEOLOCATION_ERROR_CODE.POSITION_UNAVAILABLE
        ? "GPSを有効にし、屋外など測位しやすい場所で再試行してください。"
        : positionError.code === GEOLOCATION_ERROR_CODE.TIMEOUT
          ? "20秒以内に測位できませんでした。次の更新を待ちます。"
          : "不明な位置情報エラーです。";
    setGpsError(`${name}: ${positionError.message || guidance} ${guidance}`);
    if (positionError.code === GEOLOCATION_ERROR_CODE.PERMISSION_DENIED) {
      stopGpsWatch();
    }
  }, [stopGpsWatch]);

  const startRecording = useCallback(async () => {
    if (!user) {
      setError("記録を開始するには /auth からログインしてください。");
      setPhase("error");
      return;
    }
    if (!window.isSecureContext) {
      setError("LAN内IPへのHTTP接続では位置情報を利用できません。HTTPSでこのページを開いてください。");
      setPhase("error");
      return;
    }
    if (!("geolocation" in navigator)) {
      setError("このブラウザはGeolocation APIに対応していません。");
      setPhase("error");
      return;
    }

    setError(null);
    setResult(null);
    setJourneyId(null);
    setSentCount(0);
    setPendingCount(0);
    setGpsError(null);
    setUploadWarning(null);
    bufferRef.current = [];
    lastReceivedAtRef.current = null;

    try {
      const { recordingSession } = await requestJson<RecordingSessionResponse>(
        "/api/recording-sessions",
        { method: "POST" },
      );
      sessionIdRef.current = recordingSession.id;
      recordingRef.current = true;
      setSessionId(recordingSession.id);
      setStartedAt(recordingSession.startedAt);
      setPhase("recording");

      const generation = watchGenerationRef.current;
      watchIdRef.current = navigator.geolocation.watchPosition(
        (position) => handlePosition(position, generation),
        (positionError) => {
          if (generation === watchGenerationRef.current) handleGeolocationError(positionError);
        },
        WATCH_OPTIONS,
      );
      startBatchTimer();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Recording Sessionの作成に失敗しました。");
      setPhase("error");
    }
  }, [user, handleGeolocationError, handlePosition, startBatchTimer]);

  const finishRecording = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid || !recordingRef.current) return;

    recordingRef.current = false;
    stopGpsWatch();
    stopBatchTimer();
    setError(null);
    setPhase("ending");

    try {
      while (flushingRef.current) {
        await new Promise((resolve) => window.setTimeout(resolve, 100));
      }
      if (bufferRef.current.length > 0) {
        const remaining = bufferRef.current;
        bufferRef.current = [];
        setPendingCount(0);
        await sendLocationSamples(sid, remaining);
        setSentCount((count) => count + remaining.length);
      }

      await requestJson(`/api/recording-sessions/${sid}`, { method: "PATCH" });

      setPhase("fetching_scrobbles");
      const scrobbleResult = await requestJson<ScrobbleResponse>(
        `/api/recording-sessions/${sid}/scrobbles`,
        { method: "POST" },
      );

      setPhase("creating_journey");
      const { journey } = await requestJson<JourneyResponse>("/api/journeys", {
        method: "POST",
        body: { sessionId: sid },
      });
      setJourneyId(journey.id);

      setPhase("joining");
      const joinResult = await requestJson<JoinResponse>(`/api/journeys/${journey.id}/join`, {
        method: "POST",
      });

      setResult({ ...scrobbleResult, ...joinResult });
      setPhase("done");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "予期しないエラーが発生しました。");
      setPhase("error");
    }
  }, [stopGpsWatch, stopBatchTimer]);

  useEffect(() => {
    if (phase !== "recording") return;
    const initialId = window.setTimeout(() => setNow(new Date()), 0);
    const intervalId = window.setInterval(() => setNow(new Date()), 1_000);
    return () => {
      window.clearTimeout(initialId);
      window.clearInterval(intervalId);
    };
  }, [phase]);

  useEffect(() => {
    return () => {
      stopGpsWatch();
      stopBatchTimer();
    };
  }, [stopGpsWatch, stopBatchTimer]);

  const recording = phase === "recording";
  const canStart = !recording && phase !== "ending" && phase !== "fetching_scrobbles"
    && phase !== "creating_journey" && phase !== "joining";
  const elapsedMs = startedAt && now ? now.getTime() - new Date(startedAt).getTime() : 0;

  return (
    <main className="journey-recorder">
      <h1>Journey記録（開発用）</h1>
      <p className="notice">
        記録にはログインと位置情報の利用許可が必要です。スマートフォンではHTTPS（またはlocalhost）で開いてください。
      </p>

      {authChecked && !user && (
        <p className="error" role="alert">
          <strong>未ログイン:</strong> <a href="/auth">/auth</a> からログインしてください。
        </p>
      )}

      <section className={`recording-panel ${recording ? "is-recording" : ""}`} aria-live="polite">
        <span className="recording-indicator" aria-hidden="true" />
        <strong>{PHASE_LABEL[phase]}</strong>
      </section>

      <section className="status-grid" aria-label="記録状態">
        <div><strong>ログイン中のユーザー</strong><span>{user?.email ?? "—"}</span></div>
        <div><strong>Session ID</strong><span>{sessionId ?? "—"}</span></div>
        <div><strong>Journey ID</strong><span>{journeyId ?? "—"}</span></div>
        <div><strong>記録開始時刻</strong><span>{formatDate(startedAt)}</span></div>
        <div><strong>記録経過時間</strong><span>{formatDuration(elapsedMs)}</span></div>
        <div><strong>送信済みGPS件数</strong><span>{sentCount}件</span></div>
        <div><strong>未送信GPS件数</strong><span>{pendingCount}件</span></div>
      </section>

      <div className="actions">
        <button type="button" onClick={() => void startRecording()} disabled={!canStart}>
          記録開始
        </button>
        <button type="button" onClick={() => void finishRecording()} disabled={!recording}>
          記録終了
        </button>
      </div>

      {gpsError && <p className="error" role="alert"><strong>Geolocationエラー:</strong> {gpsError}</p>}
      {uploadWarning && <p className="notice">{uploadWarning}</p>}
      {error && <p className="error" role="alert"><strong>エラー:</strong> {error}</p>}

      {result && (
        <section>
          <h2>結果</h2>
          <div className="status-grid">
            <div><strong>取得Scrobble数</strong><span>{result.fetchedCount}件</span></div>
            <div><strong>保存Scrobble数</strong><span>{result.savedCount}件</span></div>
            <div><strong>結合対象イベント数</strong><span>{result.listeningEventCount}件</span></div>
            <div><strong>結合対象GPS数</strong><span>{result.locationSampleCount}件</span></div>
            <div><strong>結合結果件数</strong><span>{result.joinedCount}件</span></div>
            <div><strong>結合アルゴリズム</strong><span>{result.algorithmVersion}</span></div>
            <div><strong>Join Run ID</strong><span>{result.joinRunId}</span></div>
          </div>
          {journeyId && (
            <div className="actions">
              <a href={`/dev/journey-map/${journeyId}`}>地図で見る</a>
            </div>
          )}
        </section>
      )}
    </main>
  );
}

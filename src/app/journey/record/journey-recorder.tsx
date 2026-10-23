"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { User } from "@supabase/supabase-js";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser-client.ts";

type Phase = "idle" | "recording" | "finishing" | "error";

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
type JourneyResponse = { journey: { id: string } };

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

export function JourneyRecorder() {
  const router = useRouter();

  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [now, setNow] = useState<Date | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [uploadWarning, setUploadWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

    sendLocationSamples(sid, batch)
      .then(() => {
        setUploadWarning(null);
      })
      .catch((cause: unknown) => {
        bufferRef.current = [...batch, ...bufferRef.current];
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

  // finishRecordingはエラー後に同じsessionIdで再試行できるよう設計する。
  // PATCH（終了）・POST /api/journeys はどちらも再実行してよい（終了済みは無害、Journey作成は冪等）。
  const finishRecording = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid) return;

    if (recordingRef.current) {
      recordingRef.current = false;
      stopGpsWatch();
      stopBatchTimer();
    }
    setError(null);
    setPhase("finishing");

    try {
      while (flushingRef.current) {
        await new Promise((resolve) => window.setTimeout(resolve, 100));
      }
      if (bufferRef.current.length > 0) {
        const remaining = bufferRef.current;
        bufferRef.current = [];
        await sendLocationSamples(sid, remaining);
      }

      try {
        await requestJson(`/api/recording-sessions/${sid}`, { method: "PATCH" });
      } catch (cause) {
        const alreadyEnded = cause instanceof Error && cause.message.includes("すでに終了");
        if (!alreadyEnded) throw cause;
      }

      const { journey } = await requestJson<JourneyResponse>("/api/journeys", {
        method: "POST",
        body: { sessionId: sid },
      });

      router.push(`/journey/${journey.id}/result`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "予期しないエラーが発生しました。");
      setPhase("error");
    }
  }, [router, stopGpsWatch, stopBatchTimer]);

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
  const canStart = phase === "idle";
  const canFinish = phase === "recording" || phase === "error";
  const elapsedMs = startedAt && now ? now.getTime() - new Date(startedAt).getTime() : 0;

  return (
    <>
      {authChecked && !user && (
        <p className="error" role="alert">
          <strong>未ログイン:</strong> <a href="/auth">/auth</a> からログインしてください。
        </p>
      )}

      <section className={`recording-panel ${recording ? "is-recording" : ""}`} aria-live="polite">
        <span className="recording-indicator" aria-hidden="true" />
        <strong>{formatDuration(elapsedMs)}</strong>
      </section>

      <div className="actions">
        <button type="button" onClick={() => void startRecording()} disabled={!canStart}>
          記録開始
        </button>
        <button type="button" onClick={() => void finishRecording()} disabled={!canFinish}>
          {phase === "error" ? "再試行" : "記録終了"}
        </button>
      </div>

      {phase === "finishing" && <p className="notice">記録を保存しています…</p>}
      {gpsError && <p className="error" role="alert"><strong>Geolocationエラー:</strong> {gpsError}</p>}
      {uploadWarning && <p className="notice">{uploadWarning}</p>}
      {error && <p className="error" role="alert"><strong>エラー:</strong> {error}</p>}
    </>
  );
}

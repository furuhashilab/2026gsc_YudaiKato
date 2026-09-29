import assert from "node:assert/strict";
import test from "node:test";

import { fetchConfirmedScrobbles } from "./lastfm-client.ts";

function track(name: string, artist: string, uts: string) {
  return {
    name,
    artist: { "#text": artist },
    date: { uts },
  };
}

function nowPlayingTrack(name: string, artist: string) {
  return {
    name,
    artist: { "#text": artist },
    "@attr": { nowplaying: "true" },
  };
}

function page(tracks: unknown[], pageNum: number, totalPages: number) {
  return {
    recenttracks: {
      track: tracks,
      "@attr": { page: String(pageNum), totalPages: String(totalPages) },
    },
  };
}

function withMockedFetch(pages: unknown[], run: () => Promise<void>) {
  const originalFetch = globalThis.fetch;
  let callCount = 0;
  globalThis.fetch = (async () => {
    const body = pages[callCount];
    callCount += 1;
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;

  return run().finally(() => {
    globalThis.fetch = originalFetch;
  });
}

test("複数ページのScrobbleを結合して取得する", async () => {
  await withMockedFetch(
    [
      page([track("Song A", "Artist A", "1000")], 1, 2),
      page([track("Song B", "Artist B", "2000")], 2, 2),
    ],
    async () => {
      const scrobbles = await fetchConfirmedScrobbles({
        apiKey: "key",
        username: "user",
        fromUnix: 0,
        toUnix: 3000,
      });
      assert.equal(scrobbles.length, 2);
      assert.equal(scrobbles[0].trackName, "Song A");
      assert.equal(scrobbles[1].trackName, "Song B");
    },
  );
});

test("nowplaying中のトラックは除外する", async () => {
  await withMockedFetch(
    [page([nowPlayingTrack("Now Playing", "Artist")], 1, 1)],
    async () => {
      const scrobbles = await fetchConfirmedScrobbles({
        apiKey: "key",
        username: "user",
        fromUnix: 0,
        toUnix: 3000,
      });
      assert.equal(scrobbles.length, 0);
    },
  );
});

test("タイムスタンプが欠落したトラックは除外する", async () => {
  await withMockedFetch(
    [page([{ name: "No Date", artist: { "#text": "Artist" } }], 1, 1)],
    async () => {
      const scrobbles = await fetchConfirmedScrobbles({
        apiKey: "key",
        username: "user",
        fromUnix: 0,
        toUnix: 3000,
      });
      assert.equal(scrobbles.length, 0);
    },
  );
});

test("Last.fm APIエラー時は例外を投げる", async () => {
  await withMockedFetch(
    [{ error: 10, message: "Invalid API key" }],
    async () => {
      await assert.rejects(() =>
        fetchConfirmedScrobbles({ apiKey: "key", username: "user", fromUnix: 0, toUnix: 3000 }),
      );
    },
  );
});

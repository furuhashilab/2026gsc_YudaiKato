import Link from "next/link";

export default function Home() {
  return (
    <main>
      <h1>Music Walk Map</h1>
      <p>卒業論文版の技術検証ページです。</p>
      <nav className="dev-links" aria-label="技術検証ページ">
        <Link href="/dev/lastfm-test">Last.fm取得検証</Link>
        <Link href="/dev/location-test">位置情報取得検証</Link>
        <Link href="/dev/timeline-join-test">Scrobble・位置ログ結合検証</Link>
      </nav>
    </main>
  );
}

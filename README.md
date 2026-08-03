# Music Walk Map

卒業論文版 Music Walk Map の技術検証用 Next.js アプリです。現在は Last.fm API から最近の視聴履歴を取得し、再生中フラグと日時の挙動を確認する機能だけを実装しています。

## セットアップ

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

`.env.local` の `LASTFM_API_KEY` に [Last.fm API](https://www.last.fm/api/account/create) で発行したキー、`LASTFM_USERNAME` に検証対象ユーザー名を設定し、`http://localhost:3000/dev/lastfm-test` を開いてください。画面は15秒ごとに履歴を取得し、検証ログをJSONまたはCSVで保存できます。

## コマンド

- `pnpm dev`: 開発サーバー
- `pnpm lint`: ESLint
- `pnpm typecheck`: TypeScript 型検査
- `pnpm build`: プロダクションビルド

検証仕様と観察項目は [docs/lastfm-validation.md](docs/lastfm-validation.md) を参照してください。

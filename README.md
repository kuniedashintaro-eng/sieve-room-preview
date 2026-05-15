# SIEVE Room Preview

SIEVE公式商品の中から家具を選び、ユーザーがアップロードした部屋画像に自然に配置したプレビュー画像を生成するNext.js MVPです。

## セットアップ

```bash
npm install
cp .env.local.example .env.local
```

`.env.local` にOpenAI APIキーを設定します。

```env
OPENAI_API_KEY=sk-your-api-key
```

開発サーバーを起動します。

```bash
npm run dev
```

ブラウザで `http://localhost:3000` を開きます。ポートを変える場合は次のように起動できます。

```bash
npm run dev -- --port 3001
```

## 主な仕様

- Next.js App Router
- TypeScript
- Tailwind CSS
- OpenAI Image Edit API
- Image model: `gpt-image-2`
- APIキーはサーバー側の `/api/generate` のみで使用
- SIEVE商品のみ選択可能
- 商品リストは `lib/sieveProducts.ts` の固定配列で管理
- 生成回数はlocalStorageで100回まで管理
- 右下の目立たないリセットボタンからβ版の簡易リセットが可能

## 注意

localStorageによる回数制限とリセット認証はMVP向けの簡易仕様です。本番ではユーザー認証、サーバー側の回数管理、DB保存、監査ログなどに置き換えてください。

OpenAI APIの利用にはAPI課金設定が必要です。`Billing hard limit has been reached` が出る場合は、OpenAI Platformの課金上限または支払い設定を確認してください。

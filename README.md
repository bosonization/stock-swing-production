# Stock Swing Production

登録銘柄を、既存の26条件スコアロジックと決算・市場環境情報で整理する本格運用版です。スコア仕様は `v2_26_conditions_202606` のまま固定しています。

## 構成

- `stock-swing-web`: Next.js Webアプリ（Supabase Authログイン、ダッシュボード、登録銘柄管理）
- `stock-swing-core`: Python分析バッチ（26条件、ゲート、決算、市場環境）
- `supabase`: 本格版DBスキーマ、RLS、ローカル確認用seed
- `.github/workflows/run_daily.yml`: 平日16:30 JSTの自動分析と画面からの手動実行

## 初回セットアップ

1. Supabaseプロジェクトで `supabase/migrations/20260808225714_create_initial_profiles.sql` を適用します。
2. Supabase Authでメール/パスワード利用者を作成します。作成時に `app_users` が自動生成されます。
3. `stock-swing-web/.env.example` を `.env.local` にコピーし、SupabaseとGitHubの値を設定します。
4. GitHub Actions secretsに `SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY` を登録します。J-Quantsを使う場合は `JQUANTS_REFRESH_TOKEN` も登録します。
5. Webを起動し、ログイン後の「登録銘柄CSV更新ページ」で `code,name` CSVを保存します。
6. 「条件判定を更新」を押すか、GitHub Actionsの定期実行を待ちます。

## ローカル起動

```powershell
cd stock-swing-web
npm.cmd install
npm.cmd run dev
```

分析エンジンの確認:

```powershell
cd stock-swing-core
python -m pip install -e .
python -m pytest
```

## PoCデータの移植

PoCの登録銘柄は、利用者ごとに管理画面へCSV貼り付けまたはファイル内容の貼り付けで移植できます。既存の分析結果はロジック互換性の検証用履歴として残す場合を除き、新スキーマへ直接コピーせず、本格版で再分析してください。これによりrun、score version、metricsが一貫します。

## セキュリティ

- 一般利用者はSupabase Authでログインし、自分のデータだけを参照・更新できます。
- DBはRLSを有効にし、分析バッチだけがservice roleで結果を書き込みます。
- service role keyとGitHub tokenはサーバー専用です。ブラウザへ公開しません。
- 旧PoCのURLキーと平文管理キーは本格版の認証には使用しません。

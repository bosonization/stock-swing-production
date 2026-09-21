# 運営管理画面・規約同意管理の反映手順

対象機能:

- 会員一覧、利用停止・再開
- 最終ログイン、登録銘柄数、最新分析状態
- 規約の版管理と新版公開
- 会員ごとの最新版同意状況
- ログイン、会員停止、規約公開、規約同意の操作履歴

> 重要: 最初の規約本文は動作確認用の初期文面です。課金開始前に、提供内容に合わせて弁護士等の確認を受けた利用規約・プライバシーポリシー等に差し替えてください。

## 反映の順番

必ず「1. Supabase」を先に実行し、その後に「2. GitHubとVercel」を実行します。

## 1. Supabaseにデータベース更新を反映

1. ブラウザーで [Supabase Dashboard](https://supabase.com/dashboard/projects) を開きます。
2. このアプリのプロジェクトを開きます。
3. 左側の「SQL Editor」を開き、「New query」を押します。
4. `supabase/migrations/20260921090000_add_operations_and_terms.sql` の全文をコピーし、SQL Editorへ貼り付けます。
5. 右下の「Run」を押します。
6. `Success. No rows returned` と表示されれば完了です。

管理者が未設定の場合だけ、SQL Editorで以下を実行します。`YOUR_EMAIL` を自分のログイン用メールアドレスへ変えてください。

```sql
update public.app_users
set role = 'admin', plan = 'admin'
where email = 'YOUR_EMAIL';
```

確認用SQL:

```sql
select id, display_name, email, role, status
from public.app_users
order by created_at;
```

## 2. GitHubへ反映し、Vercelを更新

PowerShellを開き、以下をそのままコピーして実行します。今回変更したファイルだけを登録するため、他の未登録ファイルは含まれません。

```powershell
Set-Location "C:\Users\maabo\Documents\stock_swing_production"

git add -- `
  "README.md" `
  "supabase/migrations/20260921090000_add_operations_and_terms.sql" `
  "stock-swing-web/lib/auth.ts" `
  "stock-swing-web/lib/terms.ts" `
  "stock-swing-web/app/api/auth/login/route.ts" `
  "stock-swing-web/app/api/analysis/run/route.ts" `
  "stock-swing-web/app/api/admin/users/[userId]/route.ts" `
  "stock-swing-web/app/api/admin/terms/route.ts" `
  "stock-swing-web/app/api/consents/poc/route.ts" `
  "stock-swing-web/app/api/consents/terms/route.ts" `
  "stock-swing-web/app/api/results/[userId]/route.ts" `
  "stock-swing-web/app/api/watchlist/[userId]/route.ts" `
  "stock-swing-web/app/api/watchlist/upload/route.ts" `
  "stock-swing-web/app/admin/operations/page.tsx" `
  "stock-swing-web/app/u/[userId]/page.tsx" `
  "stock-swing-web/app/u/[userId]/admin/layout.tsx" `
  "stock-swing-web/app/u/[userId]/score/[code]/page.tsx" `
  "stock-swing-web/app/globals.css" `
  "docs/operations_admin_and_terms_setup.md"

git commit -m "Add operations dashboard and terms consent management"
git push origin main
```

VercelとGitHubが連携済みなら、`git push` 後に自動デプロイが始まります。

1. [Vercel Dashboard](https://vercel.com/dashboard) を開きます。
2. 対象プロジェクト→「Deployments」を開きます。
3. 一番上のデプロイが「Ready」になるまで待ちます。
4. 本番URLを開き、管理者アカウントでログインします。

## 3. 初回の動作確認

1. ログイン後、最新規約の同意画面が表示されます。
2. 内容を確認し、チェックを入れて「同意して利用を開始」を押します。
3. ダッシュボード下部の「運営管理画面」を押します。
4. 会員数、同意済み数、登録銘柄数、最新分析が表示されることを確認します。
5. テスト用の一般ユーザーに対して「停止」を押し、そのユーザーがログインできないことを確認します。
6. 確認後「再開」を押します。

管理者自身の停止ボタンは表示されません。誤操作で管理者が入れなくなるのを防ぐためです。

## 規約を更新する日常手順

1. 管理者でログインし、「運営管理画面」を開きます。
2. 「新しい規約版を公開」へ版番号、タイトル、本文を入力します。
3. 版番号は毎回新しい値にします。例: `service_terms_2026_10_01`
4. 「新しい版を公開」を押します。
5. 公開直後の同意済み数が `0 / 全会員数` になることを確認します。
6. 各会員は次回利用時に新しい規約へ同意するまでダッシュボードを利用できません。

公開済みの規約は、同意記録との対応を保つため書き換えません。公開内容を間違えた場合は、本文を修正し、別の新しい版番号で再公開してください。

## 会員の停止・再開

1. 「会員と稼働状況」から対象者を確認します。
2. 停止する場合は「停止」を押します。
3. 利用を戻す場合は「再開」を押します。
4. 結果は「最近の操作履歴」に残ります。

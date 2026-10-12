# コミュニティ第1段階の反映手順

対象：コミュニティホーム、公式告知、基礎教材、イベント参加、公式サポート、担当役割、銘柄整理ツール利用権限  
更新日：2026年10月12日

## 反映する順番

必ず次の順番で行う。

1. Supabaseへデータベース更新を反映する。
2. GitHubへコードを送る。
3. Vercelのデプロイ完了を確認する。
4. 管理画面で担当役割とツール権限を確認する。

コードを先に公開すると、必要なテーブルが存在せず画面が開けないため、必ずSupabaseを先にする。

## 1. Supabaseへ反映

1. ブラウザーで [Supabase Dashboard](https://supabase.com/dashboard/projects) を開く。
2. このアプリのプロジェクトを選ぶ。
3. 左側の「SQL Editor」を開く。
4. 「New query」を押す。
5. ローカルの `supabase/migrations/20261012090000_add_community_foundation.sql` を開き、全文をコピーする。
6. SQL Editorへ貼り付け、「Run」を押す。
7. 赤いエラーがなく完了したことを確認する。

確認用SQL：

```sql
select feature_key, enabled, count(*)
from public.feature_entitlements
group by feature_key, enabled
order by feature_key, enabled;

select title, status, published_at
from public.announcements
order by created_at desc;

select title, status, sort_order
from public.lessons
order by sort_order;
```

確認の目安：

- 既存会員には `community=true` と `stock_swing_tool=true` が入る。
- 「コミュニティサイトを開始しました」というお知らせが1件ある。
- 基礎教材が3件ある。
- 新しく追加する会員はコミュニティを利用できるが、銘柄整理ツールは初期状態では無効になる。

## 2. GitHubへ反映

PowerShellで次をまとめてコピーして実行する。

```powershell
Set-Location "C:\Users\maabo\Documents\stock_swing_production"

git add -- `
  "docs/community_phase1_release_guide.md" `
  "docs/community_system_operations_design_2026-10-12.md" `
  "docs/changelog/CHANGELOG.md" `
  "supabase/migrations/20261012090000_add_community_foundation.sql" `
  "stock-swing-web/lib/community.ts" `
  "stock-swing-web/lib/auth.ts" `
  "stock-swing-web/package.json" `
  "stock-swing-web/app/layout.tsx" `
  "stock-swing-web/app/page.tsx" `
  "stock-swing-web/app/globals.css" `
  "stock-swing-web/app/u/[userId]/page.tsx" `
  "stock-swing-web/app/u/[userId]/home/page.tsx" `
  "stock-swing-web/app/admin/community/page.tsx" `
  "stock-swing-web/app/admin/operations/page.tsx" `
  "stock-swing-web/app/api/auth/login/route.ts" `
  "stock-swing-web/app/api/consents/terms/route.ts" `
  "stock-swing-web/app/api/analysis/run/route.ts" `
  "stock-swing-web/app/api/results/[userId]/route.ts" `
  "stock-swing-web/app/api/watchlist/[userId]/route.ts" `
  "stock-swing-web/app/api/watchlist/upload/route.ts" `
  "stock-swing-web/app/api/community/support/route.ts" `
  "stock-swing-web/app/api/community/events/[eventId]/route.ts" `
  "stock-swing-web/app/api/admin/community/route.ts" `
  "stock-swing-web/app/api/admin/users/[userId]/entitlements/route.ts"

git status -sb
git commit -m "Add community foundation and separate stock tool access"
git push origin main
```

`git status -sb`で、関係のないZIPや仕様書が追加対象に入っていないことを確認してから、commitとpushを実行する。

## 3. Vercelを確認

1. [Vercel Dashboard](https://vercel.com/dashboard) を開く。
2. 対象プロジェクトを選ぶ。
3. 「Deployments」を開く。
4. 一番上のデプロイが「Ready」になるまで待つ。
5. 本番URLを開く。
6. ログイン後に新しいコミュニティホームが表示されることを確認する。

この変更ではVercelの環境変数追加は不要。既存のSupabase設定を使用する。

## 4. 管理者で初期設定

### 担当役割

1. コミュニティホーム上部の「コミュニティ管理」を押す。
2. 「担当役割を割り当てる」で、対象者と役割を選ぶ。
3. 最初は少なくとも「事業・運営責任者」と「技術管理者」を記録する。
4. 小笹さん等を登録する場合は、本人用アカウントを作ってから「コミュニティ進行」等を割り当てる。

担当役割を付けるだけではシステム管理者権限は付与されない。Vercel、Supabase、会員停止等の管理権限は従来の `app_users.role='admin'` と分離している。

### 銘柄整理ツールの利用権限

1. 「運営管理」を開く。
2. 会員一覧の「ツール」列を確認する。
3. 既存PoC利用者は「停止」と表示される。これは現在有効で、押すと停止するという意味。
4. 新規会員は「有効化」と表示される。ツールを使わせる場合だけ押す。

## 5. 動作確認

### 管理者

- `/admin/community` を開ける。
- お知らせを1件下書き保存できる。
- イベントを公開できる。
- 公式サポートの受付を確認できる。
- `/admin/operations` で会員ごとのツール有効・停止を切り替えられる。

### 一般会員

- ログイン後、コミュニティホームが表示される。
- 公式のお知らせと3件の基礎教材を読める。
- 公開中のイベントへ参加登録・取消しができる。
- 公式サポートへ問い合わせを送れる。
- ツール権限がある場合だけ、銘柄整理ツールを開ける。
- 他人のデータや管理画面を開けない。

### LINEとの分離

- LINEに参加しなくても、公式情報、イベント、問い合わせを利用できる。
- LINEには公式サイトのURLだけを案内し、退会、返金、個人情報、投資相談を受け付けない。

## 6. 今回まだ行わないこと

- 決済・自動課金
- 会員間の自由投稿・DM
- LINEアカウントとの自動連携
- LINEメッセージの保存
- 有償会員へのyfinance・スコア機能提供
- 学習ノートと課題提出

これらは、実際の運営量と法務・データ利用条件を確認してから第2段階以降で追加する。

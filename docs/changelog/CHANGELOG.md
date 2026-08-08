# Changelog

## 2026-06-30

### Added

- PoC協力者向けのURLパラメータ方式アクセス制御を追加。
- `/u/[userId]?user=...&key=...` で `poc_users` を照合し、有効なPoCユーザーのみ既存ダッシュボードを表示。
- `/?user=...&key=...` から既存ユーザー別ダッシュボードへのリダイレクトを追加。
- `poc_users` と `poc_access_logs` を作成するSupabase SQLを追加。
- PoCアクセス成功・失敗のログ記録を追加。`key` は保存せず、`path` はクエリ文字列なしで保存。
- PoC注意文をダッシュボード上部に表示。

### Changed

- PoC同意後のリダイレクトで、元の `user` / `key` 付きURLに戻れるように変更。
- `/u/[userId]` の `userId` を閲覧対象ユーザーID、URLパラメータ `user` をPoC協力者IDとして扱うように変更。
- `poc_users.target_user_code` を照合対象に追加し、同一ダッシュボードに複数PoC協力者を紐づけ可能に変更。
- トップページ経由では `/?target=u001&user=p098&key=...` 形式でも対象ダッシュボードへリダイレクト可能に変更。

### Not changed

- core側のスコア計算ロジックは変更なし。
- Supabase Auth、メール認証、パスワードログインは未導入。
- 管理者ユーザー `takashimasaakiadmin` の既存管理者表示は維持。

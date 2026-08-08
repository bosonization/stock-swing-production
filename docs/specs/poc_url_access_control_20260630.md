# PoC URLパラメータ方式アクセス制御 仕様メモ

## 目的

PoC協力者だけが既存ダッシュボードを閲覧できるようにする。正式なログイン機能は導入せず、URLパラメータ `user` / `key` と Supabase のPoCユーザー管理テーブルを照合する軽量なアクセス制御とする。

## 対象

- web
- supabase

core のスコア計算ロジックは変更しない。

## URL仕様

既存ルーティングを優先し、以下を基本URLとする。

```text
/u/u001?user=p098&key=発行キー
```

`/u/[userId]` の `[userId]` は閲覧対象ユーザーID、URLパラメータ `user` はPoC協力者IDとして扱う。

例：

```text
/u/u001?user=p098&key=tanaka_admin
```

この場合、`poc_users.user_code = 'p098'`、`poc_users.target_user_code = 'u001'`、`sha256('tanaka_admin') = poc_users.access_key_hash`、`is_active = true` のレコードがあれば閲覧可能とする。

従来の自己一致形式も、`user_code='u001'`、`target_user_code='u001'` の行があれば引き続き利用できる。

```text
/u/u001?user=u001&key=発行キー
```

トップページ経由でPoC協力者IDと閲覧対象IDを分けたい場合は、以下形式を利用できる。

```text
/?target=u001&user=p098&key=発行キー
```

## アクセス判定

`/u/[userId]` の通常ダッシュボード表示時、管理者ID `takashimasaakiadmin` 以外は以下を確認する。

1. `user` と `key` が指定されていること
2. `poc_users.user_code = URLパラメータ user` のレコードが存在すること
3. `poc_users.target_user_code = URLパスの [userId]` であること
4. `poc_users.is_active = true` であること
5. `sha256(key)` が `poc_users.access_key_hash` と一致すること

満たさない場合、既存ダッシュボードは表示せず、以下のみ表示する。

```text
現在、この検証用ページは利用できません。
```

画面には `missing_param` / `invalid_key` / `inactive_user` などの詳細理由は表示しない。

## 管理者アクセス

`takashimasaakiadmin` は今回のPoC URLパラメータ制御の対象外とし、既存の管理者向け表示を優先して維持する。

## PoC注意文

アクセス許可後の画面上部に以下を表示する。

```text
本ツールは、登録銘柄や市場データをもとに確認対象を整理するための検証用ツールです。
特定の銘柄の売買を推奨するものではありません。
最終的な投資判断はご自身で行ってください。
```

既存の同意画面・免責文も維持する。

## アクセスログ

`poc_access_logs` に成功・失敗の両方を記録する。

記録項目は以下。

- `user_code`
- `path`
- `result`
- `user_agent`
- `ip_hash`
- `accessed_at`

`path` にはクエリ文字列を保存しない。`key` はログに保存しない。

`result` は以下。

- `success`
- `missing_param`
- `invalid_user`
- `invalid_key`
- `inactive_user`
- `error`

IPアドレスはそのまま保存せず、`POC_IP_HASH_SALT` があればそれを利用してSHA-256ハッシュ化する。未設定時は `SUPABASE_SERVICE_ROLE_KEY` をソルトとして利用する。

## Supabaseテーブル

### poc_users

PoCユーザーとアクセスキーのハッシュを管理する。

主なカラム：

- `id`
- `user_code`
- `target_user_code`
- `access_key_hash`
- `display_name`
- `is_active`
- `role`
- `memo`
- `created_at`
- `updated_at`
- `disabled_at`
- `last_accessed_at`

### poc_access_logs

PoCアクセス履歴を管理する。

主なカラム：

- `id`
- `user_code`
- `path`
- `result`
- `user_agent`
- `ip_hash`
- `accessed_at`

## 対象外

- Supabase Authによる正式ログイン
- メールアドレス認証
- パスワードログイン
- ユーザー別ウォッチリストの新規実装
- 有償ユーザー管理
- 決済連携
- 管理画面からのPoCユーザー発行
- core側スコア計算ロジック変更


## 2026-06-30 追記: 複数PoC協力者の紐づけ

同一の閲覧対象ユーザーIDに対して、複数のPoC協力者IDを紐づけられるようにした。

例：

```text
/u/u001?user=p098&key=tanaka_admin
/u/u001?user=p099&key=sato_admin
/u/u001?user=p100&key=takashi_admin
```

いずれも `/u/u001` のデータを表示するが、アクセスログ上の `user_code` はそれぞれ `p098`、`p099`、`p100` として記録される。停止時は対象のPoC協力者レコードだけ `is_active=false` にする。

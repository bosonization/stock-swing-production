# Current Spec

## PoC URLパラメータ方式アクセス制御

PoC協力者向けの軽量な閲覧制御として、既存のユーザー別ダッシュボード `/u/[userId]` にURLパラメータ方式のアクセス制御を追加している。

基本URLは以下。

```text
/u/u001?user=p098&key=発行キー
```

`/u/[userId]` の `[userId]` は閲覧対象ユーザーID、URLパラメータ `user` はPoC協力者IDとして扱う。従来の `/u/u001?user=u001&key=発行キー` も、`poc_users.user_code='u001'`、`poc_users.target_user_code='u001'` の行があれば利用できる。

トップページに `/?target=u001&user=p098&key=発行キー` でアクセスした場合は、`/u/u001?user=p098&key=発行キー` へリダイレクトする。`target` を省略した場合は従来どおり `user` と同じIDのダッシュボードへリダイレクトする。

管理者ユーザー `takashimasaakiadmin` はPoC URLパラメータ制御の対象外とし、既存の管理者向け表示を維持する。

一般PoCユーザーは、Supabase の `poc_users` に登録された `user_code`、`target_user_code`、`access_key_hash`、`is_active` を照合する。`key` はSHA-256ハッシュ化して `access_key_hash` と比較する。

閲覧不可時は、理由を画面に出さず以下のみ表示する。

```text
現在、この検証用ページは利用できません。
```

アクセス結果は `poc_access_logs` に記録する。`path` にはクエリ文字列を保存せず、`key` は保存しない。IPアドレスを保存する場合は `ip_hash` としてハッシュ化する。

PoCユーザーが閲覧できる画面には、売買推奨ではないことを示す注意文を表示する。

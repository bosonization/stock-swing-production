# ChatGPTへの依頼テンプレ

最新ソースZIPをアップロードした。  
以下の機能修正をしたい。

---

## 事前情報

ローカルの最新ソースは以下にある。

```text
C:\Users\maabo\Documents\stock_swing_mvp_starter\stock-swing-web
C:\Users\maabo\Documents\stock_swing_mvp_starter\stock-swing-core
C:\Users\maabo\Documents\stock_swing_mvp_starter\supabase
```

ChatGPTに渡すZIPは、以下の手順で作成する。

### ChatGPT提出用ZIPの作成手順

PowerShellで実行：

```powershell
$base = "C:\Users\maabo\Documents\stock_swing_mvp_starter"
$outDir = "$env:USERPROFILE\Downloads\stock_swing_source_for_chatgpt"
$zip = "$env:USERPROFILE\Downloads\stock_swing_source_for_chatgpt.zip"

Remove-Item $outDir -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item $zip -Force -ErrorAction SilentlyContinue

New-Item -ItemType Directory -Force $outDir | Out-Null
New-Item -ItemType Directory -Force "$outDir\stock-swing-core" | Out-Null
New-Item -ItemType Directory -Force "$outDir\stock-swing-web" | Out-Null
New-Item -ItemType Directory -Force "$outDir\supabase" | Out-Null

robocopy "$base\stock-swing-core\src" "$outDir\stock-swing-core\src" /E /XD __pycache__ .pytest_cache /XF *.pyc
robocopy "$base\stock-swing-core\.github" "$outDir\stock-swing-core\.github" /E
Copy-Item "$base\stock-swing-core\pyproject.toml" "$outDir\stock-swing-core\" -Force -ErrorAction SilentlyContinue
Copy-Item "$base\stock-swing-core\requirements.txt" "$outDir\stock-swing-core\" -Force -ErrorAction SilentlyContinue
Copy-Item "$base\stock-swing-core\README.md" "$outDir\stock-swing-core\" -Force -ErrorAction SilentlyContinue

robocopy "$base\stock-swing-web\app" "$outDir\stock-swing-web\app" /E /XD .next node_modules
robocopy "$base\stock-swing-web\components" "$outDir\stock-swing-web\components" /E /XD .next node_modules
robocopy "$base\stock-swing-web\lib" "$outDir\stock-swing-web\lib" /E /XD .next node_modules
robocopy "$base\stock-swing-web\public" "$outDir\stock-swing-web\public" /E /XD .next node_modules

Copy-Item "$base\stock-swing-web\package.json" "$outDir\stock-swing-web\" -Force -ErrorAction SilentlyContinue
Copy-Item "$base\stock-swing-web\package-lock.json" "$outDir\stock-swing-web\" -Force -ErrorAction SilentlyContinue
Copy-Item "$base\stock-swing-web\next.config.js" "$outDir\stock-swing-web\" -Force -ErrorAction SilentlyContinue
Copy-Item "$base\stock-swing-web\next.config.mjs" "$outDir\stock-swing-web\" -Force -ErrorAction SilentlyContinue
Copy-Item "$base\stock-swing-web\tsconfig.json" "$outDir\stock-swing-web\" -Force -ErrorAction SilentlyContinue
Copy-Item "$base\stock-swing-web\postcss.config.js" "$outDir\stock-swing-web\" -Force -ErrorAction SilentlyContinue
Copy-Item "$base\stock-swing-web\tailwind.config.js" "$outDir\stock-swing-web\" -Force -ErrorAction SilentlyContinue
Copy-Item "$base\stock-swing-web\README.md" "$outDir\stock-swing-web\" -Force -ErrorAction SilentlyContinue

robocopy "$base\supabase" "$outDir\supabase" /E /XD .git node_modules .next

Compress-Archive -Path "$outDir\*" -DestinationPath $zip -Force

Write-Host "作成完了: $zip"
```

作成された以下ZIPをChatGPTにアップロードする。

```text
C:\Users\maabo\Downloads\stock_swing_source_for_chatgpt.zip
```

---

## 目的

ここに今回の目的を書く。

例：  
管理者画面だけに50営業日の機械的過去検証の診断結果を表示したい。

---

## 変更内容

ここに具体的な変更内容を書く。

例：

1. 管理者ユーザー `takashimasaakiadmin` のダッシュボードだけに表示する
2. 一般ユーザーには表示しない
3. 以下の診断結果を出す
   - スコア計算日数
   - ①買いシグナル数
   - ①売りシグナル数
   - ②買いシグナル数
   - ②売りシグナル数
   - ③買いシグナル数
   - ③売りシグナル数
   - 最新50日スコア範囲
   - 最大前日比上昇
   - 最大前日比下降

---

## 対象

該当するものを残す。

```text
core / web / supabase
```

例：

```text
core / web
```

---

## 希望

1. 修正仕様書をMarkdownで作る
2. `docs/specs/current_spec.md` の更新内容を出す
3. `docs/changelog/CHANGELOG.md` の追記内容を出す
4. 変更対象ファイルを明示する
5. パッチZIPを作る
6. 反映手順を出す
7. 戻し手順を出す
8. 確認手順を出す
9. Git commitメッセージ案を出す

---

## 運用ルール

1修正 = 1仕様メモ = 1パッチZIP = 1commit とする。  
反映前にバックアップブランチを作る。  
問題があれば `git revert` で戻せるようにする。

---

## 反映前バックアップ手順も出してほしい

`core / web` のうち対象リポジトリについて、以下を含めること。

```powershell
git checkout main
git pull origin main
$today = Get-Date -Format "yyyyMMdd-HHmm"
git checkout -b "backup-before-change-$today"
git push origin "backup-before-change-$today"
git checkout main
```

---

## 注意

以下はZIPに含めないこと。

- `.env`
- `.env.local`
- APIキー
- Supabase service role key
- J-Quants APIキー
- Vercel token
- `node_modules`
- `.next`
- `.git`
- `__pycache__`
- `*.pyc`

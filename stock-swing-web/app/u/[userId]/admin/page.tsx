'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Papa from 'papaparse';

type CsvRow = { code?: string; Code?: string; 銘柄コード?: string; name?: string; Name?: string; 銘柄名?: string };
type WatchRow = { code: string; name?: string | null; memo?: string | null; is_active?: boolean | null; updated_at?: string | null };

function rowsToCsv(rows: WatchRow[]) {
  if (!rows || rows.length === 0) return 'code,name\n';
  const body = rows.map((r) => `${r.code},${r.name || ''}`).join('\n');
  return `code,name\n${body}`;
}

export default function Admin() {
  const params = useParams<{ userId: string }>();
  const userId = useMemo(() => String(params?.userId || ''), [params]);
  const [adminKey, setAdminKey] = useState('');
  const [unlocked, setUnlocked] = useState(false);
  const [message, setMessage] = useState('');
  const [actionsUrl, setActionsUrl] = useState('');
  const [csvText, setCsvText] = useState('code,name\n');
  const [loading, setLoading] = useState(false);
  const [loadingCurrent, setLoadingCurrent] = useState(false);
  const [updatingScore, setUpdatingScore] = useState(false);
  const [currentRows, setCurrentRows] = useState<WatchRow[]>([]);

  async function unlock() {
    setMessage('');
    try {
      const res = await fetch('/api/admin/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId, adminKey }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'verify failed');
      setUnlocked(true);
      await loadCurrent();
    } catch (error) {
      setMessage(`管理認証エラー: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function loadCurrent() {
    if (!userId) return;
    setLoadingCurrent(true);
    setMessage('');
    try {
      const res = await fetch(`/api/watchlist/${userId}`, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'registered list fetch failed');
      const rows = (json.rows || []) as WatchRow[];
      setCurrentRows(rows);
      setCsvText(rowsToCsv(rows));
    } catch (error) {
      setMessage(`現在の登録CSV取得エラー: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLoadingCurrent(false);
    }
  }

  useEffect(() => { if (unlocked) loadCurrent(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [userId, unlocked]);

  async function upload() {
    setLoading(true); setMessage(''); setActionsUrl('');
    try {
      const parsed = Papa.parse<CsvRow>(csvText, { header: true, skipEmptyLines: true });
      if (parsed.errors.length > 0) throw new Error(parsed.errors[0]?.message || 'CSV parse error');
      const res = await fetch('/api/watchlist/upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId, adminKey, rows: parsed.data }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'upload failed');
      setMessage(`登録完了: ${json.count}件。必要に応じて「条件判定を更新」を押してください。`);
      await loadCurrent();
    } catch (error) {
      setMessage(`エラー: ${error instanceof Error ? error.message : String(error)}`);
    } finally { setLoading(false); }
  }

  async function runScoreUpdate() {
    setUpdatingScore(true); setMessage('条件判定更新をGitHub Actionsへ依頼しています...'); setActionsUrl('');
    try {
      const res = await fetch('/api/analysis/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId, adminKey }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'condition update failed');
      setMessage(json.message || '条件判定更新を開始しました。数分後に銘柄整理画面を確認してください。');
      if (json.actionsUrl) setActionsUrl(json.actionsUrl);
    } catch (error) {
      setMessage(`条件判定更新エラー: ${error instanceof Error ? error.message : String(error)}`);
    } finally { setUpdatingScore(false); }
  }

  return (
    <main className="wrap">
      <section className="section">
        <h1>{userId} 登録銘柄CSV</h1>
        {!unlocked ? (
          <>
            <p>管理IDに紐づく管理キーを入力してください。認証後に登録銘柄CSVを更新できます。</p>
            <label>管理キー</label>
            <input className="input" type="password" value={adminKey} onChange={(e) => setAdminKey(e.target.value)} placeholder={`${userId} 用の管理キー`} />
            <div style={{ marginTop: 14 }}><button className="btn" onClick={unlock} disabled={!userId || !adminKey}>管理画面へ入る</button></div>
            {message ? <p>{message}</p> : null}
          </>
        ) : (
          <>
            <p>ユーザーごとの登録銘柄CSVを更新します。保存後、「条件判定を更新」で分析バッチを開始できます。</p>
            <p>CSV形式: <code>code,name</code></p>
            <div className="grid"><div><label>管理キー</label><input className="input" type="password" value={adminKey} onChange={(e) => setAdminKey(e.target.value)} /></div><div><label>現在の登録件数</label><div className="card"><b>{loadingCurrent ? '読込中' : currentRows.length}</b></div></div></div>
            <label>現在登録されているCSV / 更新後CSV</label>
            <textarea className="input" value={csvText} onChange={(e) => setCsvText(e.target.value)} rows={18} />
            <div style={{ display: 'flex', gap: 12, marginTop: 14, flexWrap: 'wrap' }}>
              <button className="btn" onClick={upload} disabled={loading || !userId}>{loading ? '登録中...' : 'CSVを保存'}</button>
              <button className="btn" type="button" onClick={runScoreUpdate} disabled={updatingScore || !userId || !adminKey}>{updatingScore ? '条件判定を更新中...' : '条件判定を更新'}</button>
              <button className="btn" type="button" onClick={loadCurrent} disabled={loadingCurrent}>現在の登録CSVを再読込</button>
              <a className="btn" href={`/u/${userId}`}>銘柄整理画面へ</a>
            </div>
            {message ? <p>{message}</p> : null}
            {actionsUrl ? <p><a href={actionsUrl} target="_blank" rel="noreferrer">GitHub Actionsの実行状況を確認</a></p> : null}
          </>
        )}
      </section>
    </main>
  );
}

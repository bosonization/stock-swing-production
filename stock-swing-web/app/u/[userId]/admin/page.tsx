'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Papa from 'papaparse';

type CsvRow = { code?: string; Code?: string; 銘柄コード?: string; name?: string; Name?: string; 銘柄名?: string };
type WatchRow = { code: string; name?: string | null };

function rowsToCsv(rows: WatchRow[]) {
  return Papa.unparse(rows.map((row) => ({ code: row.code, name: row.name || '' })), { columns: ['code', 'name'] });
}

export default function WatchlistAdmin() {
  const params = useParams<{ userId: string }>();
  const userId = useMemo(() => String(params?.userId || ''), [params]);
  const [csvText, setCsvText] = useState('code,name\n');
  const [count, setCount] = useState(0);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function loadCurrent() {
    if (!userId) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/watchlist/${encodeURIComponent(userId)}`, { cache: 'no-store' });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || '登録銘柄を取得できませんでした');
      const rows = (json.rows || []) as WatchRow[];
      setCount(rows.length);
      setCsvText(rowsToCsv(rows));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { void loadCurrent(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [userId]);

  async function save() {
    setBusy(true);
    setMessage('');
    try {
      const parsed = Papa.parse<CsvRow>(csvText, { header: true, skipEmptyLines: true });
      if (parsed.errors.length) throw new Error(parsed.errors[0].message);
      const response = await fetch('/api/watchlist/upload', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, rows: parsed.data }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || '保存できませんでした');
      setMessage(`${json.count}件を保存しました。`);
      await loadCurrent();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function runAnalysis() {
    setBusy(true);
    setMessage('条件判定の更新を開始しています…');
    try {
      const response = await fetch('/api/analysis/run', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || '更新を開始できませんでした');
      setMessage(json.message || '条件判定を開始しました。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="wrap">
      <section className="section">
        <div className="eyebrow">Registered Symbols</div>
        <h1>登録銘柄の管理</h1>
        <p>現在 {count}件。1行目を <code>code,name</code> としたCSVを編集して保存してください。</p>
        <textarea className="input" value={csvText} onChange={(event) => setCsvText(event.target.value)} rows={20} aria-label="登録銘柄CSV" />
        <div className="footer-links">
          <button className="btn" onClick={save} disabled={busy}>CSVを保存</button>
          <button className="btn" onClick={runAnalysis} disabled={busy || count === 0}>条件判定を更新</button>
          <button className="btn" onClick={loadCurrent} disabled={busy}>再読込</button>
          <a className="btn" href={`/u/${encodeURIComponent(userId)}`}>ダッシュボードへ</a>
        </div>
        {message ? <p className="meta">{message}</p> : null}
      </section>
    </main>
  );
}

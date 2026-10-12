import Link from 'next/link';
import { requireAdmin } from '../../../lib/auth';
import { supabaseAdmin } from '../../../lib/supabaseServer';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
type AppUser = {
  id: string;
  auth_user_id: string;
  display_name: string | null;
  email: string | null;
  plan: string;
  role: string;
  status: string;
  max_watchlist_count: number;
  created_at: string;
  last_login_at: string | null;
};
type OperationsSummary = {
  user_id: string;
  active_watchlist_count: number;
  analysis_status: string | null;
  analysis_started_at: string | null;
  analysis_finished_at: string | null;
  analysis_error_message: string | null;
  active_terms_agreed_at: string | null;
};
type TermsDocument = {
  id: string;
  terms_type: string;
  version: string;
  title: string;
  body: string;
  is_active: boolean;
  published_at: string;
};
type FeatureEntitlement = {
  user_id: string;
  feature_key: string;
  enabled: boolean;
};

function firstParam(value?: string | string[]) {
  return Array.isArray(value) ? String(value[0] || '') : String(value || '');
}

function formatJst(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
}

function statusLabel(status: string) {
  if (status === 'active') return '利用中';
  if (status === 'suspended') return '停止中';
  if (status === 'closed') return '終了';
  return status;
}

function runLabel(status?: string) {
  if (!status) return '未実行';
  if (status === 'success') return '成功';
  if (status === 'failed') return '失敗';
  if (status === 'running') return '実行中';
  if (status === 'queued') return '待機中';
  return status;
}

export default async function OperationsPage({ searchParams }: { searchParams?: SearchParams }) {
  const admin = await requireAdmin();
  const query = searchParams ? await searchParams : {};
  const message = firstParam(query.message);
  const error = firstParam(query.error);
  const supabase = supabaseAdmin();

  const [usersResult, summariesResult, termsResult, logsResult, entitlementsResult] = await Promise.all([
    supabase.from('app_users').select('id,auth_user_id,display_name,email,plan,role,status,max_watchlist_count,created_at,last_login_at').order('created_at'),
    supabase.from('user_operations_summary').select('user_id,active_watchlist_count,analysis_status,analysis_started_at,analysis_finished_at,analysis_error_message,active_terms_agreed_at'),
    supabase.from('terms_documents').select('id,terms_type,version,title,body,is_active,published_at').eq('terms_type', 'service_terms').order('published_at', { ascending: false }),
    supabase.from('app_event_logs').select('id,user_id,actor_id,event_type,event_version,payload,created_at').order('created_at', { ascending: false }).limit(30),
    supabase.from('feature_entitlements').select('user_id,feature_key,enabled').eq('feature_key', 'stock_swing_tool'),
  ]);

  const firstError = [usersResult.error, summariesResult.error, termsResult.error, logsResult.error, entitlementsResult.error].find(Boolean);
  if (firstError) throw new Error(`運営データを読み込めません: ${firstError?.message}`);

  const users = (usersResult.data || []) as AppUser[];
  const terms = (termsResult.data || []) as TermsDocument[];
  const activeTerms = terms.find((item) => item.is_active) || null;
  const summaries = new Map(((summariesResult.data || []) as OperationsSummary[]).map((row) => [row.user_id, row]));
  const toolAccess = new Map(((entitlementsResult.data || []) as FeatureEntitlement[]).map((row) => [row.user_id, row.enabled]));
  const actorNames = new Map(users.map((user) => [user.auth_user_id, user.display_name || user.email || user.id]));
  const activeCount = users.filter((user) => user.status === 'active').length;
  const suspendedCount = users.filter((user) => user.status === 'suspended').length;
  const consentCount = users.filter((user) => summaries.get(user.id)?.active_terms_agreed_at).length;
  const failedCount = [...summaries.values()].filter((row) => row.analysis_status === 'failed').length;

  return (
    <>
      <header className="hero operations-hero">
        <div className="eyebrow">Operations Administration</div>
        <h1>運営管理</h1>
        <p className="hero-lead">会員状態、規約同意、分析実行状況を一つの画面で確認します。</p>
        <p className="meta">管理者: {admin.display_name || admin.email}</p>
      </header>
      <main className="wrap operations-wrap">
        {message ? <p className="success-message">{message}</p> : null}
        {error ? <p className="alert">{error}</p> : null}

        <section className="operations-summary" aria-label="運営概要">
          <div><span>全会員</span><b>{users.length}</b></div>
          <div><span>利用中</span><b>{activeCount}</b></div>
          <div><span>停止中</span><b>{suspendedCount}</b></div>
          <div><span>最新規約同意済み</span><b>{consentCount}/{users.length}</b></div>
          <div><span>分析失敗</span><b>{failedCount}</b></div>
        </section>

        <section className="section operations-section">
          <div className="section-headline">
            <div><h2>会員と稼働状況</h2><p>利用停止中はログインできません。</p></div>
            <span>{users.length}人</span>
          </div>
          <div className="operations-table-wrap">
            <table className="operations-table">
              <thead><tr><th>会員</th><th>区分</th><th>状態</th><th>最終ログイン</th><th>登録銘柄</th><th>最新分析</th><th>規約同意</th><th>ツール</th><th>操作</th></tr></thead>
              <tbody>
                {users.map((user) => {
                  const summary = summaries.get(user.id);
                  const agreedAt = summary?.active_terms_agreed_at;
                  const isSelf = user.id === admin.id;
                  const hasToolAccess = toolAccess.get(user.id) === true;
                  return (
                    <tr key={user.id}>
                      <td><b>{user.display_name || '名前未設定'}</b><small>{user.email || user.id}</small></td>
                      <td>{user.role === 'admin' ? '管理者' : '一般'}<small>{user.plan}</small></td>
                      <td><span className={`ops-status ${user.status}`}>{statusLabel(user.status)}</span></td>
                      <td>{formatJst(user.last_login_at)}</td>
                      <td>{summary?.active_watchlist_count || 0} / {user.max_watchlist_count}</td>
                      <td><span className={`ops-run ${summary?.analysis_status || 'none'}`}>{runLabel(summary?.analysis_status || undefined)}</span><small>{formatJst(summary?.analysis_finished_at || summary?.analysis_started_at)}</small>{summary?.analysis_error_message ? <small className="ops-error">{summary.analysis_error_message}</small> : null}</td>
                      <td>{agreedAt ? <><span className="ops-consent ok">同意済み</span><small>{formatJst(agreedAt)}</small></> : <span className="ops-consent pending">未同意</span>}</td>
                      <td><form action={`/api/admin/users/${encodeURIComponent(user.id)}/entitlements`} method="post"><input type="hidden" name="featureKey" value="stock_swing_tool" /><input type="hidden" name="enabled" value={hasToolAccess ? 'false' : 'true'} /><button className={`mini-btn ${hasToolAccess ? 'danger-button' : 'success-button'}`} type="submit">{hasToolAccess ? '停止' : '有効化'}</button></form></td>
                      <td><div className="operations-actions"><Link className="mini-btn" href={`/u/${encodeURIComponent(user.id)}`}>ツール表示</Link>{!isSelf && user.status !== 'closed' ? <form action={`/api/admin/users/${encodeURIComponent(user.id)}`} method="post"><input type="hidden" name="status" value={user.status === 'active' ? 'suspended' : 'active'} /><button className={`mini-btn ${user.status === 'active' ? 'danger-button' : 'success-button'}`} type="submit">{user.status === 'active' ? '停止' : '再開'}</button></form> : null}</div></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="section operations-section">
          <div className="section-headline"><div><h2>規約同意管理</h2><p>新しい版を公開すると、次回アクセス時に全会員へ再同意を求めます。</p></div></div>
          {activeTerms ? (
            <div className="current-terms">
              <div><span>現在の版</span><b>{activeTerms.version}</b></div>
              <div><span>公開日</span><b>{formatJst(activeTerms.published_at)}</b></div>
              <div><span>同意状況</span><b>{consentCount} / {users.length}人</b></div>
              <details><summary>{activeTerms.title} の本文を表示</summary><div className="terms-body">{activeTerms.body}</div></details>
            </div>
          ) : <p className="alert">有効な規約がありません。すぐに公開してください。</p>}

          <form action="/api/admin/terms" method="post" className="terms-publish-form">
            <h3>新しい規約版を公開</h3>
            <label>版番号<input className="input" name="version" required minLength={2} maxLength={80} placeholder="service_terms_v2" /></label>
            <label>タイトル<input className="input" name="title" required minLength={3} maxLength={120} defaultValue="サービス利用規約・注意事項" /></label>
            <label>本文<textarea className="input" name="body" required minLength={100} maxLength={20000} rows={14} placeholder="専門家の確認を受けた規約全文を貼り付けてください。" /></label>
            <p className="account-note">公開後の本文は編集せず、修正時は必ず新しい版番号で公開します。</p>
            <button className="btn" type="submit">新しい版を公開</button>
          </form>

          {terms.length ? <details className="terms-history"><summary>過去の版を確認（{terms.length}件）</summary><ul>{terms.map((item) => <li key={item.id}><b>{item.version}</b> — {item.title} / {formatJst(item.published_at)} {item.is_active ? '（現在有効）' : ''}</li>)}</ul></details> : null}
        </section>

        <section className="section operations-section">
          <div className="section-headline"><div><h2>最近の操作履歴</h2><p>ログイン、会員停止、規約公開、規約同意を記録します。</p></div></div>
          <div className="operations-table-wrap"><table className="operations-table compact"><thead><tr><th>日時</th><th>操作</th><th>対象</th><th>実行者</th></tr></thead><tbody>{(logsResult.data || []).map((log: any) => <tr key={log.id}><td>{formatJst(log.created_at)}</td><td>{log.event_type}<small>{log.event_version}</small></td><td>{log.user_id || '—'}</td><td>{actorNames.get(log.actor_id) || log.actor_id || 'システム'}</td></tr>)}</tbody></table></div>
        </section>

        <div className="footer-links"><Link className="btn" href={`/u/${encodeURIComponent(admin.id)}/home`}>コミュニティへ</Link><Link className="btn" href="/admin/community">コミュニティ管理へ</Link></div>
      </main>
    </>
  );
}

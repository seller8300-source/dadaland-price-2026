import { apiGet, formatWon } from "@/lib/api";
import type { CompetitionSummary } from "@/lib/types";
import { ErrorPanel, SectionTitle, Stat } from "@/components/Panels";

export const dynamic = "force-dynamic";

export default async function CompetitionPage({
  searchParams,
}: {
  searchParams: { start?: string; end?: string };
}) {
  const params = {
    start: searchParams.start ?? "2026-01-01",
    end: searchParams.end ?? "2026-08-31",
  };
  let data: CompetitionSummary;
  try {
    data = await apiGet<CompetitionSummary>("/competition", params);
  } catch (error) {
    return <ErrorPanel message={(error as Error).message} />;
  }

  const clusters = (data.clusters ?? data.top_review_clusters ?? []).slice(0, 30);

  return (
    <div>
      <h1 className="text-xl font-semibold">Keyword Competition Measurement</h1>
      <p className="mt-2 text-sm text-slate-400">
        중복 광고를 무조건 낭비로 보지 않습니다. 시장규모·시즌·운영정책을 반영해 허용 비용과
        검토 대상 비용을 분리합니다 (§18–19).
      </p>

      <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Allowed Competition Spend" value={formatWon(data.allowed_competition_spend)} />
        <Stat
          label="Reallocation Review Spend"
          value={formatWon(data.reallocation_review_spend)}
          sub={`${data.review_share_pct.toFixed(1)}%`}
        />
        <Stat label="경쟁군" value={`${data.cluster_count}`} />
        <Stat label="복수계정 경쟁군" value={`${data.multi_account_cluster_count}`} />
      </div>

      <SectionTitle hint="검토 대상 비용 순">경쟁군 상세</SectionTitle>
      <div className="space-y-3">
        {clusters.map((cluster) => (
          <div key={cluster.cluster_key} className="card">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="font-medium">{cluster.label}</div>
              <div className="text-xs text-slate-400">
                {cluster.season_state} · {cluster.policy} · 허용 {cluster.allowed_account_count}개 계정
                {cluster.primary_account ? ` · Primary ${cluster.primary_account}` : ""}
              </div>
            </div>
            <div className="mt-1 text-xs text-slate-400">
              총 {formatWon(cluster.total_cost)} · 허용 {formatWon(cluster.allowed_competition_spend)} ·
              검토 {formatWon(cluster.reallocation_review_spend)}
            </div>
            <table className="data mt-3">
              <thead>
                <tr>
                  <th>계정</th>
                  <th>광고비</th>
                  <th>클릭</th>
                  <th>CPC</th>
                  <th>CTR</th>
                </tr>
              </thead>
              <tbody>
                {cluster.accounts.map((account) => (
                  <tr key={account.account}>
                    <td>{account.account}</td>
                    <td>{formatWon(account.cost)}</td>
                    <td>{account.clicks.toLocaleString("ko-KR")}</td>
                    <td>{account.cpc ? formatWon(account.cpc) : "—"}</td>
                    <td>{account.ctr ? `${account.ctr.toFixed(2)}%` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="mt-2 space-y-1 text-xs text-slate-400">
              {cluster.reasons.map((reason) => (
                <li key={reason}>· {reason}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

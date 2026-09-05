import { apiGet, formatPct, formatWon } from "@/lib/api";
import type { BenchmarkSet } from "@/lib/types";
import { ChangeCell, ErrorPanel, SectionTitle, Stat } from "@/components/Panels";

export const dynamic = "force-dynamic";

const DEFAULT_PERIODS = {
  base_start: "2025-01-01",
  base_end: "2025-08-31",
  comp_start: "2026-01-01",
  comp_end: "2026-08-31",
};

export default async function BenchmarkPage({
  searchParams,
}: {
  searchParams: Partial<typeof DEFAULT_PERIODS>;
}) {
  const params = { ...DEFAULT_PERIODS, ...searchParams };
  let data: BenchmarkSet;
  try {
    data = await apiGet<BenchmarkSet>("/benchmark/yoy", params);
  } catch (error) {
    return <ErrorPanel message={(error as Error).message} />;
  }

  return (
    <div>
      <h1 className="text-xl font-semibold">
        YoY Benchmark
        <span className="ml-2 text-sm text-slate-400">
          {data.base_period.join(" ~ ")} vs {data.comp_period.join(" ~ ")}
        </span>
      </h1>

      <SectionTitle hint="§4 회사 전체">회사 전체</SectionTitle>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="광고비" value={formatWon(data.company.comp.cost)} sub={`이전 ${formatWon(data.company.base.cost)}`} />
        <Stat label="광고비 증감" value={formatPct(data.company.cost_change_pct)} />
        <Stat label="클릭 증감" value={formatPct(data.company.click_change_pct)} />
        <Stat label="CPC 증감" value={formatPct(data.company.cpc_change_pct)} />
      </div>
      <div className="card mt-4 text-sm text-slate-300">{data.company.explanation}</div>

      <SectionTitle hint="§6 계정별 패턴">계정별</SectionTitle>
      <div className="card overflow-x-auto">
        <table className="data">
          <thead>
            <tr>
              <th>계정</th>
              <th>광고비</th>
              <th>비용 증감</th>
              <th>클릭 증감</th>
              <th>CPC 증감</th>
              <th>CTR 증감</th>
              <th>주원인</th>
            </tr>
          </thead>
          <tbody>
            {data.accounts.map((account) => (
              <tr key={account.account}>
                <td className="whitespace-nowrap">{account.account}</td>
                <td>{formatWon(account.comp.cost)}</td>
                <td><ChangeCell value={account.cost_change_pct} /></td>
                <td><ChangeCell value={account.click_change_pct} /></td>
                <td><ChangeCell value={account.cpc_change_pct} /></td>
                <td><ChangeCell value={account.ctr_change_pct} /></td>
                <td className="text-slate-400">{account.primary_driver}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <SectionTitle hint="판정이 아니라 확인 우선순위 (§11)">패턴 플래그</SectionTitle>
      <div className="grid gap-3 md:grid-cols-2">
        {data.accounts
          .filter((account) => account.flags.length > 0)
          .map((account) => (
            <div key={account.account} className="card">
              <div className="flex items-center justify-between">
                <div className="font-medium">{account.account}</div>
                <div className="text-xs text-slate-500">{formatWon(account.comp.cost)}</div>
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {account.flag_texts.map((flag) => (
                  <span key={flag} className="rounded bg-line px-2 py-0.5 text-[11px] text-slate-200">
                    {flag}
                  </span>
                ))}
              </div>
              <div className="mt-2 text-sm text-slate-300">{account.explanation}</div>
              <ul className="mt-2 space-y-1 text-xs text-slate-400">
                {account.notes.map((note) => (
                  <li key={note}>· {note}</li>
                ))}
              </ul>
            </div>
          ))}
      </div>
    </div>
  );
}

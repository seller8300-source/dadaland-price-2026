import { apiGet, formatPct, formatWon } from "@/lib/api";
import type { DailyReport } from "@/lib/types";
import { ChangeCell, Empty, ErrorPanel, SectionTitle, Stat } from "@/components/Panels";

export const dynamic = "force-dynamic";

export default async function DailyReportPage({
  searchParams,
}: {
  searchParams: { as_of?: string };
}) {
  let report: DailyReport;
  try {
    report = await apiGet<DailyReport>("/reports/daily", { as_of: searchParams.as_of });
  } catch (error) {
    return <ErrorPanel message={(error as Error).message} />;
  }

  const { company } = report;
  const mix = Object.entries(company.category_mix).slice(0, 6);

  return (
    <div>
      <h1 className="text-xl font-semibold">
        Daily CEO Report <span className="text-sm text-slate-400">({report.as_of})</span>
      </h1>

      <SectionTitle hint="§27 회사 전체">1. 회사 전체</SectionTitle>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat
          label="어제 광고비"
          value={formatWon(company.yesterday_cost)}
          sub={`7일 평균 대비 ${formatPct(company.vs_7day_avg_pct)}`}
        />
        <Stat label="이번달 누적" value={formatWon(company.month_to_date_cost)} />
        <Stat label="월말 예상" value={formatWon(company.projected_month_cost)} />
        <Stat
          label="광고비 YoY"
          value={formatPct(company.yoy.cost_change_pct)}
          sub={`매출 YoY ${company.yoy.revenue_change_pct === null ? "DATA INSUFFICIENT" : formatPct(company.yoy.revenue_change_pct)}`}
        />
      </div>
      <div className="card mt-4 text-sm text-slate-300">{company.yoy.explanation}</div>

      <SectionTitle hint="§27 상품군별 비중">상품군 비중</SectionTitle>
      <div className="card">
        <table className="data">
          <thead>
            <tr>
              <th>상품군</th>
              <th>광고비</th>
              <th>비중</th>
              <th>CPC</th>
              <th>CTR</th>
            </tr>
          </thead>
          <tbody>
            {mix.map(([category, values]) => (
              <tr key={category}>
                <td>{category}</td>
                <td>{formatWon(values.cost)}</td>
                <td>{values.share.toFixed(1)}%</td>
                <td>{values.cpc ? formatWon(values.cpc) : "—"}</td>
                <td>{values.ctr ? `${values.ctr.toFixed(2)}%` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <SectionTitle hint="§25 매출 생산성">2. 매출 생산성</SectionTitle>
      <div className="card">
        <table className="data">
          <thead>
            <tr>
              <th>계정</th>
              <th>광고비 증감</th>
              <th>매출 증감</th>
              <th>기여이익 증감</th>
              <th>판정</th>
            </tr>
          </thead>
          <tbody>
            {report.productivity.map((row) => (
              <tr key={row.account}>
                <td>
                  {row.account}
                  {row.is_growth_account ? (
                    <span className="ml-2 rounded bg-accent/20 px-1.5 py-0.5 text-[10px] text-accent">
                      성장계정
                    </span>
                  ) : null}
                </td>
                <td><ChangeCell value={row.cost_change_pct} /></td>
                <td><ChangeCell value={row.revenue_change_pct} /></td>
                <td><ChangeCell value={row.profit_change_pct} /></td>
                <td className="text-slate-300">{row.verdict_text}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <SectionTitle hint="§27 우선 확인 팀">3. 우선 확인 팀</SectionTitle>
      {report.priority_accounts.length ? (
        <div className="grid gap-3 md:grid-cols-2">
          {report.priority_accounts.map((item) => (
            <div key={item.account} className="card">
              <div className="font-medium">
                {item.icon} {item.account}
              </div>
              <ul className="mt-2 space-y-1 text-sm text-slate-300">
                {item.reasons.slice(0, 3).map((reason) => (
                  <li key={reason}>· {reason}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        <Empty>특이사항 없음</Empty>
      )}

      {report.policy_violations.length ? (
        <>
          <SectionTitle hint="§6 허용 상품군 위반">POLICY VIOLATION</SectionTitle>
          <div className="card border-danger/50">
            <table className="data">
              <thead>
                <tr>
                  <th>계정</th>
                  <th>상품군</th>
                  <th>키워드</th>
                  <th>비용</th>
                  <th>최근 집행일</th>
                </tr>
              </thead>
              <tbody>
                {report.policy_violations.slice(0, 10).map((violation) => (
                  <tr key={`${violation.account}-${violation.keyword}`}>
                    <td className="text-danger">{violation.account}</td>
                    <td>{violation.product_category}</td>
                    <td>{violation.keyword}</td>
                    <td>{formatWon(violation.cost)}</td>
                    <td>{violation.date}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      <SectionTitle hint="§18 경쟁 허용 vs 재배치 검토">4. Keyword Competition</SectionTitle>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        <Stat label="경쟁 허용 비용" value={formatWon(report.competition.allowed_competition_spend)} />
        <Stat
          label="재배치 검토 비용"
          value={formatWon(report.competition.reallocation_review_spend)}
          sub={`${report.competition.review_share_pct.toFixed(1)}% · 검토 대상이며 삭감 확정이 아님`}
        />
        <Stat label="경쟁군 수" value={`${report.competition.cluster_count}`} />
      </div>

      <SectionTitle hint="§17 Confidence 70 이상만">5. Opportunity</SectionTitle>
      {report.opportunities.length ? (
        <div className="card">
          <table className="data">
            <thead>
              <tr>
                <th>키워드</th>
                <th>유형</th>
                <th>Confidence</th>
                <th>근거</th>
              </tr>
            </thead>
            <tbody>
              {report.opportunities.slice(0, 12).map((item) => (
                <tr key={`${item.keyword}-${item.type}`}>
                  <td>{item.keyword}</td>
                  <td className="text-slate-400">{item.type}</td>
                  <td>{item.confidence.toFixed(0)}</td>
                  <td className="text-slate-300">
                    {item.evidence.map((evidence) => evidence.detail).join(" · ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty>근거 기준(2개 이상)을 통과한 신규 추천 없음 — DATA INSUFFICIENT</Empty>
      )}

      <SectionTitle hint="§30 실행은 사람이 한다">6. 케이오마케팅 전달 권고</SectionTitle>
      {report.agency_instructions.length ? (
        <div className="card">
          <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-200">
            {report.agency_instructions.map((instruction) => (
              <li key={instruction}>{instruction}</li>
            ))}
          </ol>
          <div className="mt-4 text-xs text-slate-500">
            “1, 3, 5번 진행” 이라고 회신하면 전달 메시지를 자동 작성합니다
            (POST /reports/daily/agency-message).
          </div>
        </div>
      ) : (
        <Empty>전달할 지시 없음</Empty>
      )}

      <SectionTitle hint="STEP 0">전환추적 설치 현황</SectionTitle>
      <div className="card text-sm">
        <div>
          설치 완료 {report.conversion_tracking.installed_accounts} / {report.conversion_tracking.total_accounts} 계정
        </div>
        <div className="mt-2 text-slate-400">{String(report.conversion_tracking.funnel.status)}</div>
      </div>

      {report.notes.length ? (
        <div className="mt-6 text-xs text-slate-500">
          {report.notes.map((note) => (
            <div key={note}>※ {note}</div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

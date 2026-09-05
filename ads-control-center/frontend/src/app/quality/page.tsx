import { apiGet } from "@/lib/api";
import type { QualityWarning } from "@/lib/types";
import { Empty, ErrorPanel, SectionTitle } from "@/components/Panels";

export const dynamic = "force-dynamic";

export default async function QualityPage() {
  let warnings: QualityWarning[];
  try {
    warnings = await apiGet<QualityWarning[]>("/quality/warnings");
  } catch (error) {
    return <ErrorPanel message={(error as Error).message} />;
  }

  const blocking = warnings.filter((warning) => warning.blocks_analysis);
  const advisory = warnings.filter((warning) => !warning.blocks_analysis);

  return (
    <div>
      <h1 className="text-xl font-semibold">Data Quality</h1>
      <p className="mt-2 text-sm text-slate-400">
        Excel 에 있다고 무조건 사용하지 않습니다. 검증을 통과한 데이터만 TRUSTED 로 승격됩니다 (§8).
      </p>

      <SectionTitle hint="분석 사용 금지">차단 (REJECTED)</SectionTitle>
      {blocking.length ? (
        <div className="card">
          <table className="data">
            <thead>
              <tr>
                <th>규칙</th>
                <th>범위</th>
                <th>내용</th>
              </tr>
            </thead>
            <tbody>
              {blocking.map((warning) => (
                <tr key={warning.id}>
                  <td className="whitespace-nowrap text-danger">{warning.rule}</td>
                  <td className="whitespace-nowrap text-slate-400">{warning.scope}</td>
                  <td>{warning.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty>차단된 데이터 없음</Empty>
      )}

      <SectionTitle hint="사용은 하되 주의">경고 (WARNING)</SectionTitle>
      {advisory.length ? (
        <div className="card">
          <table className="data">
            <thead>
              <tr>
                <th>규칙</th>
                <th>범위</th>
                <th>내용</th>
              </tr>
            </thead>
            <tbody>
              {advisory.slice(0, 50).map((warning) => (
                <tr key={warning.id}>
                  <td className="whitespace-nowrap text-warn">{warning.rule}</td>
                  <td className="whitespace-nowrap text-slate-400">{warning.scope}</td>
                  <td>{warning.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty>경고 없음</Empty>
      )}
    </div>
  );
}

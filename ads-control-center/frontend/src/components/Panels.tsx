import { formatPct, formatWon, toneForChange } from "@/lib/api";

export function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: string;
}) {
  return (
    <div className="card">
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${tone ?? ""}`}>{value}</div>
      {sub ? <div className="mt-1 text-xs text-slate-400">{sub}</div> : null}
    </div>
  );
}

export function SectionTitle({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="mb-3 mt-8 flex items-baseline gap-3">
      <h2 className="text-lg font-semibold">{children}</h2>
      {hint ? <span className="text-xs text-slate-500">{hint}</span> : null}
    </div>
  );
}

export function ChangeCell({ value }: { value: number | null | undefined }) {
  return <span className={toneForChange(value)}>{formatPct(value)}</span>;
}

export function Money({ value }: { value: number | null | undefined }) {
  return <span>{formatWon(value)}</span>;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="card text-sm text-slate-400">{children}</div>;
}

export function ErrorPanel({ message }: { message: string }) {
  return (
    <div className="card border-danger/50 text-sm">
      <div className="font-medium text-danger">데이터를 불러오지 못했습니다</div>
      <div className="mt-1 text-slate-400">{message}</div>
      <div className="mt-3 text-xs text-slate-500">
        백엔드가 실행 중인지 확인하세요: <code>uvicorn app.main:app --reload</code>
      </div>
    </div>
  );
}

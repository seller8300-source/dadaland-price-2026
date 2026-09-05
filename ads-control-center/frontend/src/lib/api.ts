/** 백엔드 API 클라이언트. 서버 컴포넌트에서 호출한다. */

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000/api/v1";

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export async function apiGet<T>(
  path: string,
  params: Record<string, string | number | undefined> = {},
): Promise<T> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query.set(key, String(value));
  }
  const suffix = query.toString() ? `?${query}` : "";
  const response = await fetch(`${API_BASE}${path}${suffix}`, {
    // 리포트는 항상 최신 데이터를 본다.
    cache: "no-store",
  });
  if (!response.ok) {
    throw new ApiError(response.status, `${path} → ${response.status}`);
  }
  return (await response.json()) as T;
}

export function formatWon(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${Math.round(value).toLocaleString("ko-KR")}원`;
}

export function formatPct(value: number | null | undefined, withSign = true): string {
  if (value === null || value === undefined) return "—";
  const sign = withSign && value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

export function toneForChange(value: number | null | undefined): string {
  if (value === null || value === undefined) return "text-slate-400";
  if (value > 25) return "text-danger";
  if (value > 5) return "text-warn";
  if (value < -5) return "text-ok";
  return "text-slate-200";
}

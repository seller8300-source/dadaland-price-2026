import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "DADA NAVER ADS AI CONTROL CENTER",
  description: "네이버 검색광고를 회사 전체 관점에서 통합 관리하는 AI 광고총괄 시스템",
};

const NAV = [
  { href: "/", label: "Daily Report" },
  { href: "/benchmark", label: "Benchmark" },
  { href: "/competition", label: "Competition" },
  { href: "/quality", label: "Data Quality" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <header className="border-b border-line">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
            <div>
              <div className="text-sm font-semibold tracking-wide text-accent">DADA</div>
              <div className="text-xs text-slate-400">NAVER ADS AI CONTROL CENTER</div>
            </div>
            <nav className="flex gap-4 text-sm">
              {NAV.map((item) => (
                <Link key={item.href} href={item.href} className="text-slate-300 hover:text-white">
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
        <footer className="mx-auto max-w-6xl px-6 pb-10 text-xs text-slate-500">
          NAVER API 는 READ ONLY 입니다. 광고 변경은 CEO 승인 후 케이오마케팅이 집행합니다.
        </footer>
      </body>
    </html>
  );
}

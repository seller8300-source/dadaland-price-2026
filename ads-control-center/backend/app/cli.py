"""운영용 CLI.

    python -m app.cli init-db
    python -m app.cli seed
    python -m app.cli import /data
    python -m app.cli validate
    python -m app.cli daily [YYYY-MM-DD]
    python -m app.cli weekly [YYYY-MM-DD]
    python -m app.cli sync-naver [--days 7]
"""
from __future__ import annotations

import argparse
from datetime import date, timedelta

from app import models  # noqa: F401  — 테이블 등록
from app.core.enums import DataSource
from app.db.base import Base
from app.db.seed import seed_all
from app.db.session import engine, session_scope


def _parse_date(value: str | None) -> date:
    return date.fromisoformat(value) if value else date.today() - timedelta(days=1)


def main() -> None:
    parser = argparse.ArgumentParser(prog="app.cli", description="DADA ADS CONTROL CENTER")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("init-db", help="테이블 생성")
    sub.add_parser("seed", help="계정/상품군/운영규칙 시드")

    import_parser = sub.add_parser("import", help="Excel 파일 또는 디렉터리 적재 (UNVERIFIED)")
    import_parser.add_argument("path")
    import_parser.add_argument("--account", default=None)
    import_parser.add_argument("--source", default=DataSource.EXCEL_KAYO)

    sub.add_parser("validate", help="Data Quality 검증 후 TRUSTED 승격")

    demo_parser = sub.add_parser(
        "demo", help="실제 Excel 이 오기 전 확인용 합성 데이터 적재 (§38 검증 데이터셋)"
    )
    demo_parser.add_argument("--with-defects", action="store_true",
                             help="§9 에서 확인된 Excel 결함(비용 복사)까지 재현")

    daily_parser = sub.add_parser("daily", help="일일 CEO 리포트 출력")
    daily_parser.add_argument("as_of", nargs="?", default=None)

    weekly_parser = sub.add_parser("weekly", help="주간 리포트(JSON) 출력")
    weekly_parser.add_argument("week_end", nargs="?", default=None)

    sync_parser = sub.add_parser("sync-naver", help="NAVER API 동기화 (READ ONLY)")
    sync_parser.add_argument("--days", type=int, default=7)

    args = parser.parse_args()

    if args.command == "init-db":
        Base.metadata.create_all(engine)
        print("테이블 생성 완료")
        return

    with session_scope() as db:
        if args.command == "seed":
            seed_all(db)
            print("시드 완료")

        elif args.command == "import":
            from pathlib import Path

            from app.services.importer.excel_import import import_directory, import_file

            path = Path(args.path)
            results = (
                import_directory(db, path, source=args.source)
                if path.is_dir()
                else [import_file(db, path, account_name=args.account, source=args.source)]
            )
            for result in results:
                print(f"{result.file_name}: {result.rows_imported}행 적재 (UNVERIFIED)")

        elif args.command == "validate":
            from app.services.quality.validator import validate

            report = validate(db)
            print(report.summary())
            for finding in report.blocking_findings[:20]:
                print(f"  [REJECTED] {finding.rule_code} — {finding.message}")

        elif args.command == "demo":
            from app.demo import dataset
            from app.services.quality.validator import validate

            seed_all(db)
            dataset.generate(db)
            dataset.add_search_terms(db)
            if args.with_defects:
                copied = dataset.inject_cost_copy_defect(db)
                print(f"Excel 결함 재현: 비용 복사 {copied}행")
            report = validate(db)
            print("데모 데이터 적재 완료:", report.summary())
            print("확인: python -m app.cli daily 2026-08-31")

        elif args.command == "daily":
            from app.services.reporting.daily import build, render_text

            print(render_text(build(db, _parse_date(args.as_of))))

        elif args.command == "weekly":
            import json

            from app.services.reporting.weekly import build

            print(json.dumps(build(db, _parse_date(args.week_end)).as_dict(), ensure_ascii=False, indent=2))

        elif args.command == "sync-naver":
            from app.services.naver.sync import sync_all

            for result in sync_all(db, days=args.days):
                print(
                    f"{result.account}: 캠페인 {result.campaigns} / 키워드 {result.keywords} / "
                    f"성과 {result.stat_rows}행"
                    + (f" · 오류 {result.errors}" if result.errors else "")
                )


if __name__ == "__main__":
    main()

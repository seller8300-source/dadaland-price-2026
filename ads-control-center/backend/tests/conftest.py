"""pytest 공통 설정. 테스트는 SQLite 인메모리에서 돌지만 스키마는 운영과 동일하다."""
from __future__ import annotations

import os
import sys
from pathlib import Path

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("ENVIRONMENT", "test")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app import models  # noqa: E402,F401
from app.db.base import Base  # noqa: E402
from app.db.seed import seed_all  # noqa: E402
from app.db.session import SessionLocal, engine  # noqa: E402
from app.demo import dataset as synthetic  # noqa: E402


@pytest.fixture()
def db() -> Session:
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    session = SessionLocal()
    seed_all(session)
    try:
        yield session
    finally:
        session.close()


@pytest.fixture()
def seeded_db(db: Session) -> Session:
    """§38 검증용 합성 데이터가 적재되고 품질검증까지 끝난 세션."""
    from app.services.quality.validator import validate

    synthetic.generate(db)
    synthetic.inject_cost_copy_defect(db)
    synthetic.add_search_terms(db)
    validate(db)
    return db

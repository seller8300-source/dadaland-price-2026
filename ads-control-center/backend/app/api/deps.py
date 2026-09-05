from __future__ import annotations

from datetime import date, timedelta

from app.db.session import get_db  # re-export for routes

__all__ = ["get_db", "default_period"]


def default_period(days: int = 30) -> tuple[date, date]:
    end = date.today() - timedelta(days=1)
    return end - timedelta(days=days - 1), end

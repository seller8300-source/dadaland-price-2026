"""SQLAlchemy models. Importing this package registers every table (§34)."""
from app.db.base import Base
from app.models.intelligence import (
    Alert,
    BusinessRule,
    CompetitionCluster,
    Event,
    Opportunity,
    Recommendation,
    RecommendationResult,
    SeasonIndex,
)
from app.models.metrics import (
    Conversion,
    DataQualityWarning,
    HistoricalImport,
    KeywordStatDaily,
    SalesDaily,
    SalesMonthly,
)
from app.models.structure import (
    Account,
    AdGroup,
    Campaign,
    Creative,
    Keyword,
    KeywordClassification,
    LandingPage,
    ProductCategoryRow,
    SearchTerm,
)

__all__ = [
    "Base",
    "Account",
    "Campaign",
    "AdGroup",
    "Keyword",
    "KeywordClassification",
    "ProductCategoryRow",
    "SearchTerm",
    "Creative",
    "LandingPage",
    "KeywordStatDaily",
    "Conversion",
    "SalesDaily",
    "SalesMonthly",
    "HistoricalImport",
    "DataQualityWarning",
    "BusinessRule",
    "CompetitionCluster",
    "SeasonIndex",
    "Event",
    "Opportunity",
    "Alert",
    "Recommendation",
    "RecommendationResult",
]

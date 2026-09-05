export interface Metrics {
  cost: number;
  clicks: number;
  impressions: number;
  conversions: number;
  cpc: number | null;
  ctr: number | null;
  average_rank: number | null;
  keyword_count: number;
  campaign_count: number;
}

export interface DailyReport {
  as_of: string;
  company: {
    yesterday_cost: number;
    yesterday_clicks: number;
    yesterday_cpc: number | null;
    vs_7day_avg_pct: number | null;
    month_to_date_cost: number;
    projected_month_cost: number;
    category_mix: Record<string, { cost: number; share: number; cpc: number | null; ctr: number | null }>;
    yoy: {
      cost_change_pct: number | null;
      click_change_pct: number | null;
      cpc_change_pct: number | null;
      revenue_change_pct: number | null;
      ad_cost_ratio_pct: number | null;
      explanation: string;
    };
    breakeven: {
      absolute_breakeven_revenue: number;
      contribution_margin_rate: number;
      scenarios: { target_ad_cost_ratio_pct: number; required_revenue: number }[];
    };
  };
  productivity: ProductivityRow[];
  priority_accounts: { account: string; icon: string; score: number; reasons: string[] }[];
  anomalies: {
    account: string;
    type: string;
    level: string;
    title: string;
    message: string;
  }[];
  policy_violations: {
    account: string;
    product_category: string;
    keyword: string;
    cost: number;
    date: string;
  }[];
  competition: CompetitionSummary;
  opportunities: OpportunityRow[];
  season: { product_category: string; expected_rise_date: string; days_left: number; message: string }[];
  conversion_tracking: {
    installed_accounts: number;
    total_accounts: number;
    accounts: { account: string; events: number; installed: boolean }[];
    funnel: Record<string, unknown> & { status: string };
  };
  agency_instructions: string[];
  notes: string[];
}

export interface ProductivityRow {
  account: string;
  is_growth_account: boolean;
  cost_change_pct: number | null;
  revenue_change_pct: number | null;
  profit_change_pct: number | null;
  ad_cost_ratio_after: number | null;
  verdict: string;
  verdict_text: string;
  notes: string[];
}

export interface OpportunityRow {
  keyword: string;
  type: string;
  product_category: string | null;
  confidence: number;
  estimated_cpc: number | null;
  evidence: { code: string; detail: string }[];
}

export interface CompetitionCluster {
  cluster_key: string;
  label: string;
  product_category: string;
  season_state: string;
  policy: string;
  primary_account: string | null;
  account_count: number;
  allowed_account_count: number;
  total_cost: number;
  allowed_competition_spend: number;
  reallocation_review_spend: number;
  has_conversion_data: boolean;
  accounts: { account: string; cost: number; clicks: number; cpc: number | null; ctr: number | null }[];
  reasons: string[];
}

export interface CompetitionSummary {
  cluster_count: number;
  multi_account_cluster_count: number;
  allowed_competition_spend: number;
  reallocation_review_spend: number;
  review_share_pct: number;
  top_review_clusters: CompetitionCluster[];
  clusters?: CompetitionCluster[];
}

export interface AccountBenchmark {
  account: string;
  is_growth_account: boolean;
  base: Metrics;
  comp: Metrics;
  cost_change_pct: number | null;
  click_change_pct: number | null;
  cpc_change_pct: number | null;
  ctr_change_pct: number | null;
  primary_driver: string;
  explanation: string;
  flags: string[];
  flag_texts: string[];
  notes: string[];
}

export interface BenchmarkSet {
  base_period: string[];
  comp_period: string[];
  company: {
    base: Metrics;
    comp: Metrics;
    cost_change_pct: number | null;
    click_change_pct: number | null;
    cpc_change_pct: number | null;
    explanation: string;
  };
  accounts: AccountBenchmark[];
}

export interface QualityWarning {
  id: number;
  rule: string;
  severity: string;
  scope: string;
  message: string;
  blocks_analysis: boolean;
}

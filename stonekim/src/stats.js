'use strict';
const { getDb } = require('./db');
const { toDateString } = require('./util');

/** 'YYYY-MM' (KST 기준 금월) */
function currentMonth(now = new Date()) {
  return toDateString(now).slice(0, 7);
}

function monthRange(month) {
  const [y, m] = month.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1, -9, 0, 0)).toISOString();
  const end = new Date(Date.UTC(y, m, 1, -9, 0, 0)).toISOString();
  return { start, end };
}

function one(sql, ...args) {
  return getDb().prepare(sql).get(...args);
}

/** §14 대시보드 - 금월 현황 */
function dashboard(month = currentMonth()) {
  const db = getDb();
  const { start, end } = monthRange(month);

  const shipped = one(
    "SELECT COUNT(*) AS c FROM projects WHERE substr(ship_date,1,7) = ?", month
  ).c;

  const targeted = one(
    `SELECT COUNT(DISTINCT project_id) AS c FROM messages
      WHERE message_type IN ('FIRST','SECOND','FINAL')
        AND ((sent_at >= ? AND sent_at < ?) OR (status='SCHEDULED' AND scheduled_at >= ? AND scheduled_at < ?))`,
    start, end, start, end
  ).c;

  const sentBy = (type) =>
    one(
      `SELECT COUNT(*) AS c FROM messages
        WHERE message_type = ? AND status IN ('SENT','SENT_SMS') AND sent_at >= ? AND sent_at < ?`,
      type, start, end
    ).c;

  const photoProjects = one(
    'SELECT COUNT(*) AS c FROM projects WHERE photo_submitted_at >= ? AND photo_submitted_at < ?',
    start, end
  ).c;

  const usableProjects = one(
    `SELECT COUNT(DISTINCT p.project_id) AS c FROM photos ph
       JOIN projects p ON p.project_id = ph.project_id
      WHERE ph.review_status = 'USABLE' AND p.photo_submitted_at >= ? AND p.photo_submitted_at < ?`,
    start, end
  ).c;

  const rewardPaid = one(
    "SELECT COUNT(*) AS c, COALESCE(SUM(amount),0) AS total FROM rewards WHERE status='PAID' AND paid_at >= ? AND paid_at < ?",
    start, end
  );

  const firstSentProjects = one(
    `SELECT COUNT(DISTINCT project_id) AS c FROM messages
      WHERE status IN ('SENT','SENT_SMS') AND sent_at >= ? AND sent_at < ?`,
    start, end
  ).c;

  const pendingReview = one(
    "SELECT COUNT(*) AS c FROM rewards WHERE status = 'PENDING'"
  ).c;

  const scheduledAhead = one(
    "SELECT COUNT(*) AS c FROM messages WHERE status = 'SCHEDULED'"
  ).c;

  return {
    month,
    shipped,
    targeted,
    sent_first: sentBy('FIRST'),
    sent_second: sentBy('SECOND'),
    sent_final: sentBy('FINAL'),
    photo_projects: photoProjects,
    photo_rate: firstSentProjects ? photoProjects / firstSentProjects : 0,
    usable_projects: usableProjects,
    reward_paid_count: rewardPaid.c,
    reward_paid_amount: rewardPaid.total,
    pending_review: pendingReview,
    scheduled_ahead: scheduledAhead,
  };
}

/** §27 MVP 성공 기준 지표 (누적) */
function kpi() {
  const db = getDb();
  const messages = one(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN status IN ('SENT','SENT_SMS') THEN 1 ELSE 0 END) AS delivered,
       SUM(CASE WHEN status = 'SENT' THEN 1 ELSE 0 END) AS alimtalk_ok,
       SUM(CASE WHEN status = 'SENT_SMS' THEN 1 ELSE 0 END) AS sms_fallback,
       SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) AS failed,
       SUM(CASE WHEN status = 'CANCELED_PHOTO' THEN 1 ELSE 0 END) AS canceled_photo
     FROM messages WHERE message_type IN ('FIRST','SECOND','FINAL')`
  );

  const reached = one(
    `SELECT COUNT(DISTINCT project_id) AS c FROM messages
      WHERE status IN ('SENT','SENT_SMS') AND message_type IN ('FIRST','SECOND','FINAL')`
  ).c;

  const visited = one(
    `SELECT COUNT(*) AS c FROM projects WHERE open_count > 0
       AND project_id IN (SELECT project_id FROM messages WHERE status IN ('SENT','SENT_SMS'))`
  ).c;

  const submittedTotal = one("SELECT COUNT(*) AS c FROM projects WHERE photo_submitted_at IS NOT NULL").c;
  // 등록률의 모수는 '메시지를 실제로 받은 현장' 이다 (요청 없이 등록된 건은 분자에서 제외)
  const submitted = one(
    `SELECT COUNT(*) AS c FROM projects
      WHERE photo_submitted_at IS NOT NULL
        AND project_id IN (SELECT project_id FROM messages WHERE status IN ('SENT','SENT_SMS'))`
  ).c;

  // 사진 등록을 유발한 마지막 발송 단계별 집계
  const stageRows = db
    .prepare(
      `SELECT last_type AS type, COUNT(*) AS c FROM (
         SELECT p.project_id,
                (SELECT m.message_type FROM messages m
                  WHERE m.project_id = p.project_id AND m.status IN ('SENT','SENT_SMS')
                    AND m.sent_at <= p.photo_submitted_at
                  ORDER BY m.sent_at DESC LIMIT 1) AS last_type
           FROM projects p WHERE p.photo_submitted_at IS NOT NULL
       ) GROUP BY last_type`
    )
    .all();
  const byStage = { FIRST: 0, SECOND: 0, FINAL: 0, NONE: 0 };
  for (const row of stageRows) byStage[row.type || 'NONE'] += row.c;

  const photoStats = one(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN review_status = 'USABLE' THEN 1 ELSE 0 END) AS usable,
            SUM(CASE WHEN is_best = 1 THEN 1 ELSE 0 END) AS best
       FROM photos`
  );

  const rewardStats = one(
    `SELECT COUNT(*) AS paid_count, COALESCE(SUM(amount),0) AS paid_total
       FROM rewards WHERE status = 'PAID'`
  );

  const stageSent = {
    FIRST: one("SELECT COUNT(DISTINCT project_id) AS c FROM messages WHERE message_type='FIRST' AND status IN ('SENT','SENT_SMS')").c,
    SECOND: one("SELECT COUNT(DISTINCT project_id) AS c FROM messages WHERE message_type='SECOND' AND status IN ('SENT','SENT_SMS')").c,
    FINAL: one("SELECT COUNT(DISTINCT project_id) AS c FROM messages WHERE message_type='FINAL' AND status IN ('SENT','SENT_SMS')").c,
  };

  return {
    messages_total: messages.total || 0,
    delivered: messages.delivered || 0,
    alimtalk_rate: messages.delivered ? (messages.alimtalk_ok || 0) / messages.delivered : 0,
    sms_fallback: messages.sms_fallback || 0,
    failed: messages.failed || 0,
    canceled_photo: messages.canceled_photo || 0,
    reached,
    visit_rate: reached ? visited / reached : 0,
    submitted,
    submitted_total: submittedTotal,
    submit_rate: reached ? submitted / reached : 0,
    stage: byStage,
    stage_sent: stageSent,
    avg_photos: submittedTotal ? (photoStats.total || 0) / submittedTotal : 0,
    usable_ratio: photoStats.total ? (photoStats.usable || 0) / photoStats.total : 0,
    best_count: photoStats.best || 0,
    reward_paid_count: rewardStats.paid_count || 0,
    reward_paid_total: rewardStats.paid_total || 0,
    reward_avg: rewardStats.paid_count ? (rewardStats.paid_total || 0) / rewardStats.paid_count : 0,
  };
}

module.exports = { dashboard, kpi, currentMonth, monthRange };

'use strict';
const { getDb, getSetting } = require('./db');
const { deliver } = require('./messaging');
const templates = require('./templates');
const rewardTiers = require('./reward');
const { dateStringPlusDays, isoPlusDaysAtHour, nowIso, toDateString } = require('./util');

/** 발송 단계 전이: 1차 → (+7일) 2차 → (+14일) 최종 → 종료 */
const NEXT_TYPE = { FIRST: 'SECOND', SECOND: 'FINAL', FINAL: null };
const FOLLOWUP_DAYS = { SECOND: 7, FINAL: 14 };
const SENT_STATUS = { FIRST: 'SENT_1', SECOND: 'SENT_2', FINAL: 'SENT_FINAL' };

/** 자동 발송이 더 이상 필요 없는 상태 */
const STOP_STATUSES = new Set(['PHOTO_SUBMITTED']);

function sendHour() {
  const h = Number(getSetting('send_hour_kst', '10'));
  return Number.isFinite(h) && h >= 0 && h <= 23 ? h : 10;
}

function baseUrl() {
  return (process.env.STONEKIM_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
}

function uploadUrl(token) {
  return `${baseUrl()}/project/upload/${token}`;
}

/**
 * 1차 메시지 발송 예정 시각.
 * - 시공예정일이 있으면 시공예정일 +2일
 * - 없으면 출고일 +14일
 */
function computeFirstScheduleAt(project, hour = 10) {
  if (project.installation_date) return dateStringPlusDays(project.installation_date, 2, hour);
  return dateStringPlusDays(project.ship_date, 14, hour);
}

/** 후속 메시지 발송 예정 시각 (직전 발송 시각 기준) */
function computeFollowUpAt(nextType, prevSentAtIso, hour = 10) {
  const days = FOLLOWUP_DAYS[nextType];
  if (!days) return null;
  return isoPlusDaysAtHour(prevSentAtIso, days, hour);
}

function getProject(projectId) {
  return getDb().prepare('SELECT * FROM projects WHERE project_id = ?').get(projectId);
}

function hasPhotos(projectId) {
  const row = getDb()
    .prepare('SELECT COUNT(*) AS c FROM photos WHERE project_id = ?')
    .get(projectId);
  return row.c > 0;
}

/** 해당 주문에 예약된 메시지가 있는지 */
function pendingMessage(projectId) {
  return getDb()
    .prepare("SELECT * FROM messages WHERE project_id = ? AND status = 'SCHEDULED' ORDER BY scheduled_at LIMIT 1")
    .get(projectId);
}

function insertScheduled(projectId, messageType, scheduledAt) {
  const db = getDb();
  db.prepare(
    `INSERT INTO messages (project_id, message_type, scheduled_at, status, created_at)
     VALUES (?, ?, ?, 'SCHEDULED', ?)`
  ).run(projectId, messageType, scheduledAt, nowIso());
  return db.prepare('SELECT last_insert_rowid() AS id').get().id;
}

/**
 * 1차 메시지를 예약한다. 이미 예약/발송 이력이 있거나 발송 제외·사진등록 상태면 예약하지 않는다.
 * @returns {number|null} message_id
 */
function scheduleFirstMessage(projectId) {
  const project = getProject(projectId);
  if (!project) return null;
  if (project.message_excluded) return null;
  if (STOP_STATUSES.has(project.status)) return null;

  const existing = getDb()
    .prepare("SELECT COUNT(*) AS c FROM messages WHERE project_id = ? AND message_type = 'FIRST'")
    .get(projectId);
  if (existing.c > 0) return null;

  const at = computeFirstScheduleAt(project, sendHour());
  if (!at) return null;
  return insertScheduled(projectId, 'FIRST', at);
}

/** 다음 단계 메시지 예약 (직전 발송 완료 직후 호출) */
function scheduleFollowUp(projectId, prevType, prevSentAt) {
  const nextType = NEXT_TYPE[prevType];
  if (!nextType) return null;
  const project = getProject(projectId);
  if (!project || project.message_excluded || STOP_STATUSES.has(project.status)) return null;
  const at = computeFollowUpAt(nextType, prevSentAt, sendHour());
  if (!at) return null;
  return insertScheduled(projectId, nextType, at);
}

/**
 * 예약된 자동 메시지를 모두 취소한다.
 * 사진 등록 시(CANCELED_PHOTO) 또는 관리자 중단 시(CANCELED_ADMIN) 호출.
 * @returns {number} 취소된 건수
 */
function cancelScheduled(projectId, reason = 'CANCELED_PHOTO', note = null) {
  const res = getDb()
    .prepare(
      `UPDATE messages SET status = ?, failure_reason = COALESCE(?, failure_reason)
       WHERE project_id = ? AND status = 'SCHEDULED'`
    )
    .run(reason, note, projectId);
  return res.changes;
}

/** 발송 대상 조회: 예약시각이 지났고 발송제외/사진등록이 아닌 메시지 */
function dueMessages(now = new Date()) {
  return getDb()
    .prepare(
      `SELECT m.*, p.status AS project_status, p.message_excluded, p.upload_token,
              c.phone AS phone, c.name AS customer_name
         FROM messages m
         JOIN projects  p ON p.project_id = m.project_id
         JOIN customers c ON c.customer_id = p.customer_id
        WHERE m.status = 'SCHEDULED' AND m.scheduled_at <= ?
        ORDER BY m.scheduled_at ASC`
    )
    .all(now.toISOString());
}

function markMessage(messageId, result, body, sentAt, toPhone = null) {
  getDb()
    .prepare(
      `UPDATE messages SET status = ?, channel = ?, sent_at = ?, failure_reason = ?, body = ?, provider_ref = ?,
              to_phone = COALESCE(?, to_phone)
       WHERE message_id = ?`
    )
    .run(result.status, result.channel, sentAt, result.error, body, result.ref, toPhone, messageId);
}

function setProjectStatus(projectId, status) {
  getDb()
    .prepare('UPDATE projects SET status = ?, updated_at = ? WHERE project_id = ?')
    .run(status, nowIso(), projectId);
}

/**
 * 예약 메시지 1건 발송.
 * 발송 직전에 사진 등록·발송제외 여부를 다시 확인한다 (절대 조건).
 */
async function sendScheduledMessage(row) {
  const project = getProject(row.project_id);
  if (!project) return { skipped: 'NO_PROJECT' };

  if (STOP_STATUSES.has(project.status) || hasPhotos(project.project_id)) {
    cancelScheduled(project.project_id, 'CANCELED_PHOTO', '사진 등록으로 자동 취소');
    return { skipped: 'PHOTO_SUBMITTED' };
  }
  if (project.message_excluded) {
    cancelScheduled(project.project_id, 'CANCELED_ADMIN', '발송 제외 대상');
    return { skipped: 'EXCLUDED' };
  }

  const link = uploadUrl(project.upload_token);
  const tiers = rewardTiers.current();
  const body = templates.buildBody(row.message_type, link, tiers);
  // 승인된 알림톡 템플릿의 치환변수 (템플릿 등록 시 아래 이름으로 신청한다)
  const variables = {
    '#{고객명}': row.customer_name || '고객',
    '#{토큰}': project.upload_token, // 버튼 URL 이 .../project/upload/#{토큰} 형태인 템플릿용
    '#{링크}': link,
    '#{기본리워드}': tiers.baseWords,
    '#{최대리워드}': tiers.maxWords,
  };
  const result = await deliver({ phone: row.phone, body, messageType: row.message_type, variables });
  const sentAt = nowIso();
  markMessage(row.message_id, result, body, sentAt, row.phone);

  if (result.status === 'SENT' || result.status === 'SENT_SMS') {
    const nextStatus = SENT_STATUS[row.message_type];
    if (nextStatus) setProjectStatus(project.project_id, nextStatus);
    scheduleFollowUp(project.project_id, row.message_type, sentAt);
  }
  return { sent: result.status, message_id: row.message_id };
}

/** 오늘(KST) 실제로 발송된 건수 */
function sentToday(now = new Date()) {
  const today = toDateString(now);
  const start = dateStringPlusDays(today, 0, 0);
  const end = dateStringPlusDays(today, 1, 0);
  return getDb()
    .prepare(
      `SELECT COUNT(*) AS c FROM messages
        WHERE status IN ('SENT','SENT_SMS') AND sent_at >= ? AND sent_at < ?`
    )
    .get(start, end).c;
}

/** 일일 발송 한도 (0 = 무제한). 소규모 오픈·대량발송 사고 방지용 안전장치. */
function dailyLimit() {
  const value = Number(getSetting('daily_send_limit', '0'));
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

/**
 * 예약 시각이 지난 메시지를 처리한다.
 * 일일 한도가 설정되어 있으면 남은 건수만 발송하고 나머지는 예약 상태로 남긴다.
 */
async function processDue(now = new Date()) {
  let rows = dueMessages(now);
  const limit = dailyLimit();
  if (limit) {
    const remaining = Math.max(0, limit - sentToday(now));
    if (rows.length > remaining) {
      console.log(`[scheduler] 일일 한도(${limit}건) 도달 · ${rows.length - remaining}건은 다음 처리로 미룸`);
      rows = rows.slice(0, remaining);
    }
  }
  const results = [];
  for (const row of rows) {
    try {
      results.push(await sendScheduledMessage(row));
    } catch (err) {
      markMessage(
        row.message_id,
        { status: 'FAILED', channel: null, error: `처리 오류: ${err.message}`, ref: null },
        null,
        nowIso()
      );
      results.push({ error: err.message, message_id: row.message_id });
    }
  }
  return results;
}

/** 관리자 수동 발송 (지금 1차 발송 / 지금 재발송) */
async function sendNow(projectId, messageType = 'FIRST') {
  const project = getProject(projectId);
  if (!project) return { ok: false, error: '주문을 찾을 수 없습니다.' };
  if (project.message_excluded) return { ok: false, error: '발송 제외 대상입니다.' };
  if (STOP_STATUSES.has(project.status)) return { ok: false, error: '이미 사진이 등록된 주문입니다.' };

  const customer = getDb()
    .prepare('SELECT * FROM customers WHERE customer_id = ?')
    .get(project.customer_id);

  // 예약되어 있던 동일 단계 메시지는 지금 발송으로 대체한다.
  const pending = getDb()
    .prepare("SELECT * FROM messages WHERE project_id = ? AND status = 'SCHEDULED' AND message_type = ?")
    .get(projectId, messageType);
  const messageId = pending
    ? pending.message_id
    : insertScheduled(projectId, messageType, nowIso());

  const row = {
    message_id: messageId,
    project_id: projectId,
    message_type: messageType,
    phone: customer.phone,
    customer_name: customer.name,
  };
  const res = await sendScheduledMessage(row);
  return { ok: true, ...res };
}

/** 사진 등록 시 호출: 상태 변경 + 예약 메시지 전부 취소 */
function onPhotoSubmitted(projectId) {
  setProjectStatus(projectId, 'PHOTO_SUBMITTED');
  getDb()
    .prepare('UPDATE projects SET photo_submitted_at = COALESCE(photo_submitted_at, ?), updated_at = ? WHERE project_id = ?')
    .run(nowIso(), nowIso(), projectId);
  const canceled = cancelScheduled(projectId, 'CANCELED_PHOTO', '사진 등록으로 자동 취소');
  // 리워드 검토 대기 행 생성
  getDb()
    .prepare(
      `INSERT INTO rewards (project_id, amount, status, created_at, updated_at)
       VALUES (?, 0, 'PENDING', ?, ?) ON CONFLICT(project_id) DO NOTHING`
    )
    .run(projectId, nowIso(), nowIso());
  return canceled;
}

let timer = null;

function startScheduler(intervalMs = 60000) {
  if (timer) return timer;
  const tick = async () => {
    try {
      const res = await processDue(new Date());
      const sent = res.filter((r) => r.sent).length;
      if (sent > 0) console.log(`[scheduler] ${sent}건 발송 처리`);
    } catch (err) {
      console.error('[scheduler] 오류:', err.message);
    }
  };
  timer = setInterval(tick, intervalMs);
  timer.unref?.();
  tick();
  return timer;
}

function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = {
  NEXT_TYPE,
  FOLLOWUP_DAYS,
  SENT_STATUS,
  baseUrl,
  uploadUrl,
  computeFirstScheduleAt,
  computeFollowUpAt,
  scheduleFirstMessage,
  scheduleFollowUp,
  cancelScheduled,
  dueMessages,
  pendingMessage,
  processDue,
  sendScheduledMessage,
  sendNow,
  onPhotoSubmitted,
  startScheduler,
  stopScheduler,
  sendHour,
  sentToday,
  dailyLimit,
};

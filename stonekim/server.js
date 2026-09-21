'use strict';
const nodeHttp = require('node:http');
const { getDb } = require('./src/db');
const auth = require('./src/auth');
const http = require('./src/http');
const scheduler = require('./src/scheduler');
const customerRoutes = require('./src/routes/customer');
const adminRoutes = require('./src/routes/admin');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';

async function router(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/health') return http.json(res, { ok: true, time: new Date().toISOString() });
  if (url.pathname === '/') return http.redirect(res, '/admin');
  if (url.pathname === '/favicon.ico') return http.text(res, '', 204);

  if (url.pathname.startsWith('/project/upload/')) {
    const handled = await customerRoutes.handle(req, res, url);
    if (handled !== false) return handled;
  }
  if (url.pathname.startsWith('/admin')) {
    const handled = await adminRoutes.handle(req, res, url);
    if (handled !== false) return handled;
  }
  return http.text(res, '페이지를 찾을 수 없습니다.', 404);
}

function createServer() {
  return nodeHttp.createServer((req, res) => {
    const started = Date.now();
    res.on('finish', () => {
      if (process.env.STONEKIM_QUIET) return;
      console.log(`${req.method} ${req.url.split('?')[0]} ${res.statusCode} ${Date.now() - started}ms`);
    });
    router(req, res).catch((err) => {
      console.error('[server] 처리 중 오류:', err);
      if (!res.headersSent) http.text(res, '일시적인 오류가 발생했습니다.', 500);
      else res.end();
    });
  });
}

function bootstrap() {
  getDb();
  const created = auth.ensureBootstrapUser();
  if (created) {
    console.log('─'.repeat(58));
    console.log(' 최초 관리자 계정이 생성되었습니다.');
    console.log(`   아이디   : ${created.username}`);
    console.log(`   비밀번호 : ${created.password}${created.generated ? '  (임시 · 로그인 후 변경하세요)' : ''}`);
    console.log('─'.repeat(58));
  }
  auth.purgeExpiredSessions();
}

if (require.main === module) {
  bootstrap();
  const server = createServer();
  server.listen(PORT, HOST, () => {
    console.log(`STONEKIM 시공사진 수집 시스템 · http://localhost:${PORT}/admin`);
    console.log(`업로드 링크 기준 주소: ${scheduler.baseUrl()}`);
    console.log(`발송 채널: ${require('./src/messaging').provider()}`);
  });
  const interval = Number(process.env.STONEKIM_TICK_MS || 60000);
  scheduler.startScheduler(interval);

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      console.log('\n종료 중...');
      scheduler.stopScheduler();
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 3000).unref();
    });
  }
}

module.exports = { createServer, router, bootstrap };

# STONEKIM 시공사진 수집 시스템
# 외부 의존성이 없어 npm install 단계가 필요 없다.
FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=3000 \
    STONEKIM_DATA_DIR=/data

WORKDIR /app

COPY package.json ./
COPY server.js ./
COPY src ./src
COPY scripts ./scripts

# DB·사진은 /data 에 저장한다. 배포 시 이 경로에 영구 디스크를 연결해야 한다.
RUN addgroup -S stonekim && adduser -S stonekim -G stonekim \
 && mkdir -p /data && chown -R stonekim:stonekim /data /app

USER stonekim
EXPOSE 3000
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1

CMD ["node", "server.js"]

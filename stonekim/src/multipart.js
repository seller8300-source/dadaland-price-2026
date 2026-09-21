'use strict';

/**
 * 의존성 없는 multipart/form-data 파서.
 * 요청 본문 전체를 메모리에 올리므로 호출 측에서 용량 상한을 반드시 적용한다.
 */

function boundaryOf(contentType) {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!match) return null;
  return (match[1] || match[2]).trim();
}

function parseHeaders(block) {
  const headers = {};
  for (const line of block.split('\r\n')) {
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
  }
  return headers;
}

function parseDisposition(value) {
  const out = { name: null, filename: null };
  if (!value) return out;
  const name = /name="([^"]*)"/.exec(value);
  if (name) out.name = name[1];
  const star = /filename\*=UTF-8''([^;]+)/i.exec(value);
  const plain = /filename="([^"]*)"/.exec(value);
  if (star) out.filename = decodeURIComponent(star[1]);
  else if (plain) out.filename = plain[1];
  return out;
}

/**
 * @returns {{fields: Object, files: Array<{field,filename,contentType,data}>}}
 */
function parse(buffer, contentType) {
  const boundary = boundaryOf(contentType);
  if (!boundary) throw new Error('multipart boundary 를 찾을 수 없습니다.');

  const delimiter = Buffer.from(`--${boundary}`);
  const fields = {};
  const files = [];

  let position = buffer.indexOf(delimiter);
  if (position < 0) throw new Error('잘못된 multipart 본문입니다.');

  while (position >= 0) {
    let start = position + delimiter.length;
    if (buffer.slice(start, start + 2).toString() === '--') break; // 종료 구분자
    if (buffer.slice(start, start + 2).toString() === '\r\n') start += 2;

    const headerEnd = buffer.indexOf('\r\n\r\n', start);
    if (headerEnd < 0) break;
    const headers = parseHeaders(buffer.toString('utf8', start, headerEnd));
    const bodyStart = headerEnd + 4;

    const next = buffer.indexOf(delimiter, bodyStart);
    const bodyEnd = next < 0 ? buffer.length : next - 2; // 앞의 \r\n 제거
    const body = buffer.subarray(bodyStart, Math.max(bodyStart, bodyEnd));

    const disposition = parseDisposition(headers['content-disposition']);
    if (disposition.filename !== null && disposition.filename !== undefined) {
      if (body.length > 0) {
        files.push({
          field: disposition.name,
          filename: disposition.filename,
          contentType: headers['content-type'] || 'application/octet-stream',
          data: Buffer.from(body),
        });
      }
    } else if (disposition.name) {
      const value = body.toString('utf8');
      if (fields[disposition.name] === undefined) fields[disposition.name] = value;
      else if (Array.isArray(fields[disposition.name])) fields[disposition.name].push(value);
      else fields[disposition.name] = [fields[disposition.name], value];
    }

    position = next;
  }

  return { fields, files };
}

module.exports = { parse, boundaryOf };

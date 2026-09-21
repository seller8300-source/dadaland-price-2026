'use strict';
const zlib = require('node:zlib');

/**
 * 의존성 없이 .xlsx(= ZIP + XML) 첫 번째 시트를 2차원 배열로 읽는다.
 * 서식 없는 값만 읽으므로 날짜는 엑셀 시리얼 숫자로 반환될 수 있다(util.normalizeDate 가 처리).
 */

/** ZIP 중앙 디렉터리를 읽어 { 파일명: Buffer } 로 반환 */
function unzip(buffer) {
  const EOCD_SIG = 0x06054b50;
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0 && i >= buffer.length - 66000; i--) {
    if (buffer.readUInt32LE(i) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('올바른 엑셀(zip) 파일이 아닙니다.');

  const entryCount = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const files = {};

  for (let n = 0; n < entryCount; n++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLen = buffer.readUInt16LE(offset + 28);
    const extraLen = buffer.readUInt16LE(offset + 30);
    const commentLen = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLen);
    offset += 46 + nameLen + extraLen + commentLen;

    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) continue;
    const lNameLen = buffer.readUInt16LE(localOffset + 26);
    const lExtraLen = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    const raw = buffer.subarray(dataStart, dataStart + compressedSize);
    try {
      files[name] = method === 0 ? Buffer.from(raw) : zlib.inflateRawSync(raw);
    } catch {
      // 개별 엔트리 해제 실패는 무시하고 나머지를 계속 읽는다
    }
  }
  return files;
}

function decodeEntities(text) {
  return String(text)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function parseSharedStrings(xml) {
  if (!xml) return [];
  const out = [];
  const siRe = /<si>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = siRe.exec(xml))) {
    const parts = [];
    const tRe = /<t[^>]*>([\s\S]*?)<\/t>/g;
    let t;
    while ((t = tRe.exec(m[1]))) parts.push(decodeEntities(t[1]));
    out.push(parts.join(''));
  }
  return out;
}

/** 'BC12' → 열 인덱스(0-based) */
function colIndex(ref) {
  const letters = String(ref).match(/^[A-Z]+/);
  if (!letters) return 0;
  let idx = 0;
  for (const ch of letters[0]) idx = idx * 26 + (ch.charCodeAt(0) - 64);
  return idx - 1;
}

function parseSheet(xml, shared) {
  const rows = [];
  const rowRe = /<row[^>]*>([\s\S]*?)<\/row>/g;
  let rowMatch;
  while ((rowMatch = rowRe.exec(xml))) {
    const cells = [];
    const cellRe = /<c([^>]*)\/>|<c([^>]*)>([\s\S]*?)<\/c>/g;
    let cellMatch;
    while ((cellMatch = cellRe.exec(rowMatch[1]))) {
      const attrs = cellMatch[1] || cellMatch[2] || '';
      const inner = cellMatch[3] || '';
      const refMatch = attrs.match(/r="([A-Z]+\d+)"/);
      const typeMatch = attrs.match(/t="([^"]+)"/);
      const type = typeMatch ? typeMatch[1] : 'n';
      let value = '';
      if (type === 'inlineStr') {
        const parts = [];
        const tRe = /<t[^>]*>([\s\S]*?)<\/t>/g;
        let t;
        while ((t = tRe.exec(inner))) parts.push(decodeEntities(t[1]));
        value = parts.join('');
      } else {
        const v = inner.match(/<v>([\s\S]*?)<\/v>/);
        value = v ? decodeEntities(v[1]) : '';
        if (type === 's') value = shared[Number(value)] ?? '';
      }
      const index = refMatch ? colIndex(refMatch[1]) : cells.length;
      cells[index] = value;
    }
    for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = '';
    rows.push(cells);
  }
  return rows;
}

/** 워크북의 첫 번째 시트 경로를 찾는다. */
function firstSheetPath(files) {
  const workbook = files['xl/workbook.xml'] && files['xl/workbook.xml'].toString('utf8');
  const rels = files['xl/_rels/workbook.xml.rels'] && files['xl/_rels/workbook.xml.rels'].toString('utf8');
  if (workbook && rels) {
    const sheet = workbook.match(/<sheet[^>]*r:id="([^"]+)"[^>]*\/?>/);
    if (sheet) {
      const rel = rels.match(new RegExp(`<Relationship[^>]*Id="${sheet[1]}"[^>]*Target="([^"]+)"`));
      if (rel) {
        const target = rel[1].replace(/^\/?xl\//, '').replace(/^\//, '');
        if (files[`xl/${target}`]) return `xl/${target}`;
      }
    }
  }
  const candidates = Object.keys(files).filter((f) => /^xl\/worksheets\/sheet\d+\.xml$/.test(f)).sort();
  if (!candidates.length) throw new Error('엑셀 시트를 찾을 수 없습니다.');
  return candidates[0];
}

/** @returns {string[][]} 첫 시트의 행 배열 */
function readXlsx(buffer) {
  const files = unzip(buffer);
  const shared = parseSharedStrings(
    files['xl/sharedStrings.xml'] && files['xl/sharedStrings.xml'].toString('utf8')
  );
  const sheetXml = files[firstSheetPath(files)].toString('utf8');
  return parseSheet(sheetXml, shared);
}

/** CSV/TSV 파싱 (따옴표·줄바꿈 포함 셀 지원) */
function readCsv(text) {
  const src = String(text).replace(/^﻿/, '');
  const delimiter = detectDelimiter(src);
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; }
        else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === delimiter) { row.push(cell); cell = ''; continue; }
    if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue; }
    if (ch === '\r') continue;
    cell += ch;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function detectDelimiter(text) {
  const head = text.split('\n').slice(0, 5).join('\n');
  const tabs = (head.match(/\t/g) || []).length;
  const commas = (head.match(/,/g) || []).length;
  return tabs > commas ? '\t' : ',';
}

/** 파일명/내용으로 형식을 판별해 행 배열을 반환 */
function readTable(buffer, fileName = '') {
  const isZip = buffer.length > 4 && buffer.readUInt32LE(0) === 0x04034b50;
  if (isZip || /\.xlsx?$/i.test(fileName)) {
    if (!isZip) throw new Error('지원하지 않는 엑셀 형식입니다. .xlsx 또는 CSV 로 저장해 주세요.');
    return readXlsx(buffer);
  }
  return readCsv(buffer.toString('utf8'));
}

module.exports = { readXlsx, readCsv, readTable, unzip, colIndex, decodeEntities };

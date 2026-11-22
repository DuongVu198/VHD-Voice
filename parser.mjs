// VHD Voice - Bộ phân tích tiếng Việt dựa trên quy tắc (không gọi máy chủ).
// Đây là bộ phân tích thử nghiệm: kết quả luôn cần con người xác nhận.

export function normalizeVietnamese(value = '') {
  return String(value).toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd')
    .replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();
}

const DIGITS = {khong:0, mot:1, hai:2, ba:3, bon:4, tu:4, nam:5, lam:5, sau:6, bay:7, tam:8, chin:9};
const SKIP = new Set(['la','khoang','tam','do','duoc','so','luong','chieu']);
function parseIntegerWords(words) {
  let total = 0; let working = 0; let seen = false;
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (word in DIGITS) {
      working += DIGITS[word]; seen = true;
    } else if (word === 'muoi') {
      working = (working || 1) * 10; seen = true;
    } else if (word === 'tram') {
      working = (working || 1) * 100; seen = true;
    } else if (word === 'nghin' || word === 'ngan') {
      total += (working || 1) * 1000; working = 0; seen = true;
    } else if (word === 'le' || word === 'linh' || SKIP.has(word)) {
      continue;
    } else {
      break;
    }
  }
  return seen ? total + working : null;
}

export function parseNumber(value) {
  const src = normalizeVietnamese(value).replace(/^\s*(?:khoang|tam|la)\s+/, '');
  const numeric = src.match(/^(\d+(?:[.,]\d+)?)(?:\s|$)/);
  if (numeric) {
    const n = Number(numeric[1].replace(',', '.'));
    if (/\bruoi\b/.test(src)) return n + 0.5;
    return Number.isFinite(n) ? n : null;
  }
  const tokens = src.split(/\s+/).filter(Boolean);
  if (!tokens.length) return null;
  const pointIdx = tokens.indexOf('phay');
  if (pointIdx >= 0) {
    const integer = pointIdx === 0 ? 0 : parseIntegerWords(tokens.slice(0, pointIdx));
    let fraction = '';
    for (const word of tokens.slice(pointIdx + 1)) {
      if (word in DIGITS) fraction += String(DIGITS[word]);
      else if (/^\d+$/.test(word)) fraction += word;
      else break;
    }
    return integer !== null && fraction ? Number(`${integer}.${fraction}`) : null;
  }
  const unitAt = tokens.findIndex((t) => ['met','m','cm','mm','phan','xen','ti','cay','cai','goc','bo','chiec','ruoi'].includes(t));
  const intTokens = unitAt >= 0 ? tokens.slice(0, unitAt) : tokens;
  const base = parseIntegerWords(intTokens);
  if (base === null) return null;
  return /\bruoi\b/.test(src) ? base + 0.5 : base;
}

function unitFromText(src) {
  const s = normalizeVietnamese(src);
  if (/\b(?:mm|mili\s*met|mi\s*li\s*met)\b/.test(s)) return 'mm';
  if (/\b(?:cm|centimet|xen\s*ti\s*met|phan)\b/.test(s)) return 'cm';
  if (/\b(?:m|met)\b/.test(s)) return 'm';
  return null;
}
function convertTo(value, from, target) {
  if (value === null || value === undefined) return null;
  if (!from || from === target) return value;
  const inM = from === 'cm' ? value / 100 : from === 'mm' ? value / 1000 : value;
  const converted = target === 'cm' ? inM * 100 : target === 'mm' ? inM * 1000 : inM;
  return Number(converted.toFixed(5));
}

const MEASURE_RE = /\b(duong\s*kinh|d\s*k|chieu\s*cao|cao|chieu\s*dai|dai|chieu\s*rong|rong|chieu\s*day|day|chu\s*vi|so\s*luong|s\s*l)\b/g;
function detectMeasurementSegments(original) {
  const norm = normalizeVietnamese(original);
  const matches = [...norm.matchAll(MEASURE_RE)];
  return {norm, matches, segments: matches.map((m, i) => {
    const begin = m.index + m[0].length;
    const end = i + 1 < matches.length ? matches[i+1].index : norm.length;
    return {kind:m[0].replace(/\s+/g, ''), content:norm.slice(begin,end).replace(/^\s*[:=]?\s*/, '').trim(), at:m.index};
  })};
}

function splitContinuous(text) {
  return text.replace(/\r/g,'\n')
    .split(/(?:\btiếp\s+theo\b|\btài\s+sản\s+(?:mới|tiếp\s+theo)\b|\bchuyển\s+sang\b|[;\n]+)/gi)
    .map(x => x.trim().replace(/^[,.\s]+|[,.\s]+$/g, ''))
    .filter(Boolean);
}

function nameFromText(text, meta) {
  const s = text.trim();
  const firstMeasure = meta.matches.length ? meta.matches[0].index : meta.norm.length;
  // NFD normalized string can have different code point lengths; take same-length
  // Vietnamese letters in a word-by-word prefix instead of slicing original at normalized index.
  const normPrefix = meta.norm.slice(0, firstMeasure);
  let words = s.split(/\s+/); let selected = [];
  for (const w of words) {
    if (normalizeVietnamese([...selected, w].join(' ')).length > normPrefix.length) break;
    selected.push(w);
  }
  let prefix = selected.join(' ').replace(/\s*[,.:]+$/,'').trim();
  if (!prefix) prefix = s;
  prefix = prefix.replace(/^(?:tài sản|kê khai|có|ghi|là)\s+/i, '').trim();
  // "3 cây xoài" / "ba cây xoài" -> "cây xoài"
  prefix = prefix.replace(/^\d+(?:[.,]\d+)?\s+(?=cây\b|cái\b|gốc\b)/i, '');
  prefix = prefix.replace(/^(?:một|hai|ba|bốn|năm|sáu|bảy|tám|chín|mười)(?:\s+(?:mươi|mười|lăm|mốt|hai|ba|bốn|năm|sáu|bảy|tám|chín))*\s+(?=cây\b|cái\b|gốc\b)/i, '');
  // Remove trailing count: "cây xoài 3 cây"
  prefix = prefix.replace(/\s+\d+(?:[.,]\d+)?\s*(?:cây|cái|gốc|bộ|chiếc)?\s*$/i,'');
  prefix = prefix.replace(/\s+(?:một|hai|ba|bốn|năm|sáu|bảy|tám|chín|mười)(?:\s+(?:mươi|lăm|mốt|hai|ba|bốn|năm))*\s*(?:cây|cái|gốc|bộ|chiếc)?\s*$/i,'');
  return prefix.trim() || s.slice(0, 100);
}

function takeLeadingQuantity(norm, firstMeasure) {
  const prefix = norm.slice(0, firstMeasure);
  const found = prefix.match(/(?:^|\s)(\d+(?:[.,]\d+)?)\s*(?:cay|cai|goc|bo|chiec)?\s*$/);
  if (found) return parseNumber(found[1]);
  const trailingWords = prefix.match(/(?:^|\s)((?:mot|hai|ba|bon|nam|sau|bay|tam|chin|muoi|tram|linh|le|lam|tu|nghin|ngan)(?:\s+(?:mot|hai|ba|bon|nam|sau|bay|tam|chin|muoi|tram|linh|le|lam|tu|nghin|ngan))*)\s*(?:cay|cai|goc|bo|chiec)?\s*$/);
  if (trailingWords) return parseNumber(trailingWords[1]);
  const initial = norm.match(/^(\d+(?:[.,]\d+)?|mot|hai|ba|bon|nam|sau|bay|tam|chin|muoi)\s+(?:cay|cai|goc|bo|chiec)\b/);
  return initial ? parseNumber(initial[1]) : null;
}

export function parseAsset(text, entryMode='single') {
  const raw = String(text || '').trim();
  const meta = detectMeasurementSegments(raw);
  const measurements = {};
  let quantity = takeLeadingQuantity(meta.norm, meta.matches.length ? meta.matches[0].index : meta.norm.length);
  const issues = [];
  for (const seg of meta.segments) {
    const n = parseNumber(seg.content);
    if (n === null) {issues.push(`Chưa hiểu số liệu ở mục “${seg.kind}”`); continue;}
    if (['soluong','sl'].includes(seg.kind)) {quantity = n; continue;}
    const u = unitFromText(seg.content);
    if (['duongkinh','dk'].includes(seg.kind)) measurements.diameter_cm = convertTo(n, u || 'cm', 'cm');
    else if (seg.kind === 'chuvi') measurements.circumference_cm = convertTo(n, u || 'cm', 'cm');
    else if (['cao','chieucao'].includes(seg.kind)) measurements.height_m = convertTo(n, u || 'm', 'm');
    else if (['dai','chieudai'].includes(seg.kind)) measurements.length_m = convertTo(n, u || 'm', 'm');
    else if (['rong','chieurong'].includes(seg.kind)) measurements.width_m = convertTo(n, u || 'm', 'm');
    else if (['day','chieuday'].includes(seg.kind)) measurements.thickness_cm = convertTo(n, u || 'cm', 'cm');
  }
  const name = nameFromText(raw, meta);
  const type = /^cay\b/.test(normalizeVietnamese(name)) ? 'tree' : 'other';
  if (!name) issues.push('Thiếu tên tài sản');
  if (quantity === null) issues.push('Chưa xác định số lượng');
  if (quantity !== null && quantity <= 0) issues.push('Số lượng phải lớn hơn 0');
  if (Object.values(measurements).some(v => !Number.isFinite(v) || v <= 0)) issues.push('Thông số kích thước không hợp lệ');
  if (type === 'tree' && measurements.diameter_cm != null && measurements.height_m == null) issues.push('Có đường kính nhưng thiếu chiều cao');
  if (type === 'tree' && measurements.height_m != null && measurements.diameter_cm == null && measurements.circumference_cm == null) issues.push('Có chiều cao nhưng thiếu đường kính hoặc chu vi');
  if (!meta.segments.length) issues.push('Không tìm thấy thông số theo từ khóa; hãy kiểm tra bản ghi');
  return {name,type,unit:type==='tree'?'cây':'cái',quantity,measurements,raw_text:raw,entry_mode:entryMode,review_status:'needs_review',issues};
}

export function parseSpeechInput(text, mode = 'single') {
  const src = String(text || '').trim();
  if (!src) return [];
  const chunks = mode === 'continuous' ? splitContinuous(src) : [src];
  return chunks.map(chunk => parseAsset(chunk, mode));
}

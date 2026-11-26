import { $, fabricCanvas, state, setStatus, isDarkBoardActive, withOpaqueBoardExport } from '../utils/context.js';
import { snapshot, remember, updateHint } from './history.js';
import { escapeHtml } from '../utils/escape.js';
import { authFetch } from '../utils/auth_client.js';
import { showAppToast } from '../utils/ui_feedback.js';
import { FabricText, Line, Path, Rect, Textbox } from 'https://cdn.jsdelivr.net/npm/fabric@6.7.1/+esm';

const LINE_CLUSTER_GAP_PX = 24;
let isDirectGradingBusy = false;
let lastEssayResult = null;

function showEssayFloatingPill(summaryText, isError = false) {
  const pill = $('essayBoardFloatingPill');
  const summaryEl = $('essayPillSummary');
  if (!pill || !summaryEl) return;
  summaryEl.textContent = summaryText;
  pill.dataset.state = isError ? 'error' : 'ok';
  pill.hidden = false;
}

function hideEssayFloatingPill() {
  const pill = $('essayBoardFloatingPill');
  if (pill) pill.hidden = true;
}

function cleanupOrphanQuestionBadges() {
  if (!fabricCanvas) return;
  const all = fabricCanvas.getObjects();
  const validGroupIds = new Set(
    all
      .filter((o) => ['question', 'answer_formatted'].includes(o?.meta?.dataRole))
      .map((o) => o.meta.questionGroupId)
      .filter(Boolean)
  );
  const orphans = all.filter(
    (o) => o?.meta?.dataRole === 'question_badge' && !validGroupIds.has(o.meta.linkedGroupId)
  );
  if (orphans.length > 0) {
    fabricCanvas.remove(...orphans);
  }
}

/**
 * Xóa toàn bộ lớp hiển thị kết quả chấm cũ (tích xanh, gạch chân đỏ, nút gợi ý)
 * mà giữ nguyên đề bài và nét viết của học sinh.
 */
export function clearGradingOverlays() {
  if (!fabricCanvas) return;
  const overlays = fabricCanvas
    .getObjects()
    .filter((obj) => obj?.meta?.dataRole === 'grading_overlay');
  if (overlays.length > 0) {
    fabricCanvas.remove(...overlays);
    fabricCanvas.requestRenderAll();
  }
  hideEssayFloatingPill();
}

/**
 * Kiểm tra chuỗi nhận diện OCR có phải chỉ là dấu chấm / nhiễu ký tự vô nghĩa không.
 */
function isMeaninglessStepText(rawText) {
  const s = String(rawText || '')
    .replace(/\\(?:cdot|bullet|quad|qquad|,|;|!|:|displaystyle|textstyle)\b/g, ' ')
    .replace(/[$.,;:!?'"`\-_·⋅=+<>→⇒⇔/\\()\s]/g, '')
    .trim();
  return s.length === 0;
}

const CLIENT_MATH_FN_NAMES = new Set([
  'sin', 'cos', 'tan', 'cot', 'asin', 'acos', 'atan',
  'sqrt', 'ln', 'log', 'exp', 'abs', 'pi', 'delta',
]);

function replaceLatexBraceCmd1(input, cmd, replacer) {
  let s = input;
  const needle = `\\${cmd}{`;
  let guard = 0;
  while (s.includes(needle) && guard < 24) {
    guard += 1;
    const idx = s.indexOf(needle);
    if (idx < 0) break;
    let depth = 1;
    let cursor = idx + needle.length;
    while (cursor < s.length && depth > 0) {
      if (s[cursor] === '{') depth += 1;
      else if (s[cursor] === '}') depth -= 1;
      cursor += 1;
    }
    if (depth !== 0) return null;
    const arg = s.slice(idx + needle.length, cursor - 1);
    s = s.slice(0, idx) + replacer(arg) + s.slice(cursor);
  }
  return s;
}

function replaceLatexFracCmd(input, cmd) {
  let s = input;
  const needle = `\\${cmd}{`;
  let guard = 0;
  while (s.includes(needle) && guard < 24) {
    guard += 1;
    const idx = s.indexOf(needle);
    if (idx < 0) break;
    let depth = 1;
    let c1 = idx + needle.length;
    while (c1 < s.length && depth > 0) {
      if (s[c1] === '{') depth += 1;
      else if (s[c1] === '}') depth -= 1;
      c1 += 1;
    }
    if (depth !== 0) return null;
    const num = s.slice(idx + needle.length, c1 - 1);
    while (c1 < s.length && /\s/.test(s[c1])) c1 += 1;
    if (s[c1] !== '{') return null;
    depth = 1;
    let c2 = c1 + 1;
    while (c2 < s.length && depth > 0) {
      if (s[c2] === '{') depth += 1;
      else if (s[c2] === '}') depth -= 1;
      c2 += 1;
    }
    if (depth !== 0) return null;
    const den = s.slice(c1 + 1, c2 - 1);
    s = `${s.slice(0, idx)}((${num})/(${den}))${s.slice(c2)}`;
  }
  return s;
}

function normalizeLatexExprToJs(rawExpr) {
  let s = String(rawExpr || '').trim();
  if (!s || s.length > 220) return null;
  if (/[à-ỹÀ-Ỹ]/.test(s)) return null;

  s = s
    .replace(/\$/g, '')
    .replace(/\\(?:displaystyle|textstyle|quad|qquad|,|;|!)/g, ' ')
    .replace(/\\left\s*\(/g, '(')
    .replace(/\\right\s*\)/g, ')')
    .replace(/\\left\s*\[/g, '(')
    .replace(/\\right\s*\]/g, ')')
    .replace(/\\left\s*\|([^|]+)\\right\s*\|/g, 'abs($1)');

  for (const fracCmd of ['dfrac', 'tfrac', 'frac']) {
    s = replaceLatexFracCmd(s, fracCmd);
    if (s === null) return null;
  }

  // \sqrt[n]{arg}
  s = s.replace(/\\sqrt\s*\[\s*([^\]]+)\s*\]\s*\{([^{}]+)\}/g, '(($2)**(1/($1)))');
  s = replaceLatexBraceCmd1(s, 'sqrt', (arg) => `sqrt(${arg})`);
  if (s === null) return null;

  // Lũy thừa hàm lượng giác: \sin^2 x, sin²(x), \cos^{2}(x)
  s = s.replace(
    /\\?(sin|cos|tan|cot)\s*(?:\^\s*\{?\s*(\d+)\s*\}?|([²³⁴]))\s*(\([^()]+\)|[a-zA-Z0-9]+)/gi,
    (_, fn, d1, sup, arg) => {
      const expMap = { '²': '2', '³': '3', '⁴': '4' };
      const exp = d1 || expMap[sup] || '2';
      return `((${fn.toLowerCase()}(${arg}))**${exp})`;
    }
  );
  s = s.replace(
    /\\?(sin|cos|tan|cot|ln|log|sqrt)\s+(?!\()([+-]?\d*[a-zA-Z]+(?:\^\s*\{?\d+\}?)?)/gi,
    (_, fn, arg) => `${fn.toLowerCase()}(${arg})`
  );
  s = s
    .replace(/\\(sin|cos|tan|cot|ln|log|exp|pi|Delta|delta)\b/g, (_, w) => w.toLowerCase());

  // Mũ dạng ^{...}
  let guard = 0;
  while (s.includes('^{') && guard < 24) {
    guard += 1;
    const idx = s.indexOf('^{');
    let depth = 1;
    let cur = idx + 2;
    while (cur < s.length && depth > 0) {
      if (s[cur] === '{') depth += 1;
      else if (s[cur] === '}') depth -= 1;
      cur += 1;
    }
    if (depth !== 0) return null;
    const expInner = s.slice(idx + 2, cur - 1);
    s = `${s.slice(0, idx)}**(${expInner})${s.slice(cur)}`;
  }
  s = s.replace(/_\s*\{([a-zA-Z0-9]+)\}/g, '_$1');
  s = s.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, (m) => {
    const map = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9' };
    return `**${Array.from(m).map((c) => map[c] ?? '').join('')}`;
  });
  s = s
    .replace(/\\(?:cdot|times)/g, '*')
    .replace(/[×⋅·]/g, '*')
    .replace(/\\div|÷/g, '/')
    .replace(/[−–]/g, '-')
    .replace(/\[/g, '(')
    .replace(/\]/g, ')')
    .replace(/\{/g, '(')
    .replace(/\}/g, ')')
    .replace(/\^/g, '**');

  const fnTable = [];
  s = s.replace(/\b[a-zA-Z_][a-zA-Z0-9_]*\b/g, (word) => {
    const lower = word.toLowerCase();
    if (CLIENT_MATH_FN_NAMES.has(lower)) {
      const idx = fnTable.length;
      fnTable.push(lower);
      return `__MFN${idx}__`;
    }
    if (/^[a-zA-Z]_\d+$/.test(word)) {
      const idx = fnTable.length;
      fnTable.push(lower);
      return `__MFN${idx}__`;
    }
    if (word.length === 1) return lower;
    if (word.length <= 3 && /^[abcxyzmnptuvw]+$/i.test(word)) {
      return Array.from(lower).join('*');
    }
    return '__INVALID_WORD__';
  });
  if (s.includes('__INVALID_WORD__')) return null;

  s = s.replace(/(\d)\s*([a-z(]|__MFN\d+__)/g, '$1*$2');
  s = s.replace(/(\))\s*(\d|[a-z(]|__MFN\d+__)/g, '$1*$2');
  s = s.replace(/\b([a-z])\s*(\(|__MFN\d+__)/g, '$1*$2');

  const vars = new Set();
  for (const m of s.matchAll(/\b([a-z])\b/g)) {
    if (m[1] !== 'e') vars.add(m[1]);
  }

  s = s.replace(/__MFN(\d+)__/g, (_, idxStr) => {
    const fn = fnTable[Number(idxStr)];
    if (fn === 'pi') return 'Math.PI';
    if (fn === 'delta') {
      vars.add('delta');
      return 'delta';
    }
    if (/^[a-z]_\d+$/.test(fn)) {
      vars.add(fn);
      return fn;
    }
    const fnMap = {
      sin: 'Math.sin',
      cos: 'Math.cos',
      tan: 'Math.tan',
      cot: '__cot',
      asin: 'Math.asin',
      acos: 'Math.acos',
      atan: 'Math.atan',
      sqrt: 'Math.sqrt',
      ln: 'Math.log',
      log: 'Math.log10',
      exp: 'Math.exp',
      abs: 'Math.abs',
    };
    return fnMap[fn] || fn;
  });
  s = s.replace(/\be\b/g, 'Math.E');

  // Whitelist an toàn tuyệt đối trước khi biên dịch biểu thức số học
  const strippedCheck = s
    .replace(/Math\.(?:sin|cos|tan|asin|acos|atan|sqrt|log10|log|exp|abs|PI|E)|__cot/g, '')
    .replace(/\b(?:delta|[a-z](?:_\d+)?)\b/g, '')
    .replace(/[\d.+\-*/()\s]/g, '');
  if (strippedCheck.length > 0) return null;

  try {
    const varList = Array.from(vars);
    // eslint-disable-next-line no-new-func
    const fn = new Function(
      '__cot',
      ...varList,
      `"use strict"; return (${s});`
    );
    return { fn, vars: varList };
  } catch {
    return null;
  }
}

function parseMathSideWithDerivative(rawSide) {
  const s = String(rawSide || '').trim();
  const mDeriv = s.match(/^\((.+)\)\s*'$/) || s.match(/^\\left\((.+)\\right\)\s*'$/);
  if (mDeriv) {
    const inner = normalizeLatexExprToJs(mDeriv[1]);
    if (!inner || inner.vars.length > 1) return null;
    const vName = inner.vars[0] || 'x';
    return {
      vars: inner.vars,
      isDerivative: true,
      evalAt(env) {
        if (inner.vars.length === 0) return 0;
        const x = env[vName];
        const h = 1e-4;
        const cot = (t) => 1 / Math.tan(t);
        const f = (t) => inner.fn(cot, t);
        return (-f(x + 2 * h) + 8 * f(x + h) - 8 * f(x - h) + f(x - 2 * h)) / (12 * h);
      },
    };
  }
  const parsed = normalizeLatexExprToJs(s);
  if (!parsed) return null;
  return {
    vars: parsed.vars,
    isDerivative: false,
    evalAt(env) {
      const cot = (t) => 1 / Math.tan(t);
      const args = parsed.vars.map((v) => env[v]);
      return parsed.fn(cot, ...args);
    },
  };
}

function areClientMathSidesEquivalent(lhsRaw, rhsRaw) {
  const lhs = parseMathSideWithDerivative(lhsRaw);
  const rhs = parseMathSideWithDerivative(rhsRaw);
  if (!lhs || !rhs) return null;

  const allVars = Array.from(new Set([...lhs.vars, ...rhs.vars])).sort();
  if (allVars.length === 0) {
    const v1 = lhs.evalAt({});
    const v2 = rhs.evalAt({});
    if (!Number.isFinite(v1) || !Number.isFinite(v2)) return null;
    return Math.abs(v1 - v2) <= 1e-5 * Math.max(1, Math.abs(v1), Math.abs(v2));
  }

  const bases = [1.37, 2.41, 0.73, 3.19, 1.83, -0.73, -1.89, -2.63];
  let validCount = 0;
  for (const base of bases) {
    const env = {};
    allVars.forEach((v, idx) => {
      env[v] = base + idx * 0.31;
    });
    const v1 = lhs.evalAt(env);
    const v2 = rhs.evalAt(env);
    if (!Number.isFinite(v1) || !Number.isFinite(v2)) continue;
    validCount += 1;
    const tol = 1e-4 * Math.max(1, Math.abs(v1), Math.abs(v2));
    if (Math.abs(v1 - v2) > tol) return false;
  }
  return validCount >= 3 ? true : null;
}

function findRealRoots1D(lhsParsed, rhsParsed, vName) {
  const f = (x) => lhsParsed.evalAt({ [vName]: x }) - rhsParsed.evalAt({ [vName]: x });
  const roots = [];
  const addRoot = (r) => {
    if (!Number.isFinite(r)) return;
    const lv = lhsParsed.evalAt({ [vName]: r });
    const rv = rhsParsed.evalAt({ [vName]: r });
    if (!Number.isFinite(lv) || !Number.isFinite(rv)) return;
    const tol = 1e-4 * Math.max(1, Math.abs(lv), Math.abs(rv));
    if (Math.abs(lv - rv) > tol) return;
    if (!roots.some((existing) => Math.abs(existing - r) < 1e-3)) {
      roots.push(r);
    }
  };

  const grid = [];
  for (let i = -30; i <= 30; i += 1) {
    grid.push(i);
    if (i < 30) grid.push(i + 0.5);
  }

  let prevX = null;
  let prevY = null;
  for (const x of grid) {
    const y = f(x);
    if (!Number.isFinite(y)) {
      prevX = null;
      prevY = null;
      continue;
    }
    if (Math.abs(y) <= 1e-7) addRoot(x);
    if (prevX !== null && prevY !== null && prevY * y < 0) {
      let lo = prevX;
      let hi = x;
      let flo = prevY;
      for (let it = 0; it < 36; it += 1) {
        const mid = 0.5 * (lo + hi);
        const fmid = f(mid);
        if (!Number.isFinite(fmid)) break;
        if (Math.abs(fmid) <= 1e-10) {
          lo = mid;
          hi = mid;
          break;
        }
        if (flo * fmid <= 0) {
          hi = mid;
        } else {
          lo = mid;
          flo = fmid;
        }
      }
      addRoot(0.5 * (lo + hi));
    }
    prevX = x;
    prevY = y;
  }
  return roots;
}

function stripStepPrefixClient(rawLine) {
  return String(rawLine || '')
    .trim()
    .replace(/^(?:bước\s*\d+|buoc\s*\d+|ta\s*có|suy\s*ra|vậy|vay)\s*[:.]?\s*/i, '')
    .replace(/^(?:\\Leftrightarrow|\\Rightarrow|<=>|⇔|=>|⇒|->)\s*/, '')
    .trim();
}

function splitTopLevelEqualsClient(str) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < str.length; i += 1) {
    const ch = str[i];
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1);
    else if (depth === 0 && ch === '=') {
      const prev = str[i - 1] || '';
      const next = str[i + 1] || '';
      if (prev === '<' || prev === '>' || prev === '!' || prev === '=' || next === '=' || next === '>') {
        continue;
      }
      parts.push(str.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(str.slice(start).trim());
  return parts;
}

function detectClientStepMathError(currentText, previousSteps, questionContent) {
  if (isMeaninglessStepText(currentText)) {
    return {
      error_type: 'INCOMPLETE_STEP',
      reason: 'Dòng viết chưa có biểu thức hoặc nội dung hợp lệ để chấm.',
      guidance: '💡 Gợi ý: Hãy xóa nét chấm thừa hoặc viết đầy đủ phép biến đổi tiếp theo.',
    };
  }

  const body = stripStepPrefixClient(currentText);
  if (!body) return null;

  const qRaw = String(questionContent || '').trim();
  const qClean = qRaw.replace(/^[^:]{1,40}:\s*/, '').trim();
  const qIsSolvePrompt = /giải\s+phương\s+trình|tìm\s+[a-z]|nghiệm/i.test(qRaw);

  // Tách ngữ cảnh Đề bài: Phương trình vs Biểu thức rút gọn/khai triển
  let anchorExpr = null;
  let problemEq = null;

  if (qClean) {
    const qParts = splitTopLevelEqualsClient(qClean);
    if (qParts.length === 1) {
      if (parseMathSideWithDerivative(qParts[0])) anchorExpr = qParts[0];
    } else if (qParts.length === 2) {
      const isLabelDef = !qIsSolvePrompt && /^[A-Z]$|^[fghPQMNS]\s*\(\s*[a-z]\s*\)$/i.test(qParts[0]) && !/^[xXyYzZ]$/.test(qParts[0]);
      if (isLabelDef && parseMathSideWithDerivative(qParts[1])) {
        anchorExpr = qParts[1];
      } else {
        const lP = parseMathSideWithDerivative(qParts[0]);
        const rP = parseMathSideWithDerivative(qParts[1]);
        const eqVars = lP && rP ? Array.from(new Set([...lP.vars, ...rP.vars])) : [];
        if (lP && rP && eqVars.length === 1) {
          problemEq = { lhs: lP, rhs: rP, varName: eqVars[0], roots: findRealRoots1D(lP, rP, eqVars[0]) };
        }
      }
    }
  } else if (previousSteps.length > 0) {
    const firstPrev = stripStepPrefixClient(previousSteps[0]);
    const pParts = splitTopLevelEqualsClient(firstPrev);
    if (pParts.length === 1 && parseMathSideWithDerivative(pParts[0])) {
      anchorExpr = pParts[0];
    } else if (pParts.length === 2 && pParts[0]) {
      const lP = parseMathSideWithDerivative(pParts[0]);
      const rP = parseMathSideWithDerivative(pParts[1]);
      const eqVars = lP && rP ? Array.from(new Set([...lP.vars, ...rP.vars])) : [];
      if (lP && rP && eqVars.length === 1) {
        problemEq = { lhs: lP, rhs: rP, varName: eqVars[0], roots: findRealRoots1D(lP, rP, eqVars[0]) };
      }
    }
  }

  // Trường hợp A: Dòng bắt đầu bằng '=' (VD: '= x^3 + 20x + 10')
  if (body.startsWith('=')) {
    const rhsChain = splitTopLevelEqualsClient(body.slice(1).trim()).filter(Boolean);
    if (rhsChain.length === 0) return null;
    const refExpr =
      anchorExpr ||
      (previousSteps.length > 0 ? stripStepPrefixClient(previousSteps[previousSteps.length - 1]).replace(/^=\s*/, '') : '');
    if (refExpr) {
      for (const rhsPart of rhsChain) {
        const eq = areClientMathSidesEquivalent(refExpr, rhsPart);
        if (eq === false) {
          const isBinom = /\([^()]+\)\s*(?:\^|\*\*)\s*\{?\s*[23]\s*\}?|[²³]/.test(refExpr);
          return isBinom
            ? {
                error_type: 'FORMULA_ERROR',
                reason: 'Khai triển hằng đẳng thức chưa chính xác: Bậc lũy thừa hoặc các hệ số không khớp với biểu thức đề bài.',
                guidance: '💡 Gợi ý: Kiểm tra lại hằng đẳng thức (A ± B)² = A² ± 2AB + B² (hoặc bậc 3), chú ý đúng số mũ và từng hệ số.',
              }
            : {
                error_type: 'CALCULATION_ERROR',
                reason: 'Biến đổi đại số chưa tương đương: Giá trị biểu thức sau dấu "=" không bằng biểu thức ban đầu.',
                guidance: '💡 Gợi ý: Hãy kiểm tra lại dấu, số mũ và hệ số của từng hạng tử ở dòng biến đổi này.',
              };
        }
      }
    }
    return null;
  }

  // Trường hợp B: Dòng có dấu '=' ở giữa
  const parts = splitTopLevelEqualsClient(body);
  if (parts.length >= 3) {
    for (let i = 0; i < parts.length - 1; i += 1) {
      const pA = parseMathSideWithDerivative(parts[i]);
      const pB = parseMathSideWithDerivative(parts[i + 1]);
      if (pA && pB && pA.vars.join(',') === pB.vars.join(',')) {
        if (areClientMathSidesEquivalent(parts[i], parts[i + 1]) === false) {
          return {
            error_type: 'CALCULATION_ERROR',
            reason: 'Các vế biến đổi nối tiếp trên cùng dòng không tương đương nhau.',
            guidance: '💡 Gợi ý: Kiểm tra lại phép rút gọn hoặc tính nhẩm giữa các dấu "=" trên dòng này.',
          };
        }
      }
    }
  }

  if (parts.length === 2 && parts[0] && parts[1]) {
    const [lhsStr, rhsStr] = parts;
    const lhsP = parseMathSideWithDerivative(lhsStr);
    const rhsP = parseMathSideWithDerivative(rhsStr);
    if (!lhsP || !rhsP) return null;

    const unionVars = Array.from(new Set([...lhsP.vars, ...rhsP.vars]));
    const isIdentity = areClientMathSidesEquivalent(lhsStr, rhsStr);

    if (unionVars.length === 0 && isIdentity === false) {
      return {
        error_type: 'CALCULATION_ERROR',
        reason: `Tính toán sai giá trị số học: ${lhsStr} không bằng ${rhsStr}.`,
        guidance: '💡 Gợi ý: Hãy tính lại từng phép cộng, trừ, nhân, chia hoặc lũy thừa ở dòng này.',
      };
    }

    if ((lhsP.isDerivative || rhsP.isDerivative) && isIdentity === false) {
      return {
        error_type: 'FORMULA_ERROR',
        reason: 'Áp dụng chưa đúng quy tắc tính đạo hàm.',
        guidance: '💡 Gợi ý: Kiểm tra lại bảng đạo hàm cơ bản và quy tắc nhân hệ số / dấu khi lấy đạo hàm.',
      };
    }

    if (anchorExpr && !problemEq) {
      const checkVsAnchor = areClientMathSidesEquivalent(anchorExpr, rhsStr);
      if (isIdentity === false || checkVsAnchor === false) {
        return {
          error_type: 'FORMULA_ERROR',
          reason: 'Phép khai triển hoặc rút gọn chưa tương đương với biểu thức đề bài.',
          guidance: '💡 Gợi ý: Đối chiếu lại từng số mũ và hệ số khi khai triển biểu thức.',
        };
      }
      return null;
    }

    if (problemEq && unionVars.length === 1 && unionVars[0] === problemEq.varName) {
      if (isIdentity === true) return null;
      const stepRoots = findRealRoots1D(lhsP, rhsP, problemEq.varName);
      const isRadicalEq = /sqrt|\\sqrt/.test(qClean);
      if (problemEq.roots.length > 0) {
        const preservesAnyRoot = problemEq.roots.some((r0) => {
          const lv = lhsP.evalAt({ [problemEq.varName]: r0 });
          const rv = rhsP.evalAt({ [problemEq.varName]: r0 });
          const tol = 1e-3 * Math.max(1, Math.abs(lv), Math.abs(rv));
          return Number.isFinite(lv) && Number.isFinite(rv) && Math.abs(lv - rv) <= tol;
        });
        const hasWrongRoot =
          !isRadicalEq &&
          stepRoots.some((rk) => {
            const lv0 = problemEq.lhs.evalAt({ [problemEq.varName]: rk });
            const rv0 = problemEq.rhs.evalAt({ [problemEq.varName]: rk });
            const tol0 = 1e-3 * Math.max(1, Math.abs(lv0), Math.abs(rv0));
            return !Number.isFinite(lv0) || !Number.isFinite(rv0) || Math.abs(lv0 - rv0) > tol0;
          });
        if (!preservesAnyRoot || hasWrongRoot) {
          return {
            error_type: 'CALCULATION_ERROR',
            reason: 'Phương trình biến đổi không tương đương (sai dấu chuyển vế hoặc tính nhẩm sai hệ số/nghiệm).',
            guidance: '💡 Gợi ý: Kiểm tra lại dấu khi chuyển vế và phép tính rút gọn hai vế của phương trình.',
          };
        }
      }
      return null;
    }

    if (!problemEq && isIdentity === false) {
      const looksLikeIdentityAttempt =
        unionVars.length >= 2 ||
        /\([^()]+\)\s*(?:\^|\*\*)\s*\{?\s*[234]\s*\}?|[²³⁴]/.test(lhsStr) ||
        /\)\s*\(/.test(lhsStr) ||
        /sin|cos|tan|cot|sqrt|ln|log/i.test(body);
      if (looksLikeIdentityAttempt && rhsStr !== '0' && rhsP.vars.length > 0) {
        return {
          error_type: 'FORMULA_ERROR',
          reason: 'Hai vế của đẳng thức không bằng nhau với mọi giá trị của biến.',
          guidance: '💡 Gợi ý: Kiểm tra lại hằng đẳng thức hoặc công thức biến đổi ở dòng này.',
        };
      }
    }
  }
  return null;
}

/**
 * Lớp bảo vệ kiểm chứng toán học đồng bộ ở phía Client: đảm bảo ngay cả khi máy chủ Cloud
 * đang khởi động lại hoặc chưa kịp cập nhật, đáp án sai tuyệt đối không bao giờ bị chấm đúng (✓).
 */
function verifyEssaySolutionClientSide(gradeData, { questionContent = '', steps = [] } = {}) {
  if (!gradeData || !Array.isArray(gradeData.steps_evaluation)) return gradeData;

  let effectiveQ = String(questionContent || '').trim();
  let effectiveSteps = Array.isArray(steps) && steps.length > 0
    ? steps.slice()
    : gradeData.steps_evaluation.map((e) => e.written_text || '');

  if (!effectiveQ && effectiveSteps.length > gradeData.steps_evaluation.length) {
    effectiveQ = effectiveSteps[0];
    effectiveSteps = effectiveSteps.slice(1);
  }

  let mutated = false;
  const prevAccum = [];

  const updatedEvals = gradeData.steps_evaluation.map((ev, idx) => {
    const stepText = effectiveSteps[idx] ?? ev.written_text ?? '';
    if (!ev.is_step_correct) {
      prevAccum.push(stepText);
      return ev;
    }
    const localErr = detectClientStepMathError(stepText, prevAccum, effectiveQ);
    prevAccum.push(stepText);
    if (!localErr) return ev;

    mutated = true;
    return {
      ...ev,
      is_step_correct: false,
      status: 'INCORRECT',
      icon: '✕',
      badge_color: '#dc2626',
      decoration_type: 'RED_UNDERLINE',
      has_math_error: true,
      error_type: localErr.error_type,
      feedback: `⚠️ Dòng ${ev.step_number || idx + 1} phát hiện lỗi: ${localErr.reason}`,
      guidance: localErr.guidance,
      no_leak_guarantee: true,
    };
  });

  if (!mutated) return gradeData;

  const correctCount = updatedEvals.filter((e) => e.is_step_correct).length;
  const incorrectCount = updatedEvals.length - correctCount;
  const firstErrObj = updatedEvals.find((e) => !e.is_step_correct);
  const firstErrStep = firstErrObj ? firstErrObj.step_number : 1;

  return {
    ...gradeData,
    steps_evaluation: updatedEvals,
    correct_steps: correctCount,
    incorrect_steps: incorrectCount,
    has_any_error: incorrectCount > 0,
    first_error_step: firstErrStep,
    score: updatedEvals.length > 0 ? Math.max(0, Math.round((correctCount / updatedEvals.length) * 100) / 10) : 0,
    overall_feedback: `Bài giải có ${incorrectCount} bước cần lưu ý. Hãy xem gợi ý gạch chân đỏ tại dòng ${firstErrStep} để chỉnh sửa mà không cần xem đáp án cuối.`,
  };
}

/**
 * Gom các nét viết tay (Path) thành từng dòng độc lập theo trục dọc Y
 * và loại bỏ các chấm nhiễu vô tình (specks < 10x10px đứng cô lập).
 */
function clusterStrokesIntoLines(strokeObjects) {
  if (!strokeObjects.length) return [];

  const items = strokeObjects
    .map((obj) => ({ obj, bbox: obj.getBoundingRect() }))
    .filter((it) => it.bbox && Number.isFinite(it.bbox.left))
    .sort((a, b) => a.bbox.top - b.bbox.top);

  const lines = [];
  for (const item of items) {
    const lastLine = lines[lines.length - 1];
    if (!lastLine) {
      lines.push({ objects: [item.obj], bbox: { ...item.bbox } });
      continue;
    }

    const lastBottom = lastLine.bbox.top + lastLine.bbox.height;
    const verticalGap = item.bbox.top - lastBottom;

    if (verticalGap <= LINE_CLUSTER_GAP_PX) {
      lastLine.objects.push(item.obj);
      const minLeft = Math.min(lastLine.bbox.left, item.bbox.left);
      const minTop = Math.min(lastLine.bbox.top, item.bbox.top);
      const maxRight = Math.max(
        lastLine.bbox.left + lastLine.bbox.width,
        item.bbox.left + item.bbox.width
      );
      const maxBottom = Math.max(lastBottom, item.bbox.top + item.bbox.height);
      lastLine.bbox = {
        left: minLeft,
        top: minTop,
        width: maxRight - minLeft,
        height: maxBottom - minTop,
      };
    } else {
      lines.push({ objects: [item.obj], bbox: { ...item.bbox } });
    }
  }

  return lines.filter((line) => !(line.objects.length <= 2 && line.bbox.width < 10 && line.bbox.height < 10));
}

/**
 * Chụp riêng vùng 1 dòng nét viết tay theo tọa độ World trên Infinite Canvas
 * và gọi /api/v1/recognize để đọc nội dung chính xác ở mọi mức zoom/pan.
 */
async function recognizeLineCluster(clusterObjects, lineBbox, subject) {
  const pad = 16;
  const allObjects = fabricCanvas.getObjects();
  const targetSet = new Set(clusterObjects);
  const prevVisibility = new Map();
  const prevBg = fabricCanvas.backgroundColor;
  const prevVpt = (fabricCanvas.viewportTransform || [1, 0, 0, 1, 0, 0]).slice();
  let imageBase64 = '';

  try {
    for (const obj of allObjects) {
      if (!targetSet.has(obj)) {
        prevVisibility.set(obj, obj.visible);
        obj.visible = false;
      }
    }
    fabricCanvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
    fabricCanvas.backgroundColor = isDarkBoardActive() ? '#191816' : '#FFFFFF';
    fabricCanvas.renderAll();
    const cropOpts = {
      left: Math.floor(lineBbox.left - pad),
      top: Math.floor(lineBbox.top - pad),
      width: Math.max(24, Math.ceil(lineBbox.width + pad * 2)),
      height: Math.max(24, Math.ceil(lineBbox.height + pad * 2)),
      multiplier: 1,
    };
    const webpUrl = fabricCanvas.toDataURL({ format: 'webp', quality: 0.85, ...cropOpts });
    imageBase64 =
      typeof webpUrl === 'string' && webpUrl.startsWith('data:image/webp')
        ? webpUrl
        : fabricCanvas.toDataURL({ format: 'png', ...cropOpts });
  } finally {
    for (const [obj, vis] of prevVisibility.entries()) {
      obj.visible = vis;
    }
    fabricCanvas.backgroundColor = prevBg || '';
    fabricCanvas.setViewportTransform(prevVpt);
    fabricCanvas.renderAll();
  }

  const res = await authFetch('/api/v1/recognize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_id: $('sessionId')?.textContent?.trim() || 'session-10a1',
      room_id: $('roomId')?.textContent?.trim() || 'room-10a1',
      subject: subject || 'TOAN',
      page_number: (state.pageIndex || 0) + 1,
      image_base64: imageBase64,
      provider: 'auto',
      already_cropped: true,
      fast_mode: true,
    }),
  });

  if (!res.ok) {
    throw new Error(`Lỗi OCR dòng bài làm (HTTP ${res.status})`);
  }
  const data = await res.json();
  if (data?.subject_details?.status === 'error') {
    throw new Error(data.explanation || 'AI tạm thời gián đoạn khi đọc dòng viết tay');
  }
  return String(data.recognized_text || data.latex || '').trim();
}

/**
 * Vẽ dấu tích xanh (✓) hoặc gạch chân đỏ đất + nút gợi ý (✕ Gợi ý) trực tiếp lên dòng bài làm.
 */
function clearGradingOverlaysForQuestion(questionGroupId) {
  if (!fabricCanvas || !questionGroupId) return;
  const overlays = fabricCanvas
    .getObjects()
    .filter(
      (obj) =>
        obj?.meta?.dataRole === 'grading_overlay' &&
        obj?.meta?.gradedQuestionId === questionGroupId
    );
  if (overlays.length > 0) {
    fabricCanvas.remove(...overlays);
  }
}

function renderOnBoardStepOverlay(stepEval, bbox, questionGroupId = '', stepOwnerId = '') {
  const isCorrect = Boolean(stepEval.is_step_correct);
  const isDark = isDarkBoardActive();
  const rightX = bbox.left + bbox.width + 16;
  const centerY = bbox.top + bbox.height / 2 - 12;

  if (isCorrect) {
    const checkObj = new FabricText('✓', {
      left: rightX,
      top: centerY,
      fontSize: 26,
      fontWeight: 'bold',
      fontFamily: 'Be Vietnam Pro, sans-serif',
      fill: isDark ? '#78A87B' : '#3D6940',
      selectable: false,
      evented: false,
      objectCaching: false,
    });
    checkObj.meta = {
      dataRole: 'grading_overlay',
      gradedQuestionId: questionGroupId,
      linkedStepOwnerId: stepOwnerId || undefined,
      stepNumber: stepEval.step_number,
    };
    fabricCanvas.add(checkObj);
    return;
  }

  const errStroke = isDark ? '#E07A68' : '#9E3B2B';
  const underlineY = bbox.top + bbox.height + 5;
  const redLine = new Line([bbox.left, underlineY, bbox.left + bbox.width, underlineY], {
    stroke: errStroke,
    strokeWidth: 3,
    strokeDashArray: [8, 4],
    selectable: false,
    evented: false,
    objectCaching: false,
  });
  redLine.meta = {
    dataRole: 'grading_overlay',
    gradedQuestionId: questionGroupId,
    linkedStepOwnerId: stepOwnerId || undefined,
    stepNumber: stepEval.step_number,
  };

  const hintObj = new FabricText(' ✕ Gợi ý ', {
    left: rightX,
    top: centerY + 2,
    fontSize: 13,
    fontWeight: '700',
    fontFamily: 'Be Vietnam Pro, sans-serif',
    fill: '#FAF8F4',
    backgroundColor: '#9E3B2B',
    selectable: false,
    evented: false,
    objectCaching: false,
  });
  hintObj.meta = {
    dataRole: 'grading_overlay',
    gradedQuestionId: questionGroupId,
    linkedStepOwnerId: stepOwnerId || undefined,
    isHintTrigger: true,
    stepNumber: stepEval.step_number,
    feedback: stepEval.feedback || '',
    guidance: stepEval.guidance || 'Hãy kiểm tra lại phép biến đổi ở dòng này.',
  };

  fabricCanvas.add(redLine, hintObj);
}

/**
 * Chuyển đổi vai trò của 1 khối đã dán giữa [ĐỀ BÀI] và [BƯỚC GIẢI] khi chạm vào badge.
 */
function toggleQuestionBadgeRole(badgeObj) {
  const linkedId = badgeObj?.meta?.linkedGroupId;
  if (!linkedId) return;

  const targetObj = fabricCanvas
    .getObjects()
    .find(
      (obj) =>
        obj?.meta?.questionGroupId === linkedId &&
        ['question', 'answer_formatted'].includes(obj?.meta?.dataRole)
    );
  if (!targetObj) return;

  const before = snapshot();
  const nextIsQuestion = targetObj.meta.dataRole !== 'question';
  targetObj.meta.dataRole = nextIsQuestion ? 'question' : 'answer_formatted';
  badgeObj.set({
    text: nextIsQuestion ? ' ĐỀ BÀI ' : ' BƯỚC GIẢI ',
    backgroundColor: nextIsQuestion ? '#9C3F23' : '#3D6940',
  });
  fabricCanvas.requestRenderAll();
  remember(before);
  setStatus(
    nextIsQuestion
      ? `Đã đặt "${targetObj.meta.rawLatex}" làm ĐỀ BÀI`
      : `Đã chuyển "${targetObj.meta.rawLatex}" thành BƯỚC GIẢI`
  );
}

/**
 * Gán đối tượng bài làm (Path hoặc answer_formatted) về đúng câu hỏi tự luận theo không gian 2D:
 * - Ưu tiên 1: Khóa cứng theo khung nét đứt answer_zone (hoặc linkedQuestionGroupId đã gắn sẵn).
 * - Ưu tiên 2: So khớp 2D (nằm bên dưới đề bài và cùng cột ngang X), tuyệt đối không gom nhầm giữa các câu.
 */
function assignObjectsToQuestions2D(questions, zones, candidateObjects) {
  const bucketMap = new Map();
  questions.forEach((q, idx) => {
    const qId = q.obj.meta.questionGroupId || `board_q_${idx + 1}`;
    bucketMap.set(qId, []);
  });

  for (const obj of candidateObjects) {
    const m = obj?.meta || {};
    if (
      m.dataRole === 'question' ||
      m.dataRole === 'answer_zone' ||
      m.dataRole === 'answer_zone_label' ||
      m.type === 'answer_option' ||
      m.type === 'quiz_option_target' ||
      m.type === 'quiz_feedback_mark' ||
      m.examDivider ||
      m.examExplanation ||
      m.quizCardManaged
    ) {
      continue;
    }

    if (m.linkedQuestionGroupId && bucketMap.has(m.linkedQuestionGroupId)) {
      bucketMap.get(m.linkedQuestionGroupId).push(obj);
      continue;
    }

    const b = obj.getBoundingRect();
    if (!b) continue;
    const cx = b.left + b.width / 2;
    const cy = b.top + b.height / 2;

    // Ưu tiên 1: Tâm nét viết / công thức nằm trong khung answer_zone của câu nào thì khóa chặt vào câu đó
    const matchedZone = zones.find(
      (z) =>
        cx >= z.bbox.left - 8 &&
        cx <= z.bbox.left + z.bbox.width + 8 &&
        cy >= z.bbox.top - 8 &&
        cy <= z.bbox.top + z.bbox.height + 8 &&
        bucketMap.has(z.groupId)
    );
    if (matchedZone) {
      bucketMap.get(matchedZone.groupId).push(obj);
      continue;
    }

    // Ưu tiên 2: So khớp 2D cho đề viết tay tự do không có khung answer_zone
    const aboveQuestions = questions.filter((q) => q.bbox.top + q.bbox.height - 10 <= cy);
    if (aboveQuestions.length === 0) continue;

    const sameColumnQuestions = aboveQuestions.filter((q) => {
      const colLeft = q.bbox.left - 85;
      const colRight = q.bbox.left + Math.max(240, q.bbox.width) + 220;
      return cx >= colLeft && cx <= colRight;
    });

    const pool = sameColumnQuestions.length > 0 ? sameColumnQuestions : aboveQuestions;
    let bestQ = pool[0];
    let bestDist = Infinity;
    for (const q of pool) {
      const dy = cy - (q.bbox.top + q.bbox.height);
      const qCenterX = q.bbox.left + Math.max(140, q.bbox.width) / 2;
      const dxPenalty = sameColumnQuestions.length > 0 ? Math.abs(cx - qCenterX) * 0.15 : Math.abs(cx - qCenterX) * 0.6;
      const score = dy + dxPenalty;
      if (score < bestDist) {
        bestDist = score;
        bestQ = q;
      }
    }

    const chosenId = bestQ.obj.meta.questionGroupId;
    if (chosenId && bucketMap.has(chosenId)) {
      bucketMap.get(chosenId).push(obj);
    }
  }

  return bucketMap;
}

/**
 * LUỒNG CHÍNH 1-CLICK: Chấm tự luận trực tiếp trên mặt bảng (hỗ trợ cả khối [ĐỀ BÀI] đã gắn nhãn
 * lẫn bài viết tay tự do nhiều dòng trực tiếp trên bảng).
 */
export async function gradeEssayDirectlyOnBoard() {
  if (!fabricCanvas || state.ended || isDirectGradingBusy) return null;

  const subject = $('subjectSelect')?.value || $('essaySubjectSelect')?.value || 'TOAN';
  cleanupOrphanQuestionBadges();

  const allObjects = fabricCanvas
    .getObjects()
    .filter((obj) => !['grading_overlay', 'question_badge'].includes(obj?.meta?.dataRole));

  const questions = allObjects
    .filter((obj) => obj?.meta?.dataRole === 'question' && obj?.meta?.questionType !== 'MCQ')
    .map((obj, idx) => {
      if (!obj.meta.questionGroupId) {
        obj.meta.questionGroupId = obj.meta.question_id || `board_q_${idx + 1}`;
      }
      return { obj, bbox: obj.getBoundingRect() };
    })
    .sort((a, b) => a.bbox.top - b.bbox.top);

  const answerZones = allObjects
    .filter((obj) => obj?.meta?.dataRole === 'answer_zone' && obj?.meta?.linkedGroupId)
    .map((obj) => ({ obj, groupId: obj.meta.linkedGroupId, bbox: obj.getBoundingRect() }));

  const freehandLines =
    questions.length === 0
      ? clusterStrokesIntoLines(
          allObjects.filter((obj) => obj instanceof Path && obj?.meta?.aiState !== 'graded')
        )
      : [];

  if (questions.length === 0 && freehandLines.length < 2) {
    return { noQuestionOnBoard: true };
  }

  isDirectGradingBusy = true;
  const gradeBtn = $('gradeEssayBtn');
  if (gradeBtn) gradeBtn.disabled = true;
  showEssayFloatingPill('Đang quét & chấm từng dòng mới trên bảng...', false);
  setStatus('AI đang chấm trực tiếp từng dòng bài làm trên bảng...');

  const before = snapshot();
  let totalCheckedSteps = 0;
  let totalErrors = 0;
  let skippedGradedQuestions = 0;

  try {
    if (questions.length > 0) {
      const assignedBuckets = assignObjectsToQuestions2D(questions, answerZones, allObjects);
      const anyQuestionHasUngradedWork = questions.some((qItem, qIdx) => {
        const gId = qItem.obj.meta.questionGroupId || `board_q_${qIdx + 1}`;
        const rObjs = assignedBuckets.get(gId) || [];
        const newRaw = rObjs.some((obj) => obj instanceof Path && obj?.meta?.aiState !== 'graded');
        const newFmt = rObjs.some(
          (obj) => obj?.meta?.dataRole === 'answer_formatted' && obj?.meta?.aiState !== 'graded'
        );
        return qItem.obj?.meta?.aiState !== 'graded' || newRaw || newFmt;
      });
      const forceRegradeAll = !anyQuestionHasUngradedWork;
      if (forceRegradeAll) {
        clearGradingOverlays();
      }

      for (let i = 0; i < questions.length; i += 1) {
        const q = questions[i];
        const qGroupId = q.obj.meta.questionGroupId || `board_q_${i + 1}`;
        const regionObjects = assignedBuckets.get(qGroupId) || [];

        const hasNewRawStrokes = regionObjects.some(
          (obj) => obj instanceof Path && obj?.meta?.aiState !== 'graded'
        );
        const hasNewFormattedSteps = regionObjects.some(
          (obj) => obj?.meta?.dataRole === 'answer_formatted' && obj?.meta?.aiState !== 'graded'
        );
        if (!forceRegradeAll && q.obj?.meta?.aiState === 'graded' && !hasNewRawStrokes && !hasNewFormattedSteps) {
          skippedGradedQuestions += 1;
          continue;
        }

        clearGradingOverlaysForQuestion(qGroupId);

        const formattedSteps = regionObjects
          .filter((obj) => obj?.meta?.dataRole === 'answer_formatted')
          .map((obj) => {
            const ownerId =
              obj.meta.stepOwnerId ||
              obj.meta.questionGroupId ||
              `step_fmt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
            obj.meta.stepOwnerId = ownerId;
            return {
              writtenText: String(obj.meta.rawLatex || '').trim(),
              bbox: obj.getBoundingRect(),
              sourceObjects: [obj],
              stepOwnerId: ownerId,
            };
          });

        const rawStrokes = regionObjects.filter((obj) => obj instanceof Path);
        const lineClusters = clusterStrokesIntoLines(rawStrokes);
        const ocrSteps = await Promise.all(
          lineClusters.map(async (cluster) => {
            const cachedText =
              cluster.objects.every((o) => o?.meta?.aiState === 'graded' && o?.meta?.recognizedText) &&
              cluster.objects[0]?.meta?.recognizedText;
            const writtenText = cachedText
              ? String(cachedText)
              : await recognizeLineCluster(cluster.objects, cluster.bbox, subject);
            const firstStroke = cluster.objects[0];
            const ownerId =
              firstStroke?.meta?.stepOwnerId ||
              firstStroke?.meta?.strokeId ||
              `step_raw_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
            return {
              writtenText,
              bbox: cluster.bbox,
              sourceObjects: cluster.objects,
              stepOwnerId: ownerId,
            };
          })
        );

        const orderedSteps = [...formattedSteps, ...ocrSteps]
          .filter((s) => s.writtenText.length > 0 && !isMeaninglessStepText(s.writtenText))
          .sort((a, b) => a.bbox.top - b.bbox.top);

        if (orderedSteps.length === 0) continue;

        const questionText = q.obj.meta.rawLatex || q.obj.meta.rawQuestionText || '';
        const stepTexts = orderedSteps.map((s) => s.writtenText);

        const resp = await authFetch('/api/v1/exam/grade-essay-solution', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            question_id: qGroupId,
            question_content: questionText,
            subject,
            steps: stepTexts,
          }),
        });

        if (!resp.ok) {
          const errBody = await resp.json().catch(() => ({}));
          throw new Error(errBody.detail || `Lỗi chấm bài (HTTP ${resp.status})`);
        }

        const gradeData = verifyEssaySolutionClientSide(await resp.json(), {
          questionContent: questionText,
          steps: stepTexts,
        });
        const evaluations = Array.isArray(gradeData.steps_evaluation)
          ? gradeData.steps_evaluation
          : [];

        evaluations.forEach((stepEval, idx) => {
          const targetLine = orderedSteps[idx];
          if (targetLine) {
            renderOnBoardStepOverlay(stepEval, targetLine.bbox, qGroupId, targetLine.stepOwnerId);
            totalCheckedSteps += 1;
            if (!stepEval.is_step_correct) totalErrors += 1;
            targetLine.sourceObjects.forEach((srcObj) => {
              srcObj.meta = {
                ...(srcObj.meta || {}),
                aiState: 'graded',
                gradedQuestionId: qGroupId,
                stepOwnerId: targetLine.stepOwnerId,
                recognizedText: targetLine.writtenText,
              };
            });
          }
        });
        q.obj.meta = { ...(q.obj.meta || {}), aiState: 'graded' };
      }
    } else {
      const freehandId = `board_freehand_${Date.now()}`;
      const ocrLines = await Promise.all(
        freehandLines.map(async (cluster) => {
          const firstStroke = cluster.objects[0];
          const ownerId =
            firstStroke?.meta?.stepOwnerId ||
            firstStroke?.meta?.strokeId ||
            `step_fh_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
          return {
            writtenText: await recognizeLineCluster(cluster.objects, cluster.bbox, subject),
            bbox: cluster.bbox,
            sourceObjects: cluster.objects,
            stepOwnerId: ownerId,
          };
        })
      );
      const validLines = ocrLines.filter(
        (l) => l.writtenText.length > 0 && !isMeaninglessStepText(l.writtenText)
      );
      if (validLines.length >= 2) {
        const problemLine = validLines[0];
        const answerLines = validLines.slice(1);
        const answerTexts = answerLines.map((s) => s.writtenText);
        const resp = await authFetch('/api/v1/exam/grade-essay-solution', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            question_id: freehandId,
            question_content: problemLine.writtenText,
            subject,
            steps: answerTexts,
          }),
        });
        if (!resp.ok) {
          const errBody = await resp.json().catch(() => ({}));
          throw new Error(errBody.detail || `Lỗi chấm bài (HTTP ${resp.status})`);
        }
        const gradeData = verifyEssaySolutionClientSide(await resp.json(), {
          questionContent: problemLine.writtenText,
          steps: answerTexts,
        });
        const evaluations = Array.isArray(gradeData.steps_evaluation)
          ? gradeData.steps_evaluation
          : [];
        problemLine.sourceObjects.forEach((srcObj) => {
          srcObj.meta = { ...(srcObj.meta || {}), aiState: 'graded', gradedQuestionId: freehandId };
        });
        evaluations.forEach((stepEval, idx) => {
          const targetLine = answerLines[idx];
          if (targetLine) {
            renderOnBoardStepOverlay(stepEval, targetLine.bbox, freehandId, targetLine.stepOwnerId);
            totalCheckedSteps += 1;
            if (!stepEval.is_step_correct) totalErrors += 1;
            targetLine.sourceObjects.forEach((srcObj) => {
              srcObj.meta = {
                ...(srcObj.meta || {}),
                aiState: 'graded',
                gradedQuestionId: freehandId,
                stepOwnerId: targetLine.stepOwnerId,
                recognizedText: targetLine.writtenText,
              };
            });
          }
        });
      }
    }

    fabricCanvas.requestRenderAll();
    updateHint();
    remember(before);

    if (totalCheckedSteps === 0 && skippedGradedQuestions > 0) {
      showEssayFloatingPill('Tất cả các câu trên bảng đã được chấm xong. Hãy viết câu mới để chấm tiếp.', false);
      setStatus('Các câu trên bảng đã chấm xong.');
    } else if (totalCheckedSteps === 0) {
      showEssayFloatingPill('Chưa thấy dòng bài làm nào bên dưới đề bài.', true);
      setStatus('Chưa phát hiện dòng bài làm nào bên dưới khối ĐỀ BÀI.');
    } else if (totalErrors === 0) {
      showEssayFloatingPill(`✓ Đúng hoàn toàn ${totalCheckedSteps}/${totalCheckedSteps} bước mới!`, false);
      setStatus(`✓ Đã chấm trực tiếp ${totalCheckedSteps} bước trên bảng: Đúng hoàn toàn!`);
    } else {
      showEssayFloatingPill(
        `Chấm xong ${totalCheckedSteps} bước: ${totalErrors} dòng cần sửa (chạm ✕ Gợi ý để xem)`,
        true
      );
      setStatus(`Đã chấm ${totalCheckedSteps} bước: phát hiện ${totalErrors} dòng cần sửa.`);
    }

    return { totalCheckedSteps, totalErrors };
  } catch (err) {
    showEssayFloatingPill(`Lỗi chấm trên bảng: ${err.message}`, true);
    setStatus(`Lỗi chấm tự luận trên bảng: ${err.message}`);
    return null;
  } finally {
    isDirectGradingBusy = false;
    if (gradeBtn) gradeBtn.disabled = false;
  }
}

const ESSAY_SAMPLES = {
  SAMPLE_HANG_DANG_THUC: [
    'Bước 1: Khai triển biểu thức (x + 2)^2',
    'Bước 2: (x + 2)^2 = x^2 + 4',
    'Bước 3: Thu gọn các số hạng đồng dạng',
  ].join('\n'),

  SAMPLE_CHUYEN_VE: [
    'Bước 1: Phương trình 2x - 6 = 0',
    'Bước 2: 2x = -6',
    'Bước 3: x = -3',
  ].join('\n'),

  SAMPLE_DAO_HAM: [
    'Bước 1: Cho hàm số y = sin(x) + 2x',
    "Bước 2: y' = (sin x)' = -cos x",
    'Bước 3: Kết luận hệ số góc tiếp tuyến',
  ].join('\n'),

  SAMPLE_HOAN_HAO: [
    'Bước 1: Xét phương trình 3x - 9 = 0',
    'Bước 2: Chuyển vế số hạng tự do: 3x = 9',
    'Bước 3: Chia cả hai vế cho 3: x = 3',
  ].join('\n'),
};

export function setupEssayGradingManager() {
  const gradeEssayBtn = $('gradeEssayBtn');
  const essayGradingDialog = $('essayGradingDialog');
  const closeEssayDialogBtn = $('closeEssayDialogBtn');
  const closeEssayDialogXBtn = $('closeEssayDialogXBtn');

  const essaySubjectSelect = $('essaySubjectSelect');
  const essayInputLines = $('essayInputLines');
  const evaluateEssayStepsBtn = $('evaluateEssayStepsBtn');
  const annotateEssayToCanvasBtn = $('annotateEssayToCanvasBtn');
  const scanCanvasForEssayBtn = $('scanCanvasForEssayBtn');

  const essayResultSection = $('essayResultSection');
  const metricTotalSteps = $('metricTotalSteps');
  const metricCorrectSteps = $('metricCorrectSteps');
  const metricWrongSteps = $('metricWrongSteps');
  const metricScore = $('metricScore');
  const essayOverallFeedback = $('essayOverallFeedback');
  const essayStepsList = $('essayStepsList');
  const essayDialogStatus = $('essayDialogStatus');

  if (!essayGradingDialog) return;

  function showStatus(text, isError = false) {
    if (!essayDialogStatus) return;
    essayDialogStatus.textContent = text;
    essayDialogStatus.hidden = !text;
    essayDialogStatus.style.color = isError ? '#dc2626' : '#16a34a';
  }

  // Quét trực tiếp nét vẽ từ Canvas vào bài giải tự luận
  if (scanCanvasForEssayBtn) {
    scanCanvasForEssayBtn.addEventListener('click', async () => {
      if (!fabricCanvas || fabricCanvas.getObjects().length === 0) {
        showStatus('Mặt bảng vẽ hiện đang trống. Hãy viết đề bài và các bước giải lên bảng trước!', true);
        return;
      }

      scanCanvasForEssayBtn.disabled = true;
      scanCanvasForEssayBtn.textContent = 'Đang quét nét vẽ...';
      showStatus('AI đang quét và bóc tách các dòng viết tay trên bảng vẽ...');

      try {
        const imageBase64 = withOpaqueBoardExport(() =>
          fabricCanvas.toDataURL({ format: 'png', multiplier: 1.5 })
        );
        const currentSubject = essaySubjectSelect ? essaySubjectSelect.value : (state.subject || 'TOAN');

        const res = await authFetch('/api/v1/recognize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_id: state.sessionId || 'session-10a1',
            room_id: state.roomId || 'room-10a1',
            subject: currentSubject,
            image_base64: imageBase64,
            provider: 'auto',
          }),
        });

        if (!res.ok) {
          throw new Error('Không thể nhận diện nét vẽ từ bảng');
        }

        const data = await res.json();
        const recognizedText = data.recognized_text || data.latex || '';
        if (!recognizedText.trim()) {
          showStatus('Không phát hiện nét chữ nào rõ ràng trên bảng vẽ.', true);
          return;
        }

        // Tự động phân tách dòng đề bài và các dòng bước giải
        const rawLines = recognizedText.split('\n').map((l) => l.trim()).filter(Boolean);
        let formattedSteps = [];
        if (rawLines.length === 1) {
          formattedSteps = [rawLines[0]];
        } else {
          rawLines.forEach((line, idx) => {
            if (/^(?:bước|buoc|step|\d+[\.:\)])/i.test(line)) {
              formattedSteps.push(line);
            } else if (idx === 0) {
              formattedSteps.push(`Đề bài: ${line}`);
            } else {
              formattedSteps.push(`Bước ${idx}: ${line}`);
            }
          });
        }

        if (essayInputLines) {
          essayInputLines.value = formattedSteps.join('\n');
        }

        showStatus(`Đã quét thành công ${formattedSteps.length} dòng từ bảng! Đang kích hoạt AI chấm...`);
        if (evaluateEssayStepsBtn) {
          evaluateEssayStepsBtn.click();
        }
      } catch (err) {
        showStatus(`Lỗi khi quét bảng vẽ: ${err.message}`, true);
      } finally {
        scanCanvasForEssayBtn.disabled = false;
        scanCanvasForEssayBtn.textContent = 'Quét từ bảng vẽ';
      }
    });
  }

  // 1-click thông minh: Có khối [ĐỀ BÀI] hoặc >= 2 dòng viết tay trên bảng -> chấm thẳng trên bảng; ngược lại -> mở khung nhập tay
  if (gradeEssayBtn) {
    gradeEssayBtn.addEventListener('click', async () => {
      if (state.ended) return;
      cleanupOrphanQuestionBadges();
      const objs = fabricCanvas.getObjects();
      const hasTaggedQuestion = objs.some(
        (obj) => obj?.meta?.dataRole === 'question' && obj?.meta?.questionType !== 'MCQ'
      );
      const freehandLinesCount = hasTaggedQuestion
        ? 0
        : clusterStrokesIntoLines(objs.filter((obj) => obj instanceof Path)).length;

      if (hasTaggedQuestion || freehandLinesCount >= 2) {
        const res = await gradeEssayDirectlyOnBoard();
        if (res?.noQuestionOnBoard) {
          showStatus('');
          essayGradingDialog.showModal();
        }
      } else {
        showStatus('');
        essayGradingDialog.showModal();
      }
    });
  }

  // Các nút điều khiển trên thanh nổi #essayBoardFloatingPill
  $('essayPillClearOverlayBtn')?.addEventListener('click', () => {
    clearGradingOverlays();
    setStatus('Đã ẩn dấu chấm trên bảng');
  });

  $('essayPillOpenDialogBtn')?.addEventListener('click', () => {
    showStatus('');
    essayGradingDialog.showModal();
  });

  $('essayPillCloseBtn')?.addEventListener('click', () => {
    hideEssayFloatingPill();
  });

  // Hit-test thủ công khi chạm ngắn (tương thích skipTargetFind: true & Infinite Canvas)
  let tapStart = null;
  fabricCanvas.on('mouse:down', (e) => {
    if (!e?.e) return;
    const pt = typeof fabricCanvas.getScenePoint === 'function'
      ? fabricCanvas.getScenePoint(e.e)
      : (e.scenePoint || null);
    if (pt) tapStart = { x: pt.x, y: pt.y, t: performance.now() };
  });

  fabricCanvas.on('mouse:up', (e) => {
    if (!tapStart || !e?.e) {
      tapStart = null;
      return;
    }
    const start = tapStart;
    tapStart = null;
    const pt = typeof fabricCanvas.getScenePoint === 'function'
      ? fabricCanvas.getScenePoint(e.e)
      : (e.scenePoint || null);
    if (!pt) return;

    if (performance.now() - start.t > 350 || Math.hypot(pt.x - start.x, pt.y - start.y) > 10) {
      return;
    }

    const objects = fabricCanvas.getObjects();
    for (let i = objects.length - 1; i >= 0; i -= 1) {
      const obj = objects[i];
      const role = obj?.meta?.dataRole;
      if (role !== 'question_badge' && !obj?.meta?.isHintTrigger) continue;

      const b = obj.getBoundingRect();
      if (pt.x >= b.left - 8 && pt.x <= b.left + b.width + 8 && pt.y >= b.top - 8 && pt.y <= b.top + b.height + 8) {
        if (role === 'question_badge') {
          toggleQuestionBadgeRole(obj);
        } else if (obj.meta.isHintTrigger) {
          setStatus(`Gợi ý dòng ${obj.meta.stepNumber}: ${obj.meta.guidance}`);
          showAppToast({
            title: `Gợi ý sửa dòng ${obj.meta.stepNumber}`,
            message: `${obj.meta.feedback ? `${obj.meta.feedback} — ` : ''}${obj.meta.guidance}`,
            variant: 'warning',
            durationMs: 6500,
          });
        }
        break;
      }
    }
  });

  // Đóng modal
  const closeModal = () => essayGradingDialog.close();
  if (closeEssayDialogBtn) closeEssayDialogBtn.addEventListener('click', closeModal);
  if (closeEssayDialogXBtn) closeEssayDialogXBtn.addEventListener('click', closeModal);

  // Chèn mẫu thử nhanh
  document.querySelectorAll('.essay-sample-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const sampleKey = btn.dataset.sample;
      if (ESSAY_SAMPLES[sampleKey] && essayInputLines) {
        essayInputLines.value = ESSAY_SAMPLES[sampleKey];
        showStatus('Đã chèn bài giải mẫu. Bấm "Chấm từng dòng bằng AI" để kiểm tra.');
      }
    });
  });

  // Chấm bài giải bằng AI
  if (evaluateEssayStepsBtn) {
    evaluateEssayStepsBtn.addEventListener('click', async () => {
      const text = essayInputLines ? essayInputLines.value.trim() : '';
      if (!text) {
        showStatus('Vui lòng nhập các bước giải tự luận (mỗi dòng một bước)', true);
        return;
      }

      const subject = essaySubjectSelect ? essaySubjectSelect.value : 'TOAN';
      evaluateEssayStepsBtn.disabled = true;
      evaluateEssayStepsBtn.textContent = 'Đang phân tích từng dòng...';
      showStatus('AI đang đọc từng dòng viết tay và kiểm tra công thức...');

      try {
        const res = await authFetch('/api/v1/exam/grade-essay-solution', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            question_id: 'essay_direct',
            raw_text: text,
            subject: subject,
          }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.detail || 'Lỗi khi chấm bài giải tự luận');
        }

        const rawLines = text
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter((s) => s.length > 0 && !isMeaninglessStepText(s));
        const data = verifyEssaySolutionClientSide(await res.json(), {
          steps: rawLines,
        });
        lastEssayResult = data;
        renderEssayResult(data);
        showStatus(
          data.has_any_error
            ? `Đã phân tích xong: Phát hiện ${data.incorrect_steps} bước cần xem lại (đã gạch chân đỏ).`
            : 'Xuất sắc! Toàn bộ các bước giải đều đúng (đã đánh dấu tích xanh).'
        );
        if (annotateEssayToCanvasBtn) annotateEssayToCanvasBtn.disabled = false;
      } catch (err) {
        showStatus(err.message, true);
      } finally {
        evaluateEssayStepsBtn.disabled = false;
        evaluateEssayStepsBtn.textContent = 'Chấm từng dòng bằng AI';
      }
    });
  }

  // Render kết quả phân tích từng bước
  function renderEssayResult(data) {
    if (!essayResultSection) return;
    essayResultSection.hidden = false;

    if (metricTotalSteps) metricTotalSteps.textContent = data.total_steps;
    if (metricCorrectSteps) metricCorrectSteps.textContent = data.correct_steps;
    if (metricWrongSteps) metricWrongSteps.textContent = data.incorrect_steps;
    if (metricScore) metricScore.textContent = `${data.score} / 10`;
    if (essayOverallFeedback) essayOverallFeedback.textContent = data.overall_feedback;

    if (essayStepsList) {
      essayStepsList.innerHTML = '';
      data.steps_evaluation.forEach((step) => {
        const stepCard = document.createElement('div');
        stepCard.className = `essay-step-card ${step.is_step_correct ? 'step-card-correct' : 'step-card-wrong'}`;

        const isCorrect = step.is_step_correct;
        const iconBadge = isCorrect
          ? '<span class="step-badge badge-green-check">✓ Bước đúng</span>'
          : '<span class="step-badge badge-red-underline">✕ Dòng sai / Nhầm công thức</span>';

        const lineClass = isCorrect ? 'step-text-correct' : 'step-text-red-underline';

        let guidanceBlock = '';
        if (!isCorrect && step.guidance) {
          guidanceBlock = `
            <div class="step-guidance-box">
              <div class="guidance-content">
                <strong>Gợi ý sửa (không lộ đáp án):</strong>
                <p>${escapeHtml(step.guidance)}</p>
              </div>
            </div>
          `;
        }

        stepCard.innerHTML = `
          <div class="step-header-row">
            <span class="step-num">Dòng ${escapeHtml(step.step_number)}</span>
            ${iconBadge}
          </div>
          <div class="step-line-content ${lineClass}">
            <code>${escapeHtml(step.written_text)}</code>
          </div>
          <div class="step-feedback-note">
            ${escapeHtml(step.feedback)}
          </div>
          ${guidanceBlock}
        `;

        essayStepsList.appendChild(stepCard);
      });
    }
  }

  // Đánh dấu trực tiếp lên bảng vẽ Fabric.js
  if (annotateEssayToCanvasBtn) {
    annotateEssayToCanvasBtn.addEventListener('click', () => {
      if (!lastEssayResult || !lastEssayResult.steps_evaluation) {
        showStatus('Chưa có kết quả chấm để đưa lên bảng', true);
        return;
      }

      annotateToCanvas(lastEssayResult);
      essayGradingDialog.close();
      setStatus(
        `Đã đánh dấu ${lastEssayResult.total_steps} bước giải lên bảng (Tích xanh ✓ & Gạch chân đỏ ✕)!`
      );
    });
  }

  // Vẽ các annotations lên canvas Fabric.js
  function annotateToCanvas(result) {
    const before = snapshot();
    const TextboxClass = Textbox || FabricText;
    const isDark = isDarkBoardActive();
    const startX = 60;
    let startY = 148;

    // Tiêu đề khối bài giải
    const headerTitle = new TextboxClass('BÀI GIẢI TỰ LUẬN (AI ĐÁNH DẤU TỪNG BƯỚC)', {
      left: startX,
      top: startY,
      fontSize: 16,
      fontWeight: 'bold',
      fill: isDark ? '#ECE7DF' : '#26231F',
      width: 800,
      selectable: false,
    });
    fabricCanvas.add(headerTitle);
    startY += 35;

    result.steps_evaluation.forEach((step) => {
      const isCorrect = step.is_step_correct;
      const lineText = `Bước ${step.step_number}: ${step.written_text}`;

      // 1. Textbox nội dung bước giải
      const stepTb = new TextboxClass(lineText, {
        left: startX + 30,
        top: startY,
        fontSize: 17,
        fontWeight: isCorrect ? 'normal' : '600',
        fill: isCorrect ? '#0f172a' : '#b91c1c',
        width: 750,
        selectable: true,
      });
      fabricCanvas.add(stepTb);

      // 2. Icon đánh dấu cạnh bước
      const iconText = isCorrect ? '✓' : '✕';
      const iconColor = isCorrect ? '#16a34a' : '#dc2626';
      const iconObj = new TextboxClass(iconText, {
        left: startX,
        top: startY - 2,
        fontSize: 20,
        fontWeight: 'bold',
        fill: iconColor,
        width: 30,
        selectable: false,
      });
      fabricCanvas.add(iconObj);

      // 3. Nếu dòng SAI hoặc NHẦM CÔNG THỨC: Vẽ đường GẠCH CHÂN ĐỎ ngay dưới dòng!
      if (!isCorrect) {
        const estimatedWidth = Math.min(650, Math.max(180, lineText.length * 10));
        const underline = new Line(
          [startX + 30, startY + 24, startX + 30 + estimatedWidth, startY + 24],
          {
            stroke: '#dc2626',
            strokeWidth: 2.5,
            strokeDashArray: [6, 3],
            selectable: false,
          }
        );
        fabricCanvas.add(underline);

        // Thêm sticker gợi ý sửa ngay dưới dòng gạch chân
        if (step.guidance) {
          const hintBox = new TextboxClass(step.guidance, {
            left: startX + 40,
            top: startY + 30,
            fontSize: 13,
            fontStyle: 'italic',
            fill: '#991b1b',
            backgroundColor: '#fee2e2',
            padding: 6,
            width: 700,
            selectable: true,
          });
          fabricCanvas.add(hintBox);
          startY += 28;
        }
      }

      startY += 38;
    });

    fabricCanvas.requestRenderAll();
    updateHint();
    remember(before);
  }
}

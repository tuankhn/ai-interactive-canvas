/**
 * Trích xuất thông số cơ bản từ đề hình học không gian tiếng Việt.
 * Mọi giá trị được xem như cùng một đơn vị; không sử dụng AI hoặc Backend.
 */
export function normalizeGeometryText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function dimension(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const value = Number(match[1].replace(',', '.'));
      if (Number.isFinite(value) && value > 0 && value <= 1000) return value;
    }
  }
  return null;
}

function baseSides(text) {
  if (/\b(tam giac|ba canh|3 canh)\b|\bs\.abc\b/.test(text)) return 3;
  if (/\b(ngu giac|nam canh|5 canh)\b/.test(text)) return 5;
  if (/\b(luc giac|sau canh|6 canh)\b/.test(text)) return 6;
  return 4; // Mặc định: chóp tứ giác / lăng trụ tứ giác.
}

export function parseGeometryProblem(problem) {
  const text = normalizeGeometryText(problem);
  let type;
  if (/\b(mat cau|hinh cau)\b/.test(text)) type = 'sphere';
  else if (/\b(hinh non|non tron xoay)\b/.test(text)) type = 'cone';
  else if (/\b(lang tru)\b/.test(text)) type = 'prism';
  else if (/\b(hinh chop|chop deu|chop tam giac|chop tu giac)\b/.test(text)) type = 'pyramid';
  else return null;

  const height = dimension(text, [
    /(?:chieu cao|do cao)\s*(?:h\s*)?(?:la|bang|=|:)?\s*(\d+(?:[.,]\d+)?)/,
    /\bh\s*=\s*(\d+(?:[.,]\d+)?)/
  ]);
  const radius = dimension(text, [
    /ban kinh(?:\s+day)?\s*(?:r\s*)?(?:la|bang|=|:)?\s*(\d+(?:[.,]\d+)?)/,
    /\br\s*=\s*(\d+(?:[.,]\d+)?)/
  ]);
  const diameter = dimension(text, [
    /duong kinh\s*(?:la|bang|=|:)?\s*(\d+(?:[.,]\d+)?)/
  ]);
  const edge = dimension(text, [
    /canh(?:\s+day)?\s*(?:a\s*)?(?:la|bang|=|:)?\s*(\d+(?:[.,]\d+)?)/,
    /\ba\s*=\s*(\d+(?:[.,]\d+)?)/
  ]);
  const sides = baseSides(text);
  let baseRadius = radius || (diameter ? diameter / 2 : null);
  if (!baseRadius && edge) baseRadius = edge / (2 * Math.sin(Math.PI / sides));
  if (!baseRadius) baseRadius = type === 'sphere' ? 3 : 2.5;

  const labels = {
    sphere: 'Mặt cầu', cone: 'Hình nón',
    prism: `Lăng trụ ${sides === 3 ? 'tam giác' : sides === 4 ? 'tứ giác' : sides === 5 ? 'ngũ giác' : 'lục giác'}`,
    pyramid: `Hình chóp ${sides === 3 ? 'tam giác' : sides === 4 ? 'tứ giác' : sides === 5 ? 'ngũ giác' : 'lục giác'}`
  };
  return {
    type,
    label: labels[type],
    sides,
    radius: baseRadius,
    height: type === 'sphere' ? baseRadius * 2 : (height || 5),
    isDefaultRadius: radius === null && diameter === null && edge === null,
    isDefaultHeight: type !== 'sphere' && height === null
  };
}

const digits = new Map([
  ["không", 0], ["một", 1], ["mốt", 1], ["hai", 2], ["ba", 3],
  ["bốn", 4], ["tư", 4], ["năm", 5], ["lăm", 5], ["sáu", 6],
  ["bảy", 7], ["bẩy", 7], ["tám", 8], ["chín", 9],
]);

const fieldUnits = {
  diameter: /\s*(?:cm|(?:xen|sen)[\s-]*ti[\s-]*mét|centim[eé]t)$/u,
  height: /\s*(?:m|mét)$/u,
  quantity: /\s*cây$/u,
};
const spokenMeasurementLabels = {
  diameter: /^đường\s+kính(?:\s+là)?[\s:]+/u,
  height: /^(?:chiều\s+cao|cao)(?:\s+là)?[\s:]+/u,
  quantity: /^số\s+lượng(?:\s+là)?[\s:]+/u,
};

function smallNumber(words) {
  const phrase = words.join(" ");
  if (/^\d{1,3}$/u.test(phrase)) return Number(phrase);
  let hundreds = 0;
  if (words[1] === "trăm" && digits.has(words[0])) {
    hundreds = digits.get(words[0]) * 100;
    words = words.slice(2);
    if (["linh", "lẻ"].includes(words[0])) {
      return digits.has(words[1]) && words.length === 2
        ? hundreds + digits.get(words[1]) : NaN;
    }
  }
  if (!words.length) return hundreds;

  let tens = 0;
  if (words[0] === "mười") {
    tens = 10;
    words = words.slice(1);
  } else if (words[1] === "mươi" && digits.has(words[0])) {
    tens = digits.get(words[0]) * 10;
    words = words.slice(2);
  }
  if (!words.length) return hundreds + tens;
  if (words.length === 1 && digits.has(words[0])) {
    return hundreds + tens + digits.get(words[0]);
  }
  return NaN;
}

function integerWords(words) {
  if (!words.length) return NaN;
  const phrase = words.join(" ");
  if (/^\d+$/u.test(phrase)) return Number(phrase);
  const scales = new Map([["tỷ", 1e9], ["tỉ", 1e9], ["triệu", 1e6], ["nghìn", 1e3], ["ngàn", 1e3]]);
  let total = 0;
  let largestNext = Infinity;
  let start = 0;
  for (const [index, word] of words.entries()) {
    const multiplier = scales.get(word);
    if (multiplier === undefined) continue;
    if (multiplier >= largestNext || index === start) return NaN;
    total += smallNumber(words.slice(start, index)) * multiplier;
    largestNext = multiplier;
    start = index + 1;
  }
  return total + smallNumber(words.slice(start));
}

export function readNumber(text, field) {
  let phrase = text.normalize("NFC").toLocaleLowerCase("vi").trim();
  if (field) {
    phrase = phrase.replace(/[.,!?…;:]+$/u, "")
      .replace(spokenMeasurementLabels[field] ?? /$^/u, "")
      .replace(/(\d)\s*([.,])\s*(?=\d)/gu, "$1$2");
  }
  phrase = phrase
    .replace(fieldUnits[field] ?? /$^/u, "").trim();
  if (/^\d+(?:[.,]\d+)?$/u.test(phrase)) return Number(phrase.replace(",", "."));
  const [whole, fraction, ...extra] = phrase.split(/\s+(?:phẩy|chấm)\s+/u);
  if (extra.length) return NaN;
  const integer = integerWords(whole.split(/\s+/u));
  if (fraction === undefined) return integer;
  const words = fraction.split(/\s+/u);
  const spokenDigits = words.map(word => /^\d+$/u.test(word) ? word : digits.get(word));
  const decimal = spokenDigits.every(digit => digit !== undefined)
    ? spokenDigits.join("") : integerWords(words);
  return Number(integer + "." + decimal);
}

const mathSymbols = {
  "mở ngoặc": "(", "đóng ngoặc": ")", cộng: "+", trừ: "-",
  âm: "-", nhân: "x", chia: "/", "*": "x", "×": "x", "÷": "/", "−": "-",
};

export function normalizeMathSymbols(text) {
  return text.normalize("NFC")
    .replace(/(?<!\p{L})(?:mở|đóng)\s+ngoặc(?!\p{L})|[\p{L}]+|[*×÷−]/giu, word =>
      mathSymbols[word.toLocaleLowerCase("vi").replace(/\s+/gu, " ")] ?? word)
    .replace(/([()])\s*ngoặc(?!\p{L})/giu, "$1");
}

export function formatHouseSpec(text) {
  const parts = normalizeMathSymbols(text).toLocaleLowerCase("vi").split(/([()+x/\-])/u);
  let formatted = "";
  let depth = 0;
  let needsOperand = true;
  let valid = true;
  for (const part of parts) {
    const token = part.trim();
    if (!token) continue;
    if (token === "(") {
      valid &&= needsOperand;
      depth += 1;
      formatted += "(";
    } else if (token === ")") {
      valid &&= !needsOperand && depth > 0;
      depth -= 1;
      formatted = formatted.trimEnd() + ")";
      needsOperand = false;
    } else if (/^[+x/\-]$/u.test(token)) {
      if (needsOperand && token === "-") {
        formatted += "-";
      } else {
        valid &&= !needsOperand;
        formatted += " " + token + " ";
      }
      needsOperand = true;
    } else {
      const number = readNumber(token);
      if (!Number.isFinite(number)) {
        valid = false;
        break;
      }
      valid &&= needsOperand;
      formatted += String(number).replace(".", ",");
      needsOperand = false;
    }
  }
  return { text: formatted.trim(), complete: valid && !needsOperand && depth === 0 };
}

const houseMarkers = [{ words: ["thông", "số"], field: "spec" }];
const treeMarkers = [
  { words: ["đường", "kính"], field: "diameter" },
  { words: ["cao"], field: "height" },
  { words: ["số", "lượng"], field: "quantity" },
];

export function parseCommands(mode, transcript) {
  const text = transcript.normalize("NFC");
  const tokens = [...text.matchAll(/[\p{L}\p{N}]+/gu)];
  const words = tokens.map(token => token[0].toLocaleLowerCase("vi"));
  const fields = {};
  const read = (from, to) => text.slice(from, to).trim()
    .replace(/^[\s,:;!?…]+|[\s,.:;!?…]+$/gu, "");

  const takeMarker = marker => {
    const { words: command, field: nextField } = marker;
    const index = words.findIndex((_, position) => position >= nextToken
      && command.every((word, offset) => words[position + offset] === word));
    if (index === -1) return false;
    fields[field] = read(start, tokens[index].index);
    nextToken = index + command.length;
    const lastToken = tokens[nextToken - 1];
    start = lastToken.index + lastToken[0].length;
    field = nextField;
    return true;
  };

  let nextToken = 0;
  let start = 0;
  let field = "name";
  const done = words.at(-1) === "xong";
  const titleOnly = words[0] === "tiêu" && words[1] === "đề";
  if (titleOnly) {
    takeMarker({ words: ["tiêu", "đề"], field: "title" });
    takeMarker({ words: ["tài", "sản"], field: "name" });
  } else if (words[0] === "tài" && words[1] === "sản") {
    takeMarker({ words: ["tài", "sản"], field: "name" });
  }
  if (field === "title") {
    fields.title = read(start, done ? tokens.at(-1).index : text.length);
    delete fields.name;
    return { fields, field, done };
  }
  if (mode === "house") {
    takeMarker(houseMarkers[0]);
  } else if (takeMarker(treeMarkers[0])) {
    // "Cao" is a command only between "đường kính" and "số lượng".
    const quantityIndex = words.findIndex((word, index) => index >= nextToken
      && word === "số" && words[index + 1] === "lượng");
    const heightIndex = words.indexOf("cao", nextToken);
    if (heightIndex !== -1 && (quantityIndex === -1 || heightIndex < quantityIndex)) {
      takeMarker(treeMarkers[1]);
    }
    takeMarker(treeMarkers[2]);
  }
  fields[field] = read(start, done ? tokens.at(-1).index : text.length);
  if (done && mode === "tree" && Object.hasOwn(fields, "height") && !fields.height) {
    return { fields, field, done, error: "Thiếu chiều cao sau lệnh “cao”." };
  }
  return { fields, field, done };
}

export function formatTitle(text) {
  const capitalize = value => value.charAt(0).toLocaleUpperCase("vi") + value.slice(1);
  const title = text.trim();
  const star = title.match(/^(?:dấu\s+)?sao(?:\s+|$)/iu);
  if (star) return ("* " + capitalize(title.slice(star[0].length))).trimEnd();
  const words = title.split(/\s+/u);
  for (let count = words.length; count > 0; count--) {
    const number = readNumber(words.slice(0, count).join(" "));
    if (Number.isSafeInteger(number)) {
      const rest = words.slice(count).join(" ");
      return number + (rest ? " " + capitalize(rest) : "");
    }
  }
  return title;
}

export function validateAsset(mode, fields, originalSpec) {
  const name = fields.name?.trim();
  if (!name) return { error: mode === "house" ? "Hãy điền tên tài sản." : "Hãy điền tên cây." };
  if (mode === "house") {
    const input = fields.spec?.trim() ?? "";
    if (input && input === originalSpec) return { asset: { mode, name, spec: input } };
    const spec = formatHouseSpec(input);
    return spec.complete
      ? { asset: { mode, name, spec: spec.text } }
      : { error: "Hãy điền số hoặc phép tính đầy đủ trong ô Thông số kỹ thuật." };
  }

  const diameterCm = readNumber(fields.diameter ?? "", "diameter");
  const heightM = fields.height?.trim() ? readNumber(fields.height, "height") : null;
  const quantity = readNumber(fields.quantity ?? "", "quantity");
  if (!Number.isFinite(diameterCm) || diameterCm <= 0) return { error: "Hãy điền đường kính lớn hơn 0 cm." };
  if (heightM !== null && (!Number.isFinite(heightM) || heightM <= 0)) return { error: "Hãy điền chiều cao lớn hơn 0 m hoặc để trống." };
  if (!Number.isSafeInteger(quantity) || quantity <= 0) return { error: "Hãy điền số lượng bằng số nguyên lớn hơn 0." };
  return { asset: { mode, name, diameterCm, heightM, quantity } };
}

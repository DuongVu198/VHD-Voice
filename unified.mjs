import { formatHouseSpec, formatTitle, normalizeMathSymbols, readNumber, validateAsset } from "./commands.mjs?v=2.2";
import { readBackup, readLegacyProfiles } from "./unified-data.mjs";

const find = id => document.getElementById(id);
const form = find("asset-form");
const stop = find("stop");
const keyboardDictation = find("keyboard-dictation");
const specPreview = find("spec-preview");
const cancel = find("cancel");
const save = find("save");
const list = find("assets");
const status = find("status");
const modeButtons = [...document.querySelectorAll("[data-mode]")];
const inputs = Object.fromEntries(["title", "name", "spec", "diameter", "height", "quantity"]
  .map(key => [key, find(key)]));
const storageKey = "gpmb-field-assets-v1";
const storageKeys = { house: "gpmb-field-house-v2", tree: "gpmb-field-tree-v2" };
const householdPrefix = "gpmb-household-v3:";
const trashPrefix = "gpmb-trash-v1:";
const activeKey = "gpmb-active-household-v3";
const mathKeys = find("math-keys");
const numberDictation = find("number-dictation");
const numericFields = new Set(["spec", "diameter", "height", "quantity"]);
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const fieldLabels = {
  title: "tiêu đề", spec: "thông số kỹ thuật", diameter: "đường kính",
  height: "chiều cao", quantity: "số lượng",
};
const microphoneErrors = {
  "not-allowed": "Hãy cấp quyền micro cho trang rồi thử lại.",
  "service-not-allowed": "Dịch vụ nhận giọng nói chưa khả dụng trên thiết bị.",
  "audio-capture": "Trình duyệt không tìm thấy micro.",
  network: "Mất kết nối với dịch vụ nhận giọng nói.",
  "no-speech": "Chưa nghe rõ giọng nói.",
  "language-not-supported": "Thiết bị chưa hỗ trợ nhận giọng nói tiếng Việt.",
};

let mode = "house";
let editingId = null;
let editingTitle = false;
let capture = null;
let recognition = null;
let activeHousehold = null;
let micTimer = null;
let useKeyboardDictation = true;
let keypadField = null;
let dictationField = null;
let specTaps = 0;
let lastSpecTap = -Infinity;
let retainedProfiles = new Map();

function notify(message = "", tone = "") {
  status.textContent = message;
  status.dataset.tone = tone;
  status.hidden = !message;
}

function currentFields() {
  return Object.fromEntries(Object.entries(inputs).map(([key, input]) => [key, input.value]));
}

function hasDraft() {
  return Object.values(currentFields()).some(value => value.trim());
}

function householdDraft() {
  return { mode, editingId, fields: currentFields() };
}

function renderForm() {
  const tree = mode === "tree";
  find("name-label").textContent = tree ? "Tên cây" : "Tên tài sản";
  find("guide").textContent = useKeyboardDictation
    ? tree
      ? "Chạm ô để nhập. Với ô số, chọn Dùng mic bàn phím nếu muốn đọc."
      : "Chạm ô để nhập. Chạm nhanh 3 lần vào Thông số kỹ thuật để mở bàn phím iPhone."
    : "Chạm ô cần nhập. Khi thấy Đang nghe, hãy đọc rồi chạm ô khác hoặc bấm Lưu.";
  find("spec-field").hidden = tree;
  find("tree-fields").hidden = !tree;
  for (const button of modeButtons) {
    button.setAttribute("aria-pressed", button.dataset.mode === mode);
  }
  stop.hidden = !recognition;
  stop.textContent = "Dừng mic";
  save.disabled = false;
  save.textContent = "Lưu";
  cancel.disabled = !editingId && !hasDraft();
  renderSpecPreview();
}

function loadAssets() {
  if (activeHousehold) return activeHousehold[mode];
  const current = localStorage.getItem(storageKeys[mode]);
  const saved = JSON.parse(current ?? localStorage.getItem(storageKey) ?? "[]");
  if (!Array.isArray(saved)) throw new Error("Invalid asset list");
  return current === null ? saved.filter(item => item.mode === mode) : saved;
}

function persistHousehold() {
  if (!activeHousehold) return false;
  activeHousehold.draft = householdDraft();
  activeHousehold.updatedAt = new Date().toISOString();
  try {
    localStorage.setItem(householdPrefix + activeHousehold.id, JSON.stringify(activeHousehold));
    localStorage.setItem(activeKey, activeHousehold.id);
    find("backup-status").textContent = "Đã tự lưu trên thiết bị lúc "
      + new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })
      + ". Bấm Cập nhật file để giữ thêm một bản sao.";
    return true;
  } catch {
    find("backup-status").textContent = "Không tự lưu được trên thiết bị. Hãy bấm Cập nhật file.";
    return false;
  }
}

function renderHousehold() {
  find("workspace").hidden = !activeHousehold;
  find("session-controls").hidden = !activeHousehold;
  find("new-household-fields").hidden = Boolean(activeHousehold);
  find("household-picker").hidden = Boolean(activeHousehold);
  find("new-household").hidden = Boolean(activeHousehold);
  if (activeHousehold) find("active-household").textContent = "Đang làm việc với hộ " + activeHousehold.name;
  renderForm();
  renderAssets();
  renderSavedHouseholds();
}

const displayNumber = value => value == null ? "" : String(value).replace(".", ",");
const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)),
  byte => byte.toString(16).padStart(2, "0")).join("");

function assetProblem(asset) {
  if (asset.kind === "title") return "";
  if (asset.legacyAsset && !asset.legacyAsset.name?.trim() && asset.name === "Chưa có tên") {
    return "Hãy điền tên.";
  }
  return validateAsset(asset.mode, {
    name: asset.name, spec: asset.spec, diameter: displayNumber(asset.diameterCm),
    height: displayNumber(asset.heightM), quantity: displayNumber(asset.quantity),
  }).error ?? "";
}

function assetDescription(asset) {
  if (asset.mode === "house") return asset.spec;
  return [
    asset.diameterCm == null ? "" : displayNumber(asset.diameterCm) + " cm",
    asset.heightM == null ? "" : "Cao " + displayNumber(asset.heightM) + " m",
    asset.quantity === null ? "" : displayNumber(asset.quantity) + " cây",
  ].filter(Boolean).join(" · ");
}


function renderAssets() {
  const isTree = mode === "tree";
  find("saved-title").textContent = isTree ? "Cây đã lưu" : "Tài sản đã lưu";
  find("count").setAttribute("aria-label", isTree ? "Số dòng cây đã lưu" : "Số tài sản đã lưu");
  list.replaceChildren();
  let assets;
  try {
    assets = loadAssets();
  } catch {
    find("empty").hidden = false;
    find("empty").textContent = "Không đọc được dữ liệu đã lưu trong trình duyệt.";
    return;
  }
  find("count").textContent = assets.filter(asset => asset.kind !== "title").length;
  find("empty").hidden = Boolean(assets.length);
  find("empty").textContent = isTree ? "Chưa có cây nào." : "Chưa có tài sản nào.";
  for (const asset of assets) {
    const row = document.createElement("li");
    row.className = asset.kind === "title" ? "asset asset-heading" : "asset";
    const text = document.createElement("div");
    const name = document.createElement("p");
    name.className = "asset-name";
    name.textContent = asset.name;
    const detail = document.createElement("p");
    detail.className = "asset-detail";
    detail.textContent = assetDescription(asset);
    text.append(name);
    if (asset.kind !== "title") text.append(detail);
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "text-button";
    edit.textContent = "Sửa";
    edit.setAttribute("aria-label", "Sửa " + asset.name);
    edit.addEventListener("click", () => editAsset(asset));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "text-button";
    remove.textContent = "Xóa";
    remove.setAttribute("aria-label", "Xóa " + asset.name);
    remove.addEventListener("click", () => deleteAsset(asset));
    const actions = document.createElement("div");
    actions.className = "asset-actions";
    if (asset.kind !== "title") {
      const review = document.createElement("p");
      review.className = "asset-detail";
      const problem = assetProblem(asset);
      const confirmed = (asset.review_status ?? asset.legacyAsset?.review_status) === "confirmed";
      review.textContent = problem ? "Cần bổ sung. " + problem : confirmed ? "Đã xác nhận" : "Cần kiểm tra";
      text.append(review);
      if (!problem && !confirmed) {
        const confirm = document.createElement("button");
        confirm.type = "button";
        confirm.className = "text-button";
        confirm.textContent = "Xác nhận";
        confirm.addEventListener("click", () => {
          if (!commitRows(loadAssets().map(item => item.id === asset.id
            ? { ...item, review_status: "confirmed" } : item))) return;
          renderAssets();
          notify("Đã xác nhận " + asset.name + ".");
        });
        actions.append(confirm);
      }
    }
    actions.append(edit, remove);
    row.append(text, actions);
    list.append(row);
  }
}

function deleteAsset(asset) {
  if (editingId === asset.id) {
    notify("Hãy lưu hoặc hủy sửa dòng này trước khi xóa.", "error");
    return;
  }
  if (!window.confirm('Xóa dòng “' + asset.name + '”?')) return;
  try {
    const remaining = loadAssets().filter(item => item.id !== asset.id);
    if (activeHousehold) {
      const next = { ...activeHousehold, [mode]: remaining, updatedAt: new Date().toISOString() };
      localStorage.setItem(householdPrefix + next.id, JSON.stringify(next));
      activeHousehold = next;
    } else localStorage.setItem(storageKeys[mode], JSON.stringify(remaining));
  } catch {
    notify("Không xóa được dòng này.", "error");
    return;
  }
  renderAssets();
  notify("Đã xóa " + asset.name + ".");
}

function saveAsset(fields = currentFields(), titleOnly = !fields.name?.trim()) {
  const title = formatTitle(fields.title ?? "");
  const measurements = [...numericFields];
  const hasMeasurements = measurements.some(key => fields[key]?.trim());
  const { asset, error } = title && titleOnly && !hasMeasurements
    ? { asset: { mode, kind: "title", name: title } }
    : validateAsset(mode, fields);
  if (editingId && editingTitle !== (asset?.kind === "title") && asset) {
    notify(editingTitle ? "Hãy chỉ điền ô Tiêu đề." : "Hãy giữ tên của dòng đang sửa.", "error");
    return false;
  }
  if (error) {
    notify(error, "error");
    const keys = mode === "house" ? ["name", "spec"] : ["name", "diameter", "height", "quantity"];
    const invalid = keys.find(key => {
      if (key === "name") return !fields.name?.trim();
      if (key === "spec") return !formatHouseSpec(fields.spec ?? "").complete;
      if ((key === "height" || key === "diameter") && !fields[key]?.trim()) return false;
      const number = readNumber(fields[key] ?? "", key);
      return !Number.isFinite(number) || number <= 0 || (key === "quantity" && !Number.isSafeInteger(number));
    });
    inputs[invalid]?.focus();
    return false;
  }
  try {
    const assets = [...loadAssets()];
    const index = assets.findIndex(item => item.id === editingId);
    if (editingId && index < 0) {
      notify("Không tìm thấy dòng đang sửa. Hãy hủy sửa rồi mở lại danh sách.", "error");
      return false;
    }
    const record = { ...assets[index], ...asset, id: editingId ?? newId() };
    if (record.kind !== "title") record.review_status = "needs_review";
    if (index < 0) {
      if (title && asset.kind !== "title") assets.push({ mode, kind: "title", name: title, id: newId() });
      assets.push(record);
    }
    else assets[index] = record;
    if (activeHousehold) {
      const next = {
        ...activeHousehold,
        [mode]: assets,
        draft: { ...householdDraft(), editingId: null, fields: {} },
        updatedAt: new Date().toISOString(),
      };
      localStorage.setItem(householdPrefix + next.id, JSON.stringify(next));
      activeHousehold = next;
    } else localStorage.setItem(storageKeys[mode], JSON.stringify(assets));
  } catch {
    notify("Không lưu được vào trình duyệt. Dữ liệu vẫn còn trong các ô nhập.", "error");
    return false;
  }
  const edited = Boolean(editingId);
  editingId = null;
  hideKeypad();
  form.reset();
  persistHousehold();
  renderForm();
  renderAssets();
  notify((edited ? "Đã lưu chỉnh sửa cho " : "Đã lưu ") + asset.name + ".");
  return true;
}

function allowNewDraft() {
  if (editingId || hasDraft()) {
    notify("Hãy lưu hoặc bỏ bản nháp đang nhập trước.", "error");
    return false;
  }
  return true;
}

function editAsset(asset) {
  if (!allowNewDraft()) return;
  mode = asset.mode;
  editingId = asset.id;
  editingTitle = asset.kind === "title";
  if (editingTitle) {
    inputs.title.value = asset.name;
  } else if (mode === "house") {
    inputs.name.value = asset.name;
    inputs.spec.value = asset.spec;
  } else {
    inputs.name.value = asset.name;
    inputs.diameter.value = displayNumber(asset.diameterCm);
    inputs.height.value = asset.heightM === null ? "" : displayNumber(asset.heightM);
    inputs.quantity.value = displayNumber(asset.quantity);
  }
  renderForm();
  notify("Đang sửa " + asset.name + ".");
  inputs[editingTitle ? "title" : "name"].focus();
  persistHousehold();
}

function fieldLabel(field) {
  if (field === "name") return mode === "tree" ? "tên cây" : "tên tài sản";
  return fieldLabels[field];
}

function releaseMic() {
  const mic = recognition;
  recognition = null;
  capture = null;
  clearTimeout(micTimer);
  if (mic) mic.abort();
  renderForm();
  persistHousehold();
}

function setSpeechTarget(field) {
  const firstInterim = capture.results.findIndex(result => !result.final);
  const offset = firstInterim === -1 ? capture.results.length : firstInterim;
  capture.target = {
    field, base: inputs[field].value, offset,
    previous: capture.results.slice(offset).map(result => result.text),
    heard: false,
  };
}

// Browsers resend earlier phrases and can revise the unfinished phrase at the boundary.
function speechAfterBoundary(text, previous) {
  if (!previous) return text;
  const words = value => [...value.normalize("NFC").matchAll(/\p{N}+(?:[.,]\p{N}+)?|\p{L}+|[()+*/−%-]/gu)];
  const before = words(previous);
  const after = words(text);
  if (!before.length || !before.every((word, i) =>
    word[0].toLocaleLowerCase("vi") === after[i]?.[0].toLocaleLowerCase("vi"))) return "";
  const last = after[before.length - 1];
  return text.normalize("NFC").slice(last.index + last[0].length).replace(/^[\s,.!?;:]+/u, "");
}

function spokenValue(target, phrases) {
  const { field, base } = target;
  const words = phrases.join(" ").replace(/[.!?;:…]+$/u, "");
  if (field === "spec") return formatHouseSpec([base, words].filter(Boolean).join(" ")).text;
  if (field === "title") return formatTitle([base, words].filter(Boolean).join(" "));
  if (field === "name") return [base, words].filter(Boolean).join(" ");
  // A new measurement replaces the old one. Try the complete phrase before
  // trying the latest chunk, so a decimal split across results stays together.
  for (const attempt of [words, phrases.at(-1)]) {
    const number = readNumber(attempt, field);
    if (Number.isFinite(number)) return displayNumber(number);
  }
  return "";
}

function watchMic() {
  clearTimeout(micTimer);
  const session = capture;
  micTimer = setTimeout(() => {
    if (capture !== session) return;
    const message = session.target.heard
      ? "Micro đã dừng sau một lúc không có kết quả mới. Chạm ô để đọc tiếp."
      : "Chưa có kết quả nhận giọng nói. Chạm lại ô hoặc chọn Dùng mic bàn phím.";
    releaseMic();
    notify(message, session.target.heard ? "" : "error");
  }, 9000);
}

function receiveSpeech(event) {
  const { target } = capture;
  const results = Array.from(event.results, result => ({
    text: result[0]?.transcript.trim() ?? "", final: result.isFinal,
  }));
  capture.results = results;
  target.previous.length = Math.min(target.previous.length, Math.max(0, results.length - target.offset));
  const fresh = results.slice(target.offset).map((result, index) => ({
    ...result, text: speechAfterBoundary(result.text, target.previous[index]),
  })).filter(result => result.text);
  if (!fresh.length) return;
  target.heard = true;
  watchMic();
  const value = spokenValue(target, fresh.map(result => result.text));
  if (!value) {
    if (fresh.at(-1).final) {
      notify("Đã nghe nhưng chưa hiểu " + fieldLabel(target.field) + ". Hãy đọc lại hoặc nhập bằng tay.", "error");
      // A rejected measurement must not contaminate the next attempt in this field.
      if (!["name", "title", "spec"].includes(target.field)) setSpeechTarget(target.field);
    }
    return;
  }
  const input = inputs[target.field];
  if (input.value !== value) {
    input.value = value;
    renderForm();
    persistHousehold();
  }
  notify("Đang nghe ô " + fieldLabel(target.field) + "…");
}

function openMic() {
  const mic = new SpeechRecognition();
  mic.lang = "vi-VN";
  mic.continuous = true;
  mic.interimResults = true;
  recognition = mic;
  mic.onstart = mic.onaudiostart = () => {
    if (recognition !== mic) return;
    capture.started = true;
    notify("Đang nghe ô " + fieldLabel(capture.target.field) + "…");
  };
  mic.onresult = event => {
    if (recognition !== mic) return;
    capture.started = true;
    receiveSpeech(event);
  };
  mic.onerror = event => {
    if (recognition !== mic) return;
    releaseMic();
    notify(microphoneErrors[event.error] ?? "Micro bị gián đoạn. Chạm lại ô để thử.", "error");
  };
  mic.onend = () => {
    if (recognition !== mic) return;
    const heard = capture.target.heard;
    clearTimeout(micTimer);
    recognition = null;
    capture = null;
    renderForm();
    persistHousehold();
    notify(heard ? "Đã dừng micro. Chạm ô để đọc tiếp."
      : "Phiên nghe kết thúc mà chưa có kết quả. Chạm lại ô để thử.", heard ? "" : "error");
  };
  renderForm();
  notify("Đang mở micro…");
  watchMic();
  try { mic.start(); }
  catch {
    clearTimeout(micTimer);
    recognition = null;
    capture = null;
    renderForm();
    notify("Không mở được micro. Hãy thử lại.", "error");
  }
}

function listenToField(field) {
  if (!window.isSecureContext || !SpeechRecognition) {
    notify("Trình duyệt chưa hỗ trợ micro trên trang này.", "error");
    return;
  }
  if (recognition) {
    if (capture.target.field !== field) {
      setSpeechTarget(field);
      watchMic();
      notify((capture.started ? "Đang nghe ô " + fieldLabel(field) : "Đang mở micro") + "…");
    }
    return;
  }
  capture = { results: [], started: false };
  setSpeechTarget(field);
  openMic();
}

stop.addEventListener("click", () => {
  releaseMic();
  notify("Đã dừng micro. Nội dung trong ô được tự lưu.");
});

function renderKeyboardPreference() {
  keyboardDictation.setAttribute("aria-pressed", String(useKeyboardDictation));
  keyboardDictation.textContent = useKeyboardDictation ? "Chuyển sang mic web" : "Dùng mic bàn phím";
}

function hideKeypad() {
  keypadField = null;
  mathKeys.hidden = true;
}

function showKeypad(key) {
  if (!numericFields.has(key) || dictationField === key) {
    hideKeypad();
    return;
  }
  keypadField = key;
  mathKeys.hidden = false;
  for (const button of mathKeys.querySelectorAll("[data-key]")) {
    const character = button.dataset.key;
    button.disabled = (key !== "spec" && "x/+-()".includes(character))
      || (key === "quantity" && character === ",");
  }
}
renderKeyboardPreference();
keyboardDictation.addEventListener("click", () => {
  normalizeKeyboardValue("spec");
  useKeyboardDictation = !useKeyboardDictation;
  renderKeyboardPreference();
  releaseMic();
  notify();
});

function keyboardExpression(text) {
  const cleaned = text.trim().replace(/[.!?;:…]+$/u, "");
  const expression = formatHouseSpec(cleaned);
  return expression.complete ? expression.text : normalizeMathSymbols(text);
}

function renderSpecPreview() {
  const source = inputs.spec.value;
  const preview = keyboardExpression(source).trim();
  specPreview.hidden = mode !== "house";
  specPreview.textContent = "Phép tính: " + (preview || "—");
}

function normalizeKeyboardValue(field) {
  const input = inputs[field];
  if (!useKeyboardDictation || !input.value.trim()) return;
  if (field === "spec") {
    input.value = keyboardExpression(input.value);
  } else if (numericFields.has(field)) {
    const number = readNumber(input.value, field);
    if (Number.isFinite(number)) input.value = displayNumber(number);
  }
}

for (const button of modeButtons) {
  button.addEventListener("click", () => {
    if (button.dataset.mode === mode || !allowNewDraft()) return;
    if (recognition) releaseMic();
    mode = button.dataset.mode;
    renderForm();
    hideKeypad();
    renderAssets();
    persistHousehold();
    notify();
  });
}
form.addEventListener("input", event => {
  if (capture && event.target === inputs[capture.target.field]) {
    setSpeechTarget(capture.target.field);
  }
  persistHousehold();
  renderForm();
});
for (const [key, input] of Object.entries(inputs)) {
  input.addEventListener("focus", () => showKeypad(key));
  input.addEventListener("click", () => {
    if (key === "spec" && dictationField !== key) {
      const now = performance.now();
      specTaps = now - lastSpecTap <= 700 ? specTaps + 1 : 1;
      lastSpecTap = now;
      if (specTaps === 3) {
        specTaps = 0;
        openDeviceKeyboard(key);
        return;
      }
    }
    showKeypad(key);
    if (!useKeyboardDictation) listenToField(key);
  });
  input.addEventListener("blur", () => {
    if (key === "spec") specTaps = 0;
    if (dictationField === key) {
      dictationField = null;
      input.inputMode = "none";
    }
    if (!useKeyboardDictation) return;
    normalizeKeyboardValue(key);
    if (key === "spec") renderSpecPreview();
    persistHousehold();
  });
}
form.addEventListener("focusout", event => {
  if (!mathKeys.contains(event.relatedTarget) && event.relatedTarget !== save && event.relatedTarget !== cancel) {
    hideKeypad();
  }
});
for (const button of [save, cancel]) {
  button.addEventListener("pointerdown", event => {
    if (keypadField) event.preventDefault();
  });
}
mathKeys.addEventListener("pointerdown", event => {
  if (event.target.closest("button")) event.preventDefault();
});
function openDeviceKeyboard(key) {
  releaseMic();
  useKeyboardDictation = true;
  renderKeyboardPreference();
  hideKeypad();
  const field = inputs[key];
  field.blur();
  dictationField = key;
  field.inputMode = "text";
  field.focus();
}
numberDictation.addEventListener("click", () => {
  if (keypadField) openDeviceKeyboard(keypadField);
});
mathKeys.addEventListener("click", event => {
  const button = event.target.closest("[data-key]");
  if (!button || button.disabled || !keypadField) return;
  const key = button.dataset.key;
  const field = inputs[keypadField];
  let start = field.selectionStart;
  let end = field.selectionEnd;
  if (key === "clear") {
    start = 0;
    end = field.value.length;
  }
  if (key === "backspace" && start === end) start = Math.max(0, start - 1);
  field.focus();
  field.setRangeText(key === "backspace" || key === "clear" ? "" : key, start, end, "end");
  field.dispatchEvent(new Event("input", { bubbles: true }));
});
form.addEventListener("submit", event => {
  event.preventDefault();
  for (const field of Object.keys(inputs)) normalizeKeyboardValue(field);
  releaseMic();
  saveAsset();
});
cancel.addEventListener("click", () => {
  if (recognition) releaseMic();
  editingId = null;
  hideKeypad();
  form.reset();
  renderForm();
  persistHousehold();
  notify("Đã xóa nội dung đang nhập.");
});
window.addEventListener("storage", event => {
  if (event.key === storageKeys[mode] || event.key === storageKey || event.key === null) renderAssets();
});

function filePayload() {
  return JSON.stringify({
    ...activeHousehold,
    format: "gpmb-field-v1",
    id: activeHousehold.id,
    name: activeHousehold.name,
    house: activeHousehold.house,
    tree: activeHousehold.tree,
    updatedAt: activeHousehold.updatedAt,
    draft: householdDraft(),
  }, null, 2);
}

function exportFile() {
  if (!activeHousehold) return;
  persistHousehold();
  download(filePayload(), "GPMB-" + activeHousehold.name.replace(/[^\p{L}\p{N}-]+/gu, "-") + ".json");
}

function download(payload, filename) {
  const blob = new Blob([payload], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  notify("Đã tạo file hồ sơ. Hãy lưu vào Files trên iPhone hoặc thư mục Tải xuống.");
}

function activateHousehold(record) {
  releaseMic();
  hideKeypad();
  activeHousehold = record;
  mode = record.draft?.mode === "tree" ? "tree" : "house";
  editingId = record[mode].some(item => item.id === record.draft?.editingId) ? record.draft.editingId : null;
  editingTitle = Boolean(editingId && record[mode].find(item => item.id === editingId)?.kind === "title");
  form.reset();
  for (const [key, value] of Object.entries(record.draft?.fields ?? {})) {
    if (Object.hasOwn(inputs, key) && typeof value === "string") inputs[key].value = value;
  }
  find("household-name").value = record.name;
  persistHousehold();
  renderHousehold();
}

find("new-household").addEventListener("click", () => {
  const name = find("household-name").value.trim();
  if (!name) {
    find("household-name").focus();
    notify("Hãy nhập tên hộ.", "error");
    return;
  }
  const record = {
    format: "gpmb-field-v1", id: newId(), name, house: [], tree: [],
    draft: { mode: "house", fields: {} },
    updatedAt: new Date().toISOString(),
  };
  try {
    const legacy = ["house", "tree"].map(kind => {
      const rows = JSON.parse(localStorage.getItem(storageKeys[kind])
        ?? localStorage.getItem(storageKey) ?? "[]");
      return Array.isArray(rows) ? rows.filter(item => item?.mode === kind) : [];
    });
    if (legacy.some(rows => rows.length)
        && window.confirm("Đưa dữ liệu Nhà và Cây đã nhập trên thiết bị này vào hồ sơ hộ mới?")) {
      [record.house, record.tree] = legacy;
    }
  } catch {
    notify("Chưa đọc được dữ liệu cũ. Hãy mở bản sao JSON để chuyển hồ sơ.", "error");
    return;
  }
  activateHousehold(record);
  exportFile();
});

find("update-file").addEventListener("click", exportFile);
find("backup-all").addEventListener("click", () => {
  try {
    const households = savedProfiles();
    const draft = households.findIndex(record => record.id === activeHousehold?.id);
    if (draft >= 0) households[draft] = JSON.parse(filePayload());
    if (!households.length) return;
    download(JSON.stringify({ format: "gpmb-field-backup-v1", households }, null, 2), "GPMB-toan-bo.json");
  } catch {
    notify("Không đọc được hồ sơ để sao lưu toàn bộ. Hãy thử cập nhật file từng hộ.", "error");
  }
});
find("open-file").addEventListener("click", () => find("file-input").click());
find("file-input").addEventListener("change", async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const records = readBackup(JSON.parse(await file.text()));
    if (activeHousehold && !persistHousehold()) {
      notify("Hãy cập nhật file của hộ hiện tại trước khi mở hồ sơ khác.", "error");
      return;
    }
    const existing = records.filter(record => localStorage.getItem(householdPrefix + record.id)
      || localStorage.getItem(trashPrefix + record.id) || retainedProfiles.has(record.id));
    if (existing.length && !window.confirm("File sẽ thay " + existing.length
      + " hồ sơ cùng mã đang lưu. Bạn muốn tiếp tục?")) return;
    for (const record of records) {
      localStorage.setItem(householdPrefix + record.id, JSON.stringify(record));
      localStorage.removeItem(trashPrefix + record.id);
    }
    activeHousehold = null;
    if (records.length === 1) activateHousehold(records[0]);
    else renderHousehold();
    notify("Đã nhập " + records.length + " hồ sơ.");
  } catch {
    notify("File hồ sơ không hợp lệ hoặc không đọc được.", "error");
  } finally {
    event.target.value = "";
  }
});
function confirmHousehold(message) {
  const dialog = find("household-confirm");
  if (typeof dialog.showModal !== "function") return Promise.resolve(window.confirm(message));
  find("confirm-message").textContent = message;
  dialog.returnValue = "no";
  return new Promise(resolve => {
    dialog.addEventListener("close", () => resolve(dialog.returnValue === "yes"), { once: true });
    dialog.showModal();
  });
}

function finishHousehold() {
  activeHousehold = null;
  localStorage.removeItem(activeKey);
  form.reset();
  hideKeypad();
  find("household-name").value = "";
  renderHousehold();
}

find("close-household").addEventListener("click", async () => {
  if (!activeHousehold || !await confirmHousehold("Bạn có muốn đóng hồ sơ “" + activeHousehold.name + "”?")) return;
  releaseMic();
  if (!persistHousehold()) {
    notify("Chưa tự lưu được. Hãy bấm Cập nhật file để sao lưu hồ sơ.", "error");
    return;
  }
  finishHousehold();
  notify("Đã đóng hồ sơ. Bạn có thể mở lại từ danh sách.");
});

find("trash-household").addEventListener("click", async () => {
  const record = activeHousehold;
  if (!record || !await confirmHousehold("Chuyển hồ sơ “" + record.name
    + "” vào Hồ sơ đã xóa? Bạn có thể khôi phục sau.")) return;
  releaseMic();
  try {
    localStorage.setItem(trashPrefix + record.id, JSON.stringify(record));
    finishHousehold();
    notify("Đã chuyển hồ sơ vào Hồ sơ đã xóa.");
  } catch {
    notify("Chưa chuyển được hồ sơ vào Hồ sơ đã xóa.", "error");
  }
});

const savedHouseholds = find("saved-households");
function savedProfiles() {
  const profiles = new Map(retainedProfiles);
  for (const key of Object.keys(localStorage).filter(key => key.startsWith(householdPrefix))) {
    const record = JSON.parse(localStorage.getItem(key));
    if (record?.id) profiles.set(record.id, record);
  }
  return [...profiles.values()].filter(record => localStorage.getItem(trashPrefix + record.id) === null);
}

function renderTrash() {
  const list = find("trash-list");
  list.replaceChildren();
  for (const key of Object.keys(localStorage).filter(key => key.startsWith(trashPrefix))) {
    const record = JSON.parse(localStorage.getItem(key));
    const item = document.createElement("li");
    const name = document.createElement("span");
    name.textContent = record.name + " ";
    const restore = document.createElement("button");
    restore.type = "button";
    restore.className = "text-button";
    restore.textContent = "Khôi phục";
    restore.setAttribute("aria-label", "Khôi phục " + record.name);
    restore.addEventListener("click", () => {
      try {
        localStorage.setItem(householdPrefix + record.id, JSON.stringify(record));
        localStorage.removeItem(key);
        renderSavedHouseholds();
        notify("Đã khôi phục hồ sơ " + record.name + ".");
      } catch {
        notify("Chưa khôi phục được hồ sơ.", "error");
      }
    });
    item.append(name, restore);
    list.append(item);
  }
  find("trash").hidden = !list.childElementCount || Boolean(activeHousehold);
}

function renderSavedHouseholds() {
  savedHouseholds.replaceChildren(new Option("Chọn hồ sơ", ""));
  try {
    for (const record of savedProfiles()) {
      if (record && typeof record.name === "string" && typeof record.id === "string") {
        savedHouseholds.add(new Option(record.name, record.id));
      }
    }
    renderTrash();
  } catch {
    // An unreadable profile remains available to recover from JSON.
  }
  savedHouseholds.value = activeHousehold?.id ?? "";
  const empty = savedHouseholds.options.length < 2;
  find("saved-households-label").hidden = empty;
  find("no-households").hidden = !empty;
  find("backup-all").hidden = empty;
}
savedHouseholds.addEventListener("change", () => {
  if (!savedHouseholds.value) return;
  try {
    if (activeHousehold && !persistHousehold()) throw new Error("Unsaved household");
    const record = JSON.parse(localStorage.getItem(householdPrefix + savedHouseholds.value))
      ?? retainedProfiles.get(savedHouseholds.value);
    const [validated] = readBackup({ ...record, format: "gpmb-field-v1" });
    activateHousehold(validated);
    notify();
  } catch {
    renderSavedHouseholds();
    notify("Chưa thể mở hồ sơ. Hãy kiểm tra bản sao JSON.", "error");
  }
});

function commitRows(rows, draft = householdDraft()) {
  if (!activeHousehold) return false;
  try {
    const next = { ...activeHousehold, [mode]: rows, draft, updatedAt: new Date().toISOString() };
    localStorage.setItem(householdPrefix + next.id, JSON.stringify(next));
    activeHousehold = next;
    return true;
  } catch {
    notify("Không lưu được vào trình duyệt. Nội dung đang nhập vẫn còn.", "error");
    return false;
  }
}

renderHousehold();
readLegacyProfiles().then(records => {
  retainedProfiles = new Map(records.map(record => [record.id, record]));
  renderSavedHouseholds();
}).catch(() => {
  notify("Chưa đọc được một số hồ sơ trên thiết bị. Bạn có thể chọn Mở file đã lưu để nhập bản JSON.", "error");
});
if ("serviceWorker" in navigator && window.isSecureContext) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

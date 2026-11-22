import { formatHouseSpec, formatTitle, normalizeMathSymbols, readNumber, validateAsset } from "./commands.mjs";
import { readHouseholds } from "./field-import.mjs";

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
const activeKey = "gpmb-active-household-v3";
const mathKeys = find("math-keys");
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
let originalSpec;
let capture = null;
let recognition = null;
let activeHousehold = null;
let micTimer = null;
let useKeyboardDictation = false;

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

function renderForm() {
  const tree = mode === "tree";
  find("name-label").textContent = tree ? "Tên cây" : "Tên tài sản";
  find("guide").textContent = useKeyboardDictation
    ? "Chạm ô cần nhập rồi bấm biểu tượng micro trên bàn phím."
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
  cancel.hidden = !editingId && !hasDraft();
  cancel.textContent = editingId ? "Hủy sửa" : "Bỏ bản nháp";
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
  activeHousehold.draft = { mode, editingId, fields: currentFields() };
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
  find("household-name").disabled = Boolean(activeHousehold);
  find("new-household").hidden = Boolean(activeHousehold);
  if (activeHousehold) find("active-household").textContent = "Đang làm việc với hộ " + activeHousehold.name;
  renderForm();
  renderAssets();
  renderSavedHouseholds();
}

const displayNumber = value => value == null ? "" : String(value).replace(".", ",");
const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)),
  byte => byte.toString(16).padStart(2, "0")).join("");

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
    detail.textContent = asset.kind === "title" ? "" : asset.mode === "house" ? asset.spec : [
      asset.diameterCm === null ? "" : displayNumber(asset.diameterCm) + " cm",
      asset.heightM === null ? "" : "Cao " + displayNumber(asset.heightM) + " m",
      asset.quantity === null ? "" : displayNumber(asset.quantity) + " cây",
    ].filter(Boolean).join(" · ");
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
  const measurements = ["spec", "diameter", "height", "quantity"];
  const hasMeasurements = measurements.some(key => fields[key]?.trim());
  const { asset, error } = title && titleOnly && !hasMeasurements
    ? { asset: { mode, kind: "title", name: title } }
    : validateAsset(mode, fields, editingId ? originalSpec : undefined);
  if (editingId && editingTitle !== (asset?.kind === "title") && asset) {
    notify(editingTitle ? "Hãy chỉ điền ô Tiêu đề." : "Hãy giữ tên của dòng đang sửa.", "error");
    return false;
  }
  if (error) {
    notify(error, "error");
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
    if (index < 0) {
      if (title && asset.kind !== "title") assets.push({ mode, kind: "title", name: title, id: newId() });
      assets.push(record);
    }
    else assets[index] = record;
    if (activeHousehold) {
      const next = {
        ...activeHousehold,
        [mode]: assets,
        draft: { mode, editingId: null, fields: {} },
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
    originalSpec = asset.spec;
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

keyboardDictation.addEventListener("click", () => {
  normalizeKeyboardValue("spec");
  useKeyboardDictation = !useKeyboardDictation;
  keyboardDictation.setAttribute("aria-pressed", String(useKeyboardDictation));
  keyboardDictation.textContent = useKeyboardDictation ? "Chuyển sang mic web" : "Dùng mic bàn phím";
  for (const [field, inputMode] of Object.entries({ spec: "none", diameter: "decimal", height: "decimal", quantity: "numeric" })) {
    inputs[field].inputMode = useKeyboardDictation ? "text" : inputMode;
  }
  mathKeys.hidden = true;
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
  const preview = useKeyboardDictation && mode === "house" ? keyboardExpression(source) : source;
  specPreview.hidden = preview === source;
  specPreview.textContent = specPreview.hidden ? "" : "Phép tính " + preview;
}

function normalizeKeyboardValue(field) {
  const input = inputs[field];
  if (!useKeyboardDictation || !input.value.trim()) return;
  if (field === "spec") {
    input.value = keyboardExpression(input.value);
  } else if (["diameter", "height", "quantity"].includes(field)) {
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
    mathKeys.hidden = true;
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
  input.addEventListener("click", () => {
    if (!useKeyboardDictation) listenToField(key);
  });
  input.addEventListener("blur", () => {
    if (!useKeyboardDictation) return;
    normalizeKeyboardValue(key);
    if (key === "spec") renderSpecPreview();
    persistHousehold();
  });
}
inputs.spec.addEventListener("focus", () => { mathKeys.hidden = useKeyboardDictation; });
form.addEventListener("focusout", event => {
  if (event.relatedTarget !== inputs.spec && !mathKeys.contains(event.relatedTarget)) mathKeys.hidden = true;
});
mathKeys.addEventListener("pointerdown", event => {
  if (event.target.closest("[data-key]")) event.preventDefault();
});
mathKeys.addEventListener("click", event => {
  const key = event.target.closest("[data-key]")?.dataset.key;
  if (!key) return;
  if (key === "done") {
    inputs.spec.blur();
    mathKeys.hidden = true;
    return;
  }
  const field = inputs.spec;
  let start = field.selectionStart;
  const end = field.selectionEnd;
  if (key === "backspace" && start === end) start = Math.max(0, start - 1);
  field.focus();
  field.setRangeText(key === "backspace" ? "" : key, start, end, "end");
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
  form.reset();
  renderForm();
  persistHousehold();
  notify();
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
    draft: { mode, editingId, fields: currentFields() },
  }, null, 2);
}

function exportFile() {
  if (!activeHousehold) return;
  persistHousehold();
  const blob = new Blob([filePayload()], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "GPMB-" + activeHousehold.name.replace(/[^\p{L}\p{N}-]+/gu, "-") + ".json";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  notify("Đã tạo file hồ sơ. Hãy lưu vào Files trên iPhone hoặc thư mục Tải xuống.");
}

function activateHousehold(record) {
  releaseMic();
  activeHousehold = record;
  mode = record.draft?.mode === "tree" ? "tree" : "house";
  editingId = record.draft?.editingId ?? null;
  editingTitle = Boolean(editingId && record[mode].find(item => item.id === editingId)?.kind === "title");
  originalSpec = record[mode].find(item => item.id === editingId)?.spec;
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
find("open-file").addEventListener("click", () => find("file-input").click());
find("file-input").addEventListener("change", async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const records = readHouseholds(JSON.parse(await file.text()));
    if (activeHousehold && !persistHousehold()) {
      notify("Hãy cập nhật file của hộ hiện tại trước khi mở hồ sơ khác.", "error");
      return;
    }
    const existing = records.filter(record => localStorage.getItem(householdPrefix + record.id));
    if (existing.length && !window.confirm("File sẽ thay " + existing.length
      + " hồ sơ cùng mã đang lưu. Bạn muốn tiếp tục?")) return;
    for (const record of records) {
      localStorage.setItem(householdPrefix + record.id, JSON.stringify(record));
    }
    activeHousehold = null;
    activateHousehold(records[0]);
    notify("Đã mở hồ sơ hộ " + records[0].name + ".");
  } catch {
    notify("File hồ sơ không hợp lệ hoặc không đọc được.", "error");
  } finally {
    event.target.value = "";
  }
});
find("close-household").addEventListener("click", () => {
  releaseMic();
  if (!persistHousehold()) {
    notify("Chưa tự lưu được. Hãy bấm Cập nhật file để sao lưu hồ sơ.", "error");
    return;
  }
  activeHousehold = null;
  localStorage.removeItem(activeKey);
  form.reset();
  find("household-name").value = "";
  renderHousehold();
  notify("Đã đóng hồ sơ. Có thể mở lại file đã lưu.");
});

const savedHouseholds = find("saved-households");
function renderSavedHouseholds() {
  savedHouseholds.replaceChildren(new Option("Chọn hồ sơ", ""));
  try {
    for (const key of Object.keys(localStorage).filter(key => key.startsWith(householdPrefix))) {
      const record = JSON.parse(localStorage.getItem(key));
      if (record && typeof record.name === "string" && typeof record.id === "string") {
        savedHouseholds.add(new Option(record.name, record.id));
      }
    }
  } catch {
    // An unreadable profile remains available to recover from JSON.
  }
  savedHouseholds.value = activeHousehold?.id ?? "";
  find("saved-households-label").hidden = savedHouseholds.options.length < 2;
}
savedHouseholds.addEventListener("change", () => {
  if (!savedHouseholds.value) return;
  try {
    if (activeHousehold && !persistHousehold()) throw new Error("Unsaved household");
    const record = JSON.parse(localStorage.getItem(householdPrefix + savedHouseholds.value));
    const [validated] = readHouseholds({ ...record, format: "gpmb-field-v1" });
    activateHousehold(validated);
    notify();
  } catch {
    renderSavedHouseholds();
    notify("Chưa thể mở hồ sơ. Hãy kiểm tra bản sao JSON.", "error");
  }
});

try {
  const savedId = localStorage.getItem(activeKey);
  const saved = savedId && localStorage.getItem(householdPrefix + savedId);
  if (saved) {
    const [record] = readHouseholds({ ...JSON.parse(saved), format: "gpmb-field-v1" });
    activateHousehold(record);
  }
  else renderHousehold();
} catch {
  renderHousehold();
  notify("Không đọc được hồ sơ đang lưu. Hãy mở file sao lưu.", "error");
}

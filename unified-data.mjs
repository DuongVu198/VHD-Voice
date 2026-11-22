import { readHouseholds } from "./field-import.mjs";
import { parseCommands, validateAsset } from "./commands.mjs";

const legacyKey = "vhd-voice-v1";

function readLegacyDatabase() {
  if (!globalThis.indexedDB) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(legacyKey, 1);
    request.onupgradeneeded = () => request.transaction.abort();
    request.onerror = () => {
      if (request.error?.name === "AbortError") resolve(null);
      else reject(request.error);
    };
    request.onsuccess = () => {
      const database = request.result;
      try {
        const transaction = database.transaction("documents", "readonly");
        const record = transaction.objectStore("documents").get("main");
        record.onsuccess = () => resolve(record.result ?? null);
        record.onerror = () => reject(record.error);
        transaction.onabort = () => reject(transaction.error);
      } catch (error) {
        reject(error);
      } finally {
        database.close();
      }
    };
  });
}

export async function readLegacyProfiles() {
  let databaseError;
  const database = await readLegacyDatabase().catch(error => { databaseError = error; });
  let fallback;
  try {
    fallback = JSON.parse(localStorage.getItem(legacyKey) ?? "null");
  } catch (error) {
    if (!database) throw error;
  }
  if (!database && !fallback && databaseError) throw databaseError;
  const profiles = new Map();
  for (const state of [fallback, database]) {
    if (!state?.households?.length) continue;
    const records = readHouseholds({ ...state, schema: "vhd.voice.export", schema_version: 1 });
    for (const record of records) profiles.set(record.id, record);
  }
  return [...profiles.values()];
}

export function readBackup(data) {
  const records = data?.format === "gpmb-field-backup-v1"
    ? data.households?.flatMap(record => readHouseholds(record))
    : readHouseholds(data);
  if (!records?.length || new Set(records.map(record => record.id)).size !== records.length) {
    throw new Error("Invalid or duplicate household ID");
  }
  return records;
}

export function readContinuous(text, mode) {
  return text.split(/\s*(?:\btiếp theo\b|[\r\n;]+)\s*/iu).map(raw => raw.trim()).filter(Boolean).map(raw => {
    let fields;
    if (mode === "house") {
      const [name, spec = ""] = raw.split(/\s+thông số(?: kỹ thuật)?\s*[:：]?\s*/iu, 2);
      fields = { name, spec: spec.replace(/[,!.?…:]+$/u, "") };
    } else {
      const parsed = parseCommands(mode, raw.replace(/(?<=\s)chiều\s+cao(?=\s)/giu, "cao"));
      if (parsed.error || (Object.hasOwn(parsed.fields, "height") && !parsed.fields.height)) {
        return { raw, error: parsed.error ?? "Hãy nhập giá trị chiều cao hoặc bỏ cụm chiều cao." };
      }
      fields = parsed.fields;
    }
    return { raw, ...validateAsset(mode, fields) };
  });
}

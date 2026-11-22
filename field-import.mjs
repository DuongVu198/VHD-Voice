function validateRows(rows, mode) {
  if (!Array.isArray(rows)) throw new Error("Invalid list");
  const ids = new Set();
  for (const row of rows) {
    if (!row || row.mode !== mode || typeof row.id !== "string" || !row.id
        || ids.has(row.id) || typeof row.name !== "string" || !row.name.trim()) {
      throw new Error("Invalid row");
    }
    ids.add(row.id);
    if (row.kind === "title") continue;
    if (mode === "house" && typeof row.spec !== "string") throw new Error("Invalid specification");
    if (mode === "tree" && (typeof row.diameterCm !== "number" && row.diameterCm !== null
        || typeof row.heightM !== "number" && row.heightM !== null
        || typeof row.quantity !== "number" && row.quantity !== null)) throw new Error("Invalid measurement");
  }
}

function validateRecord(record) {
  if (record?.format !== "gpmb-field-v1" || typeof record.id !== "string" || !record.id.trim()
      || typeof record.name !== "string" || !record.name.trim()) throw new Error("Invalid household");
  validateRows(record.house, "house");
  validateRows(record.tree, "tree");
  return record;
}

export function readHouseholds(data) {
  if (data?.format === "gpmb-field-v1") return [validateRecord(data)];
  if (data?.schema !== "vhd.voice.export" || data.schema_version !== 1
      || !Array.isArray(data.households) || !data.households.length) throw new Error("Invalid file");

  return data.households.map(household => {
    if (!Array.isArray(household?.assets)) throw new Error("Invalid assets");
    const record = {
      format: "gpmb-field-v1",
      id: household.household_id,
      name: household.full_name,
      updatedAt: data.exported_at,
      house: [],
      tree: [],
      legacyProject: data.project,
      legacyHouseholdCode: household.kh,
    };
    for (const asset of household.assets) {
      const tree = asset.type === "tree";
      const mode = tree ? "tree" : "house";
      const measurements = asset.measurements ?? {};
      const measurement = key => {
        const raw = measurements[key];
        const value = typeof raw === "object" && raw !== null ? raw.value : raw;
        return typeof value === "number" && Number.isFinite(value) ? value : null;
      };
      const row = { id: asset.id, mode, name: asset.name?.trim() || "Chưa có tên", legacyAsset: asset };
      if (tree) {
        row.diameterCm = measurement("diameter_cm");
        row.heightM = measurement("height_m");
        row.quantity = typeof asset.quantity === "number" ? asset.quantity : null;
      } else {
        row.spec = typeof asset.raw_text === "string" ? asset.raw_text : "";
      }
      record[mode].push(row);
    }
    return validateRecord(record);
  });
}

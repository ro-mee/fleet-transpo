const LEVELS = ["region", "province", "city", "barangay"];
const MINIMUM_COUNTS = { region: 17, province: 80, city: 1600, barangay: 41000 };

/** Require a full-scale hierarchy before allowing snapshot reconciliation. */
export function assertFullSnapshot(records) {
  const counts = Object.fromEntries(LEVELS.map((level) => [
    level,
    records.filter((record) => record.level === level).length,
  ]));
  const tooSmall = Object.entries(MINIMUM_COUNTS)
    .filter(([level, minimum]) => counts[level] < minimum)
    .map(([level, minimum]) => `${level} has ${counts[level]}, below the safety floor ${minimum}`);
  if (tooSmall.length) throw new Error(`Refusing snapshot sync: ${tooSmall.join("; ")}.`);
  return counts;
}

/** Compare a reviewed full snapshot with the live code sets. */
export function planSnapshotSync(records, existingCodes, referencedBarangayCodes = [], existingRows = {}) {
  const incoming = Object.fromEntries(LEVELS.map((level) => [level, new Set()]));
  for (const record of records) incoming[record.level].add(record.code);

  const retire = Object.fromEntries(LEVELS.map((level) => [
    level,
    [...existingCodes[level]].filter((code) => !incoming[level].has(code)).sort(),
  ]));
  const add = Object.fromEntries(LEVELS.map((level) => [
    level,
    [...incoming[level]].filter((code) => !existingCodes[level].has(code)).sort(),
  ]));
  const referencedRetiredBarangays = [...new Set(referencedBarangayCodes)]
    .filter((code) => !incoming.barangay.has(code))
    .sort();
  const updateFields = {
    region: [], // Display names remain migration-owned.
    province: ["name", "region_code"],
    city: ["name", "region_code", "province_code", "is_city"],
    barangay: ["name", "city_code"],
  };
  const sourceField = {
    region_code: "regionCode",
    province_code: "provinceCode",
    city_code: "cityCode",
    is_city: "isCity",
  };
  const update = Object.fromEntries(LEVELS.map((level) => {
    const current = existingRows[level] ?? new Map();
    const changed = records.filter((record) => record.level === level).filter((record) => {
      const row = current.get(record.code);
      return row && updateFields[level].some((field) => row[field] !== record[sourceField[field] ?? field]);
    }).length;
    return [level, changed];
  }));

  return {
    counts: Object.fromEntries(LEVELS.map((level) => [level, incoming[level].size])),
    add,
    update,
    retire,
    referencedRetiredBarangays,
  };
}

export function assertNoReferencedRetirements(plan) {
  if (plan.referencedRetiredBarangays.length) {
    throw new Error(
      `Refusing snapshot sync: ${plan.referencedRetiredBarangays.length} saved address(es) reference barangay code(s) absent from this snapshot: ${plan.referencedRetiredBarangays.join(", ")}. ` +
      "Map or confirm those addresses before retiring the codes."
    );
  }
}

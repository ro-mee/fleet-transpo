const LEVELS = new Set(["Reg", "Prov", "City", "Mun", "Bgy", "SubMun"]);

const PSEUDO_PARENTS = new Map([
  ["0990100000", "City of Isabela (Not a Province)"],
  ["1999900000", "Special Geographic Area"],
]);
const PROVINCELESS_COMPONENT_CITY = "0990101000"; // City of Isabela uses a pseudo-province row in the publication.

function text(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    if (Array.isArray(value.richText)) return value.richText.map((part) => part.text ?? "").join("").trim();
    if (typeof value.text === "string") return value.text.trim();
    if ("result" in value) return text(value.result);
  }
  return String(value).trim();
}

function code10(value, rowNumber) {
  const raw = text(value).replace(/\.0+$/, "");
  if (!/^\d{1,10}$/.test(raw)) {
    throw new Error(`PSGC row ${rowNumber}: invalid 10-digit code "${raw}".`);
  }
  return raw.padStart(10, "0");
}

/**
 * Convert ordered rows from PSA's flat PSGC publication into import records.
 * Parentage comes from worksheet order and level transitions, never code masks.
 */
export function normalizePublicationRows(rows) {
  const records = [];
  const skipped = [];
  const state = { regionCode: null, provinceCode: null, cityCode: null };
  const seen = new Set();

  for (const row of rows) {
    const rowNumber = row.rowNumber;
    const sourceLevel = text(row.level);
    const name = text(row.name);
    const rawCode = row.code;

    if (!LEVELS.has(sourceLevel)) {
      const expectedName = PSEUDO_PARENTS.get(code10(rawCode, rowNumber));
      if (sourceLevel || !expectedName || name !== expectedName) {
        throw new Error(
          `PSGC row ${rowNumber}: unexpected geographic level "${sourceLevel}" for "${name}".`
        );
      }
      state.provinceCode = null;
      state.cityCode = null;
      skipped.push({ rowNumber, code: code10(rawCode, rowNumber), name, reason: "PSA hierarchy label, not a selectable geography" });
      continue;
    }

    const code = code10(rawCode, rowNumber);
    if (!name) throw new Error(`PSGC row ${rowNumber}: ${sourceLevel} ${code} has no name.`);

    if (sourceLevel === "SubMun") {
      skipped.push({ rowNumber, code, name, reason: "Manila district; barangays remain under City of Manila" });
      continue;
    }

    const record = {
      psgc_code: code,
      name,
      region_code: null,
      province_code: null,
      city_code: null,
      is_city: false,
    };
    switch (sourceLevel) {
      case "Reg":
        state.regionCode = code;
        state.provinceCode = null;
        state.cityCode = null;
        records.push({ level: "region", ...record });
        break;
      case "Prov":
        if (!state.regionCode) throw new Error(`PSGC row ${rowNumber}: province has no preceding region.`);
        state.provinceCode = code;
        state.cityCode = null;
        records.push({ level: "province", ...record, region_code: state.regionCode });
        break;
      case "City":
      case "Mun":
        if (!state.regionCode) throw new Error(`PSGC row ${rowNumber}: city/municipality has no preceding region.`);
        state.cityCode = code;
        {
          const cityClass = text(row.cityClass).toUpperCase();
          if (sourceLevel === "City" && !["HUC", "ICC", "CC"].includes(cityClass)) {
            throw new Error(`PSGC row ${rowNumber}: unsupported or missing City Class "${cityClass}" for ${name}.`);
          }
          if (sourceLevel === "City" && cityClass === "CC" && !state.provinceCode && code !== PROVINCELESS_COMPONENT_CITY) {
            throw new Error(`PSGC row ${rowNumber}: component city ${name} has no preceding province.`);
          }
          const independentCity = sourceLevel === "City" && (["HUC", "ICC"].includes(cityClass) || code === PROVINCELESS_COMPONENT_CITY);
        records.push({
          level: "city",
          ...record,
          city_code: null,
          region_code: state.regionCode,
          province_code: independentCity ? null : state.provinceCode,
          is_city: sourceLevel === "City",
        });
        }
        break;
      case "Bgy":
        if (!state.cityCode) throw new Error(`PSGC row ${rowNumber}: barangay has no preceding city/municipality.`);
        records.push({ level: "barangay", ...record, city_code: state.cityCode });
        break;
      default:
        throw new Error(`PSGC row ${rowNumber}: unsupported geographic level "${sourceLevel}".`);
    }

    const key = `${records.at(-1).level}:${code}`;
    if (seen.has(key)) throw new Error(`PSGC row ${rowNumber}: duplicate ${key}.`);
    seen.add(key);
  }

  const counts = Object.fromEntries(["region", "province", "city", "barangay"].map((level) => [
    level,
    records.filter((record) => record.level === level).length,
  ]));
  return { records, skipped, counts };
}

export function assertPublicationCounts(counts) {
  const expected = { region: 18, province: 82, city: 1642, barangay: 42010 };
  const mismatches = Object.entries(expected)
    .filter(([level, count]) => counts[level] !== count)
    .map(([level, count]) => `${level}: expected ${count}, found ${counts[level] ?? 0}`);
  if (mismatches.length) {
    throw new Error(`PSA 2Q 2026 record totals do not match the publication summary (${mismatches.join("; ")}).`);
  }
}

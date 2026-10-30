// Encoding gate: every tracked text file must be valid UTF-8 with no
// Windows-1252 mojibake runs (garbled punctuation/accents from misdecoded UTF-8). PowerShell 5.1
// sequences). PowerShell 5.1 Get-Content/Set-Content and `>` redirection
// silently cause exactly this damage (read on this host defaults to the
// system code page and writes UTF-16/BOM), so this gate exists to catch a
// repeat. See AGENTS.md "Text encoding" rule and SYSTEM.md 2026-10-14 entry.
//
// Usage: npm run verify:encoding   (also runs in CI after lint:ci)
// Exit 1 with a file list when mojibake is found; exit 0 when clean.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const files = execSync("git ls-files", { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  .split("\n").map((s) => s.trim()).filter(Boolean)
  .filter((f) => !f.includes("node_modules/") && !f.startsWith(".next/") && !f.startsWith("dist/")
    && !f.startsWith(".expo/") && !f.includes("android/build/") && !f.includes("android/app/build/"))
  .filter((f) => !/\.(png|jpg|jpeg|gif|webp|ico|ttf|otf|woff2?|mp4|wav|pdf|zip|car|sqlite|db|pyc|traineddata)$/i.test(f))
  .filter((f) => !f.includes("__pycache__/"));

const decoder = new TextDecoder("utf-8", { fatal: true });
const CP = {};
for (let i = 0; i < 256; i++) CP[i] = i;
Object.entries({ 0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x2C6: 0x88, 0x2030: 0x89, 0x160: 0x8A, 0x2039: 0x8B, 0x152: 0x8C, 0x17D: 0x8E, 0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x2DC: 0x98, 0x2122: 0x99, 0x161: 0x9A, 0x203A: 0x9B, 0x153: 0x9C, 0x17E: 0x9E, 0x178: 0x9F }).forEach(([k, v]) => { CP[Number(k)] = v; });
function reverseOnce(run) {
  const bytes = Buffer.from([...run].map((c) => {
    const b = CP[c.codePointAt(0)];
    if (b === undefined) throw new Error("unmappable");
    return b;
  }));
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
// A run is mojibake when it reverses (through Windows-1252) to text that no
// longer looks corrupted. Legitimate text (em-dash, quotes, arrows) cannot
// make that round trip, so it is never flagged.
const LEADS = [0xC2, 0xC3, 0xE2, 0xEF].map((c) => String.fromCodePoint(c)).join("");
const DIRTY = new RegExp("[" + LEADS + "]|\uFFFD|[\0-\x1F\uFFFE\uFFFF]");
function isReversibleMojibake(run) {
  try {
    const r1 = reverseOnce(run);
    if (!DIRTY.test(r1) && r1 !== run) return true;
    try {
      const r2 = reverseOnce(r1);
      return !DIRTY.test(r2) && r2 !== run;
    } catch { return false; }
  } catch { return false; }
}

let bad = 0;
for (const f of files) {
  let buf;
  try { buf = readFileSync(f); } catch { continue; }
  let text;
  try { text = decoder.decode(buf); }
  catch { console.log(`INVALID-UTF8 ${f}`); bad++; continue; }
  const re = /[^\x00-\x7F]+/g;
  let m, hits = 0;
  while ((m = re.exec(text)) !== null) {
    if (m[0] === "﻿" && m.index === 0) continue; // real BOM
    if (isReversibleMojibake(m[0])) hits++;
  }
  if (hits > 0) { console.log(`MOJIBAKE ${f}: ${hits} runs`); bad++; }
}
if (bad > 0) {
  console.log(`verify:encoding FAILED: ${bad} file(s) need repair`);
  process.exit(1);
}
console.log("verify:encoding passed: tracked text is valid UTF-8 with no mojibake");

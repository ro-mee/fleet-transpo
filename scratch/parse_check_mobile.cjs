const { parse } = require("@babel/parser");
const fs = require("fs");
const files = [
  "mobile/app/(app)/incidents.js",
  "mobile/app/(app)/submissions.js",
  "mobile/components/DriverSos.js",
  "mobile/lib/sync.js",
];
for (const f of files) {
  try {
    parse(fs.readFileSync(f, "utf8"), { sourceType: "module", plugins: ["jsx"] });
    console.log("OK ", f);
  } catch (e) {
    console.log("FAIL", f, e.message);
    process.exitCode = 1;
  }
}

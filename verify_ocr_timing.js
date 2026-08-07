const fs = require("fs");
const env = fs.readFileSync(".env.local", "utf8");
// timing test of tesseract worker creation + recognition on a text image
(async () => {
  const { createWorker } = await import("tesseract.js");
  const t0 = Date.now();
  let worker;
  try {
    worker = await createWorker("eng");
    console.log("worker ready after", Date.now() - t0, "ms");
  } catch (e) {
    console.log("worker FAILED:", e.message);
    process.exit(1);
  }
  const t1 = Date.now();
  // no image provided — just show that init already consumed time
  console.log("total so far:", Date.now() - t0, "ms");
  await worker.terminate();
})().catch((e) => { console.error("err:", e.message); process.exit(1); });

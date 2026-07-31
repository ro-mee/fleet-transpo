import { requireAuth, ok, err, handleError } from "@/lib/api/utils";
import { readFile } from "fs/promises";
import { join } from "path";

export async function GET() {
  try {
    const filePath = join(process.cwd(), "resources", "ai", "instructions.md");
    const content = await readFile(filePath, "utf-8");
    return ok({ content });
  } catch (e) { return handleError(e); }
}

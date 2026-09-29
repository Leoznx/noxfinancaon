import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const sharedDir = resolve(root, "supabase/functions/_shared");
const sourcePath = resolve(sharedDir, "d4sign.ts");
const templates = {
  fit: "nox-fit.docx",
  fit_plus: "nox-fit-plus.docx",
  smart: "nox-smart.docx",
  smart_plus: "nox-smart-plus.docx",
  up: "nox-up.docx",
};

const startMarker = "// CONTRACT_TEMPLATES_BASE64_START";
const endMarker = "// CONTRACT_TEMPLATES_BASE64_END";
const entries = await Promise.all(
  Object.entries(templates).map(async ([key, fileName]) => {
    const bytes = await readFile(resolve(sharedDir, "contract-templates", fileName));
    return `  ${key}: "${bytes.toString("base64")}",`;
  }),
);
const generated = [
  startMarker,
  "const TEMPLATE_BASE64: Record<TemplateKey, string> = {",
  ...entries,
  "};",
  endMarker,
].join("\n");

let source = await readFile(sourcePath, "utf8");
const pattern = new RegExp(`${startMarker}[\\s\\S]*?${endMarker}`);
if (!pattern.test(source)) {
  throw new Error("Marcadores de templates não encontrados em d4sign.ts");
}
source = source.replace(pattern, generated);
await writeFile(sourcePath, source);

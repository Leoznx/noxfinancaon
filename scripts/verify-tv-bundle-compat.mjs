import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { parse } from "@babel/parser";

const candidateRoots = [
  ".vercel/output/static",
  ".output/public",
  "dist/client",
  "dist",
];

async function collectJavaScriptFiles(directory) {
  const files = [];
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return files;
    throw error;
  }

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectJavaScriptFiles(path)));
    else if (entry.isFile() && /\.(?:js|mjs)$/.test(entry.name)) files.push(path);
  }
  return files;
}

let outputRoot = null;
let files = [];
for (const candidate of candidateRoots) {
  const candidateFiles = await collectJavaScriptFiles(candidate);
  if (candidateFiles.length > 0) {
    outputRoot = candidate;
    files = candidateFiles;
    break;
  }
}

if (!outputRoot) {
  throw new Error(
    "Bundle estático não encontrado. Execute `npm run build` antes de `npm run check:tv-bundle`.",
  );
}

function findIncompatibleSyntax(source) {
  const ast = parse(source, { sourceType: "unambiguous" });
  const stack = [ast];
  const matches = [];

  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;

    if (
      node.type === "OptionalMemberExpression" ||
      node.type === "OptionalCallExpression" ||
      (node.type === "LogicalExpression" && node.operator === "??") ||
      (node.type === "AssignmentExpression" && node.operator === "??=")
    ) {
      matches.push(`${node.type}${node.operator ? ` (${node.operator})` : ""}`);
      if (matches.length >= 3) return matches;
    }

    for (const [key, value] of Object.entries(node)) {
      if (["loc", "start", "end", "extra"].includes(key)) continue;
      if (Array.isArray(value)) {
        for (const child of value) {
          if (child && typeof child === "object") stack.push(child);
        }
      } else if (value && typeof value === "object" && "type" in value) {
        stack.push(value);
      }
    }
  }

  return matches;
}

const incompatible = [];
for (const file of files) {
  const source = await readFile(file, "utf8");
  const matches = findIncompatibleSyntax(source);
  if (matches.length > 0) incompatible.push({ file: relative(outputRoot, file), matches });
}

if (incompatible.length > 0) {
  const details = incompatible
    .map(({ file, matches }) => `${file}: ${matches.join(", ")}`)
    .join("\n");
  throw new Error(
    `O bundle ainda contém sintaxe incompatível com WebViews antigos:\n${details}`,
  );
}

console.log(
  `Compatibilidade da TV confirmada em ${files.length} arquivo(s) JavaScript de ${outputRoot}.`,
);

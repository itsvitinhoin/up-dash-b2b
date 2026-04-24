import { readFileSync, writeFileSync, unlinkSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");

// Remove generated type files whose names clash with Zod schema consts in api.ts.
// Clash happens when an endpoint has BOTH path params AND query params: Orval
// generates `GetXParams` as a Zod path-param schema in api.ts AND as a TS type
// in generated/types for the query params.  We delete the TS type file and patch
// the types/index.ts barrel so it isn't re-exported.
const typesDir = resolve(root, "lib/api-zod/src/generated/types");
const typesIndex = resolve(typesDir, "index.ts");
const apiTs = resolve(root, "lib/api-zod/src/generated/api.ts");

// Detect which names api.ts exports as `export const X = zod.object(...)`.
const apiContent = readFileSync(apiTs, "utf8");
const zodConsts = new Set();
for (const m of apiContent.matchAll(/^export const (\w+) = zod\.object/gm)) {
  zodConsts.add(m[1]);
}

// Read types/index.ts and find lines referencing conflicting type files.
const typesIndexContent = readFileSync(typesIndex, "utf8");
const linesToRemove = new Set();

for (const line of typesIndexContent.split("\n")) {
  const m = line.match(/export \* from ['"]\.\/(\w+)['"]/);
  if (!m) continue;
  // Convert kebab-style filename to PascalCase (e.g. getCustomerDetailParams → GetCustomerDetailParams)
  const pascal = m[1].replace(/(^|-)(\w)/g, (_, _sep, c) => c.toUpperCase());
  if (zodConsts.has(pascal)) {
    linesToRemove.add(line.trim());
    const filePath = resolve(typesDir, `${m[1]}.ts`);
    if (existsSync(filePath)) {
      unlinkSync(filePath);
      console.log(`[fix-zod-index] Removed conflicting type file: ${m[1]}.ts`);
    }
  }
}

// Rewrite types/index.ts without the conflicting lines.
const fixedIndex = typesIndexContent
  .split("\n")
  .filter((line) => !linesToRemove.has(line.trim()))
  .join("\n");
writeFileSync(typesIndex, fixedIndex, "utf8");

// Also restore the api-zod src index to use plain export *.
const srcIndex = resolve(root, "lib/api-zod/src/index.ts");
writeFileSync(
  srcIndex,
  `export * from "./generated/api";\nexport * from "./generated/types";\n`,
  "utf8",
);

console.log("[fix-zod-index] Done — no more GetXParams naming conflicts.");

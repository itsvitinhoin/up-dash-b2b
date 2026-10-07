import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const destination = path.resolve(process.argv[2] ?? path.join(root, "tmp/public-preview"));
const output = path.join(destination, ".vercel/output");
const staticDir = path.join(output, "static");
const functionDir = path.join(output, "functions/api/index.func");
await fs.mkdir(staticDir, { recursive: true });
await fs.mkdir(functionDir, { recursive: true });
await fs.mkdir(path.join(destination, "empty-env"), { recursive: true });

// Demo settings only affect this build. Production source and auth stay unchanged.
process.env.NODE_ENV = "production";
process.env.PORT = "4173";
process.env.BASE_PATH = "/";
process.env.VITE_DESIGN_DEMO = "1";
const { build, loadConfigFromFile } = await import(pathToFileURL(path.join(root, "artifacts/up-dash/node_modules/vite/dist/node/index.js")));
const { config } = await loadConfigFromFile({ command: "build", mode: "production" }, path.join(root, "artifacts/up-dash/vite.config.ts"));
const user = { id: "design-admin", email: "demo@updash.local", firstName: "Time", lastName: "Grupo UP", role: "ADMIN", clientId: null };
const session = {
  "updash.token": "design-preview-local",
  "updash.refresh": "design-preview-refresh",
  "updash.user": JSON.stringify(user),
  "updash.clientId": "design-b2b",
  "updash.dashboardMode": "B2B",
};
await build({
  ...config,
  configFile: false,
  envDir: path.join(destination, "empty-env"),
  plugins: [{
    name: "isolated-public-demo",
    enforce: "pre",
    transform(code, id) {
      if (/\/(components\/app-layout|pages\/(login|dashboard))\.tsx(?:\?|$)/.test(id)) {
        return code.replaceAll(/import\.meta\.env\.DEV\s*&&\s*import\.meta\.env\.VITE_DESIGN_DEMO/g, "import.meta.env.VITE_DESIGN_DEMO");
      }
    },
    transformIndexHtml() {
      return [{ tag: "meta", attrs: { name: "robots", content: "noindex, nofollow" }, injectTo: "head" }, {
        tag: "script", injectTo: "head-prepend",
        children: `(()=>{const values=${JSON.stringify(session)};if(!localStorage.getItem('updash.token'))for(const [key,value] of Object.entries(values))localStorage.setItem(key,value);})();`,
      }];
    },
  }, ...config.plugins],
  build: { ...config.build, outDir: staticDir, emptyOutDir: true },
});

const localPreview = await fs.readFile(path.join(root, "scripts/preview-redesign.mjs"), "utf8");
const dataStart = localPreview.indexOf("const now =");
const handlerStart = localPreview.indexOf("const server = createServer(async (req, res) => {");
const handlerEnd = localPreview.indexOf("\n});\nserver.listen", handlerStart);
if ([dataStart, handlerStart, handlerEnd].some(index => index < 0)) throw new Error("Local demo structure changed; review the public adapter.");
const data = localPreview.slice(dataStart, handlerStart);
let handler = localPreview.slice(handlerStart, handlerEnd).replace("const server = createServer(async (req, res) => {", "export default async function handler(req, res) {");
handler = handler.replace('const url = new URL(req.url, `http://127.0.0.1:${apiPort}`);', `const url = new URL(req.url, 'https://demo.invalid');
  const demoPath = req.query?.__demoPath ?? url.searchParams.get('__demoPath');
  if (demoPath) url.pathname = String(demoPath);
  url.searchParams.delete('__demoPath');`);
handler = handler.replace(/  if \(path === "\/ui-kit"\) \{[\s\S]*?\n  \}\n/, "");
if (handler.includes("apiPort") || handler.includes("readFileSync") || handler.includes("createServer")) throw new Error("Public demo must not start a server or read workspace files.");
await fs.writeFile(path.join(functionDir, "index.mjs"), `import { organizationFixture } from './organization-fixtures.mjs';\n${data}${handler}\n}\n`);
await fs.copyFile(path.join(root, "scripts/organization-fixtures.mjs"), path.join(functionDir, "organization-fixtures.mjs"));
await fs.writeFile(path.join(functionDir, ".vc-config.json"), JSON.stringify({ runtime: "nodejs22.x", handler: "index.mjs", launcherType: "Nodejs", supportsResponseStreaming: false }, null, 2));
await fs.writeFile(path.join(output, "config.json"), JSON.stringify({
  version: 3,
  routes: [
    { src: "/api/(.*)", dest: "/api/index?__demoPath=/api/$1" },
    { handle: "filesystem" },
    { src: "/(.*)", dest: "/index.html" },
  ],
}, null, 2));
await fs.writeFile(path.join(destination, "package.json"), JSON.stringify({ name: "up-dash-glass-preview", private: true, type: "module" }, null, 2));
await fs.writeFile(path.join(destination, "README.md"), "# UP Dash Glass · Public visual preview\n\nPrebuilt frontend and synthetic read-only API. No database, integration credentials, extraction jobs or production environment variables are included. Build with scripts/build-public-preview.mjs; deploy only to the dedicated up-dash-glass-preview project.\n");
console.log(`Public preview prepared: ${destination}`);

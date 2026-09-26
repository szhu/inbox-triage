#!/usr/bin/env bun
// Transpiles each src/server/*.ts file to dist/*.js independently (no
// bundling — Apps Script's multiple .gs files share one global scope), then
// compiles src/client/client.ts and splices it into main.js in place of the
// __CLIENT_JS__ placeholder, since that file runs in the browser, not
// alongside the server files. The compiled client JS is written outside
// dist/ so it never gets pushed to Apps Script as its own file — it would
// fail there, since its top-level code assumes a browser (google.script.run,
// document, etc.) rather than the server global scope Apps Script evaluates
// every dist/*.js file in.

import { readdir } from "node:fs/promises";

const root = new URL("..", import.meta.url).pathname;

async function buildFile(entry: string, outfile: string) {
  const proc = Bun.spawn(
    ["bun", "build", entry, "--outfile", outfile, "--target", "browser", "--no-bundle"],
    { cwd: root, stdout: "inherit", stderr: "inherit" },
  );
  if ((await proc.exited) !== 0) throw new Error(`Failed to build ${entry}`);
}

const serverFiles = (await readdir(`${root}src/server`)).filter((f) => f.endsWith(".ts"));
for (const file of serverFiles) {
  await buildFile(`src/server/${file}`, `dist/${file.replace(/\.ts$/, ".js")}`);
}

await buildFile("src/client/client.ts", ".build/client.js");
const clientJs = await Bun.file(`${root}.build/client.js`).text();
const mainJs = await Bun.file(`${root}dist/main.js`).text();
// main.js's PAGE_HTML is itself a backtick template literal, so the spliced
// text must be escaped as if it were going inside one (JSON.stringify's
// escaping is for double-quoted strings, not backtick literals, so it can't
// be used here as-is).
const escapedClientJs = clientJs.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
await Bun.write(`${root}dist/main.js`, mainJs.replace("__CLIENT_JS__", () => escapedClientJs));

await Bun.write(`${root}dist/appsscript.json`, Bun.file(`${root}appsscript.json`));

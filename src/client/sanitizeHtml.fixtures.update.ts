// Rewrites the expected-output block of every case in
// sanitizeHtml.fixtures.md to whatever sanitizeHtmlToString() actually
// produces for that case's input block right now, so fixtures never have to
// be hand-copied from a manual test run. Run after editing an input block,
// or after a real sanitizeHtml.ts change, then review the diff for
// correctness -- this script has no opinion on whether the new output is
// right, only on making the file match the code.
//
// Usage: bun run src/client/sanitizeHtml.fixtures.update.ts

import { Window } from "happy-dom";
import { sanitizeHtmlToString } from "./sanitizeHtml";
import { FixtureFile } from "./sanitizeHtml.fixtures.parse";

const window = new Window();
Object.assign(globalThis, {
  document: window.document,
  DOMParser: window.DOMParser,
  Node: window.Node,
});

const fixturesPath = new URL("./sanitizeHtml.fixtures.md", import.meta.url)
  .pathname;
const markdown = await Bun.file(fixturesPath).text();
const fixtures = new FixtureFile(markdown);

let updated = 0;
for (const case_ of fixtures.cases) {
  const newExpected = sanitizeHtmlToString(case_.input);
  if (newExpected !== case_.expectedOutput) {
    updated++;
    case_.setExpectedOutput(newExpected);
  }
}

await Bun.write(fixturesPath, fixtures.toMarkdown());
console.log(
  updated === 0
    ? "No expected-output blocks changed."
    : `Updated ${updated} expected-output block(s). Review the diff.`,
);

// Regression tests for sanitizeHtml, driven by the fixtures in
// sanitizeHtml.fixtures.md -- see that file for what each case covers and
// why. This file is just the parser/runner: it reads fixtures.md (a
// static import, so `bun test --watch` re-runs when the fixtures change,
// unlike a runtime readFileSync), turns each case into a real test(), and
// runs it through the same code path client.ts uses in production.

import { Window } from "happy-dom";
import { beforeAll, expect, test } from "bun:test";
import { sanitizeHtmlToString } from "./sanitizeHtml";
import { FixtureFile as FixturesFile } from "./sanitizeHtml.fixtures.parse";

import sanitizeHtmlFixturesMd from "./sanitizeHtml.fixtures.md" with {
  type: "text",

  // Override Bun's default Markdown-to-HTML transform for .md imports.
  loader: "text",
};

beforeAll(() => {
  // sanitizeHtml uses DOMParser/document/Node directly as globals (it runs
  // in a browser in production), so a DOM implementation needs to be
  // installed before it's called. happy-dom is lighter than jsdom and is
  // enough for the plain-HTML parsing this function does.
  const window = new Window();
  Object.assign(globalThis, {
    document: window.document,
    DOMParser: window.DOMParser,
    Node: window.Node,
  });
});

for (const case_ of new FixturesFile(sanitizeHtmlFixturesMd).cases) {
  test(case_.name, () => {
    expect(sanitizeHtmlToString(case_.input)).toBe(case_.expectedOutput);
  });
}

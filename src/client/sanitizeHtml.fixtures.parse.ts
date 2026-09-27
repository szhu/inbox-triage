// Parses sanitizeHtml.fixtures.md's cases behind a small array-like API:
// f.length, f.get(i) (a snapshot -- name/input/expectedOutput as plain
// strings), f.setExpected(i, text), f.toMarkdown(). Callers never see how
// a case's content is actually stored.
//
// Internally, the file is kept as a flat array of lines except that each
// fenced ```html block's content is collapsed into a single array entry
// (however many lines it spans) instead of one entry per line -- so a
// case's content can be overwritten by index without touching the
// surrounding prose, and reassembly is always `entries.join("\n")`.

const CASE_HEADING = /^### (.+)$/;
const FENCE = "```txt";
const FENCE_END = "```";

export interface TestCase {
  name: string;
  input: string;
  expectedOutput: string;
  setExpectedOutput: (expectedOutput: string) => void;
}

export class FixtureFile {
  private sourceLines: string[];
  cases: TestCase[];

  constructor(markdown: string) {
    const lines = markdown.split("\n");
    const cases: TestCase[] = [];
    const sourceLines: string[] = [];
    let i = 0;
    let name = "";

    // Finds the next heading (if any), then sets the name of the case.
    // Also adds non-matching lines it finds beforehand.
    function processUpToAndIncludingNextHeading(): void {
      while (i < lines.length && !CASE_HEADING.test(lines[i])) {
        sourceLines.push(lines[i]);
        i++;
      }
      if (i >= lines.length) return;
      name = CASE_HEADING.exec(lines[i])![1].trim();
      sourceLines.push(lines[i]);
      i++;
    }

    // Finds the next fenced block and adds it to entries.
    // Also adds non-matching lines it finds beforehand.
    function processUpToAndIncludingNextFencedBlock(): void {
      while (i < lines.length && lines[i] !== FENCE) {
        sourceLines.push(lines[i]);
        i++;
      }
      if (i >= lines.length) {
        throw new Error(
          `sanitizeHtml.fixtures.md: expected an \`\`\`html block for "${name}", reached end of file`,
        );
      }
      sourceLines.push(lines[i]);
      const start = ++i;

      // Finds the closing fence, then appends the entire block as a single
      // "source line".
      while (i < lines.length && lines[i] !== FENCE_END) i++;
      if (i >= lines.length) {
        throw new Error(
          `sanitizeHtml.fixtures.md: unterminated \`\`\`html block for "${name}", reached end of file`,
        );
      }
      sourceLines.push(lines.slice(start, i).join("\n"));
      sourceLines.push(lines[i]);
      i++;
    }

    while (true) {
      processUpToAndIncludingNextHeading();
      if (i >= lines.length) break; // no more headings
      processUpToAndIncludingNextFencedBlock();
      const inputIndex = sourceLines.length - 2;
      processUpToAndIncludingNextFencedBlock();
      const expectedIndex = sourceLines.length - 2;

      cases.push({
        name: name,
        input: sourceLines[inputIndex],
        get expectedOutput() {
          return sourceLines[expectedIndex];
        },
        setExpectedOutput: (expectedOutput: string) => {
          sourceLines[expectedIndex] = expectedOutput;
        },
      });
    }

    this.sourceLines = sourceLines;
    this.cases = cases;
  }

  toMarkdown(): string {
    return this.sourceLines.join("\n");
  }
}

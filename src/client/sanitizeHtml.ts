// Tags whose formatting we keep as real elements (structural markup like
// lists/tables gets to lay itself out natively, since flattening it to a
// <br>-separated text stream would make it unreadable). Everything else is
// unwrapped (its children are kept, the element itself is dropped) so
// styling/layout markup from the original HTML email can't leak into the
// plain look.
//
// Exception: tables are frequently used as pure layout scaffolding in
// marketing/transactional emails (one <td> per <tr>, nested many levels
// deep just for spacing) rather than as real tabular data. A table like
// that is unwrapped like a div instead of kept, on a per-table basis --
// see isLayoutTable.
const ALLOWED_TAGS = new Set([
  "a",
  "b",
  "strong",
  "i",
  "em",
  "u",
  "br",
  "ul",
  "ol",
  "li",
  "table",
  "tr",
  "td",
  "th",
]);
// A table/tbody/thead/tfoot that has content in at most one column per row
// is pure layout, not real tabular data -- treat it (and its rows/cells)
// like divs instead of keeping the table structure natively.
const TABLE_CONTAINER_TAGS = new Set(["table", "tbody", "thead", "tfoot"]);
// Unwrapped tags that mark a paragraph break (blank line) between siblings,
// as opposed to a plain line break -- so p+p reads as two paragraphs, not
// two lines glued together the way div+div is.
const PARAGRAPH_TAGS = new Set(["p", "blockquote"]);
// Unwrapped tags that mark a single line break between siblings (they're
// block-level in the original HTML, just not a paragraph). Anything NOT in
// this set or PARAGRAPH_TAGS is treated as purely inline (font, span, and
// the like) and contributes no break at all when unwrapped -- so a <font>
// wrapping a whole message doesn't glue every top-level div into one block,
// but also doesn't introduce spacing of its own.
const LINE_BREAK_TAGS = new Set(["div"]);
// Tags dropped along with all of their content (never even shown as text).
const DROPPED_TAGS = new Set(["script", "style", "head", "img"]);
const SAFE_URL = /^(https?:|mailto:)/i;

// Parses a Gmail message's HTML body with the browser's own HTML parser
// (DOMParser -- no regex-based HTML handling) and rebuilds it as a
// DocumentFragment containing only an allowlisted set of formatting tags
// and safe link URLs, so it's safe to insert into the page while still
// keeping links clickable and bold/italic text intact.
export function sanitizeHtmlToNode(html: string): DocumentFragment {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const out = document.createDocumentFragment();

  function walk(node: Node, dest: Node) {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        dest.appendChild(document.createTextNode(child.textContent ?? ""));
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const el = child as Element;
      const tag = el.tagName.toLowerCase();

      if (DROPPED_TAGS.has(tag)) continue;

      if (tag === "table" && isLayoutTable(el)) {
        // Pure layout table (at most one column with content per row):
        // flatten it like a p -- a paragraph-sized gap between cells/rows,
        // skipping the tr/td wrappers entirely rather than keeping them
        // as table structure. Cells belonging to a nested table are left
        // for that table's own (recursive) walk to handle.
        for (const cell of directCells(el)) {
          const cellContent = document.createDocumentFragment();
          walk(cell, cellContent);
          trimBreaksAndWhitespace(cellContent);
          if (!cellContent.firstChild) continue;
          if (dest.lastChild) {
            dest.appendChild(document.createElement("br"));
            dest.appendChild(document.createElement("br"));
          }
          dest.appendChild(cellContent);
        }
        continue;
      }

      if (!ALLOWED_TAGS.has(tag)) {
        // Unwrap: keep the content, drop the element, and mark whatever
        // break it implied -- two <br>s for a paragraph-like tag (a
        // blank-line gap between siblings), one for a block-level
        // line-grouping tag like div, or none at all for a purely inline
        // wrapper like font/span, which shouldn't introduce spacing.
        // Repeated fragmentation of the same source paragraph into many
        // nested divs/ps is squashed back down by collapseRepeatedBreaks.
        const isBlockLike = PARAGRAPH_TAGS.has(tag) || LINE_BREAK_TAGS.has(tag);
        const breaks = PARAGRAPH_TAGS.has(tag) ? 2 : isBlockLike ? 1 : 0;
        if (dest.lastChild) {
          for (let i = 0; i < breaks; i++) {
            dest.appendChild(document.createElement("br"));
          }
        }
        if (isBlockLike) {
          // p/div's own leading/trailing whitespace or <br>s (formatting
          // noise from the source HTML) shouldn't survive as part of its
          // content -- trim it the same way a kept element's content is.
          const content = document.createDocumentFragment();
          walk(el, content);
          trimBreaksAndWhitespace(content);
          dest.appendChild(content);
        } else {
          walk(el, dest);
        }
        continue;
      }

      const clean = document.createElement(tag);
      if (tag === "a") {
        const href = el.getAttribute("href") ?? "";
        if (SAFE_URL.test(href)) {
          clean.setAttribute("href", href);
          clean.setAttribute("target", "_blank");
          clean.setAttribute("rel", "noopener noreferrer");
        }
      }
      walk(el, clean);
      trimBreaksAndWhitespace(clean);
      // A link with nothing but whitespace for its label (a common
      // tracking-pixel-style artifact in marketing emails) isn't a link
      // worth keeping -- drop it rather than leaving a dead clickable gap.
      if (tag === "a" && (clean.textContent ?? "").trim() === "") continue;
      dest.appendChild(clean);
    }
  }

  walk(doc.body, out);
  collapseRepeatedBreaks(out);
  trimBreaksAndWhitespace(out);
  return out;
}

// Strips leading/trailing <br>s and whitespace-only text so an element (or
// the top-level fragment) doesn't start/end with the blank space left over
// from the original HTML's own formatting/indentation.
function trimBreaksAndWhitespace(node: Node) {
  while (
    node.firstChild &&
    (isBreak(node.firstChild) || isWhitespaceText(node.firstChild))
  ) {
    node.removeChild(node.firstChild);
  }
  while (
    node.lastChild &&
    (isBreak(node.lastChild) || isWhitespaceText(node.lastChild))
  ) {
    node.removeChild(node.lastChild);
  }
}

// The <td>/<th> cells that belong to `table` itself (via its rows), not to
// any table nested inside one of those cells.
function directCells(table: Element): Element[] {
  const cells: Element[] = [];
  for (const row of directRows(table)) {
    for (const cell of Array.from(row.children)) {
      const tag = cell.tagName.toLowerCase();
      if (tag === "td" || tag === "th") cells.push(cell);
    }
  }
  return cells;
}

// The <tr> rows that belong to `table` itself, looking through an
// immediate <tbody>/<thead>/<tfoot> wrapper but not into a nested table.
function directRows(table: Element): Element[] {
  const rows: Element[] = [];
  for (const child of Array.from(table.children)) {
    const tag = child.tagName.toLowerCase();
    if (tag === "tr") rows.push(child);
    else if (TABLE_CONTAINER_TAGS.has(tag)) rows.push(...directRows(child));
  }
  return rows;
}

// A table is pure layout, not real tabular data, if no row has content in
// more than one column -- e.g. every <tr> has at most one non-empty
// <td>/<th>, even if there are several empty spacer cells alongside it.
function isLayoutTable(table: Element): boolean {
  for (const row of directRows(table)) {
    let nonEmptyCells = 0;
    for (const cell of Array.from(row.children)) {
      const tag = cell.tagName.toLowerCase();
      if (tag !== "td" && tag !== "th") continue;
      if ((cell.textContent ?? "").trim() !== "") nonEmptyCells++;
    }
    if (nonEmptyCells > 1) return false;
  }
  return true;
}

// Kept block-level elements: a <br> run touching one of these doesn't need
// its own full paragraph gap, since the element itself already reads as a
// visually distinct block -- so the run is capped at 1 there instead of 2.
const BLOCK_ELEMENT_TAGS = new Set(["ul", "ol", "li", "table"]);

// Empty block elements in the original HTML (a very common artifact of
// Gmail's own composer, e.g. a chain of blank <div>s) each turn into one
// <br> above, so a run of them becomes a run of consecutive <br>s; collapse
// any run of 2+ down to exactly two (a paragraph-sized gap), or down to
// exactly one when the run is directly adjacent to a kept block-level
// element (ul/ol/li/table) on either side, since that element already
// provides its own visual separation. Whitespace-only text nodes
// (insignificant indentation from the source HTML) next to a <br> don't
// break up a run -- they're removed so e.g. "<br><br>\n\n<br><br>" (two
// runs separated only by formatting whitespace) collapses to one.
function collapseRepeatedBreaks(root: Node) {
  let child = root.firstChild;
  while (child) {
    if (isBreak(child)) {
      const runStart = child;
      while (isWhitespaceText(child.nextSibling)) {
        root.removeChild(child.nextSibling!);
      }
      let count = 1;
      while (child.nextSibling && isBreak(child.nextSibling)) {
        count++;
        child = child.nextSibling;
        while (isWhitespaceText(child.nextSibling)) {
          root.removeChild(child.nextSibling!);
        }
      }
      const touchesBlock =
        isBlockElement(runStart.previousSibling) ||
        isBlockElement(child.nextSibling);
      const max = touchesBlock ? 1 : 2;
      while (count > max) {
        root.removeChild(runStart.nextSibling!);
        count--;
      }
      child = child.nextSibling;
    } else {
      const next = child.nextSibling;
      if (child.nodeType === Node.ELEMENT_NODE) collapseRepeatedBreaks(child);
      child = next;
    }
  }
}

function isBlockElement(node: Node | null): boolean {
  return (
    node !== null &&
    node.nodeType === Node.ELEMENT_NODE &&
    BLOCK_ELEMENT_TAGS.has((node as Element).tagName.toLowerCase())
  );
}

function isBreak(node: Node): boolean {
  return (
    node.nodeType === Node.ELEMENT_NODE &&
    (node as Element).tagName.toLowerCase() === "br"
  );
}

function isWhitespaceText(node: Node | null): boolean {
  return (
    node !== null &&
    node.nodeType === Node.TEXT_NODE &&
    /^\s*$/.test(node.textContent ?? "")
  );
}

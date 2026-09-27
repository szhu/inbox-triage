// Runs in the browser, inside Apps Script's sandboxed iframe — a completely
// different runtime from src/server/*.ts (which runs server-side with access
// to GmailApp etc., and shares nothing with this file at runtime). Talks to
// the server only through google.script.run.

import { El } from "./el";

interface ScriptRunner {
  withSuccessHandler(callback: (value: any) => void): ScriptRunner;
  withFailureHandler(callback: (error: Error) => void): ScriptRunner;
  [serverFunction: string]: any;
}
declare const google: { script: { run: ScriptRunner } };

// Marks el as pending (via a CSS class) for the duration of a server call,
// so in-flight vs. completed is visible without any per-call bookkeeping.
function withPending(
  el: HTMLElement,
  onSuccess?: (value: any) => void,
): ScriptRunner {
  el.classList.add("pending");
  const settle = (handler?: (value: any) => void) => (value: any) => {
    el.classList.remove("pending");
    handler?.(value);
  };
  return google.script.run
    .withSuccessHandler(settle(onSuccess))
    .withFailureHandler(settle(fail));
}

const ICONS = {
  archive:
    '<svg viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="3" fill="none" stroke="currentColor"/><path d="M3 6h10v7H3z" fill="none" stroke="currentColor"/><path d="M6.5 8.5h3M8 8.5v3M6.5 10l1.5 1.5L9.5 10" fill="none" stroke="currentColor"/></svg>',
  unarchive:
    '<svg viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="3" fill="none" stroke="currentColor"/><path d="M3 6h10v7H3z" fill="none" stroke="currentColor"/><path d="M6.5 11.5h3M8 11.5v-3M6.5 10l1.5-1.5L9.5 10" fill="none" stroke="currentColor"/></svg>',
  unread:
    '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="4" fill="currentColor"/></svg>',
  read: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="4" fill="none" stroke="currentColor"/></svg>',
  refresh:
    '<svg viewBox="0 0 16 16"><path d="M3 8a5 5 0 0 1 8.5-3.5M13 8a5 5 0 0 1-8.5 3.5" fill="none" stroke="currentColor"/><path d="M11 2v3h-3M5 14v-3h3" fill="none" stroke="currentColor"/></svg>',
  star: '<svg viewBox="0 0 16 16"><path d="M8 2l1.8 3.9 4.2.5-3.1 3 .8 4.3L8 11.6 4.3 13.7l.8-4.3-3.1-3 4.2-.5z" fill="currentColor"/></svg>',
  unstar:
    '<svg viewBox="0 0 16 16"><path d="M8 2l1.8 3.9 4.2.5-3.1 3 .8 4.3L8 11.6 4.3 13.7l.8-4.3-3.1-3 4.2-.5z" fill="none" stroke="currentColor"/></svg>',
};

const PAGE_SIZE = 50;
let allThreads: any[] = [];
let reachedEndOfInbox = false;
let loadingMore = false;
refresh();

// A cache-and-dedupe layer in front of server calls whose results never go
// stale for a given key (e.g. a thread's messages, which are immutable once
// sent). A successful result is cached forever; a call already in flight for
// the same key is joined instead of firing a duplicate request.
const callCache = new Map<string, any>();
const callsInFlight = new Map<string, Array<(result: any) => void>>();

function cachedCall(
  key: string,
  run: (onSuccess: (result: any) => void) => void,
  onSuccess: (result: any) => void,
) {
  if (callCache.has(key)) {
    onSuccess(callCache.get(key));
    return;
  }
  const waiters = callsInFlight.get(key);
  if (waiters) {
    waiters.push(onSuccess);
    return;
  }
  callsInFlight.set(key, [onSuccess]);
  run((result) => {
    callCache.set(key, result);
    const toNotify = callsInFlight.get(key) ?? [];
    callsInFlight.delete(key);
    for (const notify of toNotify) notify(result);
  });
}

function fetchThreadMessages(
  threadId: string,
  onSuccess: (messages: any[]) => void,
) {
  cachedCall(
    `getThreadMessages:${threadId}`,
    (settle) =>
      google.script.run
        .withSuccessHandler(settle)
        .withFailureHandler(fail)
        .getThreadMessages(threadId),
    onSuccess,
  );
}

// Bumped every time a different sender is selected, so an in-flight
// background prefetch from a previously selected sender can tell it's stale
// and stop issuing further fetches instead of racing the new selection.
let senderPrefetchGeneration = 0;

// Prefetches (and caches) messages for every thread in a sender's group in
// the background, one at a time, so opening any of them afterward is
// instant. Stops as soon as a different sender is selected.
function prefetchSenderMessages(group: string, generation: number) {
  const threadIds = allThreads
    .filter((t) => t.senderGroup === group)
    .map((t) => t.id)
    .filter((id) => !callCache.has(`getThreadMessages:${id}`));
  let i = 0;
  const next = () => {
    if (generation !== senderPrefetchGeneration) return;
    if (i >= threadIds.length) return;
    const threadId = threadIds[i++];
    fetchThreadMessages(threadId, () => {
      if (generation !== senderPrefetchGeneration) return;
      next();
    });
  };
  next();
}

document
  .getElementById("topbar")!
  .appendChild(
    IconButton({ icon: "refresh", title: "Refresh", onclick: refresh }),
  );

document.getElementById("main")!.addEventListener("scroll", maybeLoadMore);

function refresh() {
  reachedEndOfInbox = false;
  google.script.run
    .withSuccessHandler((threads: any[]) => {
      allThreads = threads;
      reachedEndOfInbox = threads.length < PAGE_SIZE;
      render();
    })
    .withFailureHandler(fail)
    .listInboxThreads(0);
}

function maybeLoadMore() {
  if (loadingMore || reachedEndOfInbox) return;
  const main = document.getElementById("main")!;
  if (main.scrollTop + main.clientHeight < main.scrollHeight - 200) return;
  loadingMore = true;
  google.script.run
    .withSuccessHandler((threads: any[]) => {
      loadingMore = false;
      reachedEndOfInbox = threads.length < PAGE_SIZE;
      allThreads = allThreads.concat(threads);
      document.getElementById("status")!.textContent =
        allThreads.length + " threads";
      renderSenders(false);
      maybeLoadMore();
    })
    .withFailureHandler((error: Error) => {
      loadingMore = false;
      fail(error);
    })
    .listInboxThreads(allThreads.length);
}

function buildRow(t: any): HTMLElement {
  let row: HTMLElement;
  row = El(
    {
      "tag": "div",
      "class": "row",
      "data-sender-group": t.senderGroup,
      "data-thread-id": t.id,
      "onclick": () => toggleThread(t.id, row),
    },
    El({ tag: "span", class: "cell subject" }, t.subject),
    El(
      { tag: "span", class: "cell date" },
      new Date(t.date).toLocaleDateString(undefined, {
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }),
    ),
    El({ tag: "span", class: "cell count" }, String(t.messageCount)),
    El(
      { tag: "span", class: "cell actions" },
      IconButton({
        icon: "archive",
        title: "Archive",
        onclick: (btn) => archiveOne(t.id, row, btn),
      }),
      IconButton({
        icon: t.isUnread ? "unread" : "read",
        title: "Toggle read",
        onclick: (btn) => toggleThreadRead(t.id, btn),
      }),
      IconButton({
        icon: t.isStarred ? "star" : "unstar",
        title: "Toggle star",
        onclick: (btn) => toggleThreadStarred(t.id, btn),
      }),
    ),
  );
  return row;
}

function renderThreadRows() {
  const rows = document.querySelector("#threads .rows")!;
  rows.innerHTML = "";
  for (const t of allThreads) rows.appendChild(buildRow(t));
  document.getElementById("threads")!.hidden = false;
}

function render() {
  document.getElementById("status")!.textContent =
    allThreads.length + " threads";
  renderThreadRows();
  renderSenders();
  maybeLoadMore();
}

function renderSenders(reselect = true) {
  const senderList = document.getElementById("senders")!;
  const prevSelected = (senderList.querySelector(".selected") as HTMLElement)
    ?.dataset.group;
  senderList.innerHTML = "";
  const groups = [...new Set(allThreads.map((t) => t.senderGroup))];
  for (const group of groups) {
    const inGroup = allThreads.filter((t) => t.senderGroup === group);
    const unread = inGroup.filter((t) => t.isUnread).length;
    const isMailingList = inGroup.some((t) => t.isMailingList);
    const secondLine = isMailingList ? inGroup[0].listId : group;
    const { name, othersCount } = senderGroupSummary(inGroup);
    const displayNameEl = El(
      { tag: "span", class: "sender-display-name" },
      name || group,
      othersCount
        ? El({ tag: "span", class: "sender-others-count" }, ` +${othersCount}`)
        : "",
    );
    let row: HTMLElement;
    row = El(
      {
        "tag": "div",
        "class": "sender-row",
        "data-group": group,
        "onclick": () => selectSender(group, row),
      },
      El(
        { tag: "span", class: "sender-text" },
        displayNameEl,
        El({ tag: "span", class: "sender-name" }, secondLine),
      ),
      El({ tag: "span", class: "unread-count" }, unread ? String(unread) : ""),
      IconButton({
        icon: "archive",
        title: "Archive all",
        onclick: (btn) => archiveSender(group, btn),
      }),
    );
    senderList.appendChild(row);
  }
  const toSelect =
    [...senderList.children].find(
      (r) => (r as HTMLElement).dataset.group === prevSelected,
    ) ?? senderList.firstChild;
  if (!toSelect) return;
  if (reselect) {
    selectSender(
      (toSelect as HTMLElement).dataset.group!,
      toSelect as HTMLElement,
    );
  } else {
    (toSelect as HTMLElement).classList.add("selected");
  }
}

// Shows who sent the most recent thread in the group, plus how many other
// distinct people/senders have also sent one -- e.g. "Aria Kovalovich +2"
// -- rather than an arbitrary single name, since a sender group commonly
// bundles several distinct senders (a mailing list's many posters, or a
// domain like google.com covering several different Google products/teams).
// The "+N" part is returned separately so it can be styled less prominently
// than the name itself.
function senderGroupSummary(threads: any[]): {
  name: string;
  othersCount: number;
} {
  const byRecency = [...threads].sort((a, b) => b.date.localeCompare(a.date));
  // Prefer the most recent thread that actually has a display name over a
  // merely-more-recent one that doesn't, so the headline name isn't a raw,
  // hard-to-read address like "noreply-apps-scripts-notifications@google.com"
  // just because it happens to be the latest.
  const mostRecent = byRecency.find((t) => t.senderName) ?? byRecency[0];
  const recentName = mostRecent.senderName || mostRecent.sender;
  const names = threads.map((t) => t.senderName || t.sender);
  const others = new Set(names.filter((n) => n !== recentName));

  // --- Shared-phrase override (remove this block to revert to always
  // showing "<most recent sender> +N others") ---
  // When every sender's display name shares a contiguous phrase (e.g.
  // "American Airlines AAdvantage" and "American Airlines Cargo" both start
  // with "American Airlines"), that phrase alone is a better headline than
  // any one sender's name plus a "+N" -- it's the actual reason these are
  // grouped together, not an arbitrary pick.
  const wordsOf = (name: string) => name.split(/\s+/).filter(Boolean);
  const containsWordSequence = (haystack: string[], needle: string[]) => {
    for (let i = 0; i <= haystack.length - needle.length; i++) {
      if (
        needle.every(
          (word, j) => haystack[i + j].toLowerCase() === word.toLowerCase(),
        )
      ) {
        return true;
      }
    }
    return false;
  };
  if (names.length > 0) {
    const firstWords = wordsOf(names[0]);
    const otherWordLists = names.slice(1).map(wordsOf);
    let sharedPhrase = "";
    // Try every contiguous span of the first name's words, longest first, and
    // keep the longest one that's present in every other name too.
    for (let len = firstWords.length; len >= 1 && !sharedPhrase; len--) {
      for (let start = 0; start + len <= firstWords.length; start++) {
        const span = firstWords.slice(start, start + len);
        if (
          otherWordLists.every((words) => containsWordSequence(words, span))
        ) {
          sharedPhrase = span.join(" ");
          break;
        }
      }
    }
    if (sharedPhrase) {
      return { name: sharedPhrase, othersCount: 0 };
    }
  }
  // --- end shared-phrase override ---

  return { name: recentName, othersCount: others.size };
}

function IconButton({
  icon,
  title,
  onclick,
}: {
  icon: keyof typeof ICONS;
  title: string;
  onclick: (btn: HTMLButtonElement) => void;
}): HTMLButtonElement {
  let btn: HTMLButtonElement;
  btn = El({
    tag: "button",
    class: "icon-btn",
    title,
    onclick: (e: Event) => {
      e.stopPropagation();
      onclick(btn);
    },
  }) as HTMLButtonElement;
  btn.innerHTML = ICONS[icon];
  return btn;
}

function selectSender(group: string, el: HTMLElement) {
  document
    .querySelectorAll("#senders .selected")
    .forEach((d) => d.classList.remove("selected"));
  el.classList.add("selected");
  // Threads loaded in the background (infinite scroll) never get a row
  // built on the right side, since that side intentionally isn't touched
  // by a background load -- rebuild it here so switching senders always
  // shows all of that sender's threads, not just the ones from the first
  // page.
  renderThreadRows();
  const matchingRows: HTMLElement[] = [];
  for (const row of document.querySelectorAll<HTMLElement>(
    "#threads .rows > .row",
  )) {
    const matches = row.dataset.senderGroup === group;
    row.classList.toggle("hidden-row", !matches);
    if (matches) matchingRows.push(row);
  }
  // A sender with just one thread has nothing to pick between -- open it
  // immediately instead of making that a required extra click.
  if (matchingRows.length === 1) {
    toggleThread(matchingRows[0].dataset.threadId!, matchingRows[0]);
  }
  senderPrefetchGeneration++;
  prefetchSenderMessages(group, senderPrefetchGeneration);
}

function toggleThread(threadId: string, tr: HTMLElement) {
  const existing = tr.nextElementSibling as HTMLElement | null;
  if (existing && existing.dataset.messagesFor === threadId) {
    existing.remove();
    tr.classList.remove("open");
    return;
  }
  document.querySelectorAll("[data-messages-for]").forEach((r) => r.remove());
  document
    .querySelectorAll("#threads .row.open")
    .forEach((r) => r.classList.remove("open"));
  tr.classList.add("open");
  const cell = El({ tag: "div", class: "cell messages-cell" }, "Loading...");
  const row = El(
    {
      "tag": "div",
      "class": "row messages-row",
      "data-messages-for": threadId,
    },
    cell,
  );
  tr.after(row);
  fetchThreadMessages(threadId, (messages) =>
    renderMessages(messages, cell, threadId),
  );
}

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
export function sanitizeHtml(html: string): DocumentFragment {
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

function renderMessages(messages: any[], cell: HTMLElement, threadId: string) {
  cell.innerHTML = "";
  cell.appendChild(
    El(
      {},
      El(
        {
          tag: "a",
          class: "open-in-gmail",
          href:
            "https://mail.google.com/mail/?authuser=" +
            messages[0].userEmail +
            "#all/" +
            threadId,
          target: "_blank",
        },
        "Open thread in Gmail",
      ),
    ),
  );
  for (const m of messages) {
    const address = m.from.match(/<([^>]+)>/)?.[1] ?? m.from;
    const header = El(
      { tag: "div", class: "message-header" },
      m.fromName
        ? El(
            "span",
            El({ tag: "span", class: "message-from-name" }, m.fromName),
            " <" + address + ">",
          )
        : El("span", m.from),
      El("span", new Date(m.date).toLocaleString()),
    );
    const bodyEl = El({ tag: "div", class: "message-body" });
    bodyEl.appendChild(sanitizeHtml(m.body));
    const div = El({ tag: "div", class: "messages" }, header, bodyEl);
    cell.appendChild(div);
  }
}

function archiveOne(threadId: string, tr: HTMLElement, btn: HTMLElement) {
  const t = allThreads.find((t) => t.id === threadId);
  const nowArchived = !t.archived;
  withPending(btn).setThreadArchived(threadId, nowArchived);
  t.archived = nowArchived;
  tr.classList.toggle("archived", nowArchived);
  btn.innerHTML = ICONS[nowArchived ? "unarchive" : "archive"];
  renderSenders();
}

function archiveSender(group: string, btn: HTMLElement) {
  const toArchive = allThreads.filter(
    (t) => t.senderGroup === group && !t.archived,
  );
  withPending(btn).archiveThreads(toArchive.map((t) => t.id));
  for (const t of toArchive) {
    t.archived = true;
    document
      .querySelector(`tr[data-thread-id="${t.id}"]`)
      ?.classList.add("archived");
  }
  btn.closest(".sender-row")!.classList.add("archived");
}

function toggleThreadRead(threadId: string, btn: HTMLButtonElement) {
  const t = allThreads.find((t) => t.id === threadId);
  const nowRead = t.isUnread;
  withPending(btn).markThreadRead(threadId, nowRead);
  t.isUnread = !nowRead;
  btn.innerHTML = ICONS[t.isUnread ? "unread" : "read"];
  renderSenders();
}

function toggleThreadStarred(threadId: string, btn: HTMLButtonElement) {
  const t = allThreads.find((t) => t.id === threadId);
  const nowStarred = !t.isStarred;
  withPending(btn).setThreadStarred(threadId, nowStarred);
  t.isStarred = nowStarred;
  btn.innerHTML = ICONS[nowStarred ? "star" : "unstar"];
}

function fail(error: Error) {
  document.getElementById("status")!.textContent = "Error: " + error.message;
}

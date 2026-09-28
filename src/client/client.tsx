// Runs in the browser, inside Apps Script's sandboxed iframe — a completely
// different runtime from src/server/*.ts (which runs server-side with access
// to GmailApp etc., and shares nothing with this file at runtime). Talks to
// the server only through google.script.run.

import { createRoot } from "react-dom/client";
import { El } from "./el";
import { sanitizeHtmlToNode } from "./sanitizeHtml";

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

let topbarRefreshing = false;
const topbarRoot = createRoot(document.getElementById("topbar")!);
function renderTopbar() {
  topbarRoot.render(
    <Topbar refreshing={topbarRefreshing} onRefresh={refresh} />,
  );
}
renderTopbar();

let selectedSenderGroup: string | null = null;
let openThreadId: string | null = null;
let archiveSenderPending: string | null = null;
const sendersRoot = createRoot(document.getElementById("senders")!);
function renderSenderList() {
  sendersRoot.render(
    <SenderList
      selectedGroup={selectedSenderGroup}
      onSelectGroup={selectSender}
      archiveSenderPending={archiveSenderPending}
      onArchiveSender={archiveSender}
    />,
  );
}

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

document.getElementById("main")!.addEventListener("scroll", maybeLoadMore);

declare const PAGE_DATA: { appUrl: string };

// Secret shortcut for the PWA install, where there's no browser chrome to
// hard-reload from: double-clicking the title reloads the whole page.
document.getElementById("app-title")!.addEventListener("dblclick", () => {
  navigatingAway = true;
  document.body.style.opacity = "0";
  window.top!.location.href = PAGE_DATA.appUrl;
});

function refresh() {
  reachedEndOfInbox = false;
  topbarRefreshing = true;
  renderTopbar();
  google.script.run
    .withSuccessHandler((threads: any[]) => {
      topbarRefreshing = false;
      renderTopbar();
      allThreads = threads;
      reachedEndOfInbox = threads.length < PAGE_SIZE;
      render();
    })
    .withFailureHandler((error: Error) => {
      topbarRefreshing = false;
      renderTopbar();
      fail(error);
    })
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
      renderSenderList();
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
  renderThreadRows();
  if (!selectedSenderGroup && allThreads.length > 0) {
    selectSender(allThreads[0].senderGroup);
  } else {
    renderSenderList();
  }
  maybeLoadMore();
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

function selectSender(group: string) {
  selectedSenderGroup = group;
  renderSenderList();
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
      El(
        { tag: "div", class: "message-header-row" },
        m.fromName
          ? El(
              "span",
              El({ tag: "span", class: "message-from-name" }, m.fromName),
              " <" + address + ">",
            )
          : El({ tag: "span", class: "message-from-name" }, m.from),
        El("span", new Date(m.date).toLocaleString()),
      ),
      m.to
        ? El({ tag: "div", class: "message-header-recipients" }, "To: " + m.to)
        : "",
      m.cc
        ? El({ tag: "div", class: "message-header-recipients" }, "Cc: " + m.cc)
        : "",
      m.bcc
        ? El(
            { tag: "div", class: "message-header-recipients" },
            "Bcc: " + m.bcc,
          )
        : "",
    );
    const bodyEl = El({ tag: "div", class: "message-body" });
    bodyEl.appendChild(sanitizeHtmlToNode(m.body));
    const div = El({ tag: "div", class: "messages" }, header, bodyEl);
    cell.appendChild(div);
  }
}

function archiveOne(threadId: string, tr: HTMLElement, btn: HTMLElement) {
  const t = allThreads.find((t) => t.id === threadId);
  const nowArchived = !t.archived;
  withPending(btn, renderSenderList).setThreadArchived(threadId, nowArchived);
  t.archived = nowArchived;
  tr.classList.toggle("archived", nowArchived);
  btn.innerHTML = ICONS[nowArchived ? "unarchive" : "archive"];
}

function archiveSender(group: string) {
  const toArchive = allThreads.filter(
    (t) => t.senderGroup === group && !t.archived,
  );
  archiveSenderPending = group;
  renderSenderList();
  google.script.run
    .withSuccessHandler(() => {
      archiveSenderPending = null;
      renderSenderList();
    })
    .withFailureHandler((error: Error) => {
      archiveSenderPending = null;
      renderSenderList();
      fail(error);
    })
    .archiveThreads(toArchive.map((t) => t.id));
  for (const t of toArchive) {
    t.archived = true;
    document
      .querySelector(`[data-thread-id="${t.id}"]`)
      ?.classList.add("archived");
  }
  renderSenderList();
}

function toggleThreadRead(threadId: string, btn: HTMLButtonElement) {
  const t = allThreads.find((t) => t.id === threadId);
  const nowRead = t.isUnread;
  withPending(btn, renderSenderList).markThreadRead(threadId, nowRead);
  t.isUnread = !nowRead;
  btn.innerHTML = ICONS[t.isUnread ? "unread" : "read"];
}

function toggleThreadStarred(threadId: string, btn: HTMLButtonElement) {
  const t = allThreads.find((t) => t.id === threadId);
  const nowStarred = !t.isStarred;
  withPending(btn).setThreadStarred(threadId, nowStarred);
  t.isStarred = nowStarred;
  btn.innerHTML = ICONS[nowStarred ? "star" : "unstar"];
}

// Set right before navigating away (e.g. the double-click reload), so
// fail() can ignore errors from requests the navigation aborted in flight
// instead of alerting on a spurious error the user didn't cause.
let navigatingAway = false;

function fail(error: Error) {
  if (navigatingAway) return;
  alert(
    "Error: " +
      (error instanceof Error ? error.message : JSON.stringify(error)),
  );
}

function ReactIconButton({
  icon,
  title,
  onClick,
  pending,
}: {
  icon: keyof typeof ICONS;
  title: string;
  onClick: (e: React.MouseEvent) => void;
  pending?: boolean;
}) {
  return (
    <button
      className={"icon-btn" + (pending ? " pending" : "")}
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
      dangerouslySetInnerHTML={{ __html: ICONS[icon] }}
    />
  );
}

function Topbar({
  refreshing,
  onRefresh,
}: {
  refreshing: boolean;
  onRefresh: () => void;
}) {
  return (
    <>
      <h1
        id="app-title"
        onDoubleClick={() => {
          navigatingAway = true;
          document.body.style.opacity = "0";
          window.top!.location.href = PAGE_DATA.appUrl;
        }}
      >
        Inbox Triage
      </h1>
      <ReactIconButton
        icon="refresh"
        title="Refresh"
        pending={refreshing}
        onClick={onRefresh}
      />
    </>
  );
}

function SenderRow({
  group,
  threads,
  selected,
  onSelect,
  pending,
  onArchiveAll,
}: {
  group: string;
  threads: any[];
  selected: boolean;
  onSelect: () => void;
  pending: boolean;
  onArchiveAll: () => void;
}) {
  const unread = threads.filter((t) => t.isUnread).length;
  const isMailingList = threads.some((t) => t.isMailingList);
  const secondLine = isMailingList ? threads[0].listId : group;
  const { name, othersCount } = senderGroupSummary(threads);
  const archived = threads.every((t) => t.archived);
  return (
    <div
      className={
        "sender-row" +
        (selected ? " selected" : "") +
        (archived ? " archived" : "")
      }
      onClick={onSelect}
    >
      <span className="sender-text">
        <span className="sender-display-name">
          {name || group}
          {othersCount ? (
            <span className="sender-others-count"> +{othersCount}</span>
          ) : (
            ""
          )}
        </span>
        <span className="sender-name">{secondLine}</span>
      </span>
      <span className="unread-count">{unread ? String(unread) : ""}</span>
      <ReactIconButton
        icon="archive"
        title="Archive all"
        pending={pending}
        onClick={onArchiveAll}
      />
    </div>
  );
}

function SenderList({
  selectedGroup,
  onSelectGroup,
  archiveSenderPending,
  onArchiveSender,
}: {
  selectedGroup: string | null;
  onSelectGroup: (group: string) => void;
  archiveSenderPending: string | null;
  onArchiveSender: (group: string) => void;
}) {
  const groups = [...new Set(allThreads.map((t) => t.senderGroup))];
  return (
    <>
      {groups.map((group) => (
        <SenderRow
          key={group}
          group={group}
          threads={allThreads.filter((t) => t.senderGroup === group)}
          selected={selectedGroup === group}
          onSelect={() => onSelectGroup(group)}
          pending={archiveSenderPending === group}
          onArchiveAll={() => onArchiveSender(group)}
        />
      ))}
    </>
  );
}

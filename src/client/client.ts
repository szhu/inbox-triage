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
      render();
    })
    .withFailureHandler((error: Error) => {
      loadingMore = false;
      fail(error);
    })
    .listInboxThreads(allThreads.length);
}

function buildRow(t: any): HTMLElement {
  let tr: HTMLElement;
  tr = El(
    {
      "tag": "tr",
      "data-sender-group": t.senderGroup,
      "data-thread-id": t.id,
    },
    El(
      { tag: "td", class: "subject", onclick: () => toggleThread(t.id, tr) },
      t.subject,
    ),
    El(
      "td",
      new Date(t.date).toLocaleDateString(undefined, {
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }),
    ),
    El("td", String(t.messageCount)),
    El(
      { tag: "td", class: "actions" },
      IconButton({
        icon: "archive",
        title: "Archive",
        onclick: (btn) => archiveOne(t.id, tr, btn),
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
  return tr;
}

function render() {
  document.getElementById("status")!.textContent =
    allThreads.length + " threads";
  const tbody = document.querySelector("#threads tbody")!;
  tbody.innerHTML = "";
  for (const t of allThreads) tbody.appendChild(buildRow(t));
  document.getElementById("threads")!.hidden = false;
  renderSenders();
  maybeLoadMore();
}

function renderSenders() {
  const senderList = document.getElementById("senders")!;
  const prevSelected = (senderList.querySelector(".selected") as HTMLElement)
    ?.dataset.group;
  senderList.innerHTML = "";
  const groups = [...new Set(allThreads.map((t) => t.senderGroup))];
  for (const group of groups) {
    const inGroup = allThreads.filter((t) => t.senderGroup === group);
    const unread = inGroup.filter((t) => t.isUnread).length;
    const displayName = shortestName(inGroup);
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
        El({ tag: "span", class: "sender-display-name" }, displayName || group),
        El({ tag: "span", class: "sender-name" }, group),
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
  if (toSelect)
    selectSender(
      (toSelect as HTMLElement).dataset.group!,
      toSelect as HTMLElement,
    );
}

function shortestName(threads: any[]): string {
  const names = threads.map((t) => t.senderName).filter(Boolean);
  return names.length
    ? names.reduce((a: string, b: string) => (b.length < a.length ? b : a))
    : "";
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
  for (const tr of document.querySelectorAll<HTMLElement>(
    "#threads tbody tr",
  )) {
    tr.classList.toggle("hidden-row", tr.dataset.senderGroup !== group);
  }
}

function toggleThread(threadId: string, tr: HTMLElement) {
  const existing = tr.nextElementSibling as HTMLElement | null;
  if (existing && existing.dataset.messagesFor === threadId) {
    existing.remove();
    return;
  }
  document.querySelectorAll("tr[data-messages-for]").forEach((r) => r.remove());
  const cell = El({ tag: "td", colspan: "4" }, "Loading...");
  const row = El({ "tag": "tr", "data-messages-for": threadId }, cell);
  tr.after(row);
  google.script.run
    .withSuccessHandler((messages: any[]) => renderMessages(messages, cell))
    .withFailureHandler(fail)
    .getThreadMessages(threadId);
}

function renderMessages(messages: any[], cell: HTMLElement) {
  cell.innerHTML = "";
  for (const m of messages) {
    const header = El(
      { tag: "div", class: "message-header" },
      El("span", m.from + " · " + new Date(m.date).toLocaleString()),
      IconButton({
        icon: m.isUnread ? "unread" : "read",
        title: "Toggle read",
        onclick: (btn) => toggleMessageRead(m.id, btn),
      }),
    );
    const div = El({ tag: "div", class: "messages" }, header, m.body);
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

function toggleMessageRead(messageId: string, btn: HTMLButtonElement) {
  const nowRead = btn.innerHTML === ICONS.unread;
  withPending(btn).markMessageRead(messageId, nowRead);
  btn.innerHTML = ICONS[nowRead ? "read" : "unread"];
}

function fail(error: Error) {
  document.getElementById("status")!.textContent = "Error: " + error.message;
}

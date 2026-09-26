// Runs in the browser, inside Apps Script's sandboxed iframe — a completely
// different runtime from src/server/*.ts (which runs server-side with access
// to GmailApp etc., and shares nothing with this file at runtime). Talks to
// the server only through google.script.run.

interface ScriptRunner {
  withSuccessHandler(callback: (value: any) => void): ScriptRunner;
  withFailureHandler(callback: (error: Error) => void): ScriptRunner;
  [serverFunction: string]: any;
}
declare const google: { script: { run: ScriptRunner } };

const ICONS = {
  archive:
    '<svg viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="3" fill="none" stroke="currentColor"/><path d="M3 6h10v7H3z" fill="none" stroke="currentColor"/><path d="M6.5 8.5h3M8 8.5v3M6.5 10l1.5 1.5L9.5 10" fill="none" stroke="currentColor"/></svg>',
  unarchive:
    '<svg viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="3" fill="none" stroke="currentColor"/><path d="M3 6h10v7H3z" fill="none" stroke="currentColor"/><path d="M6.5 11.5h3M8 11.5v-3M6.5 10l1.5-1.5L9.5 10" fill="none" stroke="currentColor"/></svg>',
  unread: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="4" fill="currentColor"/></svg>',
  read: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="4" fill="none" stroke="currentColor"/></svg>',
};

let allThreads: any[] = [];
google.script.run.withSuccessHandler(render).withFailureHandler(fail).listInboxThreads();

function render(threads: any[]) {
  allThreads = threads;
  document.getElementById("status")!.textContent = threads.length + " threads";
  const tbody = document.querySelector("#threads tbody")!;
  for (const t of threads) {
    const tr = document.createElement("tr");
    tr.dataset.senderGroup = t.senderGroup;
    tr.dataset.threadId = t.id;
    tr.innerHTML = "<td class='subject'></td><td></td><td></td><td class='actions'></td>";
    tr.children[0].textContent = t.subject;
    tr.children[1].textContent = new Date(t.date).toLocaleString();
    tr.children[2].textContent = t.messageCount;
    (tr.children[0] as HTMLElement).onclick = () => toggleThread(t.id, tr);
    tr.children[3].append(
      iconButton("archive", "Archive", () => archiveOne(t.id, tr)),
      iconButton(t.isUnread ? "unread" : "read", "Toggle read", (btn) => toggleThreadRead(t.id, btn)),
    );
    tbody.appendChild(tr);
  }
  document.getElementById("threads")!.hidden = false;
  renderSenders();
}

function renderSenders() {
  const senderList = document.getElementById("senders")!;
  const prevSelected = (senderList.querySelector(".selected") as HTMLElement)?.dataset.group;
  senderList.innerHTML = "";
  const groups = [...new Set(allThreads.map((t) => t.senderGroup))];
  for (const group of groups) {
    const inGroup = allThreads.filter((t) => t.senderGroup === group);
    const unread = inGroup.filter((t) => t.isUnread).length;
    const displayName = shortestName(inGroup);
    const row = document.createElement("div");
    row.className = "sender-row";
    row.dataset.group = group;
    row.innerHTML =
      "<span class='sender-text'><span class='sender-display-name'></span><span class='sender-name'></span></span><span class='unread-count'></span>";
    row.querySelector(".sender-display-name")!.textContent = displayName || group;
    row.querySelector(".sender-name")!.textContent = group;
    row.children[1].textContent = unread ? String(unread) : "";
    row.append(iconButton("archive", "Archive all", (btn) => archiveSender(group, btn)));
    row.onclick = () => selectSender(group, row);
    senderList.appendChild(row);
  }
  const toSelect =
    [...senderList.children].find((r) => (r as HTMLElement).dataset.group === prevSelected) ?? senderList.firstChild;
  if (toSelect) selectSender((toSelect as HTMLElement).dataset.group!, toSelect as HTMLElement);
}

function shortestName(threads: any[]): string {
  const names = threads.map((t) => t.senderName).filter(Boolean);
  return names.length ? names.reduce((a: string, b: string) => (b.length < a.length ? b : a)) : "";
}

function iconButton(icon: keyof typeof ICONS, title: string, onClick: (btn: HTMLButtonElement) => void) {
  const btn = document.createElement("button");
  btn.className = "icon-btn";
  btn.innerHTML = ICONS[icon];
  btn.title = title;
  btn.onclick = (e) => {
    e.stopPropagation();
    onClick(btn);
  };
  return btn;
}

function selectSender(group: string, el: HTMLElement) {
  document.querySelectorAll("#senders .selected").forEach((d) => d.classList.remove("selected"));
  el.classList.add("selected");
  for (const tr of document.querySelectorAll<HTMLElement>("#threads tbody tr")) {
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
  const row = document.createElement("tr");
  row.dataset.messagesFor = threadId;
  const cell = document.createElement("td");
  cell.colSpan = 4;
  cell.textContent = "Loading...";
  row.appendChild(cell);
  tr.after(row);
  google.script.run
    .withSuccessHandler((messages: any[]) => renderMessages(messages, cell))
    .withFailureHandler(fail)
    .getThreadMessages(threadId);
}

function renderMessages(messages: any[], cell: HTMLElement) {
  cell.innerHTML = "";
  for (const m of messages) {
    const div = document.createElement("div");
    div.className = "messages";
    const header = document.createElement("div");
    header.className = "message-header";
    header.innerHTML = "<span></span>";
    header.children[0].textContent = m.from + " · " + new Date(m.date).toLocaleString();
    header.append(iconButton(m.isUnread ? "unread" : "read", "Toggle read", (btn) => toggleMessageRead(m.id, btn)));
    div.append(header, document.createTextNode(m.body));
    cell.appendChild(div);
  }
}

function archiveOne(threadId: string, tr: HTMLElement) {
  google.script.run.withFailureHandler(fail).archiveThread(threadId);
  allThreads.find((t) => t.id === threadId).archived = true;
  tr.classList.add("archived");
  renderSenders();
}

function archiveSender(group: string, btn: HTMLElement) {
  const toArchive = allThreads.filter((t) => t.senderGroup === group && !t.archived);
  google.script.run.withFailureHandler(fail).archiveThreads(toArchive.map((t) => t.id));
  for (const t of toArchive) {
    t.archived = true;
    document.querySelector(`tr[data-thread-id="${t.id}"]`)?.classList.add("archived");
  }
  btn.closest(".sender-row")!.classList.add("archived");
}

function toggleThreadRead(threadId: string, btn: HTMLButtonElement) {
  const t = allThreads.find((t) => t.id === threadId);
  const nowRead = t.isUnread;
  google.script.run.withFailureHandler(fail).markThreadRead(threadId, nowRead);
  t.isUnread = !nowRead;
  btn.innerHTML = ICONS[t.isUnread ? "unread" : "read"];
  renderSenders();
}

function toggleMessageRead(messageId: string, btn: HTMLButtonElement) {
  const nowRead = btn.innerHTML === ICONS.unread;
  google.script.run.withFailureHandler(fail).markMessageRead(messageId, nowRead);
  btn.innerHTML = ICONS[nowRead ? "read" : "unread"];
}

function fail(error: Error) {
  document.getElementById("status")!.textContent = "Error: " + error.message;
}

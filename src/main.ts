function doGet() {
  return HtmlService.createHtmlOutput(PAGE_HTML).setTitle("Inbox triage");
}

function listInboxThreads() {
  const threads = GmailApp.search("in:inbox", 0, 50);
  return threads.map((t) => {
    const sender = t.getMessages()[0]?.getFrom() ?? "";
    return {
      id: t.getId(),
      subject: t.getFirstMessageSubject(),
      sender,
      senderName: senderDisplayName(sender),
      senderGroup: groupForSender(sender),
      date: t.getLastMessageDate().toISOString(),
      messageCount: t.getMessageCount(),
      isUnread: t.isUnread(),
    };
  });
}

// The display name portion of a "Name <addr>" sender, or "" if there is none
// (including when the "name" is just the address again, e.g. "a@b.com <a@b.com>").
function senderDisplayName(sender: string): string {
  const match = sender.match(/^"?([^"<]*?)"?\s*<([^>]+)>$/);
  if (!match) return "";
  const [, name, address] = match;
  return name.trim().toLowerCase() === address.trim().toLowerCase() ? "" : name.trim();
}

// Groups a sender by organization: a public email address (gmail.com, etc.)
// groups by its full address; anything else groups by "suffix + one label",
// e.g. hello@x.y.example.com -> example.com, hello@x.y.example.co.uk -> example.co.uk.
function groupForSender(sender: string): string {
  const bracketed = sender.match(/<([^>]+)>/);
  const address = (bracketed ? bracketed[1] : sender).trim().toLowerCase();
  const domain = address.split("@")[1];
  if (!domain) return address;
  if (PUBLIC_EMAIL_PROVIDERS.has(domain)) return address;

  const labels = domain.split(".");
  for (let i = 0; i < labels.length - 1; i++) {
    if (PUBLIC_SUFFIXES.has(labels.slice(i + 1).join("."))) {
      return labels.slice(i).join(".");
    }
  }
  return domain;
}

function getThreadMessages(threadId: string) {
  const thread = GmailApp.getThreadById(threadId);
  return thread.getMessages().map((m) => ({
    id: m.getId(),
    from: m.getFrom(),
    date: m.getDate().toISOString(),
    body: m.getPlainBody(),
    isUnread: m.isUnread(),
  }));
}

function archiveThread(threadId: string) {
  GmailApp.getThreadById(threadId).moveToArchive();
}

function archiveThreads(threadIds: string[]) {
  for (const id of threadIds) GmailApp.getThreadById(id).moveToArchive();
}

function markThreadsRead(threadIds: string[], read: boolean) {
  for (const id of threadIds) {
    const thread = GmailApp.getThreadById(id);
    read ? thread.markRead() : thread.markUnread();
  }
}

function markThreadRead(threadId: string, read: boolean) {
  const thread = GmailApp.getThreadById(threadId);
  read ? thread.markRead() : thread.markUnread();
}

function markMessageRead(messageId: string, read: boolean) {
  const message = GmailApp.getMessageById(messageId);
  read ? message.markRead() : message.markUnread();
}

const PAGE_HTML = `<!DOCTYPE html>
<html>
<head>
  <base target="_top">
  <style>
    body { font-family: system-ui, sans-serif; margin: 0; color: #1a1a1a; display: flex; height: 100vh; }
    h1 { font-size: 1.1rem; margin: 0.8rem; }
    button.icon-btn { font: inherit; cursor: pointer; width: 1.6rem; height: 1.6rem; padding: 0; display: inline-flex; align-items: center; justify-content: center; border: 1px solid #ccc; border-radius: 3px; background: #fff; }
    button.icon-btn:hover { background: #f0f0f0; }
    button.icon-btn svg { width: 14px; height: 14px; }
    #senders { width: 340px; overflow-y: auto; border-right: 1px solid #ddd; flex-shrink: 0; }
    #senders .sender-row { display: flex; align-items: center; padding: 0.5rem 0.8rem; font-size: 0.85rem; cursor: pointer; border-bottom: 1px solid #eee; white-space: nowrap; }
    #senders .sender-row:hover { background: #f5f5f5; }
    #senders .sender-row.selected { background: #e8f0fe; }
    #senders .sender-text { display: flex; flex-direction: column; overflow: hidden; flex: 1; }
    #senders .sender-display-name { overflow: hidden; text-overflow: ellipsis; font-weight: 600; }
    #senders .sender-name { overflow: hidden; text-overflow: ellipsis; color: #666; font-size: 0.8rem; }
    #senders .unread-count { color: #666; margin-left: 0.5rem; min-width: 1.2rem; text-align: right; }
    #senders .icon-btn { margin-left: 0.5rem; }
    .archived { opacity: 0.35; }
    #main { flex: 1; overflow-y: auto; }
    table { border-collapse: collapse; width: 100%; table-layout: fixed; }
    th, td { text-align: left; padding: 0.4rem 0.8rem; border-bottom: 1px solid #ddd; font-size: 0.9rem; vertical-align: top; }
    td.actions { white-space: nowrap; }
    td.actions .icon-btn + .icon-btn { margin-left: 0.3rem; }
    th { color: #666; font-weight: 600; }
    td.subject { cursor: pointer; }
    #status { color: #666; margin: 0.8rem; }
    tr.hidden-row { display: none; }
    .messages { white-space: pre-wrap; overflow-x: auto; font-size: 0.85rem; background: #fafafa; padding: 0.6rem; margin: 0.3rem 0; border-radius: 4px; }
    .message-header { display: flex; justify-content: space-between; color: #666; font-size: 0.8rem; margin-bottom: 0.3rem; }
  </style>
</head>
<body>
  <div id="senders"></div>
  <div id="main">
    <h1>Inbox triage</h1>
    <div id="status">Loading...</div>
    <table id="threads" hidden>
      <thead><tr><th>Subject</th><th>Date</th><th>#</th><th></th></tr></thead>
      <tbody></tbody>
    </table>
  </div>
  <script>
    const ICONS = {
      archive: '<svg viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="3" fill="none" stroke="currentColor"/><path d="M3 6h10v7H3z" fill="none" stroke="currentColor"/><path d="M6.5 8.5h3M8 8.5v3M6.5 10l1.5 1.5L9.5 10" fill="none" stroke="currentColor"/></svg>',
      unarchive: '<svg viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="3" fill="none" stroke="currentColor"/><path d="M3 6h10v7H3z" fill="none" stroke="currentColor"/><path d="M6.5 11.5h3M8 11.5v-3M6.5 10l1.5-1.5L9.5 10" fill="none" stroke="currentColor"/></svg>',
      unread: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="4" fill="currentColor"/></svg>',
      read: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="4" fill="none" stroke="currentColor"/></svg>',
    };

    let allThreads = [];
    google.script.run.withSuccessHandler(render).withFailureHandler(fail).listInboxThreads();

    function render(threads) {
      allThreads = threads;
      document.getElementById("status").textContent = threads.length + " threads";
      const tbody = document.querySelector("#threads tbody");
      for (const t of threads) {
        const tr = document.createElement("tr");
        tr.dataset.senderGroup = t.senderGroup;
        tr.dataset.threadId = t.id;
        tr.innerHTML = "<td class='subject'></td><td></td><td></td><td class='actions'></td>";
        tr.children[0].textContent = t.subject;
        tr.children[1].textContent = new Date(t.date).toLocaleString();
        tr.children[2].textContent = t.messageCount;
        tr.children[0].onclick = () => toggleThread(t.id, tr);
        tr.children[3].append(
          iconButton("archive", "Archive", () => archiveOne(t.id, tr)),
          iconButton(t.isUnread ? "unread" : "read", "Toggle read", (btn) => toggleThreadRead(t.id, btn)),
        );
        tbody.appendChild(tr);
      }
      document.getElementById("threads").hidden = false;
      renderSenders();
    }

    function renderSenders() {
      const senderList = document.getElementById("senders");
      const prevSelected = senderList.querySelector(".selected")?.dataset.group;
      senderList.innerHTML = "";
      const groups = [...new Set(allThreads.map((t) => t.senderGroup))];
      for (const group of groups) {
        const inGroup = allThreads.filter((t) => t.senderGroup === group);
        const unread = inGroup.filter((t) => t.isUnread).length;
        const displayName = shortestName(inGroup);
        const row = document.createElement("div");
        row.className = "sender-row";
        row.dataset.group = group;
        row.innerHTML = "<span class='sender-text'><span class='sender-display-name'></span><span class='sender-name'></span></span><span class='unread-count'></span>";
        row.querySelector(".sender-display-name").textContent = displayName || group;
        row.querySelector(".sender-name").textContent = group;
        row.children[1].textContent = unread || "";
        row.append(iconButton("archive", "Archive all", (btn) => archiveSender(group, btn)));
        row.onclick = () => selectSender(group, row);
        senderList.appendChild(row);
      }
      const toSelect = [...senderList.children].find((r) => r.dataset.group === prevSelected) ?? senderList.firstChild;
      if (toSelect) selectSender(toSelect.dataset.group, toSelect);
    }

    function shortestName(threads) {
      const names = threads.map((t) => t.senderName).filter(Boolean);
      return names.length ? names.reduce((a, b) => (b.length < a.length ? b : a)) : "";
    }

    function iconButton(icon, title, onClick) {
      const btn = document.createElement("button");
      btn.className = "icon-btn";
      btn.innerHTML = ICONS[icon];
      btn.title = title;
      btn.onclick = (e) => { e.stopPropagation(); onClick(btn); };
      return btn;
    }

    function selectSender(group, el) {
      document.querySelectorAll("#senders .selected").forEach((d) => d.classList.remove("selected"));
      el.classList.add("selected");
      for (const tr of document.querySelectorAll("#threads tbody tr")) {
        tr.classList.toggle("hidden-row", tr.dataset.senderGroup !== group);
      }
    }

    function toggleThread(threadId, tr) {
      const existing = tr.nextElementSibling;
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
      google.script.run.withSuccessHandler((messages) => renderMessages(messages, cell)).withFailureHandler(fail).getThreadMessages(threadId);
    }

    function renderMessages(messages, cell) {
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

    function archiveOne(threadId, tr) {
      google.script.run.withFailureHandler(fail).archiveThread(threadId);
      allThreads.find((t) => t.id === threadId).archived = true;
      tr.classList.add("archived");
      renderSenders();
    }

    function archiveSender(group, btn) {
      const toArchive = allThreads.filter((t) => t.senderGroup === group && !t.archived);
      google.script.run.withFailureHandler(fail).archiveThreads(toArchive.map((t) => t.id));
      for (const t of toArchive) {
        t.archived = true;
        document.querySelector('tr[data-thread-id="' + t.id + '"]')?.classList.add("archived");
      }
      btn.closest(".sender-row").classList.add("archived");
    }

    function toggleThreadRead(threadId, btn) {
      const t = allThreads.find((t) => t.id === threadId);
      const nowRead = t.isUnread;
      google.script.run.withFailureHandler(fail).markThreadRead(threadId, nowRead);
      t.isUnread = !nowRead;
      btn.innerHTML = ICONS[t.isUnread ? "unread" : "read"];
      renderSenders();
    }

    function toggleMessageRead(messageId, btn) {
      const nowRead = btn.innerHTML === ICONS.unread;
      google.script.run.withFailureHandler(fail).markMessageRead(messageId, nowRead);
      btn.innerHTML = ICONS[nowRead ? "read" : "unread"];
    }

    function fail(error) {
      document.getElementById("status").textContent = "Error: " + error.message;
    }
  </script>
</body>
</html>`;

function doGet() {
  return HtmlService.createHtmlOutput(PAGE_HTML).setTitle("Inbox triage");
}

function listInboxThreads() {
  const threads = GmailApp.search("in:inbox", 0, 50);
  return threads.map((t) => ({
    id: t.getId(),
    subject: t.getFirstMessageSubject(),
    sender: t.getMessages()[0]?.getFrom() ?? "",
    date: t.getLastMessageDate().toISOString(),
    messageCount: t.getMessageCount(),
    isUnread: t.isUnread(),
  }));
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
    button { font: inherit; cursor: pointer; }
    #senders { width: 340px; overflow-y: auto; border-right: 1px solid #ddd; flex-shrink: 0; }
    #senders .sender-row { display: flex; align-items: center; padding: 0.5rem 0.8rem; font-size: 0.85rem; cursor: pointer; border-bottom: 1px solid #eee; white-space: nowrap; }
    #senders .sender-row:hover { background: #f5f5f5; }
    #senders .sender-row.selected { background: #e8f0fe; font-weight: 600; }
    #senders .sender-name { overflow: hidden; text-overflow: ellipsis; flex: 1; }
    #senders .unread-count { color: #666; margin-left: 0.5rem; }
    #senders .sender-archive { margin-left: 0.5rem; }
    .archived { opacity: 0.35; }
    #main { flex: 1; overflow-y: auto; }
    table { border-collapse: collapse; width: 100%; }
    th, td { text-align: left; padding: 0.4rem 0.8rem; border-bottom: 1px solid #ddd; font-size: 0.9rem; vertical-align: top; }
    td.actions { white-space: nowrap; }
    th { color: #666; font-weight: 600; }
    td.subject { cursor: pointer; }
    #status { color: #666; margin: 0.8rem; }
    tr.hidden-row { display: none; }
    .messages { white-space: pre-wrap; font-size: 0.85rem; background: #fafafa; padding: 0.6rem; margin: 0.3rem 0; border-radius: 4px; }
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
    let allThreads = [];
    google.script.run.withSuccessHandler(render).withFailureHandler(fail).listInboxThreads();

    function render(threads) {
      allThreads = threads;
      document.getElementById("status").textContent = threads.length + " threads";
      const tbody = document.querySelector("#threads tbody");
      for (const t of threads) {
        const tr = document.createElement("tr");
        tr.dataset.sender = t.sender;
        tr.dataset.threadId = t.id;
        tr.innerHTML = "<td class='subject'></td><td></td><td></td><td class='actions'></td>";
        tr.children[0].textContent = t.subject;
        tr.children[1].textContent = new Date(t.date).toLocaleString();
        tr.children[2].textContent = t.messageCount;
        tr.children[0].onclick = () => toggleThread(t.id, tr);
        tr.children[3].append(
          button("Archive", () => archiveOne(t.id, tr)),
          button(t.isUnread ? "Mark read" : "Mark unread", (btn) => toggleThreadRead(t.id, btn)),
        );
        tbody.appendChild(tr);
      }
      document.getElementById("threads").hidden = false;
      renderSenders();
    }

    function renderSenders() {
      const senderList = document.getElementById("senders");
      const prevSelected = senderList.querySelector(".selected .sender-name")?.textContent;
      senderList.innerHTML = "";
      const bySender = [...new Set(allThreads.map((t) => t.sender))];
      for (const sender of bySender) {
        const unread = allThreads.filter((t) => t.sender === sender && t.isUnread).length;
        const row = document.createElement("div");
        row.className = "sender-row";
        row.innerHTML = "<span class='sender-name'></span><span class='unread-count'></span>";
        row.children[0].textContent = sender;
        row.children[1].textContent = unread || "";
        row.append(button("Archive", (btn) => archiveSender(sender, btn), "sender-archive"));
        row.onclick = () => selectSender(sender, row);
        senderList.appendChild(row);
      }
      const toSelect = [...senderList.children].find((r) => r.querySelector(".sender-name").textContent === prevSelected) ?? senderList.firstChild;
      if (toSelect) selectSender(toSelect.querySelector(".sender-name").textContent, toSelect);
    }

    function button(label, onClick, extraClass) {
      const btn = document.createElement("button");
      btn.textContent = label;
      if (extraClass) btn.className = extraClass;
      btn.onclick = (e) => { e.stopPropagation(); onClick(btn); };
      return btn;
    }

    function selectSender(sender, el) {
      document.querySelectorAll("#senders .selected").forEach((d) => d.classList.remove("selected"));
      el.classList.add("selected");
      for (const tr of document.querySelectorAll("#threads tbody tr")) {
        tr.classList.toggle("hidden-row", tr.dataset.sender !== sender);
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
        header.append(button(m.isUnread ? "Mark read" : "Mark unread", (btn) => toggleMessageRead(m.id, btn)));
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

    function archiveSender(sender, btn) {
      const toArchive = allThreads.filter((t) => t.sender === sender && !t.archived);
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
      btn.textContent = t.isUnread ? "Mark read" : "Mark unread";
      renderSenders();
    }

    function toggleMessageRead(messageId, btn) {
      const nowRead = btn.textContent === "Mark read";
      google.script.run.withFailureHandler(fail).markMessageRead(messageId, nowRead);
      btn.textContent = nowRead ? "Mark unread" : "Mark read";
    }

    function fail(error) {
      document.getElementById("status").textContent = "Error: " + error.message;
    }
  </script>
</body>
</html>`;

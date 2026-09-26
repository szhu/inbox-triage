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
  return name.trim().toLowerCase() === address.trim().toLowerCase()
    ? ""
    : name.trim();
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

function setThreadArchived(threadId: string, archived: boolean) {
  const thread = GmailApp.getThreadById(threadId);
  archived ? thread.moveToArchive() : thread.moveToInbox();
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
    body { font-family: system-ui, sans-serif; margin: 0; color: #1a1a1a; display: flex; flex-direction: column; height: 100vh; }
    button.icon-btn { font: inherit; cursor: pointer; width: 1.6rem; height: 1.6rem; padding: 0; display: inline-flex; align-items: center; justify-content: center; border: 1px solid #ccc; border-radius: 3px; background: #fff; }
    button.icon-btn:hover { background: #f0f0f0; }
    button.icon-btn svg { width: 14px; height: 14px; }
    button.icon-btn.pending { animation: pending-pulse 0.8s ease-in-out infinite; }
    @keyframes pending-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
    #topbar { display: flex; align-items: center; gap: 0.6rem; padding: 0.6rem 0.8rem; border-bottom: 1px solid #ddd; flex-shrink: 0; }
    #topbar h1 { font-size: 1.1rem; margin: 0; }
    #topbar #status { color: #666; flex: 1; }
    #body { display: flex; flex: 1; overflow: hidden; }
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
    tr.hidden-row { display: none; }
    .messages { white-space: pre-wrap; overflow-x: auto; font-size: 0.85rem; background: #fafafa; padding: 0.6rem; margin: 0.3rem 0; border-radius: 4px; }
    .message-header { display: flex; justify-content: space-between; color: #666; font-size: 0.8rem; margin-bottom: 0.3rem; }
  </style>
</head>
<body>
  <div id="topbar">
    <h1>Inbox triage</h1>
    <div id="status">Loading...</div>
  </div>
  <div id="body">
    <div id="senders"></div>
    <div id="main">
      <table id="threads" hidden>
        <thead><tr><th>Subject</th><th>Date</th><th>#</th><th></th></tr></thead>
        <tbody></tbody>
      </table>
    </div>
  </div>
  <script>
    __CLIENT_JS__
  </script>
</body>
</html>`;

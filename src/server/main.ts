function doGet() {
  return HtmlService.createHtmlOutput(PAGE_HTML).setTitle("Inbox triage");
}

function listInboxThreads(start: number) {
  const threads = GmailApp.search("in:inbox", start, 50);
  return threads.map((t) => {
    const messages = t.getMessages();
    const firstMessage = messages[0];
    const lastMessage = messages[messages.length - 1];
    const sender = lastMessage?.getFrom() ?? "";
    const listInfo = getMailingListInfo(firstMessage);
    const senderGroup = listInfo ? listInfo.id : groupForSender(sender);
    return {
      id: t.getId(),
      subject: t.getFirstMessageSubject(),
      sender,
      senderName: trimSenderDisplayName(senderDisplayName(sender), senderGroup),
      senderGroup,
      isMailingList: listInfo !== null,
      listId: listInfo?.id ?? "",
      date: t.getLastMessageDate().toISOString(),
      messageCount: t.getMessageCount(),
      isUnread: t.isUnread(),
      isStarred: t.hasStarredMessages(),
    };
  });
}

// A thread is a real mailing list (not a marketing/newsletter blast) when
// its message carries both List-Post (RFC 2369 -- "you can reply to this
// list", which one-way marketing sends never set, even when they set
// List-Id for their own segmentation purposes) and Precedence: list.
// Returns the list's own address (parsed from List-Post's mailto: link,
// since that's guaranteed present once we've confirmed it's a list) as a
// stable identifier that's consistent across senders of the same list.
function getMailingListInfo(message: GoogleAppsScript.Gmail.GmailMessage) {
  const listPost = message.getHeader("List-Post");
  const precedence = message.getHeader("Precedence");
  if (!listPost || precedence.toLowerCase() !== "list") return null;
  const match = listPost.match(/<mailto:([^>]+)>/i);
  return match ? { id: match[1].toLowerCase() } : null;
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

// Strips a leading "Team" or trailing "Notification(s)"/"Receipts" from a
// display name, unless that word is also part of the sender's own domain
// (e.g. keep "Team Headway" since its group is headway.co, not headway.com).
function trimSenderDisplayName(name: string, senderGroup: string): string {
  const match = name.match(/^(team)\s+|\s+(notifications?|receipts)$/i);
  if (!match) return name;
  const word = (match[1] ?? match[2]).toLowerCase();
  if (senderGroup.toLowerCase().includes(word)) return name;
  return (
    name.slice(0, match.index) + name.slice(match.index! + match[0].length)
  );
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
  const userEmail = Session.getActiveUser().getEmail();
  return thread.getMessages().map((m) => {
    const from = m.getFrom();
    return {
      id: m.getId(),
      from,
      fromName: senderDisplayName(from),
      date: m.getDate().toISOString(),
      body: m.getBody(),
      isUnread: m.isUnread(),
      userEmail,
    };
  });
}

function setThreadArchived(threadId: string, archived: boolean) {
  const thread = GmailApp.getThreadById(threadId);
  archived ? thread.moveToArchive() : thread.moveToInbox();
}

function setThreadStarred(threadId: string, starred: boolean) {
  const messages = GmailApp.getThreadById(threadId).getMessages();
  starred ? GmailApp.starMessages(messages) : GmailApp.unstarMessages(messages);
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
    #senders { width: clamp(200px, 33vw, 340px); overflow-y: auto; border-right: 1px solid #ddd; flex-shrink: 0; }
    #senders .sender-row { display: flex; align-items: center; padding: 0.5rem 0.8rem; font-size: 0.85rem; cursor: pointer; border-bottom: 1px solid #eee; white-space: nowrap; }
    #senders .sender-row:hover { background: #f5f5f5; }
    #senders .sender-row.selected { background: #e8f0fe; }
    #senders .sender-text { display: flex; flex-direction: column; overflow: hidden; flex: 1; }
    #senders .sender-display-name { overflow: hidden; text-overflow: ellipsis; font-weight: 600; }
    #senders .sender-others-count { font-weight: 400; color: #666; }
    #senders .sender-name { overflow: hidden; text-overflow: ellipsis; color: #666; font-size: 0.8rem; }
    #senders .unread-count { color: #666; margin-left: 0.5rem; min-width: 1.2rem; text-align: right; }
    #senders .icon-btn { margin-left: 0.5rem; }
    .archived { opacity: 0.35; }
    #main { flex: 1; overflow-y: auto; }
    #threads .header { display: none; }
    #threads .row {
      display: grid;
      grid-template-columns: 1fr auto;
      grid-template-areas: "subject subject" "date actions";
      gap: 0.2rem 0.8rem;
      padding: 0.4rem 0.8rem;
      border-bottom: 1px solid #ddd;
      font-size: 0.9rem;
    }
    #threads .cell { text-align: left; }
    #threads .messages-cell {
        display: flex;
        flex-direction: column;
        gap: 0.8rem;
    }
    #threads .row:not(.messages-row) { cursor: pointer; }
    #threads .row:not(.messages-row):hover { background: #f5f5f5; }
    #threads .row:not(.messages-row).open { background: #e8f0fe; }
    #threads .subject { grid-area: subject; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    #threads .row.open .subject { overflow: visible; text-overflow: clip; white-space: normal; }
    #threads .date { grid-area: date; color: #666; font-size: 0.8rem; align-self: center; }
    #threads .count { display: none; }
    #threads .actions { grid-area: actions; white-space: nowrap; }
    #threads .actions .icon-btn + .icon-btn { margin-left: 0.3rem; }
    #threads .row.hidden-row { display: none; }
    #threads .messages-row { display: block; }
    .messages { overflow-x: auto; font-size: 0.85rem; }
    .messages + .messages { margin-top: 1rem; }
    .message-header { display: flex; justify-content: space-between; color: #333; font-size: 0.8rem; background: #eee; padding: 0.4rem 0.8rem; margin-bottom: 0.6rem; border-radius: 4px; }
    .message-from-name { font-weight: 600; }
    .message-body { padding: 0 0.8rem; word-wrap: break-word; }
    .message-body a { color: #1a73e8; }
    .message-body ul, .message-body ol { margin: 0; }
    .open-in-gmail { margin: 0 0.8rem; font-size: 0.8rem; color: #1a73e8; }
    @media (min-width: 700px) {
      #threads .header {
        display: grid;
        grid-template-columns: 1fr 7rem 2.5rem 6.5rem;
        color: #666;
        font-weight: 600;
        padding: 0.4rem 0.8rem;
        border-bottom: 1px solid #ddd;
        font-size: 0.9rem;
      }
      #threads .row {
        grid-template-columns: 1fr 7rem 2.5rem 6.5rem;
        grid-template-areas: "subject date count actions";
        align-items: center;
      }
      #threads .count { display: block; }
    }
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
      <div id="threads" hidden>
        <div class="header"><span>Subject</span><span>Date</span><span>#</span><span></span></div>
        <div class="rows"></div>
      </div>
    </div>
  </div>
  <script>
    __CLIENT_JS__
  </script>
</body>
</html>`;

function listInboxThreads() {
  const threads = GmailApp.search("in:inbox", 0, 50);
  return threads.map((t) => ({
    id: t.getId(),
    subject: t.getFirstMessageSubject(),
    messageCount: t.getMessageCount(),
  }));
}

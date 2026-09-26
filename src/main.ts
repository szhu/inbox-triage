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
  }));
}

const PAGE_HTML = `<!DOCTYPE html>
<html>
<head>
  <base target="_top">
  <style>
    body { font-family: system-ui, sans-serif; margin: 0; color: #1a1a1a; display: flex; height: 100vh; }
    h1 { font-size: 1.1rem; margin: 0.8rem; }
    #senders { width: 260px; overflow-y: auto; border-right: 1px solid #ddd; flex-shrink: 0; }
    #senders div { padding: 0.5rem 0.8rem; font-size: 0.85rem; cursor: pointer; border-bottom: 1px solid #eee; }
    #senders div:hover { background: #f5f5f5; }
    #senders div.selected { background: #e8f0fe; font-weight: 600; }
    #main { flex: 1; overflow-y: auto; }
    table { border-collapse: collapse; width: 100%; }
    th, td { text-align: left; padding: 0.4rem 0.8rem; border-bottom: 1px solid #ddd; font-size: 0.9rem; }
    th { color: #666; font-weight: 600; }
    #status { color: #666; margin: 0.8rem; }
    tr.hidden-row { display: none; }
  </style>
</head>
<body>
  <div id="senders"></div>
  <div id="main">
    <h1>Inbox triage</h1>
    <div id="status">Loading...</div>
    <table id="threads" hidden>
      <thead><tr><th>Subject</th><th>Date</th><th>#</th></tr></thead>
      <tbody></tbody>
    </table>
  </div>
  <script>
    google.script.run.withSuccessHandler(render).withFailureHandler(fail).listInboxThreads();

    function render(threads) {
      document.getElementById("status").textContent = threads.length + " threads";
      const tbody = document.querySelector("#threads tbody");
      for (const t of threads) {
        const tr = document.createElement("tr");
        tr.dataset.sender = t.sender;
        tr.innerHTML = "<td></td><td></td><td></td>";
        tr.children[0].textContent = t.subject;
        tr.children[1].textContent = new Date(t.date).toLocaleString();
        tr.children[2].textContent = t.messageCount;
        tbody.appendChild(tr);
      }
      document.getElementById("threads").hidden = false;

      const senderList = document.getElementById("senders");
      const bySender = [...new Set(threads.map((t) => t.sender))];
      for (const sender of bySender) {
        const div = document.createElement("div");
        div.textContent = sender;
        div.onclick = () => selectSender(sender, div);
        senderList.appendChild(div);
      }
      selectSender(bySender[0], senderList.firstChild);
    }

    function selectSender(sender, el) {
      document.querySelectorAll("#senders div.selected").forEach((d) => d.classList.remove("selected"));
      el.classList.add("selected");
      for (const tr of document.querySelectorAll("#threads tbody tr")) {
        tr.classList.toggle("hidden-row", tr.dataset.sender !== sender);
      }
    }

    function fail(error) {
      document.getElementById("status").textContent = "Error: " + error.message;
    }
  </script>
</body>
</html>`;

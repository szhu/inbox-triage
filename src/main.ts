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
    body { font-family: system-ui, sans-serif; margin: 2rem; color: #1a1a1a; }
    table { border-collapse: collapse; width: 100%; }
    th, td { text-align: left; padding: 0.4rem 0.8rem; border-bottom: 1px solid #ddd; font-size: 0.9rem; }
    th { color: #666; font-weight: 600; }
    #status { color: #666; margin-bottom: 1rem; }
  </style>
</head>
<body>
  <h1>Inbox triage</h1>
  <div id="status">Loading...</div>
  <table id="threads" hidden>
    <thead><tr><th>Sender</th><th>Subject</th><th>Date</th><th>#</th></tr></thead>
    <tbody></tbody>
  </table>
  <script>
    google.script.run.withSuccessHandler(render).withFailureHandler(fail).listInboxThreads();

    function render(threads) {
      document.getElementById("status").textContent = threads.length + " threads";
      const tbody = document.querySelector("#threads tbody");
      for (const t of threads) {
        const tr = document.createElement("tr");
        tr.innerHTML = "<td></td><td></td><td></td><td></td>";
        tr.children[0].textContent = t.sender;
        tr.children[1].textContent = t.subject;
        tr.children[2].textContent = new Date(t.date).toLocaleString();
        tr.children[3].textContent = t.messageCount;
        tbody.appendChild(tr);
      }
      document.getElementById("threads").hidden = false;
    }

    function fail(error) {
      document.getElementById("status").textContent = "Error: " + error.message;
    }
  </script>
</body>
</html>`;

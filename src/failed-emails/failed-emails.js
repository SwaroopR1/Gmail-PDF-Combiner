function renderList(record) {
  const meta = document.getElementById("meta");
  const list = document.getElementById("list");

  meta.textContent =
    `${record.items.length} email(s) were skipped during the last combination/download.`;

  list.innerHTML = record.items
    .map((it) => {
      const num     = it.number ?? "?";
      const sender  = escapeHtml(it.sender || "(unknown sender)");
      const subject = escapeHtml(it.subject || "(no subject)");
      const reason  = escapeHtml(it.reason || "");
      return `
        <div class="item">
          <span class="num">#${num}</span>
          <div class="row">
            <span class="label">Email ID:</span>
            <span class="value sender">${sender}</span>
          </div>
          <div class="row">
            <span class="label">Subject:</span>
            <span class="value">${subject}</span>
          </div>
          ${reason ? `<div class="reason">${reason}</div>` : ""}
        </div>`;
    })
    .join("");
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

document.addEventListener("DOMContentLoaded", async () => {
  const { lastFailedEmails } = await chrome.storage.local.get("lastFailedEmails");
  renderList(lastFailedEmails);
});
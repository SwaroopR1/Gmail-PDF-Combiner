async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function isGmail(tab) {
  return tab && tab.url && tab.url.startsWith("https://mail.google.com");
}

document.addEventListener("DOMContentLoaded", async () => {
  const startBtn      = document.getElementById("startBtn");
  const continueBtn   = document.getElementById("continueBtn");
  const stopBtn       = document.getElementById("stopBtn");
  const showBtn       = document.getElementById("showBtn");
  const combineBtn    = document.getElementById("combineBtn");
  const downloadBtn   = document.getElementById("downloadBtn");
  const resetBtn      = document.getElementById("resetBtn");
  const failedBtn     = document.getElementById("failedBtn");
  const invoiceToggle = document.getElementById("invoiceModeToggle");
  const output        = document.getElementById("output");

  // -------------------------------------------------------------------------
  //  Invoice Mode toggle: start disabled until we know Gmail is open
  // -------------------------------------------------------------------------
  invoiceToggle.disabled = true;

  const tab = await getActiveTab();

  if (!isGmail(tab)) {
    // Body already carries class="not-gmail" → the popup is completely
    // gray/black/white from the very first frame. Nothing to do but disable.

    output.textContent   = "Open Gmail to use this extension.";
    return;
  }

  // Gmail detected → swap the body class to unlock the colourful theme.
  document.body.classList.replace("not-gmail", "gmail");

  // -------------------------------------------------------------------------
  //  Content script bootstrap
  // -------------------------------------------------------------------------
  async function ensureContentScript() {
    try {
      const res = await chrome.tabs.sendMessage(tab.id, { type: "PING" });
      if (res?.ok){
        return;
      }
    } catch {}

    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["lib/pdf-lib.min.js", "lib/fflate.min.js", "src/content/content.js"],
      });

    } catch (e) {
      console.warn("Failed to inject content script:", e);
    }
  }

  await ensureContentScript();

  // the invoice toggle is restored to ON if the user closes and reopens the extension popup
  try {
    const { invoiceMode } = await chrome.storage.local.get("invoiceMode");
    invoiceToggle.checked = !!invoiceMode;
  } catch {}

  invoiceToggle.disabled = false;

  invoiceToggle.addEventListener("change", async () => {
    try {
      await chrome.storage.local.set({ invoiceMode: invoiceToggle.checked });
    } catch (e) {
      console.warn("Failed to save invoice mode:", e);
    }
  });

  // -------------------------------------------------------------------------
  //  "Previous Failed Emails" button state
  // -------------------------------------------------------------------------
  async function refreshFailedBtn() {
    const { lastFailedEmails } = await chrome.storage.local.get("lastFailedEmails");
    const has =
      !!(lastFailedEmails &&
         lastFailedEmails.items &&
         lastFailedEmails.items.length > 0);
    failedBtn.disabled = !has;
    failedBtn.textContent = has
      ? `Previous Failed Emails/PDFs (${lastFailedEmails.items.length})`
      : "Previous Failed Emails/PDFs";
  }

  await refreshFailedBtn();

  failedBtn.addEventListener("click", () => {

    // opens the below mentioned URL in a separate browser popup window
    chrome.windows.create({ 
      url: chrome.runtime.getURL("src/failed-emails/failed-emails.html"), // converts the extension-relative path into a full chrome-extension://... URL.
      type: "popup",
      width: 440,
      height: 540,
    });
  });

  // fetchState asks the content script for its current state
  async function fetchState() {
    try {
      const res = await chrome.tabs.sendMessage(tab.id, { type: "PING" });
      if (res?.ok) {
        return {
          active:     !!res.active,       // whether selection tracking is currently on
          hasSession: !!res.hasSession,   // whether a session exists at all (even if paused)
          combining:  !!res.combining,    // whether a Combine or Download All operation is running
          count:      res.count || 0,     // number of tracked emails
        };
      }
    } catch {}
    return { active: false, hasSession: false, combining: false, count: 0 };
  }

  // -------------------------------------------------------------------------
  //  Button state rules
  //
  //  Start is disabled whenever a session exists — that covers both the
  //  "actively tracking" state AND the "paused after Stop" state. It is
  //  re-enabled only after 'Reset' or a page refresh, both of which clear
  //  'hasSession' on the content script side.
  // -------------------------------------------------------------------------
  function applyState(state) {
    const busy = state.combining;

    startBtn.disabled    = busy || state.active || state.hasSession;
    stopBtn.disabled     = busy || !state.active;
    continueBtn.disabled = busy || state.active || !state.hasSession;
    showBtn.disabled     = busy || state.active || !state.hasSession;
    combineBtn.disabled  =
      busy || state.active || !state.hasSession || state.count === 0;
    downloadBtn.disabled =
      busy || state.active || !state.hasSession || state.count === 0;
    resetBtn.disabled    = busy || !state.hasSession;

    invoiceToggle.disabled = busy;
  }

  function renderIdle(state) {
    if (state.combining) {
      output.textContent = "⏳ Working… please wait until finished.";
    } else if (state.active) {
      output.textContent = `Selection active — ${state.count} tracked.`;
    } else if (state.hasSession) {
      output.textContent = `${state.count} email(s) tracked. Ready to view / combine.`;
    } else {
      output.textContent = "";
    }
  }

  // -------------------------------------------------------------------------
  //  Email list formatting
  //
  //  Each entry is rendered as:
  //     1.
  //     email_id
  //     Subject
  //     ──────────────────────────────
  //
  //  Long email_ids and subjects are truncated with an ellipsis so they never
  //  overflow the separator line.
  // -------------------------------------------------------------------------
  const SEP = "─".repeat(30);
  const MAX_LEN = 100;

  function truncate(s, max) {
    s = String(s ?? "");
    return s.length > max ? s.slice(0, max - 1) + "…" : s;
  }

  function formatEmailList(emails) {
    if (!emails || emails.length === 0) return "No emails were selected.";
    return emails
      .map((e, i) => {    
        // e — the current email object ({ id, sender, subject }).
        // i — its index (0-based), used to produce the 1., 2., 3. numbering via i + 1.

        const id      = truncate(e.sender,  MAX_LEN);
        const subject = truncate(e.subject, MAX_LEN);
        return `${i + 1}.\n${id}\n${subject}\n${SEP}`;
      })
      .join("\n\n");
  }


  // -------------------------------------------------------------------------
  //  Initial paint
  // -------------------------------------------------------------------------
  let state = await fetchState();
  applyState(state);
  renderIdle(state);

  // -------------------------------------------------------------------------
  //  START
  // -------------------------------------------------------------------------
  startBtn.addEventListener("click", async () => {
    
    const res = await chrome.tabs.sendMessage(tab.id, { type: "START" });  // Send a START message to the content script
    if (!res?.ok) {
      output.textContent = "Failed to start.";
      return;
    }
    state = await fetchState();
    applyState(state);
    output.textContent =
      "Selection started. Close this popup and pick emails in Gmail.";
  });

  // -------------------------------------------------------------------------
  //  CONTINUE
  // -------------------------------------------------------------------------
  continueBtn.addEventListener("click", async () => {
    
    const res = await chrome.tabs.sendMessage(tab.id, { type: "RESUME" }); // Send a RESUME message to the content script
    if (!res?.ok) {
      output.textContent = "Nothing to continue.";
      return;
    }
    state = await fetchState();
    applyState(state);
    output.textContent = `Resumed (${state.count} tracked). Keep selecting.`;
  });

  // -------------------------------------------------------------------------
  //  STOP
  // -------------------------------------------------------------------------
  stopBtn.addEventListener("click", async () => {
    await chrome.tabs.sendMessage(tab.id, { type: "STOP" });   // Send a STOP message to the content script

    state = await fetchState();
    applyState(state);

    output.textContent =
      `Tracking stopped. ${state.count} email(s) recorded. `;
  });

  // -------------------------------------------------------------------------
  //  SHOW EMAILS
  // -------------------------------------------------------------------------
  showBtn.addEventListener("click", async () => {
    const res = await chrome.tabs.sendMessage(tab.id, { type: "STOP" });
    const emails = res?.emails || []; // if res is not null/undefined, access its emails property; otherwise return [] (no error thrown).

    state = await fetchState();
    applyState(state);

    output.textContent = formatEmailList(emails);
  });

  // -------------------------------------------------------------------------
  //  COMBINE
  // -------------------------------------------------------------------------
  combineBtn.addEventListener("click", async () => {
    const stopRes = await chrome.tabs.sendMessage(tab.id, { type: "STOP" });
    const emails = stopRes?.emails || [];

    if (emails.length === 0) {
      output.textContent = "No emails were selected.";
      state = await fetchState();
      applyState(state);
      return;
    }

    const { invoiceMode } = await chrome.storage.local.get("invoiceMode");

    output.textContent =
      `Combining PDFs from ${emails.length} email(s)` +
      (invoiceMode ? " (Invoice Mode ON — you'll be prompted if necessary)" : "") +
      "…\n\n" +
      formatEmailList(emails) +
      "\n\n(Progress is shown in the Gmail page.)";

    const busy = {
      active: false,
      hasSession: true,
      combining: true,
      count: emails.length,
    };
    applyState(busy);

    try {
      const res = await chrome.tabs.sendMessage(tab.id, { type: "COMBINE" });
      if (res?.ok) {    // If ok, append success
        console.log("\n\n✅ Combined PDF downloaded.");
      } else {
        output.textContent += `\n\n❌ ${res?.error || "Combine failed."}`;
      }
    } catch (err) {
      output.textContent += `\n\n❌ ${err.message}`;
    }

    state = await fetchState();
    applyState(state);
    refreshFailedBtn();
  });

  // -------------------------------------------------------------------------
  //  DOWNLOAD ALL
  // -------------------------------------------------------------------------
  downloadBtn.addEventListener("click", async () => {
    const stopRes = await chrome.tabs.sendMessage(tab.id, { type: "STOP" });
    const emails = stopRes?.emails || [];

    if (emails.length === 0) {
      output.textContent = "No emails were selected.";
      state = await fetchState();
      applyState(state);
      return;
    }

    output.textContent =
      `Downloading all PDFs from ${emails.length} email(s)…\n\n` +
      formatEmailList(emails) +
      "\n\n(Progress is shown in the Gmail page.)";

    const busy = {
      active: false,
      hasSession: true,
      combining: true,
      count: emails.length,
    };
    applyState(busy);

    try {
      const res = await chrome.tabs.sendMessage(tab.id, { type: "DOWNLOAD_ALL" });
      if (res?.ok) {
        console.log(`\n\n✅ Downloaded ${res.count || 0} file(s) as selected_pdfs.zip.`);
      } else {
        output.textContent += `\n\n❌ ${res?.error || "Download failed."}`;
      }
    } catch (err) {
      output.textContent += `\n\n❌ ${err.message}`;
    }

    state = await fetchState();
    applyState(state);
    refreshFailedBtn();
  });

  // -------------------------------------------------------------------------
  //  RESET
  // -------------------------------------------------------------------------
  resetBtn.addEventListener("click", async () => {
    const res = await chrome.tabs.sendMessage(tab.id, { type: "RESET" });
    if (!res?.ok) {
      output.textContent = "Failed to reset.";
      return;
    }

    try {
      await chrome.storage.local.remove([
        "lastFailedEmails",
        "invoiceMode",
        "senderDecisions",
      ]);
    } catch (e) {
      console.warn("Failed to clear persisted state on reset:", e);
    }

    invoiceToggle.checked = false;
    await refreshFailedBtn();

    state = await fetchState();
    applyState(state);
    output.textContent = "🔄 Reset — extension back to initial state.";
  });
});
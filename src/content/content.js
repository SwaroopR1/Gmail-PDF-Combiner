(() => {
  // This prevents double injection of content scripts — no duplicate observers, no duplicate listeners.
  if (window.__gmailSelectorCombinerInjected) return;
  window.__gmailSelectorCombinerInjected = true;


  // On every fresh page load, discard all per-session state so the extension starts clean
  chrome.storage.local
    .remove(["lastFailedEmails", "invoiceMode", "senderDecisions"])
    .catch(() => {});

  // =========================================================================
  //  SECTION 1 — Selection tracking
  // =========================================================================
  let active = false;
  let hasSession = false;
  let combining = false;
  const selected = new Map(); // id -> { id, sender, subject}
  let observer = null;
  const pending = new Set();  // a Set of <tr> row elements that need to be re-checked.
  let flushTimer = null;

  function getEmailInfo(row) {
    if (!row) return null;

    const el = row.querySelector("[data-legacy-thread-id]");
    const id = el ? el.getAttribute("data-legacy-thread-id") : null;

    if (!id) return null;

    const subjectEl = row.querySelector(".bog");
    const subject = subjectEl ? subjectEl.textContent.trim() : "(no subject)";

    const senderEl =
      row.querySelector(".yW span[email]") ||
      row.querySelector(".yP") ||
      row.querySelector(".zF");
    const sender = senderEl
      ? senderEl.getAttribute("email") || senderEl.textContent.trim()
      : "(unknown sender)";

    return { id, sender, subject }; // It is exactly equivalent to writing: return { id: id, sender: sender, subject: subject };
  }

  function processRow(row) {
    const checkbox = row.querySelector('[role="checkbox"]');
    if (!checkbox) return;
    const isChecked = checkbox.getAttribute("aria-checked") === "true";
    const info = getEmailInfo(row);
    if (!info) return;

    if (isChecked) {
      if (!selected.has(info.id)) {
        selected.set(info.id, info); // insertion order --> selection order
      }
    } else {
      const stillPresent = document.querySelector(`tr.zA [data-legacy-thread-id="${info.id}"]`);
    // Do NOT remove if an email has been deselected without the user's knowledge.
      if (!stillPresent) return; 

    // Only remove if the user explicitly sees that an email has been deselected.
      selected.delete(info.id);

    }
  }

  // Below two functions implement a small batching layer 
  // between Gmail’s DOM mutations and the processRow work.

  // Instead of calling processRow immediately every time a checkbox changes or a row appears, 
  // the extension queues affected rows and processes them together a few milliseconds later.

  function flush() {
    flushTimer = null;
    pending.forEach(processRow);
    pending.clear();
  }

  // Changed rows are queued via queueRow(row)
  // After a batch, flush() runs processRow on each queued row
  function queueRow(row) {
    if (!row) return;
    pending.add(row);
    if (flushTimer) return;
    flushTimer = setTimeout(flush, 50);
  }

  function startObserver() {
    if (observer) return; // guard against double-registration
    const root = document.body;

    observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        const row = m.target.closest("tr.zA");   // A checkbox changed. Find its row and process it.
        if (row) queueRow(row);
      }
    });

    observer.observe(root, {
      subtree: true,  // watch all descendants, not just direct children of <body>.
      attributes: true, attributeFilter: ["aria-checked"], // Fire when attributes change on watched elements- but only for aria-checked, i.e. Gmail's checkbox state flipping on/off. 
                                                          // All other attribute changes are ignored, keeping the callback cheap.
    });
  }

  function stopObserver() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  }

// ---------------------------------------------------------------------
// ---------------------------------------------------------------------
// CSS - HELPER FUNCTION
function ensureSectionStylesheet(key, relativePath) {
  const linkId = `gpc-style-${key}`;
  if (document.getElementById(linkId)) return;
  const link = document.createElement("link");
  link.id = linkId;
  link.rel = "stylesheet";
  link.type = "text/css";
  link.href = chrome.runtime.getURL(relativePath);
  document.head.appendChild(link);
}
// ---------------------------------------------------------------------
// ---------------------------------------------------------------------


  // =========================================================================
  //  SECTION 2 — Progress overlay UI
  // =========================================================================

  function showProgressUI() {
    if (document.getElementById("pdf-combiner-progress")) return;

    ensureSectionStylesheet(
      "section-2-progress",
      "src/content/css_files/section-2-progress.css"
    );

    const overlay = document.createElement("div");
    overlay.id = "pdf-combiner-progress";
    overlay.innerHTML = `
      <div class="gpc-dialog">
        <h2>Gmail PDF Combiner</h2>
        <div id="progress-status">Initializing…</div>
        <div class="gpc-progress-track">
          <div id="progress-bar"></div>
        </div>
      </div>`;
      
    document.body.appendChild(overlay);
  }

  function updateProgress(status, percent) {
    const ui = document.getElementById("pdf-combiner-progress");
    if (!ui) return;
    const s = ui.querySelector("#progress-status");
    const b = ui.querySelector("#progress-bar");
    if (s) s.textContent = status;
    if (b) b.style.width = Math.min(100, Math.max(0, percent)) + "%";
  }

  function hideProgressUI(delay = 0) {
    if (delay > 0) return setTimeout(() => hideProgressUI(0), delay);
    const ui = document.getElementById("pdf-combiner-progress");
    if (ui) ui.remove();
  }

  function showErrorUI(message) {
    showProgressUI();
    updateProgress("❌ " + message, 100);
    setTimeout(() => hideProgressUI(0), 2000);
  }

  // =========================================================================
  //  SECTION 3 — Failed emails persistence
  // =========================================================================
  async function saveFailedEmails(items) {
    try {
      if (!items || items.length === 0) {
        await chrome.storage.local.remove("lastFailedEmails");    
        // If nothing was skipped, delete the storage key entirely rather than store an empty object.
        return;
      }
      await chrome.storage.local.set({
        lastFailedEmails: {
          timestamp: Date.now(),
          items,
        },
      });
    } catch (e) {
      console.warn("Failed to persist failed emails:", e);
    }
  }

  // =========================================================================
  //  SECTION 4 — Invoice mode helpers (Four small utilities)
  // =========================================================================
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function getInvoiceMode() {
    try {
      const { invoiceMode } = await chrome.storage.local.get("invoiceMode");
      return !!invoiceMode;
    } catch {
      return false;
    }
  }

  async function getSenderDecisions() {
    try {
      const { senderDecisions } = await chrome.storage.local.get("senderDecisions");
      return senderDecisions && typeof senderDecisions === "object"
        ? senderDecisions
        : {};
    } catch {
      return {};
    }
  }

  async function saveSenderDecisions(decisions) {
    try {
      await chrome.storage.local.set({ senderDecisions: decisions });
    } catch (e) {
      console.warn("Failed to save sender decisions:", e);
    }
  }

  // =========================================================================
  //  SECTION 5 — Invoice mode prompts
  // =========================================================================

// Returns Promise<{ selectedIndices: number[], remember: boolean, pattern?: string } | null>
  function promptFileSelection(pdfs, sender) {
    return new Promise((resolve) => {
      ensureSectionStylesheet(
        "section-5-file-prompt",
        "src/content/css_files/section-5-file-prompt.css"
      );

      const overlay = document.createElement("div");
      overlay.id = "invoice-file-prompt";

      const rows = pdfs
        .map(
          (p, i) => `
        <label class="inv-file-row" data-idx="${i}">
          <input type="checkbox" data-idx="${i}" checked />
          <span>${escapeHtml(p.filename)}</span>
        </label>`
        )
        .join("");

      overlay.innerHTML = `
        <div class="ifp-dialog">
          <h2>Invoice Mode — Select PDFs</h2>
          <div class="ifp-subtitle">
            This email from <b>${escapeHtml(sender)}</b> has ${pdfs.length} PDF files.
            Choose which ones to include:
          </div>
          <div class="ifp-btn-row">
            <button type="button" id="inv-file-all">Select All</button>
            <button type="button" id="inv-file-none">Select None</button>
          </div>
          <div id="inv-file-list">${rows}</div>

          <label class="ifp-remember-label">
            <input type="checkbox" id="inv-file-remember" />
            <span>Remember the choice for all subsequent emails from this sender.</span>
          </label>

          <div id="inv-file-pattern-wrap">
            <label>
              Enter the text to remember (case sensitive) — <br>
              [This does NOT auto-ticks] <br>
            </label>
            <input type="text" id="inv-file-pattern"
                  placeholder="e.g. Invoice, REC-2024, statement" />
            <div class="ifp-pattern-hint">
              For SUBSEQUENT emails from this sender: <strong> ONLY </strong> auto-select PDFs whose filenames
              contain this text.
            </div>
          </div>

          <div class="ifp-actions">
            <button id="inv-file-cancel">Cancel</button>
            <button id="inv-file-ok">Confirm</button>
          </div>
        </div>`;

      document.body.appendChild(overlay);

      const cleanup = (result) => {
        overlay.remove();
        resolve(result);
      };

      const listEl       = overlay.querySelector("#inv-file-list");
      const rememberCb   = overlay.querySelector("#inv-file-remember");
      const patternWrap  = overlay.querySelector("#inv-file-pattern-wrap");
      const patternInput = overlay.querySelector("#inv-file-pattern");
      const rowEls       = Array.from(overlay.querySelectorAll(".inv-file-row"));
      const boxEls       = Array.from(listEl.querySelectorAll("input[type=checkbox]"));

      const getSelectedIndices = () =>
        boxEls.filter((cb) => cb.checked).map((cb) => parseInt(cb.dataset.idx, 10));
      
      const isPartialSelection = () => {
        const sel = getSelectedIndices();
        return sel.length > 0 && sel.length < boxEls.length;
      };

      const applyHighlight = (text) => {    // text is the string that will be matched against file name
        rowEls.forEach((el, i) => {
          const name  = pdfs[i].filename || "";
          const match = !!text && name.includes(text); // case-sensitive
          if (match) {
            el.style.background = "#fff3cd";
            el.style.border     = "1px solid #ffb300";
          } else {
            el.style.background = "#f8f9fa";
            el.style.border     = "1px solid transparent";
          }
        });
      };

      const updatePatternVisibility = () => {
        const show = rememberCb.checked && isPartialSelection();
        patternWrap.style.display = show ? "block" : "none";
        if (!show) {
          patternInput.value = "";
          applyHighlight("");
        }
      };

      overlay.querySelector("#inv-file-all").addEventListener("click", () => {
        boxEls.forEach((cb) => (cb.checked = true));
        updatePatternVisibility();
      });
      overlay.querySelector("#inv-file-none").addEventListener("click", () => {
        boxEls.forEach((cb) => (cb.checked = false));
        updatePatternVisibility();
      });

      boxEls.forEach((cb) =>
        cb.addEventListener("change", updatePatternVisibility)
      );

      rememberCb.addEventListener("change", updatePatternVisibility);

      patternInput.addEventListener("input", () => {
        applyHighlight(patternInput.value);
      });

      overlay.querySelector("#inv-file-ok").addEventListener("click", () => {
        const selectedIndices = getSelectedIndices();
        const remember        = rememberCb.checked;
        const all  = selectedIndices.length === boxEls.length;
        const none = selectedIndices.length === 0;

        if (remember && !all && !none) {
          const pattern = patternInput.value;
          if (!pattern) {
            alert(
              "Please enter the text that identifies the documents you want remembered."
            );
            patternInput.focus(); // puts the text cursor in the field so the user can start typing immediately
            return;
          }
          const matches = selectedIndices.some((idx) =>
            (pdfs[idx].filename || "").includes(pattern)
          );
          if (!matches) {
            alert(
              "None of the selected PDFs contain that text. Please choose a text " +
              "that appears in AT-LEAST ONE of the selected PDFs."
            );
            patternInput.focus();
            return;
          }
          cleanup({ selectedIndices, remember, pattern });
          return;
        }

        cleanup({ selectedIndices, remember });
      });

      overlay.querySelector("#inv-file-cancel").addEventListener("click", () => {
        cleanup(null);
      });
    });
  }

  // Returns Promise<{ mode, pages?, remember } | null>
  function promptPageSelection(pdf, pageCount, sender) {
    return new Promise((resolve) => {
      ensureSectionStylesheet(
        "section-5-page-prompt",
        "src/content/css_files/section-5-page-prompt.css"
      );

      const overlay = document.createElement("div");
      overlay.id = "invoice-page-prompt";

      const pageBoxes = [];
      for (let p = 1; p <= pageCount; p++) {
        pageBoxes.push(`
          <label>
            <input type="checkbox" data-page="${p}" checked />
            <span>Page ${p}</span>
          </label>`);
      }

      overlay.innerHTML = `
        <div class="ipp-dialog">
          <h2>Invoice Mode — Select Pages</h2>
          <div class="ipp-subtitle">
            PDF <b>${escapeHtml(pdf.filename)}</b> from
            <b>${escapeHtml(sender)}</b> has <b>${pageCount}</b> pages.
          </div>

          <div class="ipp-mode-row">
            <label>
              <input type="radio" name="inv-page-mode" value="all" checked />
              <span>Include all pages</span>
            </label>
            <label>
              <input type="radio" name="inv-page-mode" value="specific" />
              <span>Choose specific pages</span>
            </label>
          </div>

          <div id="inv-page-specific">
            <div class="ipp-btn-row">
              <button type="button" id="inv-page-all">Select All</button>
              <button type="button" id="inv-page-none">Select None</button>
            </div>
            <div id="inv-page-grid">
              ${pageBoxes.join("")}
            </div>
          </div>

          <label class="ipp-remember-label">
            <input type="checkbox" id="inv-page-remember" />
            <span>Remember this choice for all Subsequent PDFs from this sender</span>
          </label>

          <div class="ipp-actions">
            <button id="inv-page-skip">Skip this PDF</button>
            <div class="ipp-actions-right">
              <button id="inv-page-cancel">Cancel</button>
              <button id="inv-page-ok">Confirm</button>
            </div>
          </div>
        </div>`;

      document.body.appendChild(overlay);

      const gridEl = overlay.querySelector("#inv-page-grid");
      const specificEl = overlay.querySelector("#inv-page-specific");

      overlay
        .querySelectorAll('input[name="inv-page-mode"]')
        .forEach((r) =>
          r.addEventListener("change", () => {
            const val = overlay.querySelector(
              'input[name="inv-page-mode"]:checked'
            ).value;
            specificEl.style.display = val === "specific" ? "block" : "none";
          })
        );

      const cleanup = (result) => {
        overlay.remove();
        resolve(result);
      };

      overlay.querySelector("#inv-page-all").addEventListener("click", () => {
        gridEl
          .querySelectorAll("input[type=checkbox]")
          .forEach((cb) => (cb.checked = true));
      });
      overlay.querySelector("#inv-page-none").addEventListener("click", () => {
        gridEl
          .querySelectorAll("input[type=checkbox]")
          .forEach((cb) => (cb.checked = false));
      });

      overlay.querySelector("#inv-page-ok").addEventListener("click", () => {
        const mode = overlay.querySelector(
          'input[name="inv-page-mode"]:checked'
        ).value;
        const remember = overlay.querySelector("#inv-page-remember").checked;
        if (mode === "all") {
          cleanup({ mode: "all", remember });
        } else {
          const pages = Array.from(
            gridEl.querySelectorAll("input[type=checkbox]")
          )
            .filter((cb) => cb.checked)
            .map((cb) => parseInt(cb.dataset.page, 10));
          if (pages.length === 0) {
            alert("Please select at least one page, or click 'Skip this PDF'.");
            return;
          }
          cleanup({ mode: "specific", pages, remember });
        }
      });

      overlay.querySelector("#inv-page-skip").addEventListener("click", () => {
        const remember = overlay.querySelector("#inv-page-remember").checked;
        cleanup({ mode: "skip", remember });
      });

      overlay.querySelector("#inv-page-cancel").addEventListener("click", () => {
        cleanup(null);
      });
    });
  }

  // =========================================================================
  //  SECTION 6 — Thread ID helper (no DOM interaction needed)
  // =========================================================================
    
  function getGmailAccountIndex() {
    const m = location.pathname.match(/\/mail\/u\/(\d+)/);
    return m ? m[1] : "0";
  }

  function decodeHtmlEntities(s) {
    const ta = document.createElement("textarea");
    ta.innerHTML = s;
    return ta.value;
  }

  function extractPdfUrlsFromPrintViewDoc(doc, baseUrl) {
    // doc: The parsed DOM Document created from Gmail’s Print View HTML.
    
    const seen = new Set();
    const pdfUrls = [];

    doc.querySelectorAll('a[href*="view=att"]').forEach((a) => {
      const rawHref = a.getAttribute("href") || "";
      if (!rawHref) return;

      let absoluteUrl;
      try {
        absoluteUrl = new URL(decodeHtmlEntities(rawHref), baseUrl).href;
      } catch { return; }
      if (seen.has(absoluteUrl)) return;

      // Filename lives in the <b> inside the row, not inside the <a>.
      const row = a.closest("tr");
      let filename = "";
      if (row) {
        const boldEl = row.querySelector("b");
        if (boldEl) filename = boldEl.textContent || "";
      }
      if (!filename) {
        filename =
          a.textContent ||
          a.getAttribute("aria-label") ||
          a.getAttribute("title") ||
          "";
      }

      filename = decodeHtmlEntities(filename).replace(/\s+/g, " ").trim();

      // Ensure it is a PDF
      if (!/\.pdf$/i.test(filename)) {
        const m = filename.match(/([\w\-. ]+\.pdf)/i);
        if (!m) return;
        filename = m[1].trim();
      }

      seen.add(absoluteUrl);
      pdfUrls.push({ url: absoluteUrl, filename });
    });

    return pdfUrls;
  }

  // The async function that actually fetches and parses the Print View
  async function getPdfUrlsFromPrintView(threadId) {

    const u = getGmailAccountIndex();
    const baseUrl = `https://mail.google.com/mail/u/${u}/`;
    const raw = threadId; 

    // data-legacy-thread-id is HEX. permthid= needs DECIMAL with thread-f: prefix.
    let decimal = null;
    try {
      decimal = BigInt("0x" + raw).toString(); // converts the hex string to a decimal string
    } catch {}

    const urls = [];
    if (decimal) {
      urls.push(`${baseUrl}?view=pt&search=all&permthid=thread-f:${decimal}`);
    }
    urls.push(`${baseUrl}?ui=2&view=pt&search=all&th=${raw}`);

    let html = null;
    for (const url of urls) {
      try {
        const res = await fetch(url, { credentials: "include", cache: "no-store" });
        if (!res.ok) {
          console.warn("[PV] non-ok:", res.status, url);
          continue;
        }
        const text = await res.text(); // Read the body of the response as a plain string (the HTML).
        console.log("[PV] len:", text.length, "hasAtt:", /view=att/.test(text), url);
        if (text && /view=att/.test(text)) {
          html = text;
          break;
        }
      } catch (e) {
        console.warn("[PV] fetch failed:", url, e);
      }
    }

    if (!html) return [];

    const doc = new DOMParser().parseFromString(html, "text/html"); // Parses the HTML string into a DOM document.
    return extractPdfUrlsFromPrintViewDoc(doc, baseUrl);
  }

  // =========================================================================
  //  SECTION 7 — Downloading + per-file validation
  // =========================================================================
  async function downloadPdf(url, filename) {
    try {
      const response = await fetch(url, {
        credentials: "include",
        cache: "no-store",
      });
      if (!response.ok) {  
        return { ok: false, reason: `HTTP ${response.status}` };
      }

      const contentType = (response.headers.get("content-type") || "").toLowerCase();
      if (contentType.includes("text/html")) {
        return {
          ok: false,
          reason: "download returned HTML (auth may have expired)",
        };
      }

      const blob = await response.blob();

      if (blob.size === 0) {
        return { ok: false, reason: "file is empty (0 bytes)" };
      }

      const head = new Uint8Array(await blob.slice(0, 5).arrayBuffer());
      const magic = String.fromCharCode.apply(null, head);
      if (magic !== "%PDF-") {
        return { ok: false, reason: "not a valid PDF file (bad header)" };
      }

      return { ok: true, blob, filename };
    } catch (error) {
      return { ok: false, reason: `download error: ${error.message}` };
    }
  }

  // =========================================================================
  //  SECTION 8 — Inspect PDF page count (page-world round-trip)
  // =========================================================================
  async function inspectPdf(blob) {
    try {
      const { PDFDocument } = window.PDFLib;
      const arrayBuffer = await blob.arrayBuffer(); 
      // PDFDocument.load() does not accept a Blob directly, but it does accept an ArrayBuffer, Uint8Array, or base64 string. 
      
      const pdfDoc = await PDFDocument.load(arrayBuffer);
      return { ok: true, pageCount: pdfDoc.getPageCount() };
    } catch (err) {
      const raw = String((err && err.message) || err);
      let reason;
      if (/encrypt/i.test(raw)) {
        reason = "password-protected or encrypted PDF";
      } else if (/parse|invalid|corrupt|structure/i.test(raw)) {
        reason = "corrupted or invalid PDF";
      } else {
        reason = raw.length > 100 ? raw.slice(0, 97) + "…" : raw;
      }
      return { ok: false, reason };
    }
  }

  // =========================================================================
  //  SECTION 9 — ZIP builder (using fflate)
  // =========================================================================

  function sanitizeEntryName(name) {
    return (
      String(name)
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 180) || "file.pdf"
    );
  }

  function uniqueFlatName(originalName, usedNames) {
    const safe = sanitizeEntryName(originalName || "file.pdf");
    if (!usedNames.has(safe)) {
      usedNames.add(safe);
      return safe;
    }
    const dot = safe.lastIndexOf(".");
    const base = dot > 0 ? safe.slice(0, dot) : safe;
    const ext  = dot > 0 ? safe.slice(dot) : "";
    let n = 1;
    let candidate = `${base}(${n})${ext}`;
    while (usedNames.has(candidate)) {
      n++;
      candidate = `${base}(${n})${ext}`;
    }
    usedNames.add(candidate);
    return candidate;
  }

  async function buildZipBlob(entries) {
    // entries: [{ name: string, blob: Blob }]
    const zipData = {};

    for (const entry of entries) {
      const bytes = new Uint8Array(await entry.blob.arrayBuffer());
      zipData[entry.name] = bytes;
    }

    const zipped = fflate.zipSync(zipData, { level: 0 });

    return new Blob([zipped], { type: "application/zip" });
  }

  // =========================================================================
  //  SECTION 10 — Shared collection pipeline
  //
  //  Walks every selected email, fetches its Print View (a static HTML page
  //  containing the full thread), extracts PDF attachment URLs, and downloads
  //  each PDF. When `useInvoiceMode` is true, the file-level and page-level
  //  prompts are invoked.
  //
  //  Returns { collectedPdfs, skipped }.
  //  collectedPdfs entries: { filename, blob, emailNumber, sender, subject,
  //                           pages }  — pages is null = all pages.
  //  skipped entries: { number, sender, subject, reason }.
  // =========================================================================
  async function collectPdfs({ useInvoiceMode }) {
    const invoiceMode = useInvoiceMode ? await getInvoiceMode() : false;
    const senderDecisions = await getSenderDecisions();

    const tracked = Array.from(selected.values());
    if (tracked.length === 0) throw new Error("No emails were selected.");

    showProgressUI();
    
    updateProgress("Preparing…", 0);

    const collectedPdfs = [];
    const skipped = [];

    for (let i = 0; i < tracked.length; i++) {  
      const info = tracked[i];
      const baseProgress = (i / tracked.length) * 70;

      updateProgress(
        `Fetching email ${i + 1}/${tracked.length}:\n${info.subject}`,
        baseProgress
      );

      const threadId = info.id;
      const pdfs = await getPdfUrlsFromPrintView(threadId);

      if (pdfs.length === 0) {
        skipped.push({
          number: i + 1,
          sender: info.sender,
          subject: info.subject,
          reason: "no PDF attachment found",
        });
        continue;
      }

      // -------------- Invoice Mode: file selection --------------
      let pdfsToProcess = pdfs;
      let senderDecision = { ...(senderDecisions[info.sender] || {}) };

      if (invoiceMode && pdfs.length > 1) {
        const fd = senderDecision.files;
        if (fd && fd.mode === "all") {
          // keep all — no prompt
        } else if (fd && fd.mode === "skip") {
          skipped.push({
            number: i + 1,
            sender: info.sender,
            subject: info.subject,
            reason: `all PDFs skipped by sender rule`,
          });
          continue;
        } else if (fd && fd.mode === "pattern" && fd.pattern) {
          // Sender rule remembers a text pattern — keep matching PDFs only.
          const matched = pdfs.filter((p) =>
            (p.filename || "").includes(fd.pattern)
          );
          if (matched.length === 0) {
            skipped.push({
              number: i + 1,
              sender: info.sender,
              subject: info.subject,
              reason: `no PDFs match remembered pattern "${fd.pattern}"`,
            });
            continue;
          }
          pdfsToProcess = matched;
        } else {
          const choice = await promptFileSelection(pdfs, info.sender);
          if (!choice) throw new Error("Cancelled by user in Invoice Mode.");

          if (choice.selectedIndices.length === 0) {
            skipped.push({
              number: i + 1,
              sender: info.sender,
              subject: info.subject,
              reason: "no PDFs selected by user",
            });
            if (choice.remember) {
              senderDecision = { ...senderDecision, files: { mode: "skip" } };
              senderDecisions[info.sender] = senderDecision;
              await saveSenderDecisions(senderDecisions);
            }
            continue;
          }

          pdfsToProcess = choice.selectedIndices.map((idx) => pdfs[idx]); // a new array containing only the chosen pdf

          if (choice.remember) {
            if (choice.selectedIndices.length === pdfs.length) {
              // All selected → remember "all".
              senderDecision = { ...senderDecision, files: { mode: "all" } };
              senderDecisions[info.sender] = senderDecision;
              await saveSenderDecisions(senderDecisions);
            } else if (choice.pattern) {
              // Partial selection → remember the entered text pattern.
              senderDecision = {
                ...senderDecision,
                files: { mode: "pattern", pattern: choice.pattern },
              };
              senderDecisions[info.sender] = senderDecision;
              await saveSenderDecisions(senderDecisions);
            }
          }
        }
      }

      const skipPagePrompts = pdfsToProcess.length > 1;

      // -------------- Download + (optional) page selection --------------
      for (let j = 0; j < pdfsToProcess.length; j++) {
        const pdf = pdfsToProcess[j];
        updateProgress(
          `Downloading ${pdf.filename}\n(email ${i + 1}/${tracked.length})…`,
          baseProgress +
            ((j + 1) / Math.max(1, pdfsToProcess.length)) *
              (70 / tracked.length)
        );
        const dl = await downloadPdf(pdf.url, pdf.filename);
        if (!dl.ok) {
          skipped.push({
            number: i + 1,
            sender: info.sender,
            subject: info.subject,
            reason: `${pdf.filename} — ${dl.reason}`,
          });
          continue;
        }

        let pagesSpec = null;

        if (invoiceMode && !skipPagePrompts) {
          updateProgress(
            `Inspecting ${pdf.filename}…\n(email ${i + 1}/${tracked.length})`,
            baseProgress +
              ((j + 1) / Math.max(1, pdfsToProcess.length)) *
                (70 / tracked.length)
          );
          const inspect = await inspectPdf(dl.blob);
          if (!inspect.ok) {
            skipped.push({
              number: i + 1,
              sender: info.sender,
              subject: info.subject,
              reason: `${pdf.filename} — ${inspect.reason}`,
            });
            continue;
          }

          const pageCount = inspect.pageCount;

          if (pageCount > 1) {
            const pd = senderDecision.pages;
            if (pd && pd.mode === "all") {
              pagesSpec = null;
            } else if (pd && pd.mode === "skip") {
              skipped.push({
                number: i + 1,
                sender: info.sender,
                subject: info.subject,
                reason: `${pdf.filename} — skipped by sender rule`,
              });
              continue;
            } else if (pd && pd.mode === "specific") {
              const valid = (pd.pages || []).filter(
                (p) => Number.isInteger(p) && p >= 1 && p <= pageCount // p >= 1 — pages are 1‑indexed in PDFs; 0 or negatives are meaningless.
              );
              if (valid.length === 0) {
                skipped.push({
                  number: i + 1,
                  sender: info.sender,
                  subject: info.subject,
                  reason: `${pdf.filename} — no pages match sender rule`,
                });
                continue;
              }
              pagesSpec = valid;
            } else {
              const choice = await promptPageSelection(
                pdf,
                pageCount,
                info.sender
              );
              if (!choice) throw new Error("Cancelled by user in Invoice Mode.");

              if (choice.mode === "skip") {
                skipped.push({
                  number: i + 1,
                  sender: info.sender,
                  subject: info.subject,
                  reason: `${pdf.filename} — skipped by user`,
                });
                if (choice.remember) {
                  senderDecision = {
                    ...senderDecision,
                    pages: { mode: "skip" },
                  };
                  senderDecisions[info.sender] = senderDecision;
                  await saveSenderDecisions(senderDecisions);
                }
                continue;
              }

              if (choice.mode === "all") {
                pagesSpec = null;
                if (choice.remember) {
                  senderDecision = {
                    ...senderDecision,
                    pages: { mode: "all" },
                  };
                  senderDecisions[info.sender] = senderDecision;
                  await saveSenderDecisions(senderDecisions);
                }
              } else {
                pagesSpec = choice.pages;
                if (choice.remember) {
                  senderDecision = {
                    ...senderDecision,
                    pages: { mode: "specific", pages: choice.pages },
                  };
                  senderDecisions[info.sender] = senderDecision;
                  await saveSenderDecisions(senderDecisions);
                }
              }
            }
          }
        }

        collectedPdfs.push({
          filename: pdf.filename,
          blob: dl.blob,
          emailNumber: i + 1,
          sender: info.sender,
          subject: info.subject,
          pages: pagesSpec,
        });
      }

    }

    return { collectedPdfs, skipped };
  }

  // =========================================================================
  //  SECTION 11 — Combine action
  // =========================================================================
  async function combineSelectedPdfs() {
    const { collectedPdfs, skipped } = await collectPdfs({useInvoiceMode: true,});

    if (collectedPdfs.length === 0) {
      await saveFailedEmails(skipped);
      const lines = ["No usable PDFs were found in any of the selected emails."];
      if (skipped.length > 0) {
        lines.push("");
        lines.push("See the popup → “Previous Failed Emails/PDFs” for details.");
      }
      throw new Error(lines.join("\n"));
    }

    updateProgress(`Combining ${collectedPdfs.length} PDF(s)…`, 85);

    const { PDFDocument } = window.PDFLib;
    const combinedDoc = await PDFDocument.create();
    const failures = [];

    for (const item of collectedPdfs) {
      try {
        const arrayBuffer = await item.blob.arrayBuffer(); 
        // reads the Blob (the downloaded PDF) into an ArrayBuffer, because PDFDocument.load() doesn't accept a Blob directly.
        
        const pdfDoc = await PDFDocument.load(arrayBuffer);
        // parses that binary into an in‑memory PDFDocument object (pdfDoc), ready for page extraction.

        const totalPages = pdfDoc.getPageCount();

        let indices;
        if (Array.isArray(item.pages) && item.pages.length > 0) {
          indices = item.pages
            .map((p) => Number(p) - 1)
            .filter((idx) => Number.isInteger(idx) && idx >= 0 && idx < totalPages);
        } else {
          indices = pdfDoc.getPageIndices();
        }

        if (indices.length === 0) {
          failures.push({
            filename: item.filename,
            emailNumber: item.emailNumber,
            sender: item.sender,
            subject: item.subject,
            reason: "no pages selected",
          });
          continue;
        }

        const pages = await combinedDoc.copyPages(pdfDoc, indices);
        pages.forEach((page) => combinedDoc.addPage(page));
      } catch (err) {
        const raw = String((err && err.message) || err);
        let reason;
        if (/encrypt/i.test(raw)) {
          reason = "password-protected or encrypted PDF";
        } else if (
          /Failed to parse|parse PDF|Invalid PDF|corrupt|structure/i.test(raw)
        ) {
          reason = "corrupted or invalid PDF";
        } else {
          reason = raw.length > 100 ? raw.slice(0, 97) + "…" : raw;
        }
        failures.push({
          filename: item.filename,
          emailNumber: item.emailNumber,
          sender: item.sender,
          subject: item.subject,
          reason,
        });
      }
    }

    if (combinedDoc.getPageCount() === 0) {
      for (const p of collectedPdfs) {
        if (p) { p.blob = null; p.filename = null; }
      }
      collectedPdfs.length = 0;
      const err = new Error("No usable PDF pages could be extracted.");
      err.failures = failures;
      throw err;
    }

    const pdfBytes = await combinedDoc.save();
    const combineResult = {
      blob: new Blob([pdfBytes], { type: "application/pdf" }),
      failures,
    };

    for (const f of combineResult.failures) {
      skipped.push({
        number: f.emailNumber,
        sender: f.sender,
        subject: f.subject,
        reason: `${f.filename} — ${f.reason}`,
      });
    }

    await saveFailedEmails(skipped);

    const combinedCount = collectedPdfs.length - combineResult.failures.length;

    // programmatically trigger the download of the combined PDF

    const url = URL.createObjectURL(combineResult.blob); // Give me a temporary address for this in-memory PDF
    const link = document.createElement("a");           // Make a fake link.
    link.href = url;                                    // Point the fake link at the temporary address.
    link.download = "combined.pdf";                     // Tell the browser: when this is clicked, save it as combined.pdf.
    link.click();                                     // Click it programmatically
    setTimeout(() => URL.revokeObjectURL(url), 5000);   // After 5 seconds, URL.revokeObjectURL(url) destroys the temporary address

    // Release source PDFs
    try {
      for (const p of collectedPdfs) {
        if (p) {
          p.blob = null;
          p.filename = null;
        }
      }
      collectedPdfs.length = 0;

      combineResult.blob = null;
      combineResult.failures.length = 0;
    } catch (e) {
      console.warn("Blob cleanup failed:", e);
    }

    let summary = `✅ Done! Combined ${combinedCount} PDF(s) into combined.pdf.`;
    if (skipped.length > 0) {
      summary +=
        `\n\nSkipped ${skipped.length} item(s). ` +
        `See “Previous Failed Emails/PDFs” in the popup for details.`;
    }
    updateProgress(summary, 100);
    hideProgressUI(skipped.length > 0 ? 5000 : 2500);
  }

  // =========================================================================
  //  SECTION 12 — Download-all action (flat ZIP, no merging, no Invoice Mode)
  // =========================================================================
  async function downloadAllPdfs() {
    const { collectedPdfs, skipped } = await collectPdfs({
      useInvoiceMode: false,
    });

    if (collectedPdfs.length === 0) {
      await saveFailedEmails(skipped);
      throw new Error("No usable PDFs were found in any of the selected emails.");
    }

    updateProgress(`Building ZIP with ${collectedPdfs.length} file(s)…`, 88);

    // Duplicate names get a numeric
    // suffix before the extension: invoice.pdf → invoice(1).pdf, etc.
    const usedNames = new Set();
    const entries = [];

    for (const pdf of collectedPdfs) {
      const name = uniqueFlatName(pdf.filename, usedNames);
      entries.push({ name, blob: pdf.blob });
    }

    let zipBlob;
    try {
      zipBlob = await buildZipBlob(entries);
    } catch (err) {
      await saveFailedEmails(skipped);
      throw new Error("Failed to build ZIP: " + err.message);
    }

    // Record any files that couldn't be downloaded.
    await saveFailedEmails(skipped);

    // Download the ZIP
    const url = URL.createObjectURL(zipBlob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "selected_pdfs.zip";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);

    const count = entries.length;

    // Release in-memory blobs. The ZIP file is now on the user's disk.
    try {
      for (const p of collectedPdfs) {
        if (p) {
          p.blob = null;
          p.filename = null;
        }
      }
      collectedPdfs.length = 0;
      entries.length = 0;
      zipBlob = null;
    } catch (e) {
      console.warn("Blob cleanup failed:", e);
    }

    let summary = `✅ Done! Saved ${count} PDF(s) into selected_pdfs.zip.`;
    if (skipped.length > 0) {
      summary +=
        `\n\nSkipped ${skipped.length} item(s). ` +
        `See “Previous Failed Emails/PDFs” in the popup for details.`;
    }
    updateProgress(summary, 100);
    hideProgressUI(skipped.length > 0 ? 5000 : 2500);

    return count;
  }

  // =========================================================================
  //  SECTION 13 — Message handling
  // =========================================================================
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    
    if (msg.type === "START") {
      active = true;
      hasSession = true;
      selected.clear();
      startObserver();
      sendResponse({ ok: true });

    } else if (msg.type === "RESUME") {
      if (!hasSession) {
        sendResponse({ ok: false, error: "No previous session" });
        return true;
      }
      active = true;
      startObserver();
      sendResponse({ ok: true });

    } else if (msg.type === "STOP") {
      active = false;
      stopObserver();
      if (flushTimer) {
        clearTimeout(flushTimer);
        flush();
      }
      sendResponse({ ok: true, emails: Array.from(selected.values()) });

    } else if (msg.type === "RESET") {
      active = false;
      hasSession = false;
      combining = false;
      selected.clear();
      pending.clear();
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      stopObserver();
      hideProgressUI(0);
      sendResponse({ ok: true });

    } else if (msg.type === "PING") {
      sendResponse({
        ok: true,
        active,
        hasSession,
        combining,
        count: selected.size,
      });
      
    } else if (msg.type === "COMBINE") {

      if (combining) {
        sendResponse({
          ok: false,
          error: "An operation is already in progress.",
        });
        return true;
      }

      combining = true;

      combineSelectedPdfs()
        .then(() => {
          combining = false;
          sendResponse({ ok: true });
        })
        .catch((err) => {
          combining = false;
          showErrorUI(err.message || String(err));
          sendResponse({ ok: false, error: err.message });
        });

      return true;
      
    } else if (msg.type === "DOWNLOAD_ALL") {

      if (combining) {
        sendResponse({
          ok: false,
          error: "An operation is already in progress.",
        });
        return true;
      }

      combining = true;

      downloadAllPdfs()
        .then((count) => {
          combining = false;
          sendResponse({ ok: true, count });
        })
        .catch((err) => {
          combining = false;
          showErrorUI(err.message || String(err));
          sendResponse({ ok: false, error: err.message });
        });

      return true;
    }
    return true;
  });
})();
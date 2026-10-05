# Privacy Policy — Gmail PDF Combiner

**Last updated: October 5, 2026**

Gmail PDF Combiner is a browser extension that helps you select emails in Gmail and combine their PDF attachments into a single document or download them as a ZIP archive. This policy explains what data the extension processes, why it is processed, and how it is handled.

Our guiding principle is simple: **everything the extension does runs entirely in your browser.** No data is ever sent to a server.

## 1. What We Do Not Do

- We do not ask for or store your Gmail password.
- We do not use the Gmail API to read your entire mailbox.
- We do not use any third-party analytics, error tracking, or advertising services.
- We do not sell your personal data.
- We do not transmit any of your data to external servers.

## 2. Information Processed by the Extension

When you select emails and start an operation, the extension reads the following information from the Gmail page:

- **Email metadata:** The sender name and subject line of the selected emails, which are used to display a preview of your selection.
- **Thread identifiers:** Internal Gmail thread IDs, which are used to fetch the Print View of each selected email.
- **Attachment data:** PDF attachment URLs, filenames, and file contents. This data is downloaded directly from Gmail and processed locally in your browser.

This information is used solely to download attachments, merge PDFs, create ZIP archives, and display progress updates within the Gmail page.

**All processing happens locally.** Attachment content, PDF merging, and ZIP creation are performed in your browser using bundled JavaScript libraries (`pdf-lib` and `fflate`). No attachment data, email content, or selection information is ever uploaded to any external server.

## 3. Local Browser Storage

The extension stores a small amount of data in `chrome.storage.local` on your device. This includes:

- **`lastFailedEmails`:** A list of emails that were skipped during the last operation, so you can review them in the "Previous Failed Emails" window.
- **`invoiceMode`:** Whether Invoice Mode is turned on or off.
- **`senderDecisions`:** Per-sender preferences you create in Invoice Mode (e.g., remembering which PDFs to select or which pages to include for a particular sender).

This data never leaves your device. You can remove it at any time by uninstalling the extension, clearing the extension's storage through your browser settings, reloading the Gmail page or clicking the "Reset" button in the extension popup.

## 4. Permissions Used

The extension requests the following permissions, each strictly necessary for its core functionality:

- **`storage`:** Used to persist your settings and failure records locally, as described above.
- **`scripting`:** Used to inject the necessary libraries and content script into the Gmail tab when you first click on the extension after loading a Gmail page.
- **`host_permissions` for `https://mail.google.com/*`:** Required so the extension can read the Gmail page, fetch the Print View of selected threads, and download PDF attachments.


## 5. Data Retention and Deletion

The extension stores a small amount of persistent data in `chrome.storage.local` on your device: `lastFailedEmails`, `invoiceMode`, and `senderDecisions`. This data remains until you uninstall the extension, clear its storage through your browser settings, reload the Gmail page, or click the "Reset" button in the extension popup.

Downloaded PDF attachment data and the combined PDF or ZIP output are held only in memory during the operation. They are not written to persistent storage. The attachment blobs are released, and the combined output's temporary object URL is revoked, as soon as the operation completes and the download is initiated.

## 6. Security

Because no data is transmitted to external servers, the primary security consideration is the local integrity of the extension. The extension uses HTTPS for all requests to Gmail, and all processing occurs in a sandboxed browser environment. No internet service can be guaranteed 100% secure, but we have designed this extension to minimize data exposure by keeping everything on your device.

## 7. Children's Privacy

This extension is not directed to children under 13. We do not knowingly collect personal information from children under 13. If you believe a child has provided personal information through this extension, please contact us and we will take appropriate steps to delete it.

## 8. Changes to This Policy

We may update this Privacy Policy from time to time. Changes are effective when posted on this page.

## 9. Contact

If you have questions or requests about this Privacy Policy, please contact us:

**Email:** [swaroopnerd@gmail.com]

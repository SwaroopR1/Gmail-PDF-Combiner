# Gmail PDF Combiner

A Chrome extension that lets you select emails in Gmail and either combine their PDF attachments into a single document or download them all as a ZIP archive. Everything runs locally in your browser — no data is sent to any server.

## Features

- **Select emails in Gmail** – Click the extension icon, start selection, and pick the emails you want.
- **Combine PDFs** – Merge all PDF attachments from the selected emails into one `combined.pdf`.
- **Download All as ZIP** – Save every PDF attachment as a flat `selected_pdfs.zip`.
- **Invoice Mode** – Optionally choose which PDFs and which pages to include per sender. Remember your choices for future emails from the same sender (cleared on Gmail page reload, Reset, or uninstall).
- **Failure tracking** – Any skipped emails are saved locally so you can review them later in the “Previous Failed Emails” window.
- **100% local processing** – PDF merging and ZIP creation use bundled JavaScript libraries (`pdf-lib`, `fflate`). No attachment data ever leaves your device.

## Demo

[![Watch the demo](https://img.youtube.com/vi/https://www.youtube.com/watch?v=DGqkJ7oy8C0/0.jpg)](https://www.youtube.com/watch?v=DGqkJ7oy8C0)


## Code Map (Excalidraw)

For developers who want a quick overview of how the extension works, an Excalidraw file is included in the repository: docs/codemap.excalidraw

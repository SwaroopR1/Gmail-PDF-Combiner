
## Installation

# Installation and Usage

### From the Chrome Web Store
*(Coming soon — link will be added here.)*

### Manual (Developer Mode)
1. Clone this repository or download the ZIP.
2. Open Chrome and go to `chrome://extensions`.
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the project folder.
5. The extension icon will appear in your toolbar.

## Usage

1. Open Gmail in Chrome.
2. Click the extension icon.
3. (Optional) Toggle **Invoice Mode** if you want to select specific PDFs or pages.
4. Click **Start Selection**.
5. Select the emails you want by ticking their checkboxes in Gmail.
6. Click **Stop** (followed by **Show Emails** to review the list).
7. Click **Combine PDFs from Selected Emails** to merge them, or **Download All PDFs** to get a ZIP.
8. Watch the progress overlay on the Gmail page. The file downloads automatically when ready.

## Permissions

| Permission | Why it's needed |
|------------|-----------------|
| `storage` | Saves your Invoice Mode preferences and failure records locally. |
| `scripting` | Injects the content script and libraries into the Gmail tab on first use. |
| `host_permissions` (`https://mail.google.com/*`) | Reads the Gmail page, fetches Print View of selected threads, and downloads PDF attachments. |

## Privacy

All processing happens locally. No email content, attachment data, or selection information is sent to external servers.

For full details, see the [Privacy Policy](../PRIVACY.md).

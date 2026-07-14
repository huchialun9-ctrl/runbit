# Runbits Web

**Instant Local Server & Live Previewer for Web Developers**

Zero-command, zero-server local web previewer. Drag, drop, and run your web projects instantly in the browser.

![Runbits Web](https://img.shields.io/badge/status-active-brightgreen) ![License](https://img.shields.io/badge/license-MIT-blue) ![Node](https://img.shields.io/badge/node-%3E%3D16-green)

## Features

- **Zero Command** - No terminal, no npm scripts. Just drag and drop.
- **0% Server** - 100% runs in your browser. Code never leaves your machine.
- **No Sign-ups** - Open the page and start working immediately.
- **Live Preview** - Instant iframe preview with responsive viewport switching (desktop/tablet/mobile).
- **QR Code Testing** - Scan QR code to preview on your real phone, wirelessly.
- **Code Editor** - Built-in CodeMirror editor with syntax highlighting, auto-completion, and formatting.
- **File System Access API** - Link your local folder for two-way sync with VS Code.
- **Hot Reload** - Changes sync instantly via WebSocket.
- **Debug Console** - Real-time console logs and network request monitoring.
- **Dev Toolbox** - JSON formatter, Base64, URL encoding, JWT parser, timestamp converter, SHA-256 hash.
- **PWA Support** - Install as a Progressive Web App, works offline.

## Quick Start

### Option 1: Direct (No install needed)

Simply open `index.html` in your browser. The app runs entirely in the browser.

### Option 2: With Backend (Recommended)

```bash
# Clone the repo
git clone https://github.com/huchialun9-ctrl/runbit.git
cd runbit

# Install dependencies
npm install

# Start the dev server
npm run dev
```

Open http://localhost:3000 in your browser.

## Architecture

```
Your Files → VFS (IndexedDB) → Service Worker Gateway → Sandboxed Preview
                                     ↓
                               WebSocket Hot-Reload
                                     ↓
                              REST API (Backend)
```

### Core Components

| Component | Description |
|-----------|-------------|
| **VFS (Virtual File System)** | IndexedDB-backed file storage with full CRUD operations |
| **Service Worker** | Intercepts preview requests, serves files from VFS with correct MIME types |
| **Sandboxed Iframe** | Isolated preview environment with console/network interception |
| **Express Backend** | REST API for project management, QR code generation, file hosting |
| **WebSocket** | Real-time hot-reload notifications between server and client |

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/projects` | List all projects |
| `POST` | `/api/projects` | Create a new project |
| `GET` | `/api/projects/:id` | Get project details and files |
| `DELETE` | `/api/projects/:id` | Delete a project |
| `PUT` | `/api/projects/:id/files` | Create/update a file |
| `POST` | `/api/projects/:id/files/batch` | Batch upload files |
| `DELETE` | `/api/projects/:id/files?path=...` | Delete a file |
| `GET` | `/api/projects/:id/files?path=...` | Get file content |
| `GET` | `/api/qr?text=...&size=200` | Generate QR code (data URL) |
| `GET` | `/api/qr.png?text=...&size=200` | Generate QR code (PNG) |
| `GET` | `/preview/:projectId/*` | Serve project files for preview |

## Development

```bash
# Development mode with hot reload
npm run dev

# Production mode
npm start
```

## Tech Stack

- **Frontend**: Vanilla HTML/CSS/JS, CodeMirror 5, Service Workers, IndexedDB
- **Backend**: Node.js, Express, WebSocket (ws), QRCode.js
- **PWA**: Service Worker caching, Web App Manifest

## Security

- **Iframe Sandbox**: Preview runs in sandboxed iframe with restricted permissions
- **Same-Origin Policy**: Virtual domain isolation prevents cross-origin access
- **No Telemetry**: Zero data collection, zero analytics
- **Offline First**: Works without internet after first load

## License

MIT - Made with passion by developers, for developers.

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

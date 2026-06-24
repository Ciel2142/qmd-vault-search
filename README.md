# qmd Search for Obsidian

Search your vault and external [qmd](https://www.npmjs.com/package/@tobilu/qmd) collections with hybrid (BM25 + vector) search, right inside Obsidian. Adds a search panel, a quick-search command, a "Related notes" panel, and semantic link suggestions.

- **Hybrid search** — keyword (BM25) and semantic (vector) search, with a Keyword/Hybrid toggle in the panel.
- **Quick search modal** — search from the command palette without opening a panel.
- **Related notes** — a side panel that shows notes semantically similar to the one you're reading.
- **Semantic link suggestions** — type `@@` in a note to get suggested links by meaning, not just filename.
- **qmd context summaries** — right-click any file or folder to attach a human-written summary that tells qmd what it contains.
- **Auto-indexing** — your vault is indexed and embedded automatically, and re-indexed when you edit.

> **Desktop only.** The plugin launches the local `qmd` engine as a child process, so it does not run on Obsidian mobile.

---

## Installation

> Not yet in the official Community Plugins directory. Two ways to install today (both need the **qmd engine** from Step 1 below):

**Via BRAT (recommended — auto-updates):**

1. Install the **BRAT** community plugin (Settings → Community plugins → Browse → "BRAT").
2. BRAT → **Add Beta plugin** → enter `Ciel2142/qmd-vault-search` → **Add**.
3. Enable **qmd Vault Search** under Settings → Community plugins.

**Manual (from a release):**

Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/Ciel2142/qmd-vault-search/releases/latest) into `<your-vault>/.obsidian/plugins/qmd-vault-search/`, then enable the plugin.

To build from source instead, follow Steps 2–4 below.

---

## Requirements

1. **Obsidian** 1.7.2 or newer (desktop).
2. **qmd** — the local search engine this plugin drives. It is a separate command-line tool you install once (see below).
3. **Node.js** 18+ — only needed to *build* the plugin from source. Not needed at runtime (Obsidian bundles its own Node).

---

## Step 1 — Install the `qmd` engine

The plugin talks to a local `qmd` daemon. Install the `qmd` CLI globally with npm or bun:

```bash
npm install -g @tobilu/qmd
# or
bun install -g @tobilu/qmd
```

Verify it's on your `PATH`:

```bash
qmd --version    # e.g. qmd 2.5.2
```

If `qmd` is **not** on your `PATH` (common on Windows, or with custom installs), note its full path — you'll set it in the plugin settings later. On Windows the global install is typically `qmd.cmd`; the plugin handles launching `.cmd` shims automatically.

> **First run downloads models.** The first semantic search/embedding triggers `qmd` to download its embedding + query-expansion models (~1+ GB) via `node-llama-cpp`. This is a one-time download, cached under your user cache dir. Keyword search works immediately; semantic results appear once models finish loading.

---

## Step 2 — Build the plugin

The compiled `main.js` is **not** checked into the repo (it's a build artifact), so you build it once:

```bash
git clone <this-repo-url> obsidian-qmd-plugin
cd obsidian-qmd-plugin
npm install
npm run build
```

This produces `main.js` in the project root. You now have the three files Obsidian needs:

- `main.js`
- `manifest.json`
- `styles.css`

---

## Step 3 — Install into your vault

**macOS shortcut:** run the bundled script — it builds (if needed), auto-detects your vault, and copies everything:

```bash
./install-macos.sh                       # auto-detect from your Obsidian vault list
./install-macos.sh "/path/to/your/vault" # or pass the vault explicitly
```

Otherwise, copy the three files into a `qmd-vault-search` folder inside your vault's plugins directory by hand:

```
<your-vault>/.obsidian/plugins/qmd-vault-search/
├── main.js
├── manifest.json
└── styles.css
```

**macOS / Linux:**

```bash
mkdir -p "<your-vault>/.obsidian/plugins/qmd-vault-search"
cp main.js manifest.json styles.css "<your-vault>/.obsidian/plugins/qmd-vault-search/"
```

**Windows (PowerShell):**

```powershell
$dest = "<your-vault>\.obsidian\plugins\qmd-vault-search"
New-Item -ItemType Directory -Force -Path $dest
Copy-Item main.js, manifest.json, styles.css $dest
```

Replace `<your-vault>` with the absolute path to your vault. (`.obsidian` is a hidden folder at the vault root.)

---

## Step 4 — Enable and first run

1. In Obsidian: **Settings → Community plugins**. Turn off **Restricted mode** if it's on.
2. Find **qmd Search** in the installed plugins list and toggle it **on**. (If you copied the files while Obsidian was open, click the reload/refresh icon first.)
3. On load the plugin will:
   - **Start the qmd daemon** if it isn't already running (`qmd mcp --http --daemon --port 8181`). You'll see a notice: *"qmd daemon not running — starting it. Give it a few seconds to load models."*
   - **Register your vault** as a qmd collection named `vault` and embed it (one-time, runs in the background).
   - **Re-index automatically** whenever you create, edit, rename, or delete notes.

You don't need to run any `qmd` commands by hand — the plugin manages the daemon and indexing for you.

---

## Usage

| How | What it does |
|-----|--------------|
| 🔍 **Search ribbon icon** (left sidebar) | Opens the qmd search panel. Toggle Keyword/Hybrid; results link straight to notes. |
| 📋 **List ribbon icon** | Opens the **Related notes** panel for the active note. |
| Command palette → **Open qmd search panel** | Same as the search ribbon icon. |
| Command palette → **Search qmd (modal)** | Quick search in a pop-up modal. |
| Command palette → **Open related notes panel** | Same as the list ribbon icon. |
| Type **`@@`** in a note | Semantic link suggestions — pick one to insert a `[[wikilink]]`. |
| Right-click a file/folder → **Set qmd context…** | Attach / edit / remove a human-written summary for that path (see below). |
| Command palette → **Set qmd context for current file** | Same, for the active note. |

> Tip: assign hotkeys to the commands in **Settings → Hotkeys** (search "qmd").

---

## qmd context summaries

qmd lets you attach a short, human-written **context summary** to a file, a folder, or your whole vault. The summary tells qmd's search what that path is about — it's the `qmd context add` CLI command surfaced in Obsidian.

**To set one:** right-click a file or folder in the file explorer → **Set qmd context…** (or run the command **Set qmd context for current file**). A box opens, pre-filled with the current summary if there is one. Type a sentence or two describing the path and click **Save**; **Remove** deletes it.

- A summary on a **folder** applies to everything under it; on a **file**, to that file; on the **vault root**, to the whole collection.
- Setting a context does **not** re-embed your vault — it's a small config change.
- If a context change doesn't seem reflected in search, reload the plugin (or restart the daemon) so the running daemon re-reads it.
- Summaries are single-line: if you enter multiple lines, only the first is kept when you reopen the box to edit.

---

## Settings

**Settings → qmd Search:**

| Setting | Default | Notes |
|---------|---------|-------|
| **qmd binary path** | `qmd` | Set to an absolute path if `qmd` isn't on Obsidian's `PATH`. |
| **Daemon port** | `8181` | HTTP port the plugin connects to / starts the daemon on. |
| **Vault collection name** | `vault` | The qmd collection name for this vault. |
| **External collections** | *(none)* | Comma-separated qmd collection names to also search. Use **Detect** to list what the daemon has. |
| **Rerank** | on | LLM rerank on explicit searches — slower, higher quality. |
| **Reindex on save** | on | Incrementally re-index the vault after edits. |
| **Reindex debounce (ms)** | `1500` | Idle delay before reindexing after an edit. |
| **Related notes count** | `8` | How many neighbors the Related notes panel shows. |
| **Search debounce (ms)** | `300` | Idle delay before live keyword search fires as you type. |
| **Fallback on semantic failure** | on | If a Hybrid search errors, retry as keyword. |
| **Fallback on zero results** | off | If a Hybrid search finds nothing, retry as keyword. |

---

## Troubleshooting

**"qmd daemon failed to start" notice / no results.**
The plugin can't find `qmd`. Confirm `qmd --version` works in a terminal, then set **qmd binary path** in settings to its absolute path and reload the plugin.

**Daemon health check (manual).**
With the daemon running, this should return `{"status":"ok",...}`:

```bash
curl http://localhost:8181/health
```

If nothing answers, start it manually to see errors:

```bash
qmd mcp --http --daemon --port 8181
```

**Semantic / Hybrid search returns nothing at first.**
Embeddings are still downloading models or building. Keyword mode works immediately; give Hybrid a minute on first use. You can check progress with `qmd status`.

**Port already in use.**
Change **Daemon port** in settings (and reload), or stop the conflicting process. The default is `8181`.

---

## Development

```bash
npm run dev        # esbuild watch mode (rebuilds main.js on change)
npm test           # run the vitest suite
npm run typecheck  # tsc --noEmit
npm run build      # typecheck + production bundle
```

To iterate against a real vault, symlink or copy `main.js`/`manifest.json`/`styles.css` into the vault's `.obsidian/plugins/qmd-vault-search/` folder and reload Obsidian after each build.

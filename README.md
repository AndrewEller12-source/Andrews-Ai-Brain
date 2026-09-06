# Ai Task Manager

Your Codex account, organized as a personal work universe. Click the workspace name to rename it. Departments grow from your own tasks; Settings lets you create departments with optional routing keywords. Explore department → project → agent, double-click an agent to zoom in, and inspect its exact current request and latest observed work. The + Agent button prepares a new request in the selected department; Send starts real Codex execution. Scroll or pinch to zoom, drag to pan, and use the fit button to recover the view.

All preferences and work history stay in the existing local application data directory when upgrading. Release packages contain no account credentials or personal department settings. The native Xcode project and dashboard source remain editable.

# Ai Task Manager

A local dashboard powered by the Codex app-server and official Codex SDK. One inbox routes tasks to projects and available models; a department graph shows live desktop and dashboard activity alongside recorded history. Requests are persisted before routing and dispatched through a bounded queue.

See [APPLE-APPS.md](APPLE-APPS.md) for the editable Mac and iPhone apps, or [TREY-QUICKSTART.md](TREY-QUICKSTART.md) for the portable dashboard. Existing Rewster Command data and task history are preserved.

## Install and run

The architecture-specific Mac ZIP includes Node.js, the pinned Codex CLI and SDK: extract and double-click Start Rewster Command.command. The source-only ZIP requires Node.js 22.12+. Internet access is needed for model execution and sign-in; Git is needed for Git worktrees.

```sh
npm install --omit=dev
npm run launch
```

The source-only macOS and Windows Start launchers install dependencies on first run. The self-contained Mac release starts directly from its bundled runtime. `npm start` runs in the foreground. `npm run stop` stops the launcher-managed server only after checking its identity. `npm run doctor` reports runtime paths and CLI readiness. The server binds to `127.0.0.1:4780`; `PORT` overrides the port.

The pinned `@openai/codex` native CLI is preferred by default. `CODEX_BIN` overrides it; an installed CLI or desktop application binary is a fallback. The official `@openai/codex-sdk` provides the opt-in SDK execution and continuation smoke test; interactive dashboard work uses the app-server for reviewable approvals. Authentication uses the recipient's local Codex account. Account access and usage limits come from Codex; installing the dashboard grants no additional model access.

## Use

- Open **Working now** to see each unfinished request with its exact message, chat, department/project, execution clock and latest activity. The oldest execution appears first; **5+ minutes** isolates long-running work. Queued follow-ups remain separate from the current turn, and completed requests leave the list automatically. Desktop messages are retrieved by exact turn ID; unavailable text is never replaced with an old message.
- Send normal requests; automatic routing selects a project and available model. Explicit project/model choices take priority.
- Batch accepts one independent request per line, up to 100. Worker capacity controls execution; intake speed does not promise equal model concurrency.
- Click any branch wire or node to explore its department, project or agent. The branch directory exposes every matching agent, including agents beyond map display limits. Agent details link to parent and child agents; Enter/Space activates map controls and Escape closes details. Search and filters also apply to the list view.
- Open task details to read events, inspect results, continue work, resolve approvals or stop a dashboard turn.
- Pause dispatch prevents queued work from starting while already-running work continues.

The graph connects departments, project folders, tasks and explicit subagents. Confirmed running desktop and dashboard tasks pulse along their branches. A brief amber flash means newly recorded subagent activity; it does not establish a running status. Unknown activity is counted separately. Completions carry the department, project and exact task/turn, persist across restarts, and remain unread until acknowledged.

## State and recovery

Application data lives in the current user's platform application-data folder (see Quickstart). `REWSTER_DATA_DIR` overrides the location; `CODEX_HOME` selects the Codex profile. Application releases exclude state, credentials, local projects and workspace files. To use an earlier checkout's `.local` state, set `REWSTER_DATA_DIR` to that directory explicitly before starting; never distribute it.

New Git work uses a detached worktree from committed HEAD. Uncommitted edits are not copied. Requests sharing a source directory are serialized. Tasks without a project receive a local workspace. Following interruption or restart, inspect and reconcile unfinished work before retrying a request that could have made changes.

## Current scope

This is a local beta with editable native app targets; it does not have complete Codex feature parity. Distribution outside a development Mac requires appropriate signing and notarization. The desktop adapter observes the installed local Codex IPC stream (version 11) and fails closed on disconnects or unsupported protocol versions. This is a private, version-sensitive adapter, not a stable public OpenAI API. Keep Codex desktop open for live desktop observation. Some subagents do not expose a live owner stream: their recorded events and parent relationships are shown, but their running status remains unknown. Recent child discovery is bounded to seven days and 400 recent session files; older omitted children may require opening them in Codex. Loaded idle desktop tasks can continue through their actual desktop owner. New tasks and unowned history use the separate Codex app-server; desktop tools are not automatically shared with those new tasks. Native continuations inherit existing desktop settings unless a model is explicitly selected; model overrides in this private protocol still require validation. Desktop-owned approvals are handled in Codex desktop. Remote hosts and cloud ChatGPT tasks are not imported. Structured forms unsupported by this client must be completed in a supported Codex client. Windows launch scripts have not been validated on Windows.

## Development and packaging

```sh
pnpm install --frozen-lockfile
npm test
npm run sdk:smoke
npm run package
```

`npm test` runs offline regression, UI and integration checks. The SDK smoke test runs a real model and consumes account usage. Packaging creates an allowlisted archive in `dist/`; it excludes `.local`, `node_modules`, private project lists, source research, tests and generated history. The included release manifest records SHA-256 hashes for every shipped file. The small source archive downloads dependencies on first install. `npm run package:mac -- arm64` (or `x64`) produces a self-contained Mac archive from checksum-verified official Node.js and clean pinned npm dependencies, with licenses and a full file manifest. Mac packages need no package downloads on first launch; model calls still require internet access.

Official references: [Codex SDK](https://learn.chatgpt.com/docs/codex-sdk), [Codex authentication](https://learn.chatgpt.com/docs/auth).

### Upgrading to 0.4.0

Open Ai Task Manager. If an older engine has unfinished requests, the update waits and offers Open current workspace. Finish or stop those requests there; keep the new app open for automatic switchover. Existing history and account access remain in place. This release adds a personal workspace name, work-based departments, custom routing keywords, focused agent work cards, zoom and pinch navigation, and exact-request observatories.

### Visual conversations (0.5.0)

Select an agent on the map or in Codex history to open its full conversation. Messages and image cards share the timeline; Photos collects the references and results from that conversation. Select a card for a large preview, Download, or Use in reply. Details still opens the optional inspector, and Show on map returns to the agent's branch.

Use **＋ Photos**, drop images onto the conversation/composer, or paste an image into the message field. PNG, JPEG, WebP and GIF are supported: up to eight images, 12 MB each, 40 MB combined. Send images with a single message, including a photo-only message. Batch intake remains for separate text requests. Export layered design formats such as PSD or HEIC to a supported image first.

Each conversation has its own saved text, attachment IDs and retry receipt. Photos are stored privately in the local application data directory, survive restart, and are passed to Codex as local image inputs with the original message. They are included when replying to an existing desktop-owned task. Codex remains responsible for interpreting images and producing results with the tools available to that task.

The timeline loads Codex's paginated stored items and displays user-visible messages, image generations, image views and supported tool image results. Local Markdown image results inside the task workspace receive photo cards. External images remain explicit source links. Missing files have an unavailable preview; the app does not pretend to capture a live Photoshop canvas. Image storage is currently limited to 2 GB per installation.

Protocol reference: [Codex app-server documentation](https://learn.chatgpt.com/docs/app-server). Browser and HTTP tests use an isolated deterministic Codex protocol fixture; those tests verify image routing and rendering, not the quality of model-generated designs.

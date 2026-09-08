# Start Rewster Command

This is a local Codex workspace with a shared inbox, department map, durable task queue and reviewable agent actions. It uses your own Codex account and folders. It is a beta, not a complete replacement for every Codex desktop feature.

1. In **Apple menu → About This Mac**, check whether the Mac lists an Apple M-series chip or an Intel processor.
2. Extract **Ai-Task-Manager-0.10.0-macOS-arm64.zip** for Apple Silicon, or **Ai-Task-Manager-0.10.0-macOS-x64.zip** for Intel. Keep the entire extracted folder together. The Mac packages include Node.js, the Codex CLI and SDK; no Node or npm installation is needed.
3. Double-click **Start Rewster Command.command**. It starts the local app and opens the dashboard. macOS may ask permission to open the downloaded unsigned launcher. This is a local app folder, not a signed native installer.
4. Use the dashboard's account sign-in to connect your ChatGPT account. New installations use a separate empty Codex profile; they do not automatically import another local Codex login or its history. Existing Task Manager installations retain their prior local profile. Complete authentication only on the official login page. Never paste a password or token into a task.
5. Add a local project folder or send a simple request without one. Ask `What is 17 times 23?` first, then open the resulting task and send a follow-up.

Model execution and account sign-in need internet access. Usage and model access depend on your account. Git is needed for Git project worktrees. Giving another person your `127.0.0.1` link does not give them the app.

## Terminal alternative

For the small source-only ZIP or Windows package, install **Node.js 22.12 or newer** from [nodejs.org](https://nodejs.org/), then from the extracted folder:

```sh
npm install --omit=dev
npm run launch
```

To run in the foreground, use `npm start`. To stop a launcher-started app, use `npm run stop` or the Stop launcher. Closing the browser does not stop the server. Computer sleep can interrupt active work.

## Working normally

Send a message in the inbox. Auto routing chooses an available model and a project when it has enough context. Select a project/model yourself when you want control. Batch intake accepts one independent request per line; execution uses a bounded queue, so fifty queued requests does not mean fifty models execute at once. Open the task details to inspect results, continue the conversation or respond to approval requests.

When an agent is already working, open its conversation and choose **Steer now** in the delivery selector. Choose **Queue this** to save a follow-up for the next turn. That message is delivered into the exact active turn immediately instead of waiting in the follow-up queue. A normal follow-up starts when the conversation is idle. The Workspace menu and Account & settings also link to the official Codex cloud and ChatGPT sites; those remote conversations remain separate from local task history.

Projects are directories on your own computer. A new Git task works in an isolated checkout of committed HEAD; uncommitted changes are not copied. Use the reported task workspace for the resulting files. Desktop tasks appear as recorded history, while dashboard-started tasks have live execution controls. Do not run the same task concurrently in both clients.

## Your data

The release contains application files only. It includes no sender credentials, task history or project list. New local app data is stored under:

- macOS: `~/Library/Application Support/Rewster Command`
- Windows: `%LOCALAPPDATA%\Rewster Command`
- Linux: `$XDG_DATA_HOME/rewster-command` or `~/.local/share/rewster-command`

For new installations, Task Manager keeps its Codex login and history in `accounts/codex` inside its own local app-data folder. Existing installations retain their previous Codex profile, normally `~/.codex`. `REWSTER_DATA_DIR` can override app data and `REWSTER_CODEX_HOME` can explicitly select another local Codex profile. New installs ignore a generic inherited `CODEX_HOME`. Never send these folders when sharing the app. When using a legacy or explicitly shared profile, signing out affects other clients using that profile.

## If it does not start

In the self-contained Mac package, run `./runtime/bin/node scripts/doctor.mjs` in the app folder. With a system Node installation, run `npm run doctor`. It checks the runtime and Codex CLI without running a model. Server logs are `server.log` in the app data folder. If port 4780 is occupied, set `PORT` before starting. Set `CODEX_BIN` only when you intentionally need a different Codex executable. A system policy or managed account may require an administrator's help.

Apple Silicon installation and launch have been tested on macOS. The Intel package is built from upstream Intel binaries; native Intel hardware has not been tested. Windows launch scripts and path handling are supplied in the source package but were not exercised on a Windows computer.

## Send references and review designs

Click an agent to open its full chat. Use **＋ Photos**, drag a photo in, or paste it into your message. Click any image card to enlarge it; **Use in reply** attaches that image to your next message. The **Photos** gallery keeps the conversation's visual references together. On a narrow screen, tap Photos to expand it.

Supported images: PNG, JPEG, WebP or GIF, up to 12 MB each and eight per message. Export Photoshop or other layered design files as an image for a preview. Your photos, chats and drafts stay with your own local installation and Codex account.


## Approval modes and readable workspace controls

Use the **Approvals** button at the top, or Account & settings → Change approval mode. **Ask when needed** keeps workspace execution and asks you for additional access. **Auto · Risk reviewed** uses Codex's automatic reviewer for eligible requests; it can allow routine low-risk actions and other policy-permitted actions, and deny risky requests. Reviews add to Codex usage. **Full auto** allows execution with full file and network access without execution approval prompts. Choose the mode and press Save. Questions, sign-ins, service forms, and organization restrictions still apply.

The choice is saved on each new request, including follow-ups to existing tasks. Queued and running requests keep the mode they were submitted with. Old tasks and approvals already waiting are unchanged. Task details show the request's mode; desktop work launched outside this dashboard remains managed in Codex. No global Codex configuration is rewritten.

The ☰ button collapses or expands navigation. **Hide map details** gives the universe more space; **Hide photos** gives the conversation more space. The − button minimizes task details and a header button reopens them. Layout choices stay on your device. Smaller text is enlarged, with a consistent dark ink, slate, and cyan palette.

Approval behavior follows the [official Codex approval and security documentation](https://learn.chatgpt.com/docs/agent-approvals-security).

## Separate universes

Choose **All Codex** at the top to see your entire account, or choose **New universe** to start a focused workplace such as Vending Business or Design Studio. Give it a name and a short description. Automatic discovery is on by default: Codex looks for related previous work and keeps watching new task activity. To start completely blank, turn off automatic discovery and leave existing work unchecked.

Requests sent inside a universe stay there. Its departments grow from that work, and actual child agents follow their parent task. Each universe has its own manager records and master-chat draft. Manager reviews use the existing organization automation setting and your Codex account; standby records are not running agents.

Use **Edit universe → Include existing work** to include individual tasks or projects. Including a project includes its existing and future tasks. This is organization within your account, not a separate account or file-access sandbox. Switching back to **All Codex** always shows the combined work.

Automatic matches include a reason and a supporting conversation excerpt under **Edit universe → Automatically included**. Uncheck a match to exclude it; exclusions stay saved and inform future matching. Matching uses the universe description, owner-selected examples, new requests in that universe, task titles and available conversation excerpts. It runs in the background using your Codex account, caches unchanged tasks, and leaves uncertain matches out. It organizes existing tasks without moving their files or restarting their work.

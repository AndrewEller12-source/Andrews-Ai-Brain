# Ai Task Manager — Mac and iPhone

The Mac app contains the dashboard and its Node/Codex runtime. The iPhone app connects to that Mac, showing the same tasks, inbox, branches and approvals. Your Mac must be awake and connected; leave Codex desktop open to observe its active tasks. The phone does not execute Codex locally.

## Editable source

The dashboard remains ordinary editable JavaScript, HTML and CSS at the repository root. Native Swift source and the Xcode project live in `apple/`. Building an app does not lock, convert or remove that source. Local history, Codex credentials, pairing keys, personal project lists and generated runtime binaries are excluded from Git.

With Node.js 22.12 or newer installed:

```sh
npm install
node scripts/stage-apple-runtime.mjs
```

The staging command creates `apple/Runtime` from current source and a checksum-verified Mac runtime archive. If there is no archive, it builds one using official Node.js and pinned Codex dependencies. Use `--fresh` to rebuild those dependencies; use `--x64` for an Intel Mac. Open the Xcode project under `apple/`, select the Mac or iPhone scheme and build. After changing dashboard files, rerun the staging command and rebuild the Mac target. The iPhone receives dashboard updates from its paired Mac automatically.

The Mac app reuses a current dashboard on port 4780. When upgrading an older version, it waits for unfinished requests and approvals to finish, then restarts the locally owned engine with the new source. Keep the update window open for automatic switchover. Its Open current workspace button lets you finish those requests. Local history and preferences are preserved. Closing the Mac window does not cancel dashboard work.

For command-line Mac builds, use a build directory outside synced Documents/Desktop folders (for example `-derivedDataPath /tmp/ai-task-manager-native-build`). Finder metadata added by file syncing can otherwise prevent code signing.

## Pair an iPhone

1. Run the Mac app, sign into your Codex account there, and enable phone access in its phone connection controls. Initial Codex sign-in must finish on the Mac because its login callback is local to that computer.
2. Keep the Mac and iPhone on the same trusted Wi-Fi network.
3. Copy the pairing information from the Mac and paste it into the iPhone app. This information grants access to this Mac's dashboard; transfer it only to your own phone and do not commit or send it in a task.
4. Connect. The phone checks the Mac's certificate fingerprint, then uses its saved pairing credential. The pairing credential is stored in iOS Keychain.

Phone access uses HTTPS on port 4781, with a pinned certificate and a random 256-bit pairing credential required for every request. The ordinary dashboard stays loopback-only on port 4780. Disable phone access to close the network listener. Revoke pairing to invalidate an old pairing credential. If the Mac's network address changes, update the phone using fresh pairing information.

The initial connection supports local Wi-Fi. Access away from home requires a separately configured private network or tunnel; this app does not create a public internet endpoint. Do not forward the port on a router.

## Install on a physical iPhone

Open the iPhone target in Xcode, sign into your Apple account under Settings → Accounts, choose your development team under Signing & Capabilities, and select a connected, unlocked iPhone. Enable Developer Mode on the phone if Xcode requests it, then Run. Simulator builds do not prove physical-device installation or local-network permission behavior. TestFlight/App Store distribution requires your own Apple Developer signing and distribution setup.

## Data and removal

Existing application data remains under `~/Library/Application Support/Rewster Command`; Codex manages its own account separately. The Mac's phone credentials are in the private `phone-access` subdirectory. Deleting the native app does not delete tasks, account history or editable source. Disconnecting a phone removes its saved pairing from that phone; revoke it on the Mac to invalidate other copies.

### Photo conversations in 0.5.0

The Mac shell now supports the native image file picker and a Save dialog for conversation image downloads. The iPhone shell uses WebKit's photo/file picker and opens downloaded images in the share sheet. The paired HTTPS bridge accepts image uploads up to the same 12 MB limit while retaining the 2 MB limit for ordinary API requests and its existing pairing and origin checks. Both shells share the editable web conversation implementation.

# Visual conversation validation — 0.5.0

Verified September 6, 2026.

- All 137 existing and photo-focused tests passed. After adding stalled-stream recovery, the affected UI and HTTP suites passed all 52 tests (one additional regression test).
- Live Codex vision check: a synthetic reference image was uploaded through the app's real HTTP intake, dispatched to GPT-5.6-Sol with a local-image input, and completed with: “The largest shape is a mint-green circle.” Reading the stored Codex conversation returned the original user message with one available image card and the assistant's answer. This tested image input, not image-generation quality.
- Browser check at 390×844 and 1440×960: agent-to-full-chat navigation, image loading, large preview, native browser file selection, reuse in reply, photo/message intake, preserved conversation target and completed response. No horizontal overflow at desktop width and no browser warnings/errors in the tested fixture. The deterministic design fixture was separate from the user's actual tasks.
- Mac and iPhone simulator Xcode builds passed. Mac signature passed deep/strict verification. Mac file input opened the native image picker. A stalled native EventSource exposed during installation led to a bounded HTTP snapshot fallback; a failed fallback revokes the connected state and disables sending.
- The installed Mac app and runtime were upgraded without stopping active dashboard jobs. All 25 saved job IDs and the prior dispatch setting were preserved. Independent Codex desktop work continued during the engine restart.

Limitations: physical iPhone photo selection and sharing have not been exercised on a device. Preview cards show supported image inputs and actual Codex image results; the app does not capture an external design application's canvas automatically. Remote image URLs require an explicit source-link click. Image generation requires the appropriate tools in the Codex task.

# Rewster management integration — 0.8.2

This is the first two-way integration, not a complete autonomous business manager.

## Release status — September 6, 2026

Rewster Local 0.10.0 was installed, signature-verified and relaunched. Its local health check retained Accessibility and Screen Recording access. Verification passed 125 Node tests and 24 Swift checks with 280 assertions.

The task-manager integration passed 184 tests before concurrent Universe changes appeared. An isolated real-account smoke test sent a management message through the HTTP interface to an existing worker and verified a distinct completed turn on that same thread, using manual approvals. This does not validate live autonomous defect detection, spoken announcements or telephone approval.

A task-manager native 0.8.2 build was staged but NOT installed: the running application refused to quit with unfinished work, and the separate dashboard task began editing overlapping source files. Preserve both sets of changes, rerun the combined tests, restage the runtime and rebuild before installation. Do not distribute the earlier staged binary as the final combined release. The local owner setup preference requests reviews and bounded corrections on first updated startup; Settings can turn either off.

## Implemented

- Rewster reads structured task/turn identities, actual live/unknown activity, exact available approval payloads, worker results and review findings directly through a local authenticated interface.
- Rewster can send an idempotent follow-up to an exact existing task. The returned job receipt distinguishes queued work from a dispatched turn.
- Opt-in supervision reviews new completed dashboard requests with a read-only Codex worker. It compares the owner's original request, deliverables and worker report against an explicit quality standard. Unavailable evidence must be escalated rather than accepted.
- Evidence-backed corrections return to the original worker, with at most two rounds per original request. Newer work suppresses stale corrections. Maximum two concurrent reviews, 20 reviews and 10 corrections per rolling day; all execution shares the existing worker limit and Codex account.
- Management follow-ups use manual approvals even if the workspace uses full-auto. Agent tools cannot call the owner's approval endpoint. A review pass is not owner acceptance or physical verification.
- Rewster checks for changes every ten seconds while its app is running. Spoken updates are deduplicated and wait for a conversational gap, at most once per minute. Existing history is silent at startup. No new general-purpose task queue is used for announcements.
- Settings → Your growing organization contains separate review/correction switches. Turning supervision off stops scheduling new reviews/corrections, but does not cancel already accepted work; cancel those jobs individually if needed.

## Local setup

The server creates a mode-0600 `rewster-integration.token` in its application data directory. Rewster reads it directly on the same Mac; never paste it into chat. The service binds to loopback port 4780. Rewster's initial connector supports that default Mac installation only.

An owner-created `rewster-supervision.json` in the same data directory can initialize the settings once with `{ "enabled": true, "autoCorrect": true }`. This file and the token are never distributed. Subsequent UI settings take precedence. No historical bulk review runs on activation.

## Limits and next acceptance tests

Automatic review covers dashboard-managed requests with a completed turn and result. Native-only history remains visible but is not automatically acted upon. Some desktop-owned approvals expose only a waiting state; their exact form still belongs to Codex desktop. Large output sets and model-based review can miss defects. There is no guarantee that a passed assessment matches the owner's judgment.

Test a small task, deliberately leave one explicit requirement unmet, confirm the read-only review cites the actual defect, confirm the correction stays on the original thread, and verify no third correction round is sent. Check that ordinary voice conversation continues while a worker runs. Automated tests alone do not establish these live model/voice outcomes.

## Phone work remains unimplemented

Tailscale connects devices; it does not supply a cellular number, outbound calls/SMS, or arbitrary iPhone controls. The existing paired phone dashboard is separate from conversational telephone approval.

The next implementation needs an owner-selected phone provider/account (such as Twilio), verified destination and caller numbers, secure credentials, and a reachable authenticated webhook/media service. OpenAI Realtime can supply conversational audio; Twilio can originate the phone call. Do not expose the local dashboard directly to the public internet.

Before accepting "approve both," bind the authenticated call session to two exact pending approval IDs and immutable payload fingerprints. Read each action, cost, duration, artifact revision and expiry. Missing print estimates or changed job content require a new decision. Persist each decision and execution receipt separately; one successful action does not imply both succeeded. Voicemail, low-confidence transcription, expired requests and ambiguous replies must not approve anything. Completion texts need actual executor completion evidence, not just a model's promise. Physical printer readiness still requires its independent adapter checks.

Sources: [OpenAI Realtime SIP](https://developers.openai.com/api/docs/guides/realtime-sip), [Twilio Calls](https://www.twilio.com/docs/voice/api/call-resource).

# Ai Task Manager 0.4.0 validation

- 123 automated tests passed, including real HTTP fixture dispatch, 50-message bursts, exact-turn tracking, approvals, parent/subagent activity, portable state, personal naming, adaptive departments and safe upgrades.
- After the final drawer behavior correction, all 32 UI tests passed again, including keeping the drawer closed during focused-agent streaming updates.
- Browser verification used an isolated fake-Codex server on port 4782: renamed workspace, created Photo Editing with keywords, sent a held fixture request through Master chat, expanded branches, zoomed into an agent, and read its exact request and elapsed work. No production model request was sent for this visual check.
- Desktop and 390×844 phone-width visual checks passed after fixing the narrow navigation name, sticky composer overlap and agent zoom sizing.
- Native Mac Release build passed with local ad-hoc signing; deep strict signature verification passed before and after installation.
- iPhone simulator build passed. Physical phone installation, Apple distribution signing and notarization are not claimed.
- Installed app correctly detected two unfinished requests in the existing 0.2.0 engine and displayed its safe upgrade waiting screen. No active request or approval was interrupted. It switches automatically while its window remains open once those requests finish or are stopped through the existing workspace.
- The 0.4.0 download contains application code and runtime only; local account, projects, work history, preferences and pairing credentials are excluded. Existing Trey downloads do not auto-update from this source checkout.

# Ai Task Manager 0.6.0 validation

- 144 automated tests passed across queue dispatch, persistence, approval forms, owner-scoped desktop continuation, photos, UI, portability, and phone bridge lifecycle. The final mobile close-control adjustment passed all 41 UI tests again.
- New tests cover invalid-mode rejection before mutation, captured modes surviving queue changes and restart, new and resumed turn profiles, classification staying read-only, and full auto never answering an earlier pending manual approval.
- The installed Codex 0.153.4 engine accepted all three profiles in ephemeral thread/start probes and returned the expected approvalPolicy, approvalsReviewer, and sandbox. These probes did not execute commands or invoke the reviewer. The native desktop follower policy payload is covered by protocol tests; an actual privileged desktop continuation was not performed.
- Browser checks: explicit mode save, full conversation/photo sidebar width recovery, navigation collapse, mobile menu close, approval dialog at 390px, and no horizontal page overflow. Desktop checked at 1280px. No mock data was inserted into the real account.
- Mac release and iPhone Simulator builds succeeded. Installed Mac UI exposes the three modes as accessible radio controls. Physical iPhone installation remains untested.
- Installed 0.6.0 after confirming the owned dashboard queue was idle. All 25 saved job IDs and the prior pause setting were preserved. Existing Codex desktop tasks continued independently. The account remains connected and approval mode defaults to Ask when needed.

The Auto risk review option uses the native Codex reviewer, whose policy may permit low-risk, medium-risk and sufficiently authorized actions. It is not advertised as an infallible low-risk-only classifier. Full auto disables execution approval prompts and the workspace sandbox; questions, authentication, service forms and managed restrictions still apply. New requests capture their mode at intake; queued and active work is unchanged by later setting changes.

Reference: https://learn.chatgpt.com/docs/agent-approvals-security

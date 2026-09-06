# Rewster Command: research and recommendation

Research date: September 5, 2026. Andrew asked for both a universal intake and a department view of existing Codex work, with automatic project/task/model routing and burst intake.


## September 5 redesign: user-supplied neural command center

Andrew supplied a screenshot with an electric blue, branching neural display, plus [Instagram reference one](https://www.instagram.com/reels/DY_YCRYgEwi/) and [Instagram reference two](https://www.instagram.com/reels/DW9Wj_5DRpA/). The screenshot was directly inspected. Browser access to Instagram failed because an admin-enforced policy check was unavailable; neither reel was watched, and no video-derived claims are made. The screenshot therefore supplied the visual direction.

The earlier light department-card recommendation below is superseded by this explicit direction. The new overview has a navy canvas, colored curved department/project/task branches, a central command hub, branch status and a recent activity console. Department and project focus, task inspection, pan/zoom, search, active/review filters and an evidence-based workflow trail make the spatial design operational. The inbox, history, model routing, approvals and persistent queue remain connected.

Graph branches indicate ownership and folder membership, not invented inter-agent messages. Recorded parent/child links are dashed. Animation only appears on confirmed dashboard-running tasks. History-only tasks remain labeled as recorded.

## Original recommendation

Build a thin local operating console on Codex app-server. Own the routing policy, durable request receipts and exception handling. Reuse Codex for execution, history, authentication, models and approval events. An attractive office view is useful for orientation; it should never be the evidence that an agent is working.

The business payoff is fewer dropped requests, less context switching and faster review. The bottleneck becomes Andrew's review capacity and conflicting work, not the number of agent icons. Fifty simultaneous edits to a single repository would amplify collisions. Accept requests immediately, isolate or serialize execution, and measure completed useful outcomes.

## References actually found

| Reference | Evidence inspected | Useful design idea | Limitation |
| --- | --- | --- | --- |
| [Dan Wahlin: Introducing Agent Mission Control](https://www.youtube.com/watch?v=Su4U9LwkPHw) | YouTube page metadata plus [creator's product page](https://danwahlin.github.io/agent-mission-control/) | Activity signals for tool calls, subagents, approvals and session history | Built around Copilot; its integration is not evidence of Codex desktop compatibility. Video playback was not inspected. |
| [Komputer Mechanic: Advanced OpenClaw Mission Control](https://www.youtube.com/watch?v=oCj3_YVxDaI) | YouTube chapters plus [creator's walkthrough and screenshot captions](https://komputermechanic.com/tutorials/openclaw-agentos) | Separate command center, agents, Kanban, live chat and model switcher | Broad feature count adds maintenance. Borrow hierarchy rather than copying the implementation or templates. |
| [Alex Finn: OpenClaw Mission Control](https://www.youtube.com/watch?v=RhLpV6QDBFE) | Indexed YouTube page | A unified place to interact with agent work | Discovery reference; no performance claims verified. |
| [Instagram: Manage all your AI agents from one screen](https://www.instagram.com/reel/DVBMjkYgig-/) | Search-indexed description mentions mission center and Kanban | Work visibility and task status over scattered tools | Direct scrape unsupported; clip was not watched. |
| [Instagram: Running AI agents without a dashboard](https://www.instagram.com/reel/DVYnWyrAjwz/) | Search-indexed description | One place for exceptions and active work | Promotional language is not proof of reliable orchestration. |
| [TikTok: Mason AI, Exploring OpenClaw Mission Control](https://www.tiktok.com/@mason_ai/video/7611213149143829773) | Search-indexed title and comments | A visual agent overview is intuitive; comments about difficulty accessing the dashboard reinforce the need for a simple launcher | Direct access restricted; visual frames and claims not verified. |
| [TikTok: Seven-agent Mission Control](https://www.tiktok.com/@viral7275/video/7629742263521873183) | Search-indexed description | Departments can explain responsibilities | No evidence inspected that seven agents improve outcome quality. |
| [TikTok: Connect all agents into one dashboard](https://www.tiktok.com/@jgoldieseo/video/7646434592882232590) | Search-indexed description | Single intake and common history | Shared memory must remain project-scoped; it should not indiscriminately mix private context. |

Social discovery used Firecrawl CLI. Raw results are saved under research/. These are references for interaction patterns, not a claim to have watched every video or established an objectively best design. Search results alone do not validate product behavior.

## Why this layout

- Persistent composer: ask casually or send a work request without choosing a department first.
- Department floor: Engineering, Operations, Purchasing, Growth, Finance and Executive. These are ownership labels, not fictitious people or permanently running agents.
- Task register: a searchable list is the scalable view once there are dozens of requests.
- Inspector: show actual response, activity, model, destination, routing rationale and pending approvals.
- Exception inbox: surface requests requiring a decision or outcome verification.
- Explicit provenance: separate live dashboard-launched events from another client's recorded task history.

## Supported foundation and verified local boundary

[OpenAI's Codex app-server documentation](https://learn.chatgpt.com/docs/app-server) describes the custom-client interface for history, authentication, approval requests and streamed events. The local Codex 0.153.1 CLI generated the protocol bindings in generated/, and a read-only handshake verified model/list and thread/list. Seven models were returned. The dashboard discovers its model catalog live rather than treating this snapshot as permanent.

The dashboard starts its own stdio app-server. It does not attach to the desktop's private transport. Local history is shared, but desktop runtime state and desktop-specific tools are not automatically shared. New dashboard tasks persist in the Codex local history. Full desktop sidebar parity, remote hosts, cloud ChatGPT conversations, voice and all desktop connectors remain outside this version.

Model routing uses the available catalog with a starting policy: Luna for simple work, Sol for everyday work and Astra for hard reasoning. This is a configurable heuristic plus semantic request classification, not a benchmark that proves the selected model is optimal. Manual model choice wins.

## Throughput and reliability

Acceptance and execution are separate. Every accepted request receives a persistent idempotency receipt before routing. Two routing workers and a configurable execution limit prevent unbounded fan-out. One additional execution slot is available to conversation. Git tasks start in detached worktrees from committed HEAD; non-Git folders and continued tasks are serialized by source folder. The initial implementation serializes even worktrees sharing the same source folder, a conservative throughput tradeoff.

On restart, in-flight work becomes outcome-unconfirmed instead of silently replaying. This avoids duplicate changes. Existing task continuation requires recorded completion and should not compete with a still-open turn in the desktop app. Approval requests supported by the client appear with their exact supplied payload; unsupported interactions fail visibly rather than being auto-approved.

## Next acceptance gates before calling this a complete Codex replacement

1. Shared runtime subscription or a supported desktop bridge, including active remote tasks and user-input ownership.
2. Real mixed-workload evaluation: 50 incoming requests, measured routing accuracy, queue latency and completed useful outcomes. The implemented local burst test validates receipt persistence, not 50 successful AI executions.
3. More robust connector elicitation, credential handling, file uploads and every required desktop-only tool.
4. Reconciliation of unconfirmed requests after connection loss and interactive recovery.
5. Visual and keyboard review across desktop/mobile. Automated browser visual inspection was blocked by an unavailable admin-policy check during this build.

Do not invest first in animated employees, gamified productivity or token-to-dollar estimates without billing evidence. The durable differentiator is reliable context and handoffs across Andrew's real projects.

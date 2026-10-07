# Cloudflared persistence and reminders

Ordinary off-mode plan; live overview: [plan.md](plan.md). No advice/controller lifecycle.

| Phase | Status | Progress | Contract |
| --- | --- | --- | --- |
| Backend lifetime/reminder | Planned | Not implemented | [Phase 1](phase-01-backend-lifetime-reminder.md) |
| Shared UI reminder | Planned | Not implemented | [Phase 2](phase-02-shared-ui-reminder.md) |
| Verification/review | Planned | Pending both actors | [Phase 3](phase-03-verification-review.md) |

Output: origin/PTY-independent Quick Tunnels; one three-hour reminder with reconnect catch-up and explicit Stop. No expiry, custom domain, connector restart, or daemon-restart persistence. Branch: `feat/cloudflared-persistence-reminder`.

Unresolved questions: none blocking.

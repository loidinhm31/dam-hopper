Turn budget wrap-up was requested after 24 assistant turns (soft limit 24, grace 4). Process-mode live steering is unavailable, so the child was warned at launch to wrap up by this budget. Output may be partial.

Implemented Phase 05 host contract, nullable context/bridge, server-profile events, native adapter, composition, and focused tests.

Changed files: Phase 05 UI/native files plus `pnpm-lock.yaml`; preserved existing Phase 04/unrelated changes.

Validation: UI build passed; native tests passed (12); focused UI tests passed (16); native build passed; `git diff --check` passed; no staged files.

Open risks/questions: Full Phase 05 reconciliation/restart behavior and bridge/hook test breadth remain incomplete versus plan; Phase 04 runtime validation remains deferred.

Recommended next step: Review and extend adapter reconciliation tests before Phase 06.
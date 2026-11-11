# Independent review triage

Review: [plan-review.md](plan-review.md), complete static review. No product/runtime verification claimed.

- **F1 Accept (High):** global recovery localStorage requires origin-wide Web Locks exclusion, reread inside lock for all read/modify/write, settlement, clear and group consumption. No in-memory fallback if locking unavailable. Browser address saves must observe current suppression within same exclusion before committing; cross-document notification alone insufficient. Preserve unrelated records/unknown markers. Add two real same-origin document interleavings for marker preservation, suppression and single group consumption. Do not redesign unrelated OS persistence semantics.
- **F2 Accept (High):** keep profile-qualified metadata/auth routing; native target reference census, final-release serialization and closing-target exclusion compare endpoint + verified principal + namespace + backend session ID across same-client profile IDs, with runtime identity checked where available. No credential/authority transfer. Test same-endpoint/same-principal two profiles sharing exact selected target: first view closes without DELETE, final reference exactly one DELETE; different identity still denied.
- **F3 Accept (Medium):** use approved capture helper and exact colocated case artifact directory; assign writable ownership. Automated capture/assertions and agent image inspection are not human ACCEPTED. Required operator receipt carries actual identity/time/source-run-image hashes and ACCEPTED/REJECTED; PENDING_HUMAN_REVIEW blocks visual qualification. No fabricated review receipt.

Planner propagated all corrections into design, affected phases/tasks/allowlists/dependencies/checks and overview. One [targeted independent follow-up](plan-review-followup.md) resolved F1–F3; no second full audit. [Final scope validation](final-validation.md) retained the reviewed UX design after requested research. No implementation authorized.

Status: all three accepted corrections resolved at plan-contract level; planning gates complete. Product/runtime and human visual qualification remain future implementation gates.

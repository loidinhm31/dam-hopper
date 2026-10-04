## Reframed problem

The project has substantial automated coverage, but UI acceptance lacks consistently trustworthy visual evidence from the integrated application. Some suites under `packages/ui/e2e/` mount individual components rather than navigate the application. Passing component assertions and the existence of a PNG do not establish application-level visual correctness.

Confirmed direction: retain useful unit and browser-component coverage; introduce a distinct application E2E layer; require fresh local application screenshots and human review for UI changes; keep CI image generation bypassed while executing functional assertions.

## Recommendation

Separate three test responsibilities:

| Layer | Location | Responsibility | Evidence |
|---|---|---|---|
| Unit/logic | `packages/ui/src/**/*.test.ts(x)` | Validation, state transitions, ownership, cancellation, errors | Behavioral assertions; no mandatory images |
| Browser component | `packages/ui/browser-tests/` | Real-browser focus, input, geometry, rendering and browser APIs | Component screenshots when useful; explicitly labeled, not application E2E proof |
| Application E2E | `packages/ui/e2e/<case-name>/` | Real routes, navigation, integrated workflows, layout and persistence | Fresh full-application screenshots at meaningful checkpoints, plus functional assertions |

Use Vitest Browser Mode for component tests and Playwright Test for application E2E. Both use real browsers; the difference is scope and setup, not whether Playwright is involved. Exclude application E2E from the Vitest browser include pattern. Use standard `<case-name>.spec.ts` files for Playwright and update the documented filename convention accordingly.

Each application case folder contains its test and `screenshot.png`. Allow additional named checkpoint images for states or viewport sizes that cannot be proven by one image. Shared E2E setup belongs under `packages/ui/e2e/fixtures/`. Start the real frontend and an isolated backend with deterministic test data; do not use personal workspace data. Interact through application controls rather than constructing a synthetic application shell.

Amend `docs/testing.md` and its `AGENTS.md` reference with these rules:

- Every user-visible UI change requires locally generated evidence from the affected application flow and review of that evidence before acceptance.
- Capture the complete application viewport, including navigation and surrounding panels. A large component screenshot is still component evidence.
- Capture affected states and relevant viewport or docked-panel widths. Use additional checkpoints where one screenshot is insufficient.
- Evidence must correspond to the tested source revision. Record case, revision, viewport, checkpoint and run outcome with the review evidence; refresh after relevant changes.
- Never substitute synthetic HTML, a fabricated shell, an unrelated image or stale evidence. Keep images beside cases, never under `plans/`.
- Screenshots complement assertions. Assert outcomes such as persisted changes, blocked input, focus behavior and absence of overflow where relevant.
- Reviewers inspect images; image existence alone is not acceptance. Do not approve visual baselines merely to make a comparison pass.
- Use repository-relative capture paths and one capture policy. Explicit capture-enabled runs must fail on capture errors. Skipped capture must not be reported as fresh evidence.
- CI runs functional checks without generating images by default. Local capture and human review are the mandatory evidence gate; no separate required CI image job.

## Alternatives/tradeoffs

- Convert every browser test to application E2E: broader integration coverage, but slower setup, harder isolation and unnecessary duplication for low-level browser behavior. Not recommended.
- Add screenshots to existing component harnesses only: useful component evidence, but still misses application navigation, surrounding layout and real integration. Insufficient as the sole UI acceptance layer.
- Keep two browser scopes with mandatory local application evidence: preserves targeted regression tests and adds reviewable integration proof. Recommended and confirmed.
- Required CI evidence generation: stronger automation of freshness and artifact availability, but conflicts with the selected local-capture policy.
- Automated visual comparisons: useful for selected stable surfaces; avoid blanket pixel baselines for dynamic terminal output, timestamps and platform-dependent rendering. Raw captures support review but are not automated visual regression checks.

## Risks

- Local-only evidence relies on contributor and reviewer discipline; CI success cannot certify freshness or that a human inspected screenshots.
- Screenshots can look correct while persistence, keyboard behavior or ownership is broken. Behavioral assertions remain mandatory.
- Uncontrolled data, fonts, animations and viewport sizing make visual evidence inconsistent. Stabilize fixtures without hiding the behavior being verified.
- Fixtures that bypass application routing, authorization or persistence can recreate the current false-E2E problem.
- Committed images accumulate repository size. Keep meaningful checkpoints, avoid redundant captures and never include sensitive content.
- Wholesale relocation may delete unique browser regression coverage. Classify tests before removing or migrating them.

## Assumptions/evidence gaps

- Reviewed configuration currently includes both `browser-tests` and `e2e` in Vitest Browser Mode.
- The evaluations E2E file mounts `EvaluationsView` with fixture state and uses a hard-coded capture path rather than the shared capture helper. It is component coverage, not an application journey.
- Existing documentation requires full-application evidence but does not adequately distinguish execution scopes or define freshness and review acceptance.
- The repository has an advisor loopback backend fixture; suitability for the complete application journey still needs verification.
- This advice did not exhaustively classify project-wide browser suites, establish application E2E coverage counts or execute tests. Existing coverage must be inventoried during implementation.

## Success checks

- Component tests and application E2E have separate runner configurations and accurately documented scopes.
- Each of the three initial application cases navigates the actual application and exercises its real controls against isolated data.
- Privacy evidence includes the application under the overlay; assertions also verify relevant input isolation.
- Advisor evidence shows the route editor within the application; the integrated journey checks saved values through independent readback where persistence is exercised.
- Evaluations evidence includes surrounding application layout at the affected narrow panel width; assertions check relevant clipping or overflow boundaries.
- Capture-enabled local runs generate valid colocated images and fail on capture errors; no hard-coded workstation paths remain.
- Capture-disabled CI runs retain the same functional scenarios and assertions without modifying visual evidence files.
- Review records identify tested revision and checkpoints and explicitly record inspection of fresh evidence.
- The suite inventory identifies covered user workflows, retained component-only checks and remaining application coverage gaps.

## Next actions

1. Update testing rules and terminology; clearly label current component evidence and manually captured application evidence.
2. Inventory browser suites by behavior and user workflow. Retain distinct browser coverage; remove only genuinely redundant checks.
3. Separate the Playwright application runner from Vitest and establish isolated application/backend lifecycle setup.
4. Correct the existing three application cases first, retaining their useful component checks in the component layer.
5. Replace misleading or stale evidence with fresh application captures and review them against the behavioral assertions.
6. Expand application journeys to the inventory's uncovered integration and layout risks rather than mechanically copying every component test.
7. Verify local capture-enabled and CI capture-disabled execution; adopt the evidence review gate for subsequent UI changes.

## Unresolved questions

None blocking the confirmed direction. Full application fixture requirements and workflow coverage gaps must be established during implementation.

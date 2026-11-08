# Completion Report: integrate-active-hub-root (P07 / W08) [Verification Scoped]

## Status: VERIFICATION_SCOPED
- **Implementation Status**: Active Hub root stage, two-row adaptive chrome, nested project picker, Back precedence, and click routing complete.
- **Verification Status**: Shared JVM and Android debug compilation verified; 87/87 focused regression tests passing. Physical device/human UI verification and independent code review remain scoped/pending integration qualification.

## Implemented Behaviors
1. **Primary Agent Hub Root & Nested Picker**:
   - Replaced linear `PROJECT_LIST` / `TERMINAL` staging with `AppFlowStage.HUB` as primary post-authentication product stage.
   - `AgentHubEmptyRoot` renders when no active project is selected, exposing adaptive two-row chrome, "+ Open Project" (>=48dp target), Alerts/Settings actions, capability bar (Terminal, Files, Editor, Git), and connected agent roster.
   - `AgentHubProjectPickerModal` opens project picker in a nested dialog without navigating away from the Hub.
2. **Back Navigation Precedence**:
   - Hierarchical precedence strictly enforced:
     1. Modal dialogs (`projectPickerOpen`)
     2. Retained Settings overlay (`settings != null`)
     3. Retained notifications feed (`notificationsOpen`)
     4. LIFO sheets / Git details / capability->terminal
     5. Hub root departure (asks departure guard before returning to `PROFILE_LOGIN`, or yields to platform exit). Never implicit logout or remote kill.
3. **Exact Click Resolution & Routing**:
   - `ProcessInstance.consumeClick` consumes notification / deep-link clicks exactly once per process instance, preventing rotation re-consumption.
   - Pre/post consent validation re-verifies owner, socket, and terminal identity before committing route.
4. **Input Suspension & Cover Reporting**:
   - Terminal content suspends input reactively via `LaunchedEffect(settingsOpen, masked, projectPickerOpen)` (clearing focus and hiding software keyboard) while modals, Settings, or privacy mask are active.

## Demonstrated Evidence
- **Shared JVM Compilation**: `compileKotlinJvm` exit 0 (SUCCESS).
- **Android Debug Compilation**: `compileDebugKotlin` exit 0 (SUCCESS).
- **Focused Regression Tests**: 87/87 passed:
  - `AppFlowNavigationTest`: 25/25 passed.
  - `AgentHubContractsTest`: 10/10 passed.
  - `AgentSettingsNavigationTest`: 8/8 passed.
  - `SimpleFlowJourneysTest`: 7/7 passed.
  - `NativeWorkspaceViewModelTest`: 9/9 passed.
  - `RetainedTerminalAgentsIntegrationTest`: 7/7 passed.
  - `RuntimeIntegrationReadinessTest`: 9/9 passed.
  - `TerminalAgentsActivationCoordinatorTest`: 12/12 passed.

## Scoped / Pending Verification Items
1. **Physical Device Qualification**: Real device TalkBack, IME, and phone/tablet layout verification deferred to P08.
2. **Independent Review**: W08 independent review to be reconciled with W09 integration review.

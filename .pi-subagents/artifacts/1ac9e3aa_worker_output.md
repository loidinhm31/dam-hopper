Implemented Phase 05 review remediation.

Changed files: native adapter/tests; shared host parser; scope bridge; hook; existing Phase 05 UI files.

Validation: focused UI tests passed (3); native tests passed (13); UI build passed; native build passed; lint passed; diff check passed; no staged files.

Residual risks: context/hook/server-config integration test coverage remains narrower than the full Phase 05 plan; manager-reopen behavior is implementation-tested through types/build but lacks a dedicated delayed-response test.

Unresolved questions: none.
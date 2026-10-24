# FileEditorMutationTest lost-response failure

## Result

Ran requested isolated `:shared:jvmTest --tests dev.damhopper.nativeapp.features.files.FileEditorMutationTest.testAmbiguousDirectoryMutationWithLostResponseStaysUnresolvedWithoutDuplicateDispatch --stacktrace`: **1 test completed, 1 failed**. Used `--info` diagnostic execution to expose exact assertion frame because generated build reports are excluded by tool ignore rules. No source/config changes.

```text
java.lang.AssertionError: Expected value to be true.
at dev.damhopper.nativeapp.features.files.FileEditorMutationTest$testAmbiguousDirectoryMutationWithLostResponseStaysUnresolvedWithoutDuplicateDispatch$1.invokeSuspend(FileEditorMutationTest.kt:514)
```

## Root cause

`native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/files/FileEditorMutationTest.kt:514`:

```kotlin
assertTrue(outcome.message.contains("disconnected", ignoreCase = true) || outcome.message.contains("quarantine", ignoreCase = true))
```

The mock throws `CancellationException("Transport disconnected post-commit")` (lines 504–506). `FileRepository.executeFsOpWithOutcome` catches cancellation separately (FileRepository.kt:347–353), returning `FileOperationOutcome.Unknown` with `message = "Cancelled while awaiting fs:op response"` and `cause = e`. The coordinator returns this unchanged (FileMutationCoordinator.kt:887).

The assertion checks the outcome message, not the original cause message. Neither expected substring occurs: false OR false. The preceding Unknown type assertion at line 513 passed. Gradle's abbreviated line 500 is the enclosing coroutine test entry, not the failing assertion.

## Suggested fix

Change the test's diagnostic expectation to match the cancellation branch, preferably assert `OperationStage.AWAITING_RESULT`, a `CancellationException` cause, and its original message. Retain existing quarantine/reconciliation/no-duplicate assertions. No production behavior change justified by this failure alone.

The assertions from line 517 onward were not reached; this run does not validate or disprove quarantine retention, unresolved reconciliation, or duplicate-dispatch prevention.

## Unresolved questions

None for the exact assertion and immediate cause. Post-failure behavioral assertions require execution after the test expectation is corrected.

import * as fs from "node:fs/promises";
import * as path from "node:path";

/**
 * Seeds deterministic plan fixtures matching Phase 05 qualification contract.
 */
export async function seedPlanFixtures(
  primaryProjectDir: string,
  secondaryProjectDir?: string,
): Promise<void> {
  const plansDir = path.join(primaryProjectDir, "plans");
  await fs.mkdir(plansDir, { recursive: true });

  // 1. Ordinary sample plan with progress opt-in: 5 pending in plan.md, 5 completed in progress.md
  const sampleDir = path.join(plansDir, "261001-sample");
  await fs.mkdir(sampleDir, { recursive: true });
  await fs.writeFile(
    path.join(sampleDir, "plan.md"),
    `---
title: "Sample Feature Plan"
description: "Sample feature plan with reported completed progress"
status: pending
priority: P2
effort: 40h
branch: feat/sample
tags: [feature, sample]
created: 2026-10-01
---

# Sample Feature Plan

## Phases — Initial Snapshot

| # | Phase | Status | Progress | Effort | Detail |
|---|---|---|---|---|---|
| 01 | Phase 1 | Pending | 0% | 8h | [Phase 1](./phase-01.md) |
| 02 | Phase 2 | Pending | 0% | 8h | [Phase 2](./phase-02.md) |
| 03 | Phase 3 | Pending | 0% | 8h | [Phase 3](./phase-03.md) |
| 04 | Phase 4 | Pending | 0% | 8h | [Phase 4](./phase-04.md) |
| 05 | Phase 5 | Pending | 0% | 8h | [Phase 5](./phase-05.md) |
`,
  );
  await fs.writeFile(
    path.join(sampleDir, "progress.md"),
    `# Current Progress — Sample Feature Plan

**Plan:** [plan.md](./plan.md)
**Published:** 2026-10-02
**Current status:** In Progress (Phases 01, 02, 03, 04, and 05 completed)

## Phase Reconciliation

| Phase | Current status | Captured status | Completion basis / scope | Evidence / receipt |
|---|---|---|---|---|
| [01 — Phase 1](./phase-01.md) | Completed | Pending (initial snapshot) | Implemented & verified | [Receipt](./reports/phase-01-receipt.md) |
| [02 — Phase 2](./phase-02.md) | Completed | Pending (initial snapshot) | Implemented & verified | [Receipt](./reports/phase-02-receipt.md) |
| [03 — Phase 3](./phase-03.md) | Completed | Pending (initial snapshot) | Implemented & verified | [Receipt](./reports/phase-03-receipt.md) |
| [04 — Phase 4](./phase-04.md) | Completed | Pending (initial snapshot) | Implemented & verified | [Receipt](./reports/phase-04-receipt.md) |
| [05 — Phase 5](./phase-05.md) | Completed | Pending (initial snapshot) | Implemented & verified | [Receipt](./reports/phase-05-receipt.md) |
`,
  );
  await fs.writeFile(
    path.join(sampleDir, "phase-01.md"),
    `# Phase 01 — Foundation\n\nDetailed specifications for phase 01.\n`,
  );
  await fs.writeFile(
    path.join(sampleDir, "evidence.md"),
    `# Evidence Document\n\nHere is architecture evidence:\n\n\`\`\`mermaid\ngraph TD\n  A[Frontend] --> B[Backend]\n  B --> C[Storage]\n\`\`\`\n\nLocal asset reference:\n![Architecture Diagram](./assets/diagram.png)\n`,
  );

  // 2. Undated plan (no progress.md, fallback to plan.md)
  const undatedDir = path.join(plansDir, "261002-undated");
  await fs.mkdir(undatedDir, { recursive: true });
  await fs.writeFile(
    path.join(undatedDir, "plan.md"),
    `---
title: "Undated Task Plan"
status: pending
---

# Undated Task Plan

## Phases

| # | Phase | Status |
|---|---|---|
| 01 | Setup | Pending |
`,
  );

  // 3. Conflicting plan (invalid progress)
  const conflictingDir = path.join(plansDir, "261003-conflicting");
  await fs.mkdir(conflictingDir, { recursive: true });
  await fs.writeFile(
    path.join(conflictingDir, "plan.md"),
    `---
title: "Conflicting Plan"
status: in_progress
---

# Conflicting Plan

## Phases

| # | Phase | Status |
|---|---|---|
| 01 | Analysis | In Progress |
`,
  );
  await fs.writeFile(
    path.join(conflictingDir, "progress.md"),
    `# Broken Content Without Phase Reconciliation\nThis unparseable text causes conflict diagnostics.\n`,
  );

  // 4. Dated plan (explicit planned and actual ranges)
  const datedDir = path.join(plansDir, "261004-dated");
  await fs.mkdir(datedDir, { recursive: true });
  await fs.writeFile(
    path.join(datedDir, "plan.md"),
    `---
title: "Explicit Dates Plan"
status: in_progress
created: 2026-10-04
---

# Explicit Dates Plan

## Phases

| # | Phase | Status | Dates |
|---|---|---|---|
| 01 | Discovery | Completed | 2026-10-05..2026-10-06 |
| 02 | Execution | In Progress | 2026-10-07..2026-10-08 |
`,
  );

  // 5. Creation only plan
  const creationOnlyDir = path.join(plansDir, "261005-creation-only");
  await fs.mkdir(creationOnlyDir, { recursive: true });
  await fs.writeFile(
    path.join(creationOnlyDir, "plan.md"),
    `---
title: "Creation Only Plan"
status: pending
created: 2026-10-05
---

# Creation Only Plan
`,
  );

  // 6. Bulk sibling folders (>200) + unreadable document
  const bulkDir = path.join(plansDir, "bulk");
  await fs.mkdir(bulkDir, { recursive: true });
  for (let i = 1; i <= 205; i++) {
    const folderName = `plan-${String(i).padStart(3, "0")}`;
    const childDir = path.join(bulkDir, folderName);
    await fs.mkdir(childDir, { recursive: true });
    await fs.writeFile(
      path.join(childDir, "plan.md"),
      `# Plan ${folderName}\n`,
    );
  }
  // Unreadable document inside bulk directory (permissions restricted inside container post-copy)
  const unreadablePath = path.join(bulkDir, "unreadable-doc.txt");
  await fs.writeFile(unreadablePath, "Cannot read\n");
  // 7. Secondary project plan with same relative path plans/261001-sample but different report
  if (secondaryProjectDir) {
    const secSampleDir = path.join(
      secondaryProjectDir,
      "plans",
      "261001-sample",
    );
    await fs.mkdir(secSampleDir, { recursive: true });
    await fs.writeFile(
      path.join(secSampleDir, "plan.md"),
      `---
title: "Sample Feature Plan"
description: "Secondary project version of sample feature plan"
status: pending
priority: P3
created: 2026-10-01
---

# Sample Feature Plan (Secondary)

## Phases — Initial Snapshot

| # | Phase | Status | Progress | Effort | Detail |
|---|---|---|---|---|---|
| 01 | Phase 1 | Pending | 0% | 8h | [Phase 1](./phase-01.md) |
`,
    );
    await fs.writeFile(
      path.join(secSampleDir, "progress.md"),
      `# Current Progress — Sample Feature Plan

**Plan:** [plan.md](./plan.md)
**Published:** 2026-10-02
**Current status:** In Progress (Only Phase 01 completed)

## Phase Reconciliation

| Phase | Current status | Captured status | Completion basis / scope | Evidence / receipt |
|---|---|---|---|---|
| [01 — Phase 1](./phase-01.md) | Completed | Pending (initial snapshot) | Implemented & verified | [Receipt](./reports/phase-01-receipt.md) |
`,
    );
  }
}

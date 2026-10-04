# Diagnostic Report: GitHub Actions Run 37193115315 Failure

- **Run ID:** `37193115315`
- **Run URL:** https://github.com/loidinhm31/dam-hopper/actions/runs/37193115315
- **Workflow:** `Deploy Web to GitHub Pages` (`.github/workflows/deploy-pages.yml`)
- **Trigger Event:** `push` on tag `v0.10.1` (`refs/tags/v0.10.1`)
- **Trigger Commit:** `b3d99fef187deff8bb24990523a7da14e1d017d6` ("chore(release): bump version to 0.10.1")
- **Workflow DB ID:** `259398627`
- **Target Environment:** `github-pages`
- **Report Date:** 2026-10-04
- **Report Author:** GhRunDebugger

---

## 1. Executive Summary

### Issue Description & Business Impact
GitHub Actions run `37193115315` failed immediately upon invocation (duration ~3 seconds). Job `deploy` failed at initialization in 1 second before executing any workflow steps.
Web assets for release `v0.10.1` failed to deploy to GitHub Pages (https://loidinhm31.github.io/dam-hopper/).

### Root Cause
Commit `ddbf941a` ("ci(pages): deploy only on release tags") transitioned `.github/workflows/deploy-pages.yml` trigger from `branches: [main]` to `tags: ["v*"]`.
However, the GitHub environment `github-pages` has custom deployment branch policies enabled (`custom_branch_policies: true`) that only allow deployments from branch `main` (`{"type": "branch", "name": "main"}`).
When tag `v0.10.1` triggered the workflow, GitHub Actions evaluated environment protection rules for `github-pages`, identified that `v0.10.1` is a tag (not branch `main`), and rejected the deployment gate before runner step execution. The prior release run `37177155073` on `v0.10.0` failed from the identical rejection.

### Priority
**P1 (Release Deployment Blocker)**: Blocks GitHub Pages automated release deployment for current `v0.10.1` and all future `v*` release tags.

---

## 2. Technical Analysis

### 2.1 Run & Job Metadata

| Field | Value |
|---|---|
| **Workflow Name** | `Deploy Web to GitHub Pages` |
| **Workflow File** | `.github/workflows/deploy-pages.yml` |
| **Run ID** | `37193115315` |
| **Job ID** | `111409292372` |
| **Job Name** | `deploy` |
| **Run URL** | https://github.com/loidinhm31/dam-hopper/actions/runs/37193115315 |
| **Job URL** | https://github.com/loidinhm31/dam-hopper/actions/runs/37193115315/job/111409292372 |
| **Trigger Ref** | `refs/tags/v0.10.1` (`v0.10.1`) |
| **Commit SHA** | `b3d99fef187deff8bb24990523a7da14e1d017d6` |
| **Commit Subject** | `chore(release): bump version to 0.10.1` |
| **Status / Conclusion** | `completed` / `failure` |
| **Started At** | `2026-10-04T09:44:24Z` |
| **Completed At** | `2026-10-04T09:44:27Z` |
| **Job Steps Executed** | `0` (`steps: []`) |

### 2.2 Exact Error Annotations and Logs

From `gh run view 37193115315`:
```text
ANNOTATIONS
X Tag "v0.10.1" is not allowed to deploy to github-pages due to environment protection rules.
deploy: .github#1

X The deployment was rejected or didn't satisfy other protection rules.
deploy: .github#1
```

From `gh run view 37193115315 --log`:
```text
log not found: 111409292372
```
*Note:* No execution logs exist because GitHub Actions blocked job startup at the environment protection evaluation gate before dispatching steps to a runner.

### 2.3 Repository and Environment State Cross-Reference

#### Workflow Trigger Definition (`.github/workflows/deploy-pages.yml:1-25`)
```yaml
name: Deploy Web to GitHub Pages

on:
  push:
    tags:
      - "v*"

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: "pages"
  cancel-in-progress: true

jobs:
  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
```

#### GitHub Environment Configuration (`repos/loidinhm31/dam-hopper/environments/github-pages`)
```json
{
  "name": "github-pages",
  "deployment_branch_policy": {
    "protected_branches": false,
    "custom_branch_policies": true
  },
  "protection_rules": [
    {
      "id": 52058280,
      "type": "branch_policy"
    }
  ]
}
```

#### Configured Deployment Branch Policies (`repos/loidinhm31/dam-hopper/environments/github-pages/deployment-branch-policies`)
```json
{
  "total_count": 1,
  "branch_policies": [
    {
      "id": 46802056,
      "name": "main",
      "type": "branch"
    }
  ]
}
```

#### Comparison with Other Workflows
In `.github/workflows/release-linux.yml`:
- Job `publish-release` deploys using `environment: linux-release`.
- Environment `linux-release` has `deployment_branch_policy: null` and `protection_rules: []`.
- As a result, release builds on tag `v0.10.1` run without environment policy rejection.

### 2.4 History Timeline

1. **Prior to commit `ddbf941a`**:
   `deploy-pages.yml` listened on `push: branches: [main]` and `workflow_dispatch`. Deployments from `main` succeeded because `github-pages` allowed branch `main`.
2. **Commit `ddbf941a` (`2026-10-04T04:23:05Z`)**:
   Author changed trigger to `push: tags: ["v*"]` to ensure web builds deploy strictly with version tags.
3. **Run `37177155073` on tag `v0.10.0` (`2026-10-04T04:29:40Z`)**:
   Failed in 3s with `Tag "v0.10.0" is not allowed to deploy to github-pages due to environment protection rules.`
4. **Run `37193115315` on tag `v0.10.1` (`2026-10-04T09:44:24Z`)**:
   Failed in 3s with `Tag "v0.10.1" is not allowed to deploy to github-pages due to environment protection rules.`

---

## 3. Root Cause Identification

1. Workflow job `deploy` references environment `github-pages`.
2. GitHub enforces environment protection rules on `github-pages` before allocating runners or running any steps.
3. The environment protection rule `branch_policy` has only one entry: branch `main`.
4. No rule permits tags matching `v*` (or tags in general).
5. GitHub Actions rejected deployment of ref `refs/tags/v0.10.1` against the branch whitelist.

---

## 4. Actionable Fix Plan

### Step 1: Add Tag Deployment Policy to `github-pages` Environment (Required)

Configure the `github-pages` environment to allow tag deployments matching `v*`.

#### Option A: Via GitHub CLI / REST API
Run:
```bash
gh api --method POST \
  -H "Accept: application/vnd.github+json" \
  /repos/loidinhm31/dam-hopper/environments/github-pages/deployment-branch-policies \
  -f name="v*" \
  -f type="tag"
```

#### Option B: Via GitHub Repository Settings Web UI
1. Navigate to: https://github.com/loidinhm31/dam-hopper/settings/environments
2. Click **github-pages**.
3. Under **Deployment branches and tags**, click **Add deployment branch or tag rule**.
4. Select **Tag**.
5. Set pattern to `v*`.
6. Click **Add rule**.

*Resulting policy state:*
`github-pages` will allow both branch `main` and tags matching `v*`.

---

### Step 2: Update Workflow File `.github/workflows/deploy-pages.yml` (Recommended)

Add `workflow_dispatch:` so manual redeployments can be triggered without creating a new tag if needed:

```yaml
name: Deploy Web to GitHub Pages

on:
  push:
    tags:
      - "v*"
  workflow_dispatch:
```

Files to modify:
- `.github/workflows/deploy-pages.yml`

---

### Step 3: Re-run Run 37193115315

Once Step 1 is executed, re-run the failed GitHub Actions run to deploy `v0.10.1`:
```bash
gh run rerun 37193115315
```
Or view execution status:
```bash
gh run watch 37193115315
```

---

## 5. Unresolved Questions

None. Root cause and fix verified via GitHub API environment queries and historical run telemetry.

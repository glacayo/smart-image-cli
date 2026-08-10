```yaml
schema: gentle-ai.remediation-result/v1
fix_batch: final-verification-remediation-crit005
verdict: remediated
blockers_addressed: 1
head_commit: e79db70
branch: fix/pixabay-success-test-stability
changed_lines: 1
review_lineage_id: review-c9501ee29b923011
failed_evidence_revision: sha256:6f67dd4130a710b5d3a0ecf450fae7638756f39ad5e41fb78338554fdfb7e7c4
mode: strict-tdd
artifact_only_syntax: true
independent_verify: pending_must_rerun_not_self_pass
```

```json
{
  "schema": "gentle-ai.remediation-evidence/v1",
  "change": "replace-unsplash-with-pixabay",
  "fix_batch": "final-verification-remediation-crit005",
  "failed_evidence_revision": "sha256:6f67dd4130a710b5d3a0ecf450fae7638756f39ad5e41fb78338554fdfb7e7c4",
  "commit": "e79db70",
  "commit_subject": "HEAD unchanged — CRIT-005 is OpenSpec delta header syntax only (uncommitted artifact fix)",
  "branch": "fix/pixabay-success-test-stability",
  "mode": "strict-tdd",
  "artifact_only_syntax": true,
  "note": "Minimum delta-header syntax correction only. Does not claim independent final verification PASS. Fresh independent sdd-verify is still required. Admitted FAIL verify-report.md preserved unchanged.",
  "review": {
    "lineage_id": "review-c9501ee29b923011",
    "gate": "inherited_from_prior_remediation_binding",
    "result": "allow",
    "note": "Code HEAD unchanged from CRIT-001-recurrence remediation; this batch fixes OpenSpec delta parse only"
  },
  "findings_remediated": [
    {
      "id": "CRIT-005",
      "root_cause": "Independent verification FAIL evidence_revision sha256:6f67dd4130a710b5d3a0ecf450fae7638756f39ad5e41fb78338554fdfb7e7c4: openspec/changes/replace-unsplash-with-pixabay/specs/image-source-pixabay/spec.md used ## Requirements instead of the recognized delta header ## ADDED Requirements. Strict OpenSpec validation exited 1 (no delta sections found), omitting 8 requirements / 16 scenarios from the change delta parse. Runtime tests were green; archive/delta validity was blocked.",
      "fix": "One-line header rename: ## Requirements → ## ADDED Requirements in image-source-pixabay/spec.md. No production or test code changes. No commit."
    }
  ],
  "prior_remediations_preserved": [
    {
      "id": "CRIT-001/002/003",
      "batch": "final-verification-remediation",
      "evidence_revision": "sha256:b1502e4776a60373db0442388cecccbd4afbeafb658c2d67c08e157a01436d11",
      "note": "Initial pick-pixabay rmWithRetry+split, pixabay.md Unsplash removal, historical size:exception — still resolved"
    },
    {
      "id": "CRIT-004",
      "batch": "final-verification-remediation-crit004",
      "commit": "b0ca039",
      "evidence_revision": "sha256:118f6613eed931c6bb5233a05422cad4171a2cb86db0e1e6d5e041e28242180c",
      "review_lineage_id": "review-1937fac6d3f7e1c2",
      "note": "EXIF optimization-flow fixture planting — still resolved"
    },
    {
      "id": "CRIT-001-recurrence",
      "batch": "final-verification-remediation-crit001-recurrence",
      "commit": "e79db70",
      "review_lineage_id": "review-c9501ee29b923011",
      "note": "Pixabay success mega-test split — still resolved; code HEAD remains e79db70"
    }
  ],
  "commands": [
    {
      "command": "npm run openspec:validate -- replace-unsplash-with-pixabay",
      "exit": 0,
      "result": "Change 'replace-unsplash-with-pixabay' is valid (strict --no-interactive via scripts/openspec-validate.mjs)"
    }
  ],
  "raw_changed_lines": {
    "code": 0,
    "openspec_delta": 1,
    "files": {
      "openspec/changes/replace-unsplash-with-pixabay/specs/image-source-pixabay/spec.md": { "add": 1, "del": 1, "note": "header rename only" }
    },
    "budget": "1 authored line under 400; no size:exception; no production/test code"
  },
  "safety": {
    "real_credentials": false,
    "network": false,
    "customer_images": false,
    "production_bytes_modified": false,
    "test_bytes_modified": false,
    "verify_report_modified": false,
    "git_touched_by_this_batch": false
  },
  "preserved_failed_verify_report": "openspec/changes/replace-unsplash-with-pixabay/verify-report.md",
  "independent_verify": "pending_must_rerun_full_suite_not_self_pass"
}
```

## Remediation Summary

CRIT-005 remediated on branch `fix/pixabay-success-test-stability` at code HEAD **`e79db70`** (unchanged). OpenSpec delta syntax only: **1** line rename in `specs/image-source-pixabay/spec.md` (`## Requirements` → `## ADDED Requirements`).

Root cause from admitted FAIL verify (`verify-report.md`, `evidence_revision sha256:6f67dd4130a710b5d3a0ecf450fae7638756f39ad5e41fb78338554fdfb7e7c4`): strict OpenSpec validation could not parse the Pixabay capability delta (8 requirements / 16 scenarios omitted).

Fix: minimum recognized delta header. No production/test edits. No commit/archive.

Remediation-side evidence:
- `npm run openspec:validate -- replace-unsplash-with-pixabay` → exit **0**, `Change 'replace-unsplash-with-pixabay' is valid`

Prior remediations preserved: CRIT-001/002/003, CRIT-004 (`b0ca039`), CRIT-001 recurrence (`e79db70` / `review-c9501ee29b923011`).

**This report does not claim independent final verification PASS.** Prior admitted FAIL verify history remains in `verify-report.md` **unchanged**. See `apply-progress.md` section **5.6**. **Fresh independent `sdd-verify` is still required.**

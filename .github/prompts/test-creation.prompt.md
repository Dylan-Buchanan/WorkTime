Create **E2E tests** for the task being completed using:

1. the **Task Implementation File**, and
2. the **Implementation Plan**.

You must:

- derive test scenarios from **MUST requirements (R#)** and **Acceptance Criteria (AC#)**,
- implement tests using the repo’s existing E2E framework and conventions,
- run the tests,
- treat failures as **product bugs by default**,
- fix product code (or test harness/config) to make the system correct,
- **do not weaken tests** to get green unless the test contradicts the requirements/plan.

Stop when:

- all E2E tests pass, OR
- you find a **critical bug** (then produce a Critical Bug Report).

---

## Non-Negotiables

- Every MUST requirement must be covered by at least one E2E assertion.
- Every AC must map to at least one E2E test (or an explicit rationale if not automatable).
- Use the e2e test documentation in the repo to follow conventions.
- Only change tests if they are provably wrong per Task Implementation File / Plan.

---

## Deliverables

1. A brief **traceability table**: `R#/AC# -> test name(s)`.
2. New/updated E2E test files in the correct location(s).
3. The exact commands you ran and the results.
4. If failures occurred: what you fixed, where, and why (tied to evidence).
5. If critical bug: output a **Critical Bug Report**.

---

## Execute Now

1. Implement the minimal set of high-signal E2E tests that cover all MUST + AC.
2. Run targeted tests using `pnpm test:e2e:web:quick -- <test-name>`, then full E2E suite using `pnpm test:e2e:web:quick` if the initial targeted tests pass.
3. Fix product code/harness until green or until a critical bug is confirmed.

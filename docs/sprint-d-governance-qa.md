# Sprint D - Governance QA and Production Readiness

Date: 2026-05-20

## Readiness Status

Production deployment readiness: READY, with non-blocking tooling warnings noted below.

## Passed Checks

- QA/QC verification: DETECTED -> VERIFIED and UNDER_REVIEW -> VERIFIED populate `verifiedByUserId`, `verifiedAt`, preserve verification notes, and create `DEFECT_VERIFIED` timeline entries.
- Assignment: VERIFIED -> ASSIGNED populates `assignedToUserId`, `assignedToTeamId`, legacy `assignedUserId`, legacy `assignedTeamId`, `assignedAt`, and creates `DEFECT_ASSIGNED`.
- Maintenance: ASSIGNED -> COMPLETED and IN_PROGRESS -> COMPLETED populate `maintainedByUserId`, `maintainedAt`, preserve maintenance notes, and create lifecycle/outcome timeline entries.
- Maintenance outcomes accepted: `RESOLVED`, `TEMPORARY_FIX`, `MONITORING_REQUIRED`, `EXTERNAL_CONSTRAINT`, `DEFERRED`.
- Invalid maintenance outcomes rejected safely: `DUPLICATE`, `FALSE_POSITIVE`, and unknown outcome strings.
- Legacy maintenance outcomes remain compatible: `REPAIRED`, `PARTIAL`, `MONITOR_ONLY`, `ESCALATED` map to production outcomes.
- Closure verification: COMPLETED -> CLOSED and VERIFICATION_PENDING -> CLOSED populate `closureVerifiedByUserId`, `closureVerifiedAt`, preserve closure notes, preserve final `resolutionOutcome`, and create `CLOSURE_VERIFIED`.
- Rejection/exception: rejected defects remain rows, remain auditable, and rejected plus outcome-based exceptions appear in Operations Board exceptions.
- Backward compatibility: `assignedUserId`, `verificationRemarks`, `completionRemarks`, `closureRemarks`, and legacy resolution outcomes were verified.
- Operations Board: MAINHEAD filters, queue assignment, exception queue, queue counts, summary count consistency, and overdue/critical flags were verified.
- Operations Board click-through: row click and keyboard activation route to `/defects/:id`; admin web build passed.
- Admin Defect Detail: Operational Ownership, Operational Evidence, Resolution Governance, and lifecycle/outcome timeline rendering compile and build.
- Mobile Defect Detail: mobile TypeScript compiles and detail screen renders lifecycle/outcome governance with legacy note fallbacks.
- Migration safety: migrations are additive/nullable with enum additions, indexes, and foreign keys; no destructive drop/rename/not-null rewrite found.

## Issues Found and Fixed

- Maintenance completion could previously advance directly from VERIFIED through assignment and maintenance states. Fixed so governed completion cannot skip assignment.
- Assignment could previously populate assignee fields before verification. Fixed so assignment requires VERIFIED or later lifecycle status when assigning an owner.
- Mobile detail displayed only new governance note names. Fixed fallbacks for legacy `verificationRemarks` and `closureRemarks`.
- Admin Operations Board normalization now accepts legacy `assignedUserId` and `assignedTeamId` in addition to new assignment fields.

## Validation Commands

- PASS: `npx.cmd prisma migrate deploy`
- PASS: `npx.cmd prisma migrate status`
- PASS: `npx.cmd prisma generate`
- PASS: `npm.cmd run build --workspace @ascure/api`
- PASS: `npm.cmd run typecheck --workspace @ascure/admin-web`
- PASS: `npm.cmd run build --workspace @ascure/admin-web`
- PASS: `npx.cmd tsc -p apps/mobile/tsconfig.json --noEmit`
- PASS: `git diff --check`

## Service Smoke

Service-level governance smoke run: `SPRINT-D-QA-1779262746202`

The smoke created and cleaned up 19 isolated local defect rows covering verification, assignment, maintenance, closure, rejection, legacy aliases, legacy outcomes, invalid outcomes, and Operations Board aggregation.

## Non-Blocking Warnings

- npm warns that `.npmrc` project config keys `node-linker` and `shamefully-hoist` will stop working in a future npm major version.
- Prisma warns that `package.json#prisma` config is deprecated for Prisma 7.
- `git diff --check` reports Windows LF-to-CRLF normalization warnings only; no whitespace errors.

## Recommendation

Proceed to production deployment after standard environment backup and deployment runbook checks.

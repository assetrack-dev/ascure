# ASCURE — Testing, Security & Resilience Plan

> **Status:** Draft v1 · **Created:** 2026-06-22 · **Owner:** assetrack.dev
> **Baseline:** prod `b696394` (Deploy 44), DB at `add_manager_review_lifecycle`
> **Purpose:** A sequenced, referenceable plan for hardening ASCURE (security, load/stress, resilience, and automated testing) now that it is a **live multi-company field pilot**. Update the changelog at the bottom as phases land.

---

## 1. Why this plan exists

ASCURE went from prototype to a **live pilot with real field crews and multiple companies' data in one database** (TNB + main contractors + subcontractors). Two facts drive everything below:

1. **Multi-company data isolation is the crown-jewel risk.** Company A must never see Company B's assets/defects/site-visits/users/teams. The scoping logic is large and spread out, and it is demonstrably fragile — Deploy 44's adversarial review caught a hole where a manager could move a team into another company (`organizationId: null`); it passed `tsc` *and* manual testing.
2. **It runs on a single VPS that crews depend on daily.** There is no headroom and no staging, so load/pen testing cannot point at prod.

There is currently **no automated test suite at all** (0 spec files), so every change ships on `tsc` + manual + ad-hoc review. The first goal of this plan is to convert the highest-risk areas into **permanent, automated regression nets**.

---

## 2. Current state (audited 2026-06-22)

| Area | State | Notes |
|---|---|---|
| Input validation | ✅ Present | Global `ValidationPipe` `{ whitelist, forbidNonWhitelisted, transform }` (`apps/api/src/main.ts`) |
| SQL injection | ✅ Low risk | No `$queryRaw`/`$executeRaw` anywhere — all Prisma parameterized |
| TLS | ✅ Present | certbot on nginx (api / admin / www) |
| Process resilience | ✅ Partial | PM2 auto-restart + `pm2 startup` (boot resurrect); no health checks/alerting |
| Auth model | ✅ Present | JWT bearer; mobile 30-day token + single-device `mobileSessionId` rotation |
| Rate limiting | ❌ Missing | No `@nestjs/throttler` — `/auth/login` is brute-forceable |
| Security headers | ❌ Missing | No `helmet` (no HSTS/clickjacking/MIME-sniff protection) |
| CORS | ⚠️ Open | `origin: '*'` (mitigated: bearer-in-header, no ambient cookie — still should tighten) |
| Upload limits | ❌ Missing | `FileInterceptor('file')` in 5 controllers (defects, imports, inspections, report-templates, site-visits) with **no size or MIME limits** → disk-fill / DoS surface |
| Static uploads | ⚠️ Note | API serves `/uploads/` via `useStaticAssets` — uploaded content is web-reachable |
| Automated tests | ❌ None | 0 `*.spec.ts` / `*.e2e-spec.ts`, no jest/supertest/`@nestjs/testing` |
| Staging env | ❌ None | Only prod `.env`; no isolated environment to test against |
| Secrets | ⚠️ Review | `JWT_SECRET` in plain root-owned `.env` on the single VPS; no rotation story |
| Backups | ⚠️ Manual | `pg_dump` per deploy only; restore never rehearsed |

---

## 2a. Exposure remediation — public repo (audited 2026-06-22)

The repo (`assetrack-dev/ascure`) is currently **public**. Audit result: the prod `.env` (JWT secret + DB password) is **gitignored and never committed** — no catastrophic secret leak. Three things *are* exposed and need action. **⚠️ Making the repo private does NOT un-leak what's already public — the already-exposed secrets must be rotated regardless of visibility (security-by-obscurity is not a fix).**

| # | Exposure | Where | Risk | Action | Type | Urgency |
|---|---|---|---|---|---|---|
| E1 | Default account credentials | `prisma/seed.ts` (public) + no login throttle | Anyone reads the default admin/manager/etc. emails + passwords and tries them on prod | Rotate or disable every default seed account on prod (or confirm already changed); add login throttling | Owner (rotate) + code (throttle) | **Now** |
| E2 | Live Google Maps **Android** API key | `apps/mobile/android/app/src/main/AndroidManifest.xml` | Billing abuse if unrestricted (the key also ships inside the APK regardless, so secrecy was never the control) | Google Cloud Console: restrict to the Android app (package + signing SHA‑1) + Maps SDK only, set a quota/billing alert, and **rotate** the key | Owner | **Now** |
| E3 | Hardcoded `JWT_SECRET` fallback | `apps/api/src/auth/auth.module.ts` + `jwt.strategy.ts` (`JWT_SECRET \|\| <fallback>`) | If `JWT_SECRET` ever fails to load, tokens are signed/verified with a public fallback → forgeable admin tokens. Prod has the secret set → latent today | Remove the fallback; **throw** if `JWT_SECRET` is missing (fail closed) | Code | Medium |
| E4 | Repo is public | GitHub | Readable blueprint of auth logic, scope rules, every endpoint, seed creds | Make the repo **private** (proprietary client system, no open-source intent) — but only *after/alongside* E1–E3, not instead of them | Owner | Recommended |

Notes:
- E1's throttle + E3's fail-closed fix fold into **Phase 2 (Auth hardening)**; E1's credential rotation and E2/E4 are **owner actions** (prod data / Google Console / GitHub settings — not code).
- The committed `debug.keystore` files are harmless (Android's well-known default debug key) but confirm the APK is **debug-signed** → move to a real release-signing key before any wider distribution (**Phase 6**).
- The web Maps key (`NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`) is a separate, build-inlined, referrer-restricted key — also client-exposed by nature; ensure it too is HTTP-referrer-restricted with a quota.

**Operational prerequisite for E4 (going private without breaking deploys):** the VPS remote is HTTPS and pulls anonymously *because the repo is public*; once private, `git pull` will demand auth on every deploy. Fix with a **read-only SSH deploy key** (scoped to this one repo, read-only, no expiry — beats a PAT). Set it up **while still public**, confirm `git pull` works over SSH, *then* flip private (zero broken-deploy window):
```bash
# on the VPS (root)
ssh-keygen -t ed25519 -C "ascure-vps-deploy" -f /root/.ssh/ascure_deploy -N ""
cat /root/.ssh/ascure_deploy.pub      # → GitHub repo Settings → Deploy keys → Add (read-only, do NOT allow write)
printf 'Host github.com\n  HostName github.com\n  User git\n  IdentityFile /root/.ssh/ascure_deploy\n  IdentitiesOnly yes\n' >> /root/.ssh/config && chmod 600 /root/.ssh/config
ssh-keyscan -t ed25519 github.com >> /root/.ssh/known_hosts
cd /opt/ascure/ascure && git remote set-url origin git@github.com:assetrack-dev/ascure.git
ssh -T git@github.com && git pull     # expect auth-success greeting + a clean pull, no prompt
```
After the switch, the deploy runbook's pre-flight should confirm the SSH remote so an auth issue is caught before a deploy, not mid-deploy.

---

## 3. Constraints & guiding principles

- **Never load/pen-test prod.** Stand up disposable **staging** first (Phase 0). Read-only authz probes against prod with throwaway seeded accounts are acceptable; anything that writes/loads is staging-only.
- **Authorization is risk #1.** Sequence it first and make it a permanent regression net, not a one-off audit.
- **Prefer regression nets over point audits.** Every confirmed bug class becomes a test so it cannot silently re-open (the team-orphan bug is the motivating example).
- **Small-team realism.** ASCURE is built by a very small team. Phases are sized so each delivers standalone value; "ongoing" items are explicitly separated from "do-once."
- **Don't regress the field loop.** Mobile crews work offline; nothing here should add friction to the core capture→sync loop.

---

## 4. Risk register (prioritized)

| # | Risk | Likelihood | Impact | Phase |
|---|---|---|---|---|
| R1 | Cross-company / cross-tenant data leak (BOLA/IDOR via scope gaps) | **High** (proven once) | **Critical** (confidentiality breach across clients) | 1 |
| R2 | Login brute-force / credential stuffing (weak pilot passwords, no throttle) | High | High | 2 |
| R3 | Single-VPS outage under field load / disk fill from uploads | Medium | **Critical** (crews blocked) | 0, 4 |
| R4 | Privilege escalation / lifecycle-gate bypass (role/state machine) | Medium | High | 1 |
| R5 | Malicious upload (oversized, or crafted `.docx`→LibreOffice/Gotenberg) | Medium | Medium–High | 3 |
| R6 | Lost/automated DB backup → unrecoverable data loss | Low | **Critical** | 0 |
| R7 | Business-logic race (concurrent lifecycle transitions, billing snapshots) | Low–Med | Medium | 5 |
| R8 | Offline sync corruption / duplicate replay | Low–Med | Medium | 5 |
| R9 | Lost field device → readable cached data / long-lived token | Low | Medium | 6 |

---

## 5. Phased plan

Each phase: **Objective · Tasks · Tooling · Prod-safe? · Effort (rough person-days) · Depends on · Exit criteria.**
Effort is a rough order-of-magnitude for one developer, not a commitment.

### Phase 0 — Foundations (unblocks everything)
- **Objective:** A safe place to test + a way to run tests automatically + automated backups.
- **Tasks:**
  - Stand up a **staging environment** (same VPS image or a cheap second box / container set): separate Postgres `ascure_staging`, its own `.env`, the admin + api under PM2, seeded with **synthetic multi-company data** (Tenant-1 → CompanyA, CompanyB[main], CompanyC[sub-of-B], + one user per role per company).
  - Add a **test runner** to the API: `jest` + `@nestjs/testing` + `supertest`, a `test`/`test:e2e` script, and a CI hook (GitHub Actions) that runs on PR.
  - Author a **reusable seed/fixture factory** (the multi-company graph above) used by all e2e tests.
  - **Automate DB backups**: nightly `pg_dump` cron → retained N days off-box; **rehearse one restore** into staging.
- **Tooling:** Docker/PM2, GitHub Actions, jest, prisma seed.
- **Prod-safe?** Yes (backups touch prod read-only; staging is separate).
- **Effort:** 3–5 d.
- **Depends on:** —
- **Exit criteria:** `pnpm test` runs green in CI; staging reachable with seeded data; a backup has been restored successfully at least once.

### Phase 1 — Authorization & multi-company isolation suite ★ highest ROI
- **Objective:** Prove (and keep proving) that no role/company/tenant can reach another's data or actions.
- **Tasks:**
  - **Authorization matrix e2e** (the centerpiece): for every read + mutate endpoint, with the Phase-0 fixture, assert CompanyA's token → 403/404/empty on CompanyB resource IDs. Cover assets, site-visits, inspections, defects, teams, users, dashboard, map, reports.
  - **Cross-tenant** isolation cases (stronger boundary than cross-org).
  - **Privilege/role cases:** technician cannot `manager-approve`; DC cannot `generate-report`/`request-amendment` before `DISAHKAN_PENGURUS` (the hard gate); MANAGER cannot create ADMIN or assign roles outside `MANAGER_ASSIGNABLE_ROLES`; MANAGER cannot create/move/edit/deactivate a team outside their org (regression-locks the Deploy-44 fix); VIEWER/CLIENT read-only.
  - **Scope-helper unit tests** for `siteVisitAccessWhere` / `scope-context` / per-service `accessScope` so the matrix's "why" is pinned at the unit level too.
- **Tooling:** jest + supertest, seed factory.
- **Prod-safe?** Runs on staging/CI. (A small **read-only** subset can be run against prod with throwaway accounts as a smoke.)
- **Effort:** 5–8 d (bulk of the value).
- **Depends on:** Phase 0.
- **Exit criteria:** Every endpoint has at least one cross-company negative test; suite green; new endpoints fail CI until they add a scope test (lint/convention).

### Phase 2 — Auth hardening (quick, high-value)
- **Objective:** Close the cheap, high-likelihood auth gaps.
- **Tasks:**
  - `@nestjs/throttler`: strict limit on `/auth/login` (+ a sane global default); verify mobile sync endpoints aren't throttled into failure.
  - `helmet` for security headers (HSTS, frame-deny, no-sniff).
  - Tighten **CORS** from `*` to the known admin origin(s) (keep mobile working — it's same-origin to the API host, no browser CORS).
  - **Secrets review:** confirm `JWT_SECRET` is long/random (not a dev default); document a rotation procedure; consider moving secrets out of repo-root `.env` into a restricted file / secret store.
  - Add **auth audit logging** (login success/failure, password resets, role/permission changes).
  - Confirm password strength rules for user-chosen passwords.
- **Tooling:** nest middleware, throttler; tests in Phase-1 harness.
- **Prod-safe?** Build/test on staging → deploy via the normal guided runbook.
- **Effort:** 2–4 d.
- **Depends on:** Phase 0 (to test); deploy after Phase 1 ideally.
- **Exit criteria:** brute-force test shows lockout/429; headers present (observable via curl); CORS rejects unknown origins; secret rotation documented.

### Phase 3 — Security recon + targeted fixes
- **Objective:** Systematic code/dependency audit + fix the concrete surfaces.
- **Tasks:**
  - **Upload hardening (confirmed gap):** add `limits.fileSize` + MIME/extension allow-lists to all 5 `FileInterceptor` controllers; cap total storage; validate `.docx` template uploads especially (they flow to LibreOffice/Gotenberg). Confirm filename path-traversal safety (current code uses `randomUUID` + builders — verify no user-controlled path segment).
  - **Dependency scanning:** `pnpm audit` / Dependabot / `npm audit` in CI; track and patch.
  - **Static analysis:** ESLint security rules; optionally a SAST pass (Semgrep).
  - **`.docx`→PDF threat review:** crafted-template handling (XXE/macro/SSRF) through easy-template-x + Gotenberg; confirm Gotenberg stays `127.0.0.1`-bound and resource-capped.
  - **Admin XSS sweep:** confirm no `dangerouslySetInnerHTML` rendering of user/notes/report fields.
- **Tooling:** Semgrep, pnpm audit, manual review (a structured multi-agent review pass is well-suited here).
- **Prod-safe?** Audit is read-only; fixes ship via runbook.
- **Effort:** 3–5 d.
- **Depends on:** Phase 0 (for fix testing).
- **Exit criteria:** all upload endpoints bounded + type-checked; CI dependency scan green; documented threat notes for the report pipeline.

### Phase 4 — Load, stress & resilience (staging only)
- **Objective:** Know the breaking point and the bottlenecks before the field finds them.
- **Tasks:**
  - **Realistic load model** (not generic RPS): N crews × (login → `getActiveSiteVisits` → per-visit detail+asset+template warm → inspection submits + image uploads → `sync/heartbeat`) + M managers refreshing the dashboard/ops-board. Burst pattern at shift start/end.
  - **Hotspot focus:** `getDashboard` (~30 parallel queries/call), site-visit list with includes, defect ops-board, `/assets/map` feed, image upload throughput.
  - **DB:** Prisma connection-pool size vs Postgres `max_connections`; find pool-exhaustion point; add indexes where the load test reveals slow scans.
  - **Gotenberg:** concurrent report-generation load; resource-cap the container; consider a queue if compiles contend with API CPU.
  - **Disk/storage:** upload-volume projection; alerting on disk %; plan object storage migration.
  - **Resilience drills:** kill api/admin/postgres/gotenberg containers and confirm PM2/restart recovery + the mobile offline loop degrades gracefully.
  - **Capacity decision:** from results, decide VPS sizing / when to split DB onto its own box.
- **Tooling:** **k6** or **Artillery**; Postgres `pg_stat_statements`; `htop`/container stats.
- **Prod-safe?** **No — staging only.**
- **Effort:** 4–6 d.
- **Depends on:** Phase 0 (staging is mandatory).
- **Exit criteria:** documented max concurrent crews/managers before latency SLO breach; bottleneck list with fixes; recovery drills pass.

### Phase 5 — Business-logic concurrency & offline integrity
- **Objective:** Pin the correctness edges that money/billing and field reliability depend on.
- **Tasks:**
  - **Concurrency tests:** two managers approving the same visit; complete-while-DC-amends; double-submit. Evaluate `SELECT … FOR UPDATE` on the visit row inside `transition()` (read-check-write is currently a TOCTOU window).
  - **Billing/contribution** correctness under reassignment (delta-crediting) — property/edge tests.
  - **Offline sync replay:** flaky-network duplicate/conflict handling on the temp-ID reconciler; idempotency of `createInspection` (shipped) and submits.
- **Tooling:** jest (concurrency via Promise.all races), a scripted offline-replay harness.
- **Prod-safe?** Staging/CI.
- **Effort:** 3–5 d.
- **Depends on:** Phase 0/1.
- **Exit criteria:** no lost/duplicated billing credit under race; lifecycle transitions are serializable; replay is idempotent.

### Phase 6 — Mobile-specific
- **Objective:** Reduce field-device and client risks.
- **Tasks:**
  - Confirm **no secrets in the APK** (it's decompilable; API base URL is fine, but check for keys).
  - **Data-at-rest:** cached user/capabilities/visits in AsyncStorage are unencrypted → evaluate `expo-secure-store` for the token at minimum; document lost-device → password-reset revoke.
  - (Optional, later) **TLS cert pinning** for hostile networks.
  - Move from **debug-signed** to a proper release-signing key before any wider distribution.
- **Tooling:** apk decompile (jadx), expo-secure-store.
- **Prod-safe?** Yes (client-side).
- **Effort:** 2–3 d.
- **Depends on:** —
- **Exit criteria:** no embedded secrets; token stored in secure store; signing decision documented.

### Phase 7 — Operational / ongoing
- **Objective:** Sustain it.
- **Tasks:** uptime + error monitoring (e.g. self-hosted Uptime Kuma + Sentry), DB/disk/CPU alerting, log retention, a periodic (e.g. quarterly) external pen-test once past pilot, and CI gates so the Phase-1/2/3 suites must stay green to deploy.
- **Prod-safe?** Yes.
- **Effort:** ongoing.
- **Depends on:** Phases 1–4 exist to gate on.

---

## 6. Sequencing & dependencies

```
Phase 0 (staging + CI + backups)  ──┬──> Phase 1 (authz suite) ★
                                    ├──> Phase 2 (auth hardening)
                                    ├──> Phase 3 (recon + uploads)
                                    ├──> Phase 4 (load/stress)        [needs staging]
                                    └──> Phase 5 (concurrency/offline)
Phase 6 (mobile)  ── independent, can run anytime
Phase 7 (ops)     ── after 1–4 exist to gate on
```

- **Critical path:** 0 → 1. Everything else hangs off Phase 0.
- **Parallelizable after Phase 0:** 2, 3, and 6 can proceed alongside 1.
- **Hard gate:** Phase 4 (and any write/load test) **must** wait for Phase 0's staging.
- **Quick wins decoupled from staging:** Phase 2 hardening + Phase 3 upload limits can be *written/reviewed* immediately and shipped via the guided runbook even before full CI exists (but are best validated by the Phase-1 harness).

---

## 7. Tooling summary

| Need | Tool |
|---|---|
| API unit/e2e tests | jest + `@nestjs/testing` + supertest |
| CI | GitHub Actions (run on PR; gate deploy) |
| Load/stress | k6 (preferred) or Artillery |
| DB profiling | `pg_stat_statements`, `EXPLAIN ANALYZE` |
| Dependency scan | `pnpm audit` / Dependabot |
| SAST | Semgrep + ESLint security plugin |
| Rate limit / headers | `@nestjs/throttler`, `helmet` |
| Monitoring | Uptime Kuma (uptime) + Sentry (errors) |
| Mobile inspection | jadx (decompile), `expo-secure-store` |

---

## 8. Rough effort / suggested order

| Order | Phase | Effort | Prod-safe | Value |
|---|---|---|---|---|
| 1 | 0 Foundations | 3–5 d | ✅ | unblocks all |
| 2 | 1 Authz suite ★ | 5–8 d | ✅ | highest |
| 3 | 2 Auth hardening | 2–4 d | ✅ | high, cheap |
| 4 | 3 Recon + uploads | 3–5 d | ✅ | high |
| 5 | 4 Load/stress | 4–6 d | ⚠️ staging | high |
| 6 | 5 Concurrency/offline | 3–5 d | ✅ | medium |
| — | 6 Mobile | 2–3 d | ✅ | medium (anytime) |
| — | 7 Ops | ongoing | ✅ | sustaining |

Total one-time: ~**3–5 weeks** of focused work for one developer, front-loaded on the highest-risk items.

---

## 9. Open decisions / assumptions

- **Staging host:** second cheap VPS vs. containers on the same box vs. ephemeral CI-only DB. (Recommend a small separate box so load tests don't touch the prod machine.)
- **CI provider:** assumed GitHub Actions (repo is on GitHub: `assetrack-dev/ascure`).
- **Pen-test:** assumed deferred until past pilot; revisit if a second client onboards.
- **Object storage:** assumed local disk is fine for the pilot; migrate when upload volume or multi-box need appears.
- **Defect governance** stays `INSPECTOR_OWNS`; tests should cover both modes since `RELEASE_ON_REPORT` exists.

---

## 10. First two weeks — concrete checklist

- [ ] Provision staging (api + admin + `ascure_staging` Postgres) and a multi-company seed.
- [ ] Add jest + supertest + `@nestjs/testing`; wire `pnpm test` + a GitHub Action.
- [ ] Write the authz matrix skeleton + the **first 5 endpoints** (assets, site-visits, defects, teams, users) cross-company negatives.
- [ ] Add `@nestjs/throttler` to `/auth/login` + `helmet`; tighten CORS.
- [ ] Add `limits.fileSize` + MIME allow-list to the 5 `FileInterceptor` controllers.
- [ ] Stand up nightly `pg_dump` cron + do one **restore rehearsal** into staging.
- [ ] **Set up the VPS read-only SSH deploy key** (§2a) + switch the remote to SSH while still public → confirm `git pull` works → **then make the repo private (E4)**.
- [ ] **Owner — do now, not tonight:** rotate prod default seed accounts (E1) + restrict/rotate the Google Maps Android key (E2).

---

## Changelog
- **2026-06-22** — v1 draft created (baseline prod `b696394` / Deploy 44). Current-state section audited against the codebase.
- **2026-06-22** — added §2a Exposure remediation after a public-repo audit (E1 default seed creds, E2 live Google Maps Android key, E3 JWT_SECRET fallback, E4 repo visibility). Prod `.env` confirmed gitignored + never committed.
- **2026-06-22** — added the read-only SSH deploy-key setup (E4 go-private prerequisite) to §2a + the first-week checklist.

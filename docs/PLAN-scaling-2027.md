# ASCURE — Scaling plan for the January 2027 expansion (DRAFT, for discussion)

Status: **draft from the 2026-09-27 discussion.** IP ServerOne answers added **2026-11-19 (§7.1)**. Updated **2026-11-16: owner decided to move to the new server AS SOON AS POSSIBLE** (see §0). Nothing in §6–§9 is built yet.

## 0. 🔴 Update 2026-11-16 — the server move is now urgent

**Owner decision (2026-11-16):** execute the server change (new server + object storage) as soon as possible. The September timeline (§9) slipped: Tier 3 did not go live by end of October.

**Measured today:**

| Item | 2026-09-29 (after upgrade) | 2026-11-16 |
|---|---|---|
| Disk (193 GB) | 101 GB free (48%) | **14 GB free (93%)** |
| DB backups on the VPS | 1.4 GB | **15 GB** |
| One full DB dump | ~0.9 GB | **1.7 GB** (DB = 2.1 GB; `InspectionItemResult` 0.9 GB + `InspectionResult` 0.8 GB) |
| Inspection photos, all time | ~194k | **358,509 photos = 147 GB** (avg 0.43 MB) |
| Inspection photos, last 14 days | — | 40,431 = **17.5 GB (~1.25 GB/day)** |

- Disk use grew **~87 GB in 48 days ≈ 1.8 GB/day** (photos + maintenance evidence + reports + backups).
- **At that rate the 14 GB left lasts about 7–8 days, so the disk fills around 23–24 Nov 2026.** Each pre-deploy backup adds another 1.7 GB on top.
- When the disk is full, uploads fail and Postgres can stop accepting writes. Crews' phones keep the work queued, but nothing reaches the office.

**Done today (security, kept on the new server too):**
- Prod Postgres was published on `0.0.0.0:5432` (open to the internet). It now listens on `127.0.0.1` / `[::1]` only. Old container kept stopped as `ascure-postgres-old` for rollback; remove after a few quiet days.
- A read-only DB role `ascure_ro` + a tunnel-only SSH user `ascure-tunnel` for reports and the digital office (no shell, DB port only; password hashes and share tokens hidden).
- The API prefix is `/api/v1` (smokes: `/api/v1/public/stats` → 200, `/api/v1/site-visits` → 401).

### 0.1 This week — a bridge so the disk doesn't fill (pick one or both)

1. **Clean up old DB dumps (+~10–12 GB, ~6 more days).** Copy the newest 2 dumps off the server (laptop/office PC or Google Drive), check the copies open, then delete the older dumps on the VPS. The owner approves the exact list before anything is deleted.
2. **Another disk upgrade at the current host**, monthly only (no long prepaid term), if the move can't land within ~2 weeks.
- Until the move: no batch report runs and no extra dumps unless needed; the disk is checked every day (the digital office's Ops Watcher does this as its first job).

### 0.2 New order of work (replaces §9's dates)

Move the server and the photos **together**: photos go straight into object storage instead of being copied to a bigger disk first.

| Step | Target | Work |
|---|---|---|
| 1 | this week (16–22 Nov) | Bridge (§0.1). Contact IP ServerOne with the §7 questions; open the account. Owner approves this plan + TNB data-location answer (Malaysia DC covers it either way). |
| 2 | ~23 Nov – 3 Dec | Build the storage layer (§6) on dev and test it. Set up the NovaCloud C4 server with the secure baseline below. A staging copy on it first. |
| 3 | ~4 – 10 Dec | Migrate photos to the bucket in checksum-verified batches (from the old server, while it keeps running). Rehearse the database move on staging. |
| 4 | one night, ~10–13 Dec | Cutover: short maintenance window at night, final DB dump → restore on the new server, switch DNS, smokes. The old VPS stays as fallback for 1–2 weeks. |
| 5 | 14 – 31 Dec | Raise DB pool, alerts, report/ZIP worker; new-area setup; final January APK; change freeze. |
| Jan 2027 | | Go live in the 4 new areas. |

**Secure baseline for the new server (from today's findings):**
- Database and every internal service (Postgres, Gotenberg, API :3000, admin :3001) listen on localhost only. Only 22/80/443 open, firewall default-deny, checked from outside after setup.
- DB backups go **off the server** automatically (object storage with versioning), not onto the same disk. Keep a fixed number locally.
- Read-only role + tunnel user recreated the same way; one SSH key per machine.
- **Alerts** for disk (warn at 75%, urgent at 85%), memory, API down, backup failed, sent to the owner's phone. The disk reached 93% unnoticed again.
- Staging on the same provider, so changes can be checked on the phone before prod (links to the phone-only deploy plan).

## 1. Why

- ASCURE expands to **4 new areas in January 2027**: Bentong (Pahang), Taiping, Bagan Serai, Selama (northern Perak).
- Per area: **10 inspection crews + 10 maintenance crews** (40 + 40 new crews in total).
- **Maintenance is used heavily**, and contractors start on the **existing backlog right away** (APK v2.0.15, Deploy 190).
- The prod VPS disk hit **91 of 96 GB (95%)** on 2026-09-27, growing ~1.4 GB/day.

## 2. Facts measured on prod (2026-09-27, read-only)

| Item | Value |
|---|---|
| Disk | 96 GB, 91 GB used, 5.1 GB free |
| `apps/api/uploads` | 79 GB (inspections 74 GB, reports 4.5 GB, site-visits 775 MB, defects 92 MB) |
| DB backups on the VPS | 1.4 GB (latest pre-Deploy-188 dump 919 MB) |
| Growth, all uploads, last 7 days | 9.8 GB (~1.4 GB/day) |
| Inspection photos | 193,740, **average 0.40 MB**; 83,529 in the last 30 days |
| Poles inspected, last 30 days | 14,216 (~474/day) |
| Photos per submitted inspection | 5.5 |
| Poles total | 35,018 — KUANTAN 19,749 · SUNGAI SIPUT 8,036 · GERIK 4,633 · KL TIMUR 2,597 · KL BARAT 3 |
| Open Kejanggalan (maintenance backlog) | **57,892 on 26,639 poles** (76% of poles, ~2.2 per pole) |

Storage today: photos on the VPS's local disk under `uploads/` (no object storage in the API). The DB keeps each file as `storageKey` + `/uploads/...` url, served statically (reachable by anyone with the URL). Photos are full camera resolution.

## 3. Owner decisions so far

- **Never reduce photo quality** (no downscaling on the phone or the server).
- **Upgrade the VPS disk now** as a bridge (2026-09-28); cleanup alone frees only ~5–7 GB.
- **Tier 3 = S3-compatible object storage**, preferably **IP ServerOne**, with the **VPS in the same data centre** (NovaCloud). ⚠ 2026-11-19: not possible, NovaCloud is in Cyberjaya and Object Storage in AIMS (§7.1).
- **On-premise / client-hosted = later**, kept possible by staying S3-compatible and making the stack portable.
- Branch clean-up / versioned releases: wanted ("back on proper track"), planned later.

## 4. Forecast (working assumptions — to calibrate)

Assumptions: ~25 poles per survey crew per day; ~10 Kejanggalan per maintenance crew per day; ~2.5 repair photos per Kejanggalan at ~0.7 MB (the repair camera saves at quality 0.9); existing-area maintenance ≈ 40 crews.

| Workload at peak (Jan–Mar 2027) | Per day | Storage per day |
|---|---|---|
| New-area surveys (40 crews) | ~1,000 poles, ~5,900 photos | ~2.4 GB |
| New-area repairs (40 crews) | ~400 Kejanggalan, ~1,000 photos | ~0.7 GB |
| Existing backlog repairs | ~400 Kejanggalan, ~1,000 photos | ~0.7 GB |
| Existing-area surveys + reports | as today | ~0.5–1.1 GB |
| **Total** | **~8,000+ uploads/day** | **~4–5 GB/day (~120–150 GB/month)** |

- Existing backlog repair evidence alone: ~116k–145k photos ≈ **80–100 GB**.
- **Plan for ~1 TB of storage by the end of 2027.**
- Load: **~120–160 phones** syncing daily, evening bursts after offline work, work-pack downloads of ~100–200 MB per Pencawang.

## 5. Scaling risks (in the order they will hurt)

1. **Photo storage** — the VPS disk. Fix: Tier 3.
2. **DB connection pool = 5** — P2024 timeouts already in the Deploy-190 log. Fix: raise the limit, check the heavy screens.
3. **API memory growth** — the 1200 MB guardrail restarts the API often. Fix: keep hunting; move heavy jobs out of the API.
4. **One 2-vCPU server** runs API + admin + Postgres + Gotenberg; reports slow crew uploads. Fix: a separate worker for reports/ZIPs/photo processing; later, the DB on its own server.
5. **Can't run 2+ API servers** — in-memory job state (defect ZIP jobs) + local-disk photos. Fix: Tier 3 + jobs in the DB/a queue.
6. **Queries that slow down with volume** (e.g. the dashboard P2035 at 32,767+ assets, fixed in Deploy 187). Fix: load test at 2× scale before January.
7. **No alerting** (the disk reached 95% unnoticed). Fix: alerts for disk, memory, errors, uptime.
8. **Manual cherry-pick deploys** to a drifted prod branch. Fix: versioned releases + a staging server.
9. **Per-region office scripts** (Kuantan vs SS QR pipelines). Fix: region differences as configuration.
10. **TNB verification throughput** — ~800 repairs/day to verify. Product decision needed: per-package bulk verify, sampling, and automatic evidence pre-checks (time gap / GPS distance — the Gerik lesson).

## 6. Tier 3 design (to detail in docs/PLAN-object-storage.md)

- **Keep every `/uploads/...` URL.** The API sends clients to the stored object (presigned redirect); the DB, admin web and phones don't change, so no APK is needed.
- **Local-first upload** as today, then a **background push** to the bucket; local copies are cleared a few days after the cloud copy is verified.
- **Reads fall back** local → bucket during the migration.
- **Batch migration** of the existing ~100 GB, **checksum-verified** before any local file is deleted.
- **Bucket versioning / delete protection** turned on (the bucket isn't a backup by itself).
- Report generation / ZIPs stream from the bucket (watch memory).
- Optional: expiring links instead of the current public-by-URL `/uploads`.

## 7. Provider: IP ServerOne (read 2026-09-27)

**Object Storage** (NetApp StorageGRID, S3 API, Cyberjaya/AIMS, across 2 DCs, ISO 27001/27017):
- Base MYR 0.041667/hour (≈ RM30/month): 250 GiB storage, 1 TiB transfer, 20k reads, 2k writes.
- Overage (hourly): storage MYR 0.00014/GiB (≈ RM0.10/GiB/month), transfer MYR 0.04/TiB, reads RM0.01/10k, writes RM0.02/2k.
- Their table says **eventual consistency**.

**NovaCloud VPS** (OpenStack; MY Selangor + Sarawak, SG, HK; Tier III; ISO 27001/27017, SOC 2 II; 99.9% SLA; anti-DDoS; free snapshot backups: hourly ×15, daily ×7, weekly ×4):
- C1 1 vCPU/3.75 GB RM43.92 · C2 2 vCPU/7.5 GB RM80.52 · **C4 4 vCPU/15 GB RM161.04** · C8 RM322.08 per month.
- Each plan includes 1 IPv4, 10 GiB disk, 1 TiB transfer. Extra SSD RM0.60/GiB. Transfer over 1 TiB RM0.44/GiB (table header reads "/Hour/GiB" — confirm). +8% SST.

### 7.1 IP ServerOne answers (received 2026-11-19)

Owner sent 16 questions on 2026-11-18 (`Desktop\IP ServerOne - Questions.docx`); answers came back 2026-11-19.

| Topic | Answer | What it means for us |
|---|---|---|
| S3 compatibility | Yes, standard S3 features work; they asked for our feature list | Sent in the follow-up (§7.2) |
| Included 250 GiB / 1 TiB / 20k reads / 2k writes | Reset **monthly** | Matches §8 |
| Versioning / object lock | **Versioning yes, object lock no** | Protection = versioning + an app key that cannot delete object versions + DB dumps kept off the server |
| Presigned URLs | Yes | §6 design works as planned |
| Read after upload | Milliseconds to ~2 s, sometimes a few seconds | Fine: local-first upload, reads fall back local → bucket |
| Copying ~150 GB ourselves | Allowed; counts against the quotas (their SmartHand help is chargeable) | We copy it ourselves from the old server; ~360k writes ≈ RM4 |
| **Same data centre** | **No: NovaCloud is in Cyberjaya, Object Storage is in AIMS (KL)** | §3's "same DC" isn't possible. It still works (close by), and keeping photos in another DC from the server is safer for disaster recovery. Watch the traffic between them |
| Traffic between NovaCloud and Object Storage | Unclear: "If you subscription in yearly" | Asked again (§7.2 Q1). If it is metered, overage on the NovaCloud side is RM0.44/GiB |
| Transfer overage label | **Per GiB** | RM0.44/GiB over 1 TiB on NovaCloud |
| Snapshot backups | Cover **all attached volumes**; 15 hourly / 7 daily / 4 weekly, free; self-service restore free | They are crash-consistent only, so `pg_dump` to the bucket stays. Veeam (app-aware) is optional and paid |
| Firewall: only 22/80/443 | Yes | Secure baseline (§0.2) holds |
| Setup time | Within 1 working day | — |
| Contract | **Subscription: minimum 1 year. Pay-per-use credit: no commitment** | Owner decision: start pay-per-use (trial, first weeks), then decide on yearly once the yearly price is known |
| Billing | MYR; website prices exclude 8% SST | Matches §8 |
| Trial | **Free 2-week POC server** | Use it to rehearse the move (§0.2 steps 2–3) |
| Data stays in Malaysia | No written statement; TNB may visit the DC | Asked to write the DC location into the service order (§7.2 Q6) |
| Support | 24/7: email, portal ticket, hotline 03-2026 1688 | OK for a night cutover |

### 7.2 Follow-up questions (owner sends 2026-11-20, `Desktop\IP ServerOne - Follow-up Questions.docx`)

1. Is traffic between NovaCloud (Cyberjaya) and Object Storage (AIMS) free only with a yearly subscription? With pay-per-use, does it count against both monthly transfer allowances?
2. Yearly subscription price vs pay-per-use for a C4 + ~100 GiB extra SSD + Object Storage; billed monthly or upfront?
3. Can the 2-week POC include a bucket, and can the POC server become production?
4. Is there a private link between Cyberjaya and AIMS; typical latency and bandwidth?
5. Do these work: lifecycle rules that expire old versions, multipart upload, CopyObject, keys/policies that can upload and read but not delete, bucket CORS?
6. Can the data-centre location (Malaysia) be written in the service order or contract?

**Open with TNB:** must evidence photos stay in Malaysia? (Cloudflare R2 has no Malaysia region; IP ServerOne is in Malaysia, but only offers a DC visit, not a written statement.)

## 8. Estimated running cost from January 2027

| Item | Per month |
|---|---|
| NovaCloud C4 | RM161 |
| Server disk ~100 GiB | ~RM54 |
| Object storage ~300–400 GB → ~1 TB | ~RM45 → ~RM110 |
| **Subtotal + 8% SST** | **~RM280 → ~RM350** |
| Optional staging server (C1) | +~RM47 |

Unknown until §7.2 is answered: whether NovaCloud ↔ Object Storage traffic is metered (different DCs), and the yearly-subscription price.

## 9. Timeline (draft)

> ⚠ **Superseded 2026-11-16 by §0.2** — kept for history.

Hard dates: **Tier 3 live by end of October 2026** (once maintenance starts, the +100 GB disk lasts only until ~mid-November); **the NovaCloud move by mid-December 2026.**

| Weeks | Dates | Work |
|---|---|---|
| 0 | 28 Sep | Disk upgrade; distribute APK v2.0.15; TNB starts assigning packages |
| 1–2 | 29 Sep – 11 Oct | Tier 3 plan approved; IP ServerOne questions + account; build the storage layer; raise the DB pool; alerts |
| 3–4 | 12 – 25 Oct | Deploy Tier 3; migrate ~100 GB in verified batches; free the VPS disk |
| 5–6 | 26 Oct – 8 Nov | Load test at January scale; fix hotspots; reports/ZIP worker; TNB bulk-verify tools; M1 step 5 backfill |
| 7–9 | 9 – 29 Nov | Branch clean-up → `v1.0.0`, staging, portable install (may slip to February) |
| 10–11 | 30 Nov – 13 Dec | Move to NovaCloud C4; old VPS kept as fallback 1–2 weeks |
| 12–13 | 14 – 31 Dec | New-area setup (Mainheads, maintenance companies, TNB users/ranks, templates, crew accounts); final January APK; training; change freeze |
| Jan 2027 | | Go live in all 4 areas; close monitoring for 2–3 weeks |

## 10. Longer-term hosting roadmap

1. Disk cleanup/upgrade → Tier 3 object storage.
2. Portable packaging (containers, one-command install, env-driven config).
3. Versioned releases replacing the cherry-picked branches (`main` last updated 2026-04-23; prod branch 444 and dev 490 commits ahead; split 2026-07-06).
4. Dedicated Malaysian instance for TNB if they want separation.
5. Client-hosted (TNB/SESB/SESCO data centre) only when a client requires it. Prereqs: a mobile server setting (the API URL is baked in at build today), health/log export, security docs, optional SSO, crews reach it via the client's DMZ.

## 11. Still to confirm (owner)

1. How many maintenance crews on the existing areas' 57,892 Kejanggalan (assumed ~40)?
2. How many survey crews are active today (to calibrate 25 poles/crew/day)?
3. Pole counts for the 4 new areas.
4. TNB's answer on data location, and on how verification should work at ~800/day.

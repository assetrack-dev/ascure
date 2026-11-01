# PLAN — Offline capacity (SQLITE_FULL at ~80 poles) + stuck "Completion Queued" + remove OCR

Status: **APPROVED + BUILT 2026-11-02** (Q1 warn < 1 GB / block < 300 MB, Q2 2-minute retry,
Q3 office view: all as suggested). Owner decided 2026-11-01 to **remove the Smart Sensor OCR from
the phone** (Part C). Mobile-only (one APK) except the optional office view
in B5. Builds on `docs/PLAN-mobile-storage-hardening.md` and the fixes shipped in v2.0.16–v2.0.20.

## 1. The two field reports

1. **"Increase the cache size."** Crews working offline can survey about **80 poles**, then
   saving fails with `SQLITE_FULL` ("database or disk is full").
2. **"Completion Queued" for days.** PE LEPAR DAGING (CKTNJ00559, team JEBAT) finished its last
   pole on 24 Oct and showed "Completion Queued" until FIRDAUS completed it on 1 Nov 21:44.
   The server never received a completion before then (nginx log: one request, 201).

## 2. Findings — offline capacity

**The app's database is not what fills up. The phone's storage is.**
SQLITE_FULL has two causes, and the first is already handled:

| Cause | State today |
|---|---|
| AsyncStorage database hits its cap | Cap is **64 MB** (`gradle.properties`); the read-cache is held under **30 MB** by size-based eviction; large rows are split into parts. The outbox costs about **15 KB per pole** (answers + photo *paths*, never photo data), so 80 poles ≈ 1–2 MB. **Raising the cap would not help.** |
| **Phone storage full** → SQLite can't grow its file | **Not handled.** See below. |

Measured on prod (PE LEPAR DAGING, 136 poles): **849 photos = 6.2 per pole** (max 10); the
stamped photo that is uploaded averages **465 KB**.

What one photo leaves on the phone while offline (`camera/CameraCaptureHost.tsx`,
`camera/useStampedPhoto.tsx`, `syncQueue.ts`):

| File | Size | Deleted when |
|---|---|---|
| Raw camera capture (`cache/Camera/`, full sensor, quality 0.7) | **≈ 2–5 MB** (phone-dependent) | Only at the **next app start**, and only if **> 12 h old** (`sweepTempPhotoFiles`) |
| Raw capture of every **Retake** | ≈ 2–5 MB each | Same — `retakePhoto()` never deletes it |
| Stamped temp (`cache/ReactNative-snapshot-image…`, view-shot) | ≈ 0.5 MB | Next app start (view-shot's own cleanup) |
| Durable copy for upload (`documents/…`, a **copy**, not a move) | ≈ 0.5 MB | After the queued upload succeeds ✅ |

So an offline pole costs roughly **6 photos × ~3–6 MB ≈ 20–35 MB** of phone storage, nearly all
of it raw captures nobody needs after stamping. **80 poles ≈ 2–3 GB**, which is about what a
crew phone has free. That matches the "~80 poles" limit. The same day online is fine because
uploads delete the durable copies, but the raw captures still pile up until a cold start the next day.

### Step 0 — confirm on one affected phone (5 minutes, before or while building)

Ask the crew for:
1. A screenshot of the exact error. On v2.0.16+ a full **outbox** says *"Phone storage is full (N MB
   free)…"*. Raw `SQLITE_FULL` text points at another write path, or an older APK.
2. APK version (app drawer).
3. Android **Settings → Storage**: free space.
4. **Settings → Apps → ASCURE → Storage**: App / User data / **Cache** sizes. Expected: Cache
   in the GB range.

**Workaround until the APK:** before an offline day, free phone storage (videos, WhatsApp media).
With signal and **Sync Queue empty**, Android **"Clear cache"** for ASCURE is safe and frees the
raw captures. **Never "Clear data"**, which wipes the unsynced outbox.

## 3. Findings — stuck "Completion Queued"

(`syncQueue.ts`, `context/SyncContext.tsx`, `screens/SyncQueueScreen.tsx`, `screens/VisitDetailScreen.tsx`)

- The outbox is sent **only** when the network state changes, when Work Offline is switched off,
  or when the crew taps **Retry Sync**. **There is no timer**, so a completion queued on weak but
  steady signal is never retried.
- A queued completion waits until **every** other queued item of that visit has gone, including
  **FAILED** ones, which stay queued and retry forever (`hasBlockingWorkForVisit`).
- **Pole adds and edits are not shown on the Sync Queue screen**, so the blocker can be invisible.
- The button says "Completion Queued" even when the completion itself has **failed**.
- The server already receives each phone's pending count (`User.syncPendingCount`,
  `syncReportedAt`), but no office screen shows it. On 1 Nov JEBAT phones still reported
  pending items: ISHAK 2 (31 Oct), IZZUL 1 (29 Oct).

## 4. Plan

### A. Offline capacity (target: ~10× more poles per offline day)

| Step | Change | Effect |
|---|---|---|
| A1 | Delete the **raw capture** as soon as the stamped photo is saved (nothing else needs it once the OCR is gone, Part C); delete it on **Retake** and on cancel. | Removes ~2–5 MB per photo, the bulk of the usage |
| A2 | Durable copy = **move** the stamped temp instead of copying it. | One 0.5 MB copy per photo instead of two |
| A3 | Sweep also on **app return to foreground** (throttled to every 30 min) with a **2 h** age floor for cache files (not 30 min: the defect and check-in screens can hold a photo in memory that long before saving, so stamped snapshot files are never swept mid-session). **Built 2026-11-02, plus:** a sweep of our own durable photo folders for copies **no outbox entry references and older than 48 h** (an abandoned form or a retaken photo left its copy behind for good). | Leftovers from crashes or old versions are freed the same day |
| A4 | **Storage gauge** on Sync Queue: phone free space, photos waiting (count + MB), outbox items. **Warn** when free space < 1 GB; **block the camera** with a clear message below 300 MB. | Crews see it coming instead of hitting an error mid-pole |
| A5 | Raise the database cap 64 → 128 MB (headroom only; costs nothing unless used). | Belt and braces; not the fix |

Expected: ~3 MB per offline pole (6 × 0.5 MB durable copies) instead of ~20–35 MB, so a phone
with 2–3 GB free holds **~700+ poles** of photos.
**Unchanged:** photo resolution and quality (the uploaded file stays ~465 KB) and all evidence
stamps and GPS.

### B. Stuck completion

| Step | Change |
|---|---|
| B1 | **Retry timer:** while online and the outbox isn't empty, run a sync every **2 minutes** and on app resume. |
| B2 | **Show pole adds/edits** on Sync Queue (Pending / Failed, with the server's error and a per-item Retry). |
| B3 | **Visit Detail says why:** *"Waiting for 3 items of this visit to sync"* (tap → Sync Queue), or *"Not accepted: <server message>"* + **Retry**. Never a bare "Completion Queued". |
| B4 | **Stop hammering hopeless items:** a 4xx refusal (other than 408/429) stops automatic retries and shows **Needs attention** with the message. Manual Retry stays. Nothing is deleted from the phone. |
| B5 | *(web only, no APK)* **Office view:** "N unsent on phone · <time>" under each person's Status on the **Users** page (admin: tenant, manager: own company), so a stuck phone is spotted from the office. |

### C. Remove the Smart Sensor OCR from the phone (owner decision 2026-11-01)

**Why:** five rounds of fixes in July (temperature picked instead of the reading → misread digits
→ two-pass → aim box → seven-segment decoder). The decoder was only ever tested on synthetic
digits; the real-photo check (`tools/ocr-eval` "Phase B") never ran. The app doesn't record
whether a reading came from OCR or was typed, but crews report retyping it nearly every time.
It also forces the raw full-size photo to be kept (A1) and adds two native modules to the APK.

| Step | Change |
|---|---|
| C1 | **Reading field** (`inputType = OCR`, e.g. Bacaan Kelegaan): the crew takes the meter photo and **types** the reading. Keep the photo (still tagged to its checklist item, so reports and the Linked Assets columns are unchanged) and the **"Cable below range — mark LO"** button. Drop the scan, the "did you mean" chips and the "Scanner saw" line (`InspectionFormScreen.tsx`). |
| C2 | Camera: drop the blue aim box (`guide: 'reading'`) and replace it with a plain hint, *"Make the reading clear and free of glare"*, because the office check (Part D) reads this photo. |
| C3 | Delete `apps/mobile/src/ocr.ts`, the seven-segment decoder in `packages/shared-utils/src/seven-segment/` and `tools/ocr-eval/`. Remove `@react-native-ml-kit/text-recognition`, `expo-image-manipulator` and `jpeg-js` from the app. The **LO** helpers (`shared-utils/reading-sentinel`) **stay**, since the API uses them. |
| C4 | No server, template or data change: the item type stays `OCR`, values are still stored in `valueNumber` / `valueText`, and old inspections read the same. |

### D. Later, a separate plan: office-side reading check (AI vision)

The server compares each **typed** reading with its **meter photo** using an AI vision model and
**flags mismatches for the DC** (e.g. on the Site Visit Linked Assets table and the DC review).
It catches wrong readings instead of guessing them, adds nothing to the phone, and fits the
roadmap's "AI validation". To be planned on its own (cost per photo, which surveys, what the DC
sees, thresholds).

## 5. Owner decisions needed

| # | Question | Suggested |
|---|---|---|
| Q1 | Low-storage thresholds: warn < 1 GB, block camera < 300 MB? | Yes |
| Q2 | Retry interval while online: 2 minutes? | Yes |
| Q3 | B5 office view of unsynced phones: include? | Yes (small, web-only, can ship before the APK) |

## 6. Testing and release

- Scratch simulations as for v2.0.16 (queue + photo sweep): raw capture deleted after stamping;
  Retake/cancel cleanup; move keeps the outbox reference valid; sweep never
  deletes a file the outbox references; retry timer doesn't run while Work Offline is on; a
  completion still waits for its visit's items; a 4xx item stops auto-retry but keeps its data.
- Device test on an affected crew phone: **install over** the existing app (same appId keeps the
  outbox), take photos offline, and confirm Cache stays small in Settings → Apps → ASCURE.
- OCR removal: a reading field takes photo + typed value + LO; an inspection saved on the old APK
  with an OCR'd value reopens and edits normally; the APK builds without the two native modules
  (check the size drop).
- Release as **APK v2.0.21**, with release notes in BM + EN.

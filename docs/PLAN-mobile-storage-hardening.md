# Mobile storage hardening — `SQLITE_FULL[13]` in the field (✅ FIXED)

**Status:** ✅ **FIXED 2026-07-01** (APK-only — no server, no migration) after it resurfaced
at **sign-in** in the field (owner, on the new APK — the DB had finally filled). Shipped:
(1) AsyncStorage DB cap **6 → 50 MB** (`apps/mobile/android/gradle.properties`
`AsyncStorage_db_size_in_MB=50`; installing over a full DB raises the cap in place → no data
loss); (2) session (token/user) + last-pole-code writes made **fail-soft + retry-once**
(`storage.ts`) so a storage hiccup never blocks sign-in / throws a banner; (3) sync-queue
write **retry-once then surface** (`syncQueue.ts` — durable field work isn't silently
dropped); (4) offline-cache **eviction** (`offlineCache.ts`, 300-entry cap, drop oldest).
Verified: mobile tsc clean; release re-bundle; `BuildConfig AsyncStorage_db_size = 50L` baked.

Original analysis (2026-06-28 — first surfaced during the owner's on-device SAVT test, Add
Asset → "database or disk is full (code 13 SQLITE_FULL[13])"; device disk had free space, and
it cleared via Workspace → Refresh → re-enter visit):

## What actually happened (it was NOT a full disk)

SQLite returns `SQLITE_FULL` (code 13) for a real full disk *and* for any moment it
**can't complete a write transaction** (extend the DB/journal file, get past
lock/journal contention, etc.). With free disk, this was the second kind — a
**transient write failure**, which is why a refresh fixed it (a real full disk would not).

The app writes to one AsyncStorage SQLite DB from several places:

- **Offline cache** (`apps/mobile/src/offlineCache.ts`) — already **fail-soft**:
  `writeCache` swallows every error ("a full disk / serialization failure must not
  break the screen"), and `prependToCachedArray` / `cachedFetch`'s write go through it.
  So the cache did NOT raise the banner.
- **NOT fail-soft (these can throw onto the screen):**
  - `apps/mobile/src/storage.ts` → **`storeLastPoleCode`** — a raw `AsyncStorage.setItem`
    with **no try/catch**, called **right after a pole saves** (`AddAssetScreen.handleSubmit`,
    between `createAsset` and `proceedAfterSave`). Its own comment claims "best-effort…
    just means no suggestion", but the write isn't actually wrapped.
  - `apps/mobile/src/syncQueue.ts` → the queue `setItem` (`persistQueue`, ~line 1174),
    used on the offline enqueue path.

**Most likely culprit = `storeLastPoleCode`** (it's in the save path). **Network link:**
on weak/flaky 4G the **background sync** thrashes the same SQLite DB (retrying uploads,
rewriting the queue); a foreground save writing at the same moment hits **write
contention** → transient `SQLITE_FULL`. Good signal → no thrash → no error. Aggravator:
the offline cache has **no size cap / eviction**, so the DB has grown large over weeks
of testing, making transient hiccups heavier and more frequent.

**Why the refresh fixed it:** navigating away + Refresh pulled fresh data and got back to
a clean state; the next save wrote with no contention (and likely with the network back),
so it went through. Nothing was lost.

## The real bug it exposes

A **best-effort convenience write** (remember-last-No.Tiang) sits in the **critical save
path and isn't wrapped**, so a harmless momentary SQLite hiccup shows a scary "disk full"
banner and can block the save's navigation — when the pole itself was created fine.

## Fix plan (mobile-only, no server / no migration — ships in an APK)

1. **Make the non-cache writes fail-soft + retry-once on `SQLITE_FULL`**, like the cache:
   - `storeLastPoleCode` → wrap the `setItem` in try/catch (truly best-effort).
   - sync-queue `persistQueue` `setItem` → wrap + single retry after a short delay.
2. **Decouple `storeLastPoleCode` from save success** in `AddAssetScreen.handleSubmit`:
   navigate first (`proceedAfterSave`), then remember the code — a write failure there must
   never block the save or surface a banner.
3. **Cap + evict the offline cache** (`offlineCache.ts`): bound entry count / drop stale
   namespaces so the AsyncStorage DB stays small (less contention, less long-term bloat).
4. (Optional) a small **"sync now / storage used"** maintenance affordance; and next time it
   happens in the field, capture **logcat** to confirm the exact SQLite reason + which write.

## Acceptance

- Force the condition (large cache + weak network + rapid Add-Asset saves) and confirm a
  save never shows `SQLITE_FULL` and always navigates; remember-last-code may silently skip.
- Cache size stays bounded after many visits.

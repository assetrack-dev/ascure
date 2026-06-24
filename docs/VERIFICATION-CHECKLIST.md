# ASCURE — Verification Checklist

Things to verify after the 2026-06-14 work. Tick each item; note anything that
needs a tweak.

**Production:** live at commit `89330e3`
- Deploy 9–10 — Visual Report (templates, per-asset preview, compile-on-LAPORAN-SELESAI, delete)
- Deploy 11 — SAVR masterlist export
- Gotenberg container (`ascure-gotenberg`, 127.0.0.1:3002) runs the docx→PDF conversion

**Mobile APK to sideload:** `apps/mobile/android/app/build/outputs/apk/release/app-release.apk`
(47 MB, prod URL baked; bundles the whole mobile backlog)

---

## A. Admin web (prod) — Visual Report

> Prereq: upload a real `.docx` template first. Tag reference:
> `apps/api/src/report-generation/PLACEHOLDER-CONTRACT.md`.

- [ ] **Nav gating** — "Report Templates" shows in the sidebar for an **ADMIN**; not for a non-admin reporting user.
- [ ] **Upload template** — Report Templates → pick a scope (e.g. SAVR) → upload `.docx` → shows as **active** for that scope; appears in "All versions".
- [ ] **Supersede** — upload a 2nd template for the same scope → previous flips to **superseded**, new one **active** (v2).
- [ ] **Delete** — delete a test template → it disappears (DB row + file removed).
- [ ] **Per-asset preview** — open an Asset with a submitted inspection (matching scope) → **Preview report** → PDF downloads with that pole's photos/readings/defects, no leftover `{tags}`.
- [ ] **Edit-and-re-preview loop** — tweak the `.docx`, re-upload, Preview again → changes reflected.
- [ ] **Compile + freeze** — open a survey at **RONDAAN SELESAI** → **Generate report (Laporan Selesai)** → succeeds → **Download compiled report** appears → PDF = cover page + one section per asset.
- [ ] **Error sanity** — Preview an asset with no submitted inspection or no template → clear red message (no crash).

## B. Admin web (prod) — SAVR Masterlist export

- [ ] **Download** — Reports → pick a Pencawang + Status → **Download Masterlist** → file named `[NAMA PENCAWANG]_MASTERLIST.xlsx`.
- [ ] **Layout** — matches the sample: 1 pole per row, metadata columns + checklist items as columns.
- [ ] **Status filter** — try **Arkib** (imported foundation data) vs **All** → row set changes as expected.
- [ ] **Values** — for a SAVR-KLB inspection, defect columns show `1`, data columns show recorded values; metadata always fills.
- [ ] *(optional)* **Round-trip** — re-upload the exported file via Imports → validates with all columns matched.

## C. Admin web (prod) — Manager user provisioning *(earlier deploy, confirm acceptance)*

- [ ] Manager creates a TECHNICIAN/SUPERVISOR/MANAGER in their company → **temp password shown once**.
- [ ] That new user logs in → **forced to change password** before reaching the app.
- [ ] Manager resets a company user's password.

## D. Mobile — sideload the APK, then verify

- [ ] **Login** works (hits prod); **forced password change** triggers for a flagged user.
- [ ] **Tweak A** — change a pole's Pencawang.
- [ ] **Tweak B** — amend a submitted inspection (revert to editable).
- [ ] **Tweak C** — delete a pole (single + "Select" bulk delete).
- [ ] **OCR** — *prereq: in prod admin → Checklist Templates → SAVR/SAVT, add KELEGAAN item(s) as "OCR / Smart Sensor"* → scan a reading; confirm decimals captured (e.g. **5.27 not 5**) and the photo is recorded/shown.
- [ ] **Team Activity card** — Manager/Supervisor dashboard shows today's per-team inspected count *(after ≥1 inspection is SUBMITTED today, MY time)*.
- [ ] **Map** — drop-pin-to-add-asset at centre; satellite on Visit Detail; marker clustering gone; back from full map returns to **Visit Detail**.
- [ ] **Inspection queue** — one card per status; compact scope selector at top.

---

Freshest / highest-value: **A (Visual Report)** and **B (masterlist)**. C and D are
accumulated items the new APK + earlier deploys finally make testable.

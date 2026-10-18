-- Pencawang name drift — READ-ONLY report.
--
-- A survey (SiteVisit) keeps a COPY of its Pencawang's Kod / Nama / Functional
-- Location. Before 2026-10-18 a crew could change that copy at check-in or in
-- "Edit Visit Details", so the survey showed one name while the Pencawang list,
-- checklist export, QR AUTO and report filenames used the Pencawang record's.
-- New drift is now blocked in the API; this lists what is left from before.
--
-- Fix per Pencawang: decide the correct name, then rename it on the Pencawang
-- page (web). That updates the record AND copies the name onto every survey
-- of that Pencawang (Deploy 193). Compiled report PDFs keep the old name until
-- they are regenerated.
--
-- Run on prod (no writes):
--   docker exec -i ascure-postgres sh -lc 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -P pager=off' < pencawang-name-drift.sql
--
-- Compared case- and spacing-insensitively; a survey's Functional Location is
-- expected to equal the record's location, or its Kod when it has no location
-- (what the check-in screen fills in).

WITH norm AS (
  SELECT
    v.id                                   AS visit_id,
    v."lifecycleStatus"                    AS lifecycle,
    t.name                                 AS team,
    v."createdAt"::date                    AS started,
    s.code                                 AS record_code,
    s.name                                 AS record_name,
    COALESCE(s.location, s.code)           AS record_fl,
    v."pencawangCode"                      AS visit_code,
    v."pencawangName"                      AS visit_name,
    v."functionalLocation"                 AS visit_fl,
    -- A NULL copy is not drift: screens fall back to the record then.
    v."pencawangCode" IS NOT NULL
      AND upper(regexp_replace(btrim(v."pencawangCode"), '\s+', ' ', 'g'))
          <> upper(regexp_replace(btrim(s.code), '\s+', ' ', 'g'))                     AS code_differs,
    v."pencawangName" IS NOT NULL
      AND upper(regexp_replace(btrim(v."pencawangName"), '\s+', ' ', 'g'))
          <> upper(regexp_replace(btrim(s.name), '\s+', ' ', 'g'))                     AS name_differs,
    v."functionalLocation" IS NOT NULL
      AND upper(regexp_replace(btrim(v."functionalLocation"), '\s+', ' ', 'g'))
          NOT IN (upper(regexp_replace(btrim(COALESCE(s.location, '')), '\s+', ' ', 'g')),
                  upper(regexp_replace(btrim(s.code), '\s+', ' ', 'g')))               AS fl_differs
  FROM "SiteVisit" v
  JOIN "Substation" s ON s.id = v."substationId"
  LEFT JOIN "Team" t ON t.id = v."teamId"
  WHERE v."pencawangName" IS NOT NULL OR v."pencawangCode" IS NOT NULL
)
SELECT
  record_code,
  record_name                 AS pencawang_record_name,
  visit_name                  AS survey_copy_name,
  CASE WHEN code_differs THEN visit_code END AS survey_copy_code,
  CASE WHEN fl_differs   THEN visit_fl   END AS survey_copy_fl,
  concat_ws(', ',
    CASE WHEN name_differs THEN 'NAMA' END,
    CASE WHEN code_differs THEN 'KOD' END,
    CASE WHEN fl_differs   THEN 'FL' END) AS differs,
  lifecycle,
  team,
  started,
  visit_id
FROM norm
WHERE name_differs OR code_differs OR fl_differs
ORDER BY record_code, started;

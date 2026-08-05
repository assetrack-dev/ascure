/**
 * Canonical SAVT route + pole-code grammar — the single source of truth across
 * API, mobile, and admin (docs/PLAN-savt-shared-poles.md).
 *
 * A SAVT route's KOD TIANG is BY DEFINITION `{from KOD PENCAWANG} - {to
 * Pencawang code}` (e.g. "KK - LL"), and the pair is unique per direction — no
 * double circuits (owner-confirmed 2026-08-05). A pole's code on a route is
 * `{KOD TIANG} {No. Tiang}` where No. Tiang is a trunk integer with an optional
 * branch tail (e.g. "MI - KUK 33/1").
 *
 * Crews historically re-typed the KOD TIANG from the plate, so "MI-KUK",
 * "MI – KUK", and "MI - KUK" all exist in the wild for the SAME route. Because
 * the route code is a feeder identity key, every writer must canonicalize.
 */

export * from './route-code';

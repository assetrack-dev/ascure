/**
 * Canonical NO TIANG RONDAAN grammar — the single source of truth for parsing
 * and rendering TNB pole numbers across API, mobile, and admin.
 *
 * - `parse.ts`  : string -> structure. Lifted verbatim from the proven mobile
 *                 implementation (`apps/mobile/src/utils/feederSequence.ts`);
 *                 this copy is canonical going forward. The Phase 1 opener swaps
 *                 mobile onto this package and deletes the duplicate (see
 *                 docs/ASCURE-build-sequence.md).
 * - `format.ts` : structure -> string. New; the "render the label" half of
 *                 north-star §3 that did not previously exist anywhere.
 */

export * from './parse';
export * from './format';

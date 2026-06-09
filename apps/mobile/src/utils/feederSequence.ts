/**
 * NO TIANG RONDAAN grammar — now sourced from the shared canonical package
 * `@ascure/shared-utils` (single source of truth across API, mobile, admin).
 *
 * This file is a thin re-export kept so existing imports
 * (`../utils/feederSequence`) keep working unchanged; the implementation moved
 * to `packages/shared-utils/src/rondaan/` and gained the structure→string
 * formatter (`formatRondaan`). See docs/ASCURE-build-sequence.md.
 */
export * from '@ascure/shared-utils';

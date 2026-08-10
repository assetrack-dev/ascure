import type { Tone } from "@/components/ui";
import type { ClientPole } from "@/lib/client-progress";

/**
 * Shared vocabulary for the network owner's (TNB / CLIENT) read-only views.
 *
 * ⚠ The client sees their network at EVERY stage — nothing is hidden for being
 * unfinished — so every label here has to say plainly WHICH stage a row is in,
 * in words a client can read without knowing our lifecycle enum.
 */

export function formatClientDate(value: string | null): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-MY", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(parsed);
}

/** Survey lifecycle → a label a client can read without knowing our workflow. */
export function lifecycleLabel(status: string | null): string {
  switch (status) {
    case "RONDAAN_SELESAI":
      return "Survey complete";
    case "DISAHKAN_PENGURUS":
      return "Verified";
    case "PERLU_PINDAAN":
      return "Under revision";
    case "PINDAAN_SELESAI":
      return "Revised";
    case "LAPORAN_SELESAI":
      return "Reported";
    case "ARKIB":
      return "Archived";
    // DALAM_RONDAAN — and a visit that never advanced — means a crew is still
    // walking it. Visible to the client now, so it needs an honest label.
    default:
      return "In field";
  }
}

export function lifecycleTone(status: string | null): Tone {
  switch (status) {
    case "DISAHKAN_PENGURUS":
    case "LAPORAN_SELESAI":
      return "success";
    case "RONDAAN_SELESAI":
    case "PINDAAN_SELESAI":
      return "info";
    case "PERLU_PINDAAN":
      return "warning";
    case "ARKIB":
      return "neutral";
    default:
      return "brand";
  }
}

/** Maintenance category → the words TNB uses, not our enum token. */
export function formatCategory(category: string): string {
  switch (category.toUpperCase()) {
    case "RENTIS":
      return "Rentis";
    case "CAT_TIANG":
      return "Cat Tiang";
    case "SELENGGARAAN":
      return "Selenggaraan";
    default:
      return category;
  }
}

export function severityTone(severity: string | null): Tone {
  switch (severity?.toUpperCase()) {
    case "CRITICAL":
      return "critical";
    case "HIGH":
      return "high";
    case "MEDIUM":
      return "warning";
    default:
      return "neutral";
  }
}

/**
 * A pole's state in one chip: registered-but-untouched, still being walked, or
 * the lifecycle stage its finished survey has reached.
 */
export function poleStateChip(pole: ClientPole): { label: string; tone: Tone } {
  if (pole.surveyState === "NOT_SURVEYED") {
    return { label: "Not surveyed", tone: "neutral" };
  }
  return {
    label: lifecycleLabel(pole.lifecycleStatus),
    tone: lifecycleTone(pole.lifecycleStatus),
  };
}

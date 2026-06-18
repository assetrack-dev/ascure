"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  Camera,
  CheckCircle2,
  Compass,
  Eye,
  FileText,
  Layers,
  MapPin,
  Network,
  RefreshCw,
  ScanLine,
  Share2,
  ShieldCheck,
  Smartphone,
  WifiOff,
} from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { fetchPublicStats, type PublicStats } from "@/lib/public-stats";

/* ------------------------------------------------------------------ */
/* Animated counter                                                    */
/* ------------------------------------------------------------------ */

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Fires once when the element first scrolls into view. */
function useInView<T extends Element>(threshold = 0.25): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      { threshold },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold]);

  return [ref, inView];
}

function StatCounter({
  value,
  label,
  sublabel,
  hero = false,
}: {
  value: number | null;
  label: string;
  sublabel?: string;
  hero?: boolean;
}) {
  const [ref, inView] = useInView<HTMLDivElement>();
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    if (!inView || value == null) {
      return;
    }
    if (prefersReducedMotion()) {
      setDisplay(value);
      return;
    }

    let raf = 0;
    let startTs: number | null = null;
    const duration = hero ? 1900 : 1500;

    const tick = (ts: number) => {
      if (startTs === null) {
        startTs = ts;
      }
      const progress = Math.min(1, (ts - startTs) / duration);
      const eased = 1 - Math.pow(1 - progress, 3); // easeOutCubic
      setDisplay(Math.round(value * eased));
      if (progress < 1) {
        raf = requestAnimationFrame(tick);
      }
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, value, hero]);

  const loading = value == null;
  const formatted = display.toLocaleString();

  return (
    <div ref={ref} className="text-center">
      <div
        className={
          hero
            ? "font-bold leading-none text-[var(--foreground)] tabular-nums text-6xl sm:text-7xl lg:text-8xl"
            : "font-bold leading-none text-[var(--foreground)] tabular-nums text-3xl sm:text-4xl"
        }
        style={{ fontFamily: "var(--font-mono)" }}
        aria-live="polite"
      >
        {loading ? (
          <span className="inline-block animate-pulse text-[var(--muted-2)]">—</span>
        ) : (
          formatted
        )}
      </div>
      <div
        className={
          hero
            ? "mt-4 text-base font-semibold uppercase tracking-[0.18em] text-[var(--brand)]"
            : "mt-2 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted)]"
        }
      >
        {label}
      </div>
      {sublabel ? (
        <div className="mt-1 text-sm text-[var(--muted-2)]">{sublabel}</div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Content                                                             */
/* ------------------------------------------------------------------ */

const PILLARS = [
  {
    icon: Eye,
    title: "Legible",
    body: "Every asset carries a human-readable sequential number — arranged by structure, painted on the pole itself. The crew and the system read the same name.",
  },
  {
    icon: Network,
    title: "Navigable",
    body: "Not a flat list — a real graph the system can traverse. Feeders, branches and NOP tie-points the system can route and isolate across.",
  },
  {
    icon: Camera,
    title: "Provable",
    body: "Every observation is backed by a timestamped photo or a sensor reading. Evidence, not assertion — captured at the pole, the moment it's seen.",
  },
  {
    icon: RefreshCw,
    title: "Perpetual",
    body: "Re-surveyed on a fixed cycle. Year one lays the baseline; every cycle after records the delta. The data compounds.",
  },
] as const;

const LIFECYCLE: {
  stage: string;
  local: string;
  note: string;
  optional?: boolean;
}[] = [
  { stage: "In survey", local: "DALAM RONDAAN", note: "The field crew walks the feeder, tagging & inspecting each asset." },
  { stage: "Inspection locked", local: "RONDAAN SELESAI", note: "The inspector owns the defect call — authoritative on submit." },
  { stage: "Amendments", local: "PERLU PINDAAN", note: "The data controller returns any quality issues to fix.", optional: true },
  { stage: "Report compiled", local: "LAPORAN SELESAI", note: "The document factory compiles the cycle's reports." },
  { stage: "Archived", local: "ARKIB", note: "The cycle is archived — the persistent asset lives on." },
];

const TECH = [
  {
    icon: WifiOff,
    title: "Offline-first field capture",
    body: "Most sites have no base data and no signal. Inspection is asset creation — captured offline, synced when back in range.",
  },
  {
    icon: ScanLine,
    title: "OCR smart-sensor readings",
    body: "Snap the ground-clearance gauge; on-device ML reads the value off the photo. No transcription, no transposition errors.",
  },
  {
    icon: Camera,
    title: "Timestamped photo proof",
    body: "Every reading is anchored to a moment with a timestamp overlay — the audit trail is the workflow, not an afterthought.",
  },
  {
    icon: Share2,
    title: "Network-graph isolation view",
    body: "Open this breaker and these poles de-energize; close that NOP and feeder G back-feeds. Graph traversal no spreadsheet can match.",
  },
  {
    icon: FileText,
    title: "Document factory",
    body: "Your standard deliverables — inspection forms, clearance tables, schematic drawings — compiled from the same network edges and frozen at sign-off.",
  },
  {
    icon: MapPin,
    title: "Map & discovery mode",
    body: "Drop a pin, name it sequentially, inspect it. The global map plans the route and avoids re-walking what's already proven.",
  },
] as const;

const APP_FEATURES = [
  {
    icon: WifiOff,
    title: "Offline-first capture",
    body: "Inspect, add poles and queue work with zero signal — it syncs the moment you're back in range.",
  },
  {
    icon: ScanLine,
    title: "On-device OCR readings",
    body: "Snap the gauge; the value is read off the photo on the phone — no transcription, no transposition.",
  },
  {
    icon: Camera,
    title: "Timestamped photo proof",
    body: "Every observation is anchored to a moment and a GPS fix — evidence, not assertion.",
  },
  {
    icon: MapPin,
    title: "Map & route",
    body: "Drop a pin, name it in sequence, navigate the feeder — and never re-walk what's already proven.",
  },
] as const;

/* ------------------------------------------------------------------ */
/* Decorative network motif                                            */
/* ------------------------------------------------------------------ */

function NetworkMotif() {
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.5]"
      preserveAspectRatio="xMidYMid slice"
      viewBox="0 0 1200 600"
      fill="none"
    >
      <defs>
        <radialGradient id="motif-fade" cx="50%" cy="38%" r="62%">
          <stop offset="0%" stopColor="white" stopOpacity="1" />
          <stop offset="100%" stopColor="white" stopOpacity="0" />
        </radialGradient>
        <mask id="motif-mask">
          <rect width="1200" height="600" fill="url(#motif-fade)" />
        </mask>
      </defs>
      <g mask="url(#motif-mask)" stroke="var(--brand)" strokeOpacity="0.22" strokeWidth="1.5">
        {/* feeder spine + branches */}
        <path d="M120 470 L300 360 L520 300 L760 250 L1010 180" />
        <path d="M300 360 L340 200" />
        <path d="M520 300 L560 150 L700 110" />
        <path d="M520 300 L470 470" />
        <path d="M760 250 L820 420" />
        <path d="M760 250 L900 330" />
        <path d="M300 360 L180 250" />
      </g>
      <g mask="url(#motif-mask)" fill="var(--brand)">
        {[
          [120, 470],
          [300, 360],
          [520, 300],
          [760, 250],
          [1010, 180],
          [340, 200],
          [560, 150],
          [700, 110],
          [470, 470],
          [820, 420],
          [900, 330],
          [180, 250],
        ].map(([cx, cy], i) => (
          <circle key={i} cx={cx} cy={cy} r={i % 4 === 0 ? 6 : 4} fillOpacity={0.55} />
        ))}
      </g>
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Mobile app mockup                                                   */
/* ------------------------------------------------------------------ */

function StatusPill({ value, tone }: { value: string; tone: "pass" | "fail" | "reading" }) {
  const toneStyle: Record<"pass" | "fail" | "reading", React.CSSProperties> = {
    pass: { background: "rgba(34,197,94,0.16)", color: "#16a34a" },
    fail: { background: "rgba(239,68,68,0.16)", color: "#dc2626" },
    reading: {
      background: "var(--surface-pressed)",
      color: "var(--foreground)",
      fontFamily: "var(--font-mono)",
    },
  };
  return (
    <span className="rounded-md px-1.5 py-0.5 text-[10px] font-bold" style={toneStyle[tone]}>
      {value}
    </span>
  );
}

function PhoneFrame({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="relative mx-auto w-full max-w-[228px]">
      <div
        aria-hidden="true"
        className="absolute -inset-5 -z-10 rounded-[3rem] bg-[var(--brand-soft)] opacity-60 blur-2xl"
      />
      <div className="rounded-[2.4rem] border border-[var(--line-strong)] bg-[var(--background)] p-2 shadow-[var(--shadow-card)]">
        <div
          className="relative overflow-hidden rounded-[2rem] bg-[var(--panel-muted)]"
          style={{ aspectRatio: "9 / 19.5" }}
        >
          <div
            aria-hidden="true"
            className="absolute left-1/2 top-0 z-20 h-5 w-24 -translate-x-1/2 rounded-b-2xl bg-[var(--background)]"
          />
          <div className="flex items-center justify-between px-4 pt-2.5 text-[9px] font-semibold text-[var(--muted)]">
            <span>09:41</span>
            <span className="text-[var(--foreground)]" style={{ fontFamily: "var(--font-display)" }}>
              {label}
            </span>
            <span>5G</span>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

function InspectionScreen() {
  return (
    <>
      <div className="relative mx-2.5 mt-2 h-[47%] overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--panel)]">
        <svg viewBox="0 0 220 300" className="h-full w-full" fill="none" aria-hidden="true">
          <g stroke="var(--line)" strokeWidth="1">
            <path d="M0 95 H220" />
            <path d="M0 205 H220" />
            <path d="M72 0 V300" />
            <path d="M152 0 V300" />
          </g>
          <path d="M30 255 L82 185 L122 132 L172 68" stroke="var(--brand)" strokeWidth="2.5" strokeOpacity="0.7" />
          <path d="M82 185 L132 212" stroke="var(--brand)" strokeWidth="2" strokeOpacity="0.5" />
          <circle cx="30" cy="255" r="5" fill="#22c55e" />
          <circle cx="82" cy="185" r="5" fill="#22c55e" />
          <circle cx="132" cy="212" r="5" fill="#ef4444" />
          <circle cx="172" cy="68" r="5" fill="var(--muted-2)" />
          <circle cx="122" cy="132" r="7" fill="var(--brand)" stroke="var(--background)" strokeWidth="2.5" />
        </svg>
        <div className="absolute right-1.5 top-1.5 inline-flex items-center gap-1 rounded-full border border-[var(--line-strong)] bg-[var(--background)] px-1.5 py-0.5 text-[8px] font-semibold text-[var(--foreground)] shadow-sm">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: "#f59e0b" }} />
          Offline · 3
        </div>
      </div>
      <div className="mx-2.5 mt-2.5 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-2.5 shadow-[var(--shadow-soft)]">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold" style={{ fontFamily: "var(--font-mono)" }}>POLE A-12</span>
          <span className="rounded-full bg-[var(--brand-soft)] px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide text-[var(--brand)]">LV SURVEY</span>
        </div>
        <div className="mt-2 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[9px] text-[var(--muted)]">Ground clearance</span>
            <StatusPill value="5.8 m" tone="reading" />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[9px] text-[var(--muted)]">Pole condition</span>
            <StatusPill value="PASS" tone="pass" />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[9px] text-[var(--muted)]">Stay wire</span>
            <StatusPill value="FAIL" tone="fail" />
          </div>
        </div>
        <div className="mt-2.5 flex h-7 items-center justify-center rounded-[var(--radius-control)] bg-[var(--brand)] text-[9px] font-semibold text-[var(--on-brand)]">
          Submit to queue
        </div>
      </div>
    </>
  );
}

const SEVERITY: Record<string, React.CSSProperties> = {
  CRITICAL: { background: "rgba(239,68,68,0.16)", color: "#dc2626" },
  HIGH: { background: "rgba(245,158,11,0.18)", color: "#b45309" },
  MEDIUM: { background: "rgba(37,99,235,0.14)", color: "var(--brand)" },
};

function DefectCard({
  code,
  severity,
  label,
  claim,
}: {
  code: string;
  severity: keyof typeof SEVERITY;
  label: string;
  claim?: boolean;
}) {
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-bold" style={{ fontFamily: "var(--font-mono)" }}>{code}</span>
        <span className="rounded-md px-1.5 py-0.5 text-[8px] font-bold" style={SEVERITY[severity]}>
          {severity}
        </span>
      </div>
      <p className="mt-1 text-[9px] text-[var(--muted)]">{label}</p>
      {claim ? (
        <div className="mt-2 flex h-6 items-center justify-center rounded-md bg-[var(--brand)] text-[8px] font-semibold text-[var(--on-brand)]">
          Claim &amp; start
        </div>
      ) : null}
    </div>
  );
}

function MaintenanceScreen() {
  return (
    <div className="px-2.5 pt-2">
      <div className="flex items-center gap-2 rounded-xl px-2.5 py-2" style={{ background: "rgba(239,68,68,0.12)" }}>
        <span className="text-[12px]">🚨</span>
        <div className="leading-tight">
          <p className="text-[9px] font-bold" style={{ color: "#dc2626" }}>Emergency · POLE D-7</p>
          <p className="text-[8px] text-[var(--muted)]">Conductor down — respond now</p>
        </div>
      </div>
      <p className="mt-3 text-[8px] font-bold uppercase tracking-[0.12em] text-[var(--muted-2)]">
        Ready to claim · 2
      </p>
      <div className="mt-1.5 space-y-2">
        <DefectCard code="POLE A-12" severity="HIGH" label="Stay wire broken" claim />
        <DefectCard code="POLE B-3" severity="MEDIUM" label="Cracked insulator" />
      </div>
    </div>
  );
}

function OcrScreen() {
  return (
    <div className="px-2.5 pt-2">
      <div className="relative overflow-hidden rounded-xl" style={{ aspectRatio: "3 / 4", background: "#0b1220" }}>
        <svg viewBox="0 0 120 160" className="absolute inset-0 h-full w-full" aria-hidden="true">
          <rect x="38" y="14" width="22" height="132" rx="3" fill="#1e293b" />
          {[...Array(11)].map((_, i) => (
            <line
              key={i}
              x1="38"
              y1={20 + i * 12}
              x2={i % 2 === 0 ? 60 : 52}
              y2={20 + i * 12}
              stroke="#475569"
              strokeWidth="1.5"
            />
          ))}
          <text
            x="88"
            y="92"
            fontSize="20"
            fontWeight="700"
            fill="#e2e8f0"
            style={{ fontFamily: "var(--font-mono)" }}
            textAnchor="middle"
          >
            5.8
          </text>
        </svg>
        <div
          className="absolute"
          style={{ left: "60%", top: "47%", width: "32%", height: "16%", border: "1.5px dashed var(--brand)", borderRadius: 4 }}
        />
        <div className="pointer-events-none absolute inset-3">
          <span className="absolute left-0 top-0 h-3 w-3 border-l-2 border-t-2" style={{ borderColor: "var(--brand)" }} />
          <span className="absolute right-0 top-0 h-3 w-3 border-r-2 border-t-2" style={{ borderColor: "var(--brand)" }} />
          <span className="absolute bottom-0 left-0 h-3 w-3 border-b-2 border-l-2" style={{ borderColor: "var(--brand)" }} />
          <span className="absolute bottom-0 right-0 h-3 w-3 border-b-2 border-r-2" style={{ borderColor: "var(--brand)" }} />
        </div>
      </div>
      <div className="mt-2.5 flex items-center justify-between rounded-xl border border-[var(--line)] bg-[var(--panel)] p-2.5">
        <div className="leading-tight">
          <p className="text-[8px] text-[var(--muted)]">Ground clearance</p>
          <p className="text-[14px] font-bold" style={{ fontFamily: "var(--font-mono)" }}>
            5.8 <span className="text-[9px] text-[var(--muted)]">m</span>
          </p>
        </div>
        <span className="rounded-md px-1.5 py-0.5 text-[8px] font-bold" style={{ background: "rgba(34,197,94,0.16)", color: "#16a34a" }}>
          READ
        </span>
      </div>
    </div>
  );
}

function PhoneCard({
  label,
  caption,
  children,
}: {
  label: string;
  caption: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center">
      <PhoneFrame label={label}>{children}</PhoneFrame>
      <p className="mt-5 text-sm font-semibold text-[var(--foreground)]">{caption}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

const NAV_LINKS = [
  { href: "#app", label: "The app" },
  { href: "#philosophy", label: "Philosophy" },
  { href: "#methodology", label: "How it works" },
  { href: "#technology", label: "Technology" },
];

export function LandingPage() {
  const [stats, setStats] = useState<PublicStats | null>(null);

  useEffect(() => {
    let active = true;
    fetchPublicStats()
      .then((data) => {
        if (active) setStats(data);
      })
      .catch(() => {
        // Degrade quietly — the counters stay in their loading state rather
        // than breaking the marketing page if the API is unreachable.
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      {/* ---- Nav ---- */}
      <header className="sticky top-0 z-30 border-b border-[var(--line)] bg-[color-mix(in_srgb,var(--background)_82%,transparent)] backdrop-blur">
        <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <Link href="/" className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/monogram.png"
              alt="ASCURE"
              width={36}
              height={36}
              className="h-9 w-9 rounded-lg shadow-sm"
            />
            <span
              className="text-lg font-bold tracking-wide"
              style={{ fontFamily: "var(--font-display)" }}
            >
              ASCURE
            </span>
          </Link>

          <div className="hidden items-center gap-7 md:flex">
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="text-sm font-medium text-[var(--muted)] transition hover:text-[var(--foreground)]"
              >
                {link.label}
              </a>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <ThemeToggle variant="icon" />
            <Link
              href="/login"
              className="inline-flex h-10 items-center gap-1.5 rounded-[var(--radius-control)] bg-[var(--brand)] px-4 text-sm font-semibold text-[var(--on-brand)] transition hover:bg-[var(--brand-strong)]"
            >
              Sign in
              <ArrowRight size={16} />
            </Link>
          </div>
        </nav>
      </header>

      {/* ---- Hero ---- */}
      <section className="relative overflow-hidden border-b border-[var(--line)]">
        <NetworkMotif />
        <div className="relative mx-auto max-w-6xl px-5 py-24 text-center sm:py-28 lg:py-36">
          <span className="inline-flex items-center gap-2 rounded-[var(--radius-pill)] border border-[var(--line-strong)] bg-[var(--panel)] px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted)] shadow-[var(--shadow-soft)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--brand)]" />
            The register of the low-voltage distribution network
          </span>

          <h1
            className="mx-auto mt-7 max-w-4xl text-4xl font-bold leading-[1.07] tracking-tight sm:text-5xl lg:text-6xl"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Every pole.{" "}
            <span className="text-[var(--brand)]">Named, mapped, and proven.</span>
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-lg text-[var(--foreground-soft)] sm:text-xl">
            Walk the feeder, name it, see it on a map, prove it with a photo. ASCURE is the
            authoritative register of a utility&rsquo;s low-voltage distribution network &mdash;
            captured pole by pole in the field, and re-surveyed every cycle so the record never
            goes stale.
          </p>

          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/login"
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-[var(--radius-control)] bg-[var(--brand)] px-7 text-base font-semibold text-[var(--on-brand)] shadow-[var(--shadow-soft)] transition hover:bg-[var(--brand-strong)] sm:w-auto"
            >
              Sign in to the console
              <ArrowRight size={18} />
            </Link>
            <a
              href="#methodology"
              className="inline-flex h-12 w-full items-center justify-center rounded-[var(--radius-control)] border border-[var(--line-strong)] bg-[var(--panel)] px-7 text-base font-semibold text-[var(--foreground)] transition hover:bg-[var(--surface-pressed)] sm:w-auto"
            >
              See how it works
            </a>
          </div>
        </div>
      </section>

      {/* ---- Live counter ---- */}
      <section className="border-b border-[var(--line)] bg-[var(--panel)]">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:py-20">
          <div className="flex items-center justify-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--brand)] opacity-60" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[var(--brand)]" />
            </span>
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
              Live platform metrics
            </span>
          </div>

          <div className="mt-10">
            <StatCounter
              hero
              value={stats?.polesInspected ?? null}
              label="Poles inspected &amp; proven"
              sublabel="Distinct assets with a submitted, photo-backed inspection"
            />
          </div>

          <div className="mx-auto mt-14 grid max-w-3xl grid-cols-1 gap-10 sm:grid-cols-3">
            <StatCounter
              value={stats?.inspectionsPerformed ?? null}
              label="Inspections performed"
            />
            <StatCounter value={stats?.assetsInRegister ?? null} label="Assets in the register" />
            <StatCounter value={stats?.defectsLogged ?? null} label="Defects identified" />
          </div>

          <p className="mt-12 text-center text-sm text-[var(--muted-2)]">
            Real numbers, straight from the field &mdash; aggregate counts only, refreshed
            continuously.
          </p>
        </div>
      </section>

      {/* ---- Mobile app ---- */}
      <section id="app" className="border-b border-[var(--line)] scroll-mt-16">
        <div className="mx-auto max-w-6xl px-5 py-20 sm:py-24">
          <div className="max-w-2xl">
            <p className="inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.18em] text-[var(--brand)]">
              <Smartphone size={16} /> In the field
            </p>
            <h2
              className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl"
              style={{ fontFamily: "var(--font-display)" }}
            >
              The whole survey, in your crew&rsquo;s pocket
            </h2>
            <p className="mt-4 text-lg text-[var(--foreground-soft)]">
              Capture-grade tooling built for where the network actually is &mdash; no base data,
              no signal, a clearance gauge twelve metres up a pole. The inspection <em>is</em> the
              asset record.
            </p>
          </div>

          {/* phone gallery */}
          <div className="mt-14 grid grid-cols-1 gap-x-6 gap-y-12 sm:grid-cols-3">
            <PhoneCard label="Inspect" caption="Map & inspect">
              <InspectionScreen />
            </PhoneCard>
            <PhoneCard label="Maintain" caption="Maintenance & repair">
              <MaintenanceScreen />
            </PhoneCard>
            <PhoneCard label="Sensor" caption="OCR smart-sensor">
              <OcrScreen />
            </PhoneCard>
          </div>

          {/* features */}
          <div className="mt-16 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {APP_FEATURES.map((feature) => {
              const Icon = feature.icon;
              return (
                <div
                  key={feature.title}
                  className="rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[var(--shadow-soft)]"
                >
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-[var(--radius-control)] bg-[var(--brand-soft)] text-[var(--brand)]">
                    <Icon size={20} />
                  </span>
                  <p className="mt-4 font-semibold text-[var(--foreground)]">{feature.title}</p>
                  <p className="mt-1 text-sm leading-relaxed text-[var(--muted)]">{feature.body}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ---- Philosophy / pillars ---- */}
      <section id="philosophy" className="border-b border-[var(--line)] scroll-mt-16">
        <div className="mx-auto max-w-6xl px-5 py-20 sm:py-24">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--brand)]">
              The soul test
            </p>
            <h2
              className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl"
              style={{ fontFamily: "var(--font-display)" }}
            >
              Four words every feature has to earn
            </h2>
            <p className="mt-4 text-lg text-[var(--foreground-soft)]">
              If a capability doesn&rsquo;t make the network more legible, navigable, provable or
              perpetual, it&rsquo;s seasoning &mdash; not ASCURE.
            </p>
          </div>

          <div className="mt-12 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {PILLARS.map((pillar) => {
              const Icon = pillar.icon;
              return (
                <div
                  key={pillar.title}
                  className="rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--panel)] p-6 shadow-[var(--shadow-soft)] transition hover:shadow-[var(--shadow-card)]"
                >
                  <span className="inline-flex h-11 w-11 items-center justify-center rounded-[var(--radius-control)] bg-[var(--brand-soft)] text-[var(--brand)]">
                    <Icon size={22} />
                  </span>
                  <h3
                    className="mt-5 text-xl font-bold"
                    style={{ fontFamily: "var(--font-display)" }}
                  >
                    {pillar.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">{pillar.body}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ---- Methodology / lifecycle ---- */}
      <section id="methodology" className="border-b border-[var(--line)] bg-[var(--panel-muted)] scroll-mt-16">
        <div className="mx-auto max-w-6xl px-5 py-20 sm:py-24">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--brand)]">
              One lifecycle, per survey cycle
            </p>
            <h2
              className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl"
              style={{ fontFamily: "var(--font-display)" }}
            >
              From walking the feeder to a frozen report
            </h2>
            <p className="mt-4 text-lg text-[var(--foreground-soft)]">
              A single, honest state machine replaces the old governance ceremony. The inspector
              owns the defect call; the data controller owns data quality and the documents. Stage
              labels are configurable &mdash; the ones below come from a live deployment.
            </p>
          </div>

          <ol className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-5">
            {LIFECYCLE.map((step, index) => (
              <li
                key={step.stage}
                className="relative rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[var(--shadow-soft)]"
              >
                <div className="flex items-center justify-between">
                  <span
                    className="text-xs font-bold text-[var(--brand)]"
                    style={{ fontFamily: "var(--font-mono)" }}
                  >
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  {step.optional ? (
                    <span className="rounded-[var(--radius-pill)] bg-[var(--surface-pressed)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-2)]">
                      if needed
                    </span>
                  ) : null}
                </div>
                <h3
                  className="mt-3 text-sm font-bold leading-tight"
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  {step.stage}
                </h3>
                <p
                  className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-2)]"
                  style={{ fontFamily: "var(--font-mono)" }}
                >
                  {step.local}
                </p>
                <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">{step.note}</p>
              </li>
            ))}
          </ol>

          <div className="mt-8 flex flex-col gap-4 rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--panel)] p-6 sm:flex-row sm:items-center sm:gap-8">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-[var(--radius-control)] bg-[var(--brand-soft)] text-[var(--brand)]">
                <Layers size={20} />
              </span>
              <p className="text-sm text-[var(--foreground-soft)]">
                <span className="font-semibold text-[var(--foreground)]">Year 1</span> lays the
                baseline &mdash; tag, topology and first condition.
              </p>
            </div>
            <div className="hidden h-8 w-px bg-[var(--line)] sm:block" />
            <div className="flex items-center gap-3">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-[var(--radius-control)] bg-[var(--brand-soft)] text-[var(--brand)]">
                <Activity size={20} />
              </span>
              <p className="text-sm text-[var(--foreground-soft)]">
                <span className="font-semibold text-[var(--foreground)]">Year N</span> re-surveys
                it and records the delta &mdash; what moved, what&rsquo;s new, what changed source.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ---- Technology ---- */}
      <section id="technology" className="border-b border-[var(--line)] scroll-mt-16">
        <div className="mx-auto max-w-6xl px-5 py-20 sm:py-24">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--brand)]">
              Built for the field
            </p>
            <h2
              className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl"
              style={{ fontFamily: "var(--font-display)" }}
            >
              The technology under the register
            </h2>
            <p className="mt-4 text-lg text-[var(--foreground-soft)]">
              No signal, faded labels, a clearance gauge on a pole twelve metres up &mdash; the
              hard parts of the field are exactly what ASCURE is engineered around.
            </p>
          </div>

          <div className="mt-12 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {TECH.map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.title}
                  className="rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--panel)] p-6 shadow-[var(--shadow-soft)] transition hover:shadow-[var(--shadow-card)]"
                >
                  <span className="inline-flex h-11 w-11 items-center justify-center rounded-[var(--radius-control)] bg-[var(--brand-soft)] text-[var(--brand)]">
                    <Icon size={22} />
                  </span>
                  <h3 className="mt-5 text-lg font-bold" style={{ fontFamily: "var(--font-display)" }}>
                    {item.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">{item.body}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ---- Closing CTA ---- */}
      <section className="border-b border-[var(--line)] bg-[var(--panel)]">
        <div className="mx-auto max-w-6xl px-5 py-20 text-center sm:py-24">
          <h2
            className="mx-auto max-w-3xl text-3xl font-bold tracking-tight sm:text-4xl"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Proven in the field. Built to scale to any utility.
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-[var(--foreground-soft)]">
            The model that earns its keep on a national low-voltage network &mdash; the asset
            register, the network graph, the survey cycle &mdash; is multi-tenant from the ground
            up, ready for the next distribution operator.
          </p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-sm text-[var(--muted)]">
            <span className="inline-flex items-center gap-2">
              <ShieldCheck size={16} className="text-[var(--brand)]" /> Multi-tenant by design
            </span>
            <span className="inline-flex items-center gap-2">
              <Compass size={16} className="text-[var(--brand)]" /> Region &amp; operating-area geography
            </span>
            <span className="inline-flex items-center gap-2">
              <CheckCircle2 size={16} className="text-[var(--brand)]" /> Capability-based access
            </span>
          </div>
          <div className="mt-9">
            <Link
              href="/login"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-[var(--radius-control)] bg-[var(--brand)] px-8 text-base font-semibold text-[var(--on-brand)] shadow-[var(--shadow-soft)] transition hover:bg-[var(--brand-strong)]"
            >
              Sign in to the console
              <ArrowRight size={18} />
            </Link>
          </div>
        </div>
      </section>

      {/* ---- Footer ---- */}
      <footer className="bg-[var(--background)]">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-5 py-10 sm:flex-row">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/monogram.png"
              alt="ASCURE"
              width={28}
              height={28}
              className="h-7 w-7 rounded-md"
            />
            <span className="text-sm font-semibold" style={{ fontFamily: "var(--font-display)" }}>
              ASCURE
            </span>
            <span className="text-sm text-[var(--muted-2)]">Asset Inspection Platform</span>
          </div>
          <p className="text-sm text-[var(--muted-2)]">
            Walk the feeder. Name it. Map it. Prove it.
          </p>
        </div>
      </footer>
    </div>
  );
}

import type { Metadata } from "next";
import { LandingPage } from "@/components/landing-page";

export const metadata: Metadata = {
  title: "ASCURE — Walk the feeder. Name it. Map it. Prove it.",
  description:
    "ASCURE is the authoritative register of a utility's low-voltage distribution network — every pole named, mapped on a real graph, and proven with a timestamped photo, re-surveyed on a fixed cycle.",
};

export default function Home() {
  return <LandingPage />;
}

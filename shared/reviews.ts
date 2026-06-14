// Phase 3 — Review helpers shared between server and client.
// Pure functions and label maps. No I/O.

import type { ReviewGrade, TagCategory } from "./schema";

export const REVIEW_GRADE_LABELS: Record<ReviewGrade, string> = {
  A: "A — Excellent execution",
  B: "B — Solid, minor issues",
  C: "C — Mixed, room to improve",
  D: "D — Poor execution",
  F: "F — Broke the plan",
};

export const TAG_CATEGORY_LABELS: Record<TagCategory, string> = {
  setup: "Setup",
  market: "Market Condition",
  mistake: "Mistake",
  psychology: "Psychology",
  other: "Other",
};

// Maps a tag category to a Chip tone used by client UI. Server doesn't render,
// but the constant lives here so both sides agree if needed.
export const TAG_CATEGORY_TONE: Record<TagCategory, "blue" | "green" | "amber" | "red" | "gold" | "neutral"> = {
  setup: "blue",
  market: "gold",
  mistake: "red",
  psychology: "amber",
  other: "neutral",
};

export function isReviewGrade(v: unknown): v is ReviewGrade {
  return v === "A" || v === "B" || v === "C" || v === "D" || v === "F";
}

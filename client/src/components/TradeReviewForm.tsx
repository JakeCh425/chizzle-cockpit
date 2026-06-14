// Phase 3 — Post-trade review form.
// One review per trade plan (PUT upsert). Local state matches existing planner
// + execution-form patterns: no react-hook-form, shadcn primitives, inline errors.

import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { errMsg } from "@/lib/errors";
import {
  REVIEW_GRADES,
  EMOTIONAL_STATES,
  type ReviewGrade,
  type TradeReview,
} from "@shared/schema";
import { REVIEW_GRADE_LABELS } from "@shared/reviews";

interface Props {
  planId: string;
  existing: TradeReview | null;
  /** Disabled (with reason) when no executions yet. */
  disabledReason?: string;
}

const NULL_GRADE = "__none__";
const NULL_STATE = "__none__";

export function TradeReviewForm({ planId, existing, disabledReason }: Props) {
  const { toast } = useToast();

  // Form state — seed from existing review (or defaults).
  const [confidenceStr, setConfidenceStr] = useState(
    existing?.confidenceBefore == null ? "" : String(existing.confidenceBefore),
  );
  const [grade, setGrade] = useState<string>(existing?.gradeAfter ?? NULL_GRADE);
  const [followedPlan, setFollowedPlan] = useState<boolean>(!!existing?.followedPlan);
  const [emotionalState, setEmotionalState] = useState<string>(
    existing?.emotionalState && (EMOTIONAL_STATES as readonly string[]).includes(existing.emotionalState)
      ? existing.emotionalState
      : existing?.emotionalState
      ? "other"
      : NULL_STATE,
  );
  const [emotionalOther, setEmotionalOther] = useState<string>(
    existing?.emotionalState && !(EMOTIONAL_STATES as readonly string[]).includes(existing.emotionalState)
      ? existing.emotionalState
      : "",
  );
  const [lesson, setLesson] = useState<string>(existing?.lessonLearned ?? "");
  const [notes, setNotes] = useState<string>(existing?.reviewNotes ?? "");

  // If `existing` changes (after first save), reseed once.
  useEffect(() => {
    if (!existing) return;
    setConfidenceStr(existing.confidenceBefore == null ? "" : String(existing.confidenceBefore));
    setGrade(existing.gradeAfter ?? NULL_GRADE);
    setFollowedPlan(!!existing.followedPlan);
    if (existing.emotionalState && (EMOTIONAL_STATES as readonly string[]).includes(existing.emotionalState)) {
      setEmotionalState(existing.emotionalState);
      setEmotionalOther("");
    } else if (existing.emotionalState) {
      setEmotionalState("other");
      setEmotionalOther(existing.emotionalState);
    } else {
      setEmotionalState(NULL_STATE);
      setEmotionalOther("");
    }
    setLesson(existing.lessonLearned ?? "");
    setNotes(existing.reviewNotes ?? "");
  }, [existing?.id, existing?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveMutation = useMutation({
    mutationFn: async () => {
      const confidence = confidenceStr.trim() === "" ? null : Number(confidenceStr);
      const emotional =
        emotionalState === NULL_STATE ? null :
        emotionalState === "other" ? (emotionalOther.trim() || null) :
        emotionalState;
      const payload = {
        confidenceBefore: confidence,
        gradeAfter: grade === NULL_GRADE ? null : (grade as ReviewGrade),
        followedPlan,
        emotionalState: emotional,
        lessonLearned: lesson,
        reviewNotes: notes,
      };
      const res = await apiRequest("PUT", `/api/trade-plans/${planId}/review`, payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trade-plans", planId, "review"] });
      toast({ title: existing ? "Review updated" : "Review saved" });
    },
    onError: (e: any) => toast({ title: "Could not save review", description: errMsg(e), variant: "destructive" }),
  });

  // Inline validation — confidence must be 1–10 integer if provided.
  const confidenceNum = confidenceStr.trim() === "" ? null : Number(confidenceStr);
  const confidenceInvalid =
    confidenceNum !== null && (!Number.isInteger(confidenceNum) || confidenceNum < 1 || confidenceNum > 10);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (disabledReason) return;
    if (confidenceInvalid) return;
    saveMutation.mutate();
  }

  const isDisabled = !!disabledReason || saveMutation.isPending;

  return (
    <form onSubmit={onSubmit} className="space-y-3" data-testid="form-trade-review">
      {disabledReason && (
        <div className="text-[11px] text-signal-amber" data-testid="text-review-disabled-reason">
          {disabledReason}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* Confidence */}
        <div>
          <label className="text-[10px] uppercase tracking-wider text-slate-gray block mb-1">
            Confidence Before (1–10)
          </label>
          <Input
            type="number"
            min={1}
            max={10}
            step={1}
            value={confidenceStr}
            onChange={(e) => setConfidenceStr(e.target.value)}
            placeholder="—"
            disabled={isDisabled}
            data-testid="input-confidence-before"
          />
          {confidenceInvalid && (
            <div className="text-[10px] text-signal-red mt-0.5" data-testid="text-confidence-error">
              Must be an integer between 1 and 10.
            </div>
          )}
        </div>

        {/* Grade */}
        <div>
          <label className="text-[10px] uppercase tracking-wider text-slate-gray block mb-1">
            Grade After
          </label>
          <Select value={grade} onValueChange={setGrade} disabled={isDisabled}>
            <SelectTrigger data-testid="select-grade-after"><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NULL_GRADE}>—</SelectItem>
              {REVIEW_GRADES.map((g) => (
                <SelectItem key={g} value={g}>{REVIEW_GRADE_LABELS[g]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Followed plan */}
        <div>
          <label className="text-[10px] uppercase tracking-wider text-slate-gray block mb-1">
            Followed Plan?
          </label>
          <div className="flex gap-2" data-testid="group-followed-plan">
            <button
              type="button"
              onClick={() => setFollowedPlan(true)}
              disabled={isDisabled}
              data-testid="button-followed-plan-yes"
              className={`flex-1 px-2 py-1 text-[11px] font-display uppercase tracking-wider border rounded-sm transition-colors ${
                followedPlan
                  ? "text-signal-green border-signal-green/60 bg-signal-green/10"
                  : "text-slate-gray border-ink-line hover:text-soft-white"
              }`}
            >
              Yes
            </button>
            <button
              type="button"
              onClick={() => setFollowedPlan(false)}
              disabled={isDisabled}
              data-testid="button-followed-plan-no"
              className={`flex-1 px-2 py-1 text-[11px] font-display uppercase tracking-wider border rounded-sm transition-colors ${
                !followedPlan
                  ? "text-signal-red border-signal-red/60 bg-signal-red/10"
                  : "text-slate-gray border-ink-line hover:text-soft-white"
              }`}
            >
              No
            </button>
          </div>
        </div>
      </div>

      {/* Emotional state */}
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_2fr] gap-3">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-slate-gray block mb-1">
            Emotional State
          </label>
          <Select value={emotionalState} onValueChange={setEmotionalState} disabled={isDisabled}>
            <SelectTrigger data-testid="select-emotional-state"><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NULL_STATE}>—</SelectItem>
              {EMOTIONAL_STATES.map((s) => (
                <SelectItem key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {emotionalState === "other" && (
          <div>
            <label className="text-[10px] uppercase tracking-wider text-slate-gray block mb-1">
              Describe
            </label>
            <Input
              value={emotionalOther}
              onChange={(e) => setEmotionalOther(e.target.value)}
              placeholder="e.g. anxious"
              maxLength={60}
              disabled={isDisabled}
              data-testid="input-emotional-state-other"
            />
          </div>
        )}
      </div>

      {/* Lesson learned */}
      <div>
        <label className="text-[10px] uppercase tracking-wider text-slate-gray block mb-1">
          Lesson Learned
        </label>
        <Textarea
          value={lesson}
          onChange={(e) => setLesson(e.target.value)}
          placeholder="One sentence on the biggest takeaway from this trade."
          rows={2}
          maxLength={4000}
          disabled={isDisabled}
          data-testid="textarea-lesson-learned"
        />
      </div>

      {/* Review notes */}
      <div>
        <label className="text-[10px] uppercase tracking-wider text-slate-gray block mb-1">
          Review Notes
        </label>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="What actually happened? What went right or wrong?"
          rows={4}
          maxLength={8000}
          disabled={isDisabled}
          data-testid="textarea-review-notes"
        />
      </div>

      <Button
        type="submit"
        disabled={isDisabled || confidenceInvalid}
        data-testid="button-save-review"
      >
        {saveMutation.isPending ? "Saving…" : existing ? "Update Review" : "Save Review"}
      </Button>
    </form>
  );
}

// Phase 3 — Tag picker for a trade review.
// Shows attached tags (clickable to detach) + a grouped list of remaining tags
// (clickable to attach). Inline "create new tag" form for quick adds.
// Disabled until a review exists.

import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Chip } from "@/components/Panel";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { errMsg } from "@/lib/errors";
import { TAG_CATEGORIES, type TagCategory, type TradeTag } from "@shared/schema";
import { TAG_CATEGORY_LABELS, TAG_CATEGORY_TONE } from "@shared/reviews";
import { X, Plus } from "lucide-react";

interface Props {
  planId: string;
  /** Whether a review row exists for this plan. Attach/detach only works after save. */
  reviewExists: boolean;
}

export function TagPicker({ planId, reviewExists }: Props) {
  const { toast } = useToast();

  const allTagsQ = useQuery<TradeTag[]>({ queryKey: ["/api/tags"] });
  const attachedQ = useQuery<TradeTag[]>({
    queryKey: ["/api/trade-plans", planId, "review", "tags"],
    enabled: !!planId,
  });

  const attachedIds = useMemo(() => new Set((attachedQ.data ?? []).map((t) => t.id)), [attachedQ.data]);

  const attachMutation = useMutation({
    mutationFn: async (tagId: string) => {
      const res = await apiRequest("POST", `/api/trade-plans/${planId}/review/tags/${tagId}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trade-plans", planId, "review", "tags"] });
    },
    onError: (e: any) => toast({ title: "Could not attach tag", description: errMsg(e), variant: "destructive" }),
  });

  const detachMutation = useMutation({
    mutationFn: async (tagId: string) => {
      const res = await apiRequest("DELETE", `/api/trade-plans/${planId}/review/tags/${tagId}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trade-plans", planId, "review", "tags"] });
    },
    onError: (e: any) => toast({ title: "Could not detach tag", description: errMsg(e), variant: "destructive" }),
  });

  // Inline create
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState<TagCategory>("setup");

  const createAndAttachMutation = useMutation({
    mutationFn: async (body: { name: string; category: TagCategory }) => {
      const res = await apiRequest("POST", "/api/tags", body);
      const created: TradeTag = await res.json();
      if (reviewExists) {
        await apiRequest("POST", `/api/trade-plans/${planId}/review/tags/${created.id}`);
      }
      return created;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tags"] });
      queryClient.invalidateQueries({ queryKey: ["/api/trade-plans", planId, "review", "tags"] });
      setNewName("");
      setCreating(false);
      toast({ title: reviewExists ? "Tag created & attached" : "Tag created" });
    },
    onError: (e: any) => toast({ title: "Could not create tag", description: errMsg(e), variant: "destructive" }),
  });

  function onCreate(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = newName.trim();
    if (!trimmed) return;
    createAndAttachMutation.mutate({ name: trimmed, category: newCategory });
  }

  const attached = attachedQ.data ?? [];
  const allTags = allTagsQ.data ?? [];

  // Group available (non-attached) tags by category
  const available: Record<TagCategory, TradeTag[]> = {
    setup: [], market: [], mistake: [], psychology: [], other: [],
  };
  for (const t of allTags) {
    if (!attachedIds.has(t.id)) {
      const c = t.category as TagCategory;
      if (available[c]) available[c].push(t);
    }
  }

  return (
    <div className="space-y-3" data-testid="block-tag-picker">
      {/* Attached tags */}
      <div>
        <div className="text-[10px] uppercase tracking-wider text-slate-gray mb-1">
          Attached Tags
        </div>
        {!reviewExists ? (
          <div className="text-[11px] text-slate-gray" data-testid="text-no-review-yet">
            Save the review first to attach tags.
          </div>
        ) : attachedQ.isLoading ? (
          <div className="text-[11px] text-slate-gray">Loading…</div>
        ) : attached.length === 0 ? (
          <div className="text-[11px] text-slate-gray" data-testid="text-no-attached-tags">
            No tags attached yet.
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5" data-testid="list-attached-tags">
            {attached.map((t) => (
              <span key={t.id} className="inline-flex items-center gap-1" data-testid={`attached-tag-${t.id}`}>
                <Chip tone={TAG_CATEGORY_TONE[t.category as TagCategory]}>{t.name}</Chip>
                <button
                  type="button"
                  onClick={() => detachMutation.mutate(t.id)}
                  disabled={detachMutation.isPending}
                  className="text-slate-gray hover:text-signal-red transition-colors"
                  data-testid={`button-detach-tag-${t.id}`}
                  aria-label={`Detach ${t.name}`}
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Available tags grouped */}
      {reviewExists && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-gray mb-1">
            Add From Library
          </div>
          {allTagsQ.isLoading ? (
            <div className="text-[11px] text-slate-gray">Loading…</div>
          ) : allTags.length === 0 ? (
            <div className="text-[11px] text-slate-gray" data-testid="text-tag-library-empty">
              No tags in the library yet. Create one below.
            </div>
          ) : (
            <div className="space-y-1.5" data-testid="list-available-tags">
              {TAG_CATEGORIES.map((c) =>
                available[c].length === 0 ? null : (
                  <div key={c}>
                    <div className="text-[9px] uppercase tracking-wider text-slate-gray/70 mb-0.5">
                      {TAG_CATEGORY_LABELS[c]}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {available[c].map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => attachMutation.mutate(t.id)}
                          disabled={attachMutation.isPending}
                          data-testid={`button-attach-tag-${t.id}`}
                          className="opacity-70 hover:opacity-100 transition-opacity"
                        >
                          <Chip tone={TAG_CATEGORY_TONE[c]}>+ {t.name}</Chip>
                        </button>
                      ))}
                    </div>
                  </div>
                ),
              )}
            </div>
          )}
        </div>
      )}

      {/* Inline create */}
      <div className="pt-2 border-t border-ink-line/60">
        {!creating ? (
          <button
            type="button"
            onClick={() => setCreating(true)}
            data-testid="button-show-create-tag"
            className="inline-flex items-center gap-1 text-[11px] text-neon-blue hover:underline"
          >
            <Plus className="w-3 h-3" /> Create new tag
          </button>
        ) : (
          <form onSubmit={onCreate} className="flex items-end gap-2 flex-wrap" data-testid="form-create-tag-inline">
            <div className="flex-1 min-w-[120px]">
              <label className="text-[9px] uppercase tracking-wider text-slate-gray block mb-0.5">Name</label>
              <Input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="breakout"
                maxLength={40}
                data-testid="input-inline-new-tag-name"
              />
            </div>
            <div className="min-w-[120px]">
              <label className="text-[9px] uppercase tracking-wider text-slate-gray block mb-0.5">Category</label>
              <Select value={newCategory} onValueChange={(v) => setNewCategory(v as TagCategory)}>
                <SelectTrigger data-testid="select-inline-new-tag-category"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TAG_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>{TAG_CATEGORY_LABELS[c]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              type="submit"
              disabled={!newName.trim() || createAndAttachMutation.isPending}
              data-testid="button-submit-inline-tag"
              className="text-[11px]"
            >
              {createAndAttachMutation.isPending ? "Saving…" : "Add"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => { setCreating(false); setNewName(""); }}
              data-testid="button-cancel-inline-tag"
              className="text-[11px]"
            >
              Cancel
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}

// Phase 3 — Small inline tag library manager.
// Lists all tags grouped by category, supports create + delete.
// Used standalone on TagsPage and embedded inside TagPicker.

import { useState } from "react";
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
import { X } from "lucide-react";

interface Props {
  /** When true, render a compact variant for embedding inside TagPicker. */
  compact?: boolean;
}

export function TagManager({ compact = false }: Props) {
  const { toast } = useToast();
  const tagsQ = useQuery<TradeTag[]>({ queryKey: ["/api/tags"] });

  const [name, setName] = useState("");
  const [category, setCategory] = useState<TagCategory>("setup");

  const createMutation = useMutation({
    mutationFn: async (body: { name: string; category: TagCategory }) => {
      const res = await apiRequest("POST", "/api/tags", body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tags"] });
      setName("");
      toast({ title: "Tag created" });
    },
    onError: (e: any) => toast({ title: "Could not create tag", description: errMsg(e), variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/tags/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tags"] });
      // Any open review-tag lists need to refetch (the cascade just removed rows).
      queryClient.invalidateQueries({ queryKey: ["/api/trade-plans"] });
      toast({ title: "Tag deleted" });
    },
    onError: (e: any) => toast({ title: "Could not delete tag", description: errMsg(e), variant: "destructive" }),
  });

  function onCreate(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    createMutation.mutate({ name: trimmed, category });
  }

  const tags = tagsQ.data ?? [];
  const grouped: Record<TagCategory, TradeTag[]> = {
    setup: [], market: [], mistake: [], psychology: [], other: [],
  };
  for (const t of tags) {
    const c = (t.category as TagCategory);
    if (grouped[c]) grouped[c].push(t);
  }

  return (
    <div className={compact ? "space-y-3" : "space-y-4"} data-testid="block-tag-manager">
      <form onSubmit={onCreate} className="flex items-end gap-2 flex-wrap">
        <div className="flex-1 min-w-[160px]">
          <label className="text-[10px] uppercase tracking-wider text-slate-gray block mb-1">New Tag</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. breakout"
            maxLength={40}
            data-testid="input-new-tag-name"
          />
        </div>
        <div className="min-w-[140px]">
          <label className="text-[10px] uppercase tracking-wider text-slate-gray block mb-1">Category</label>
          <Select value={category} onValueChange={(v) => setCategory(v as TagCategory)}>
            <SelectTrigger data-testid="select-new-tag-category"><SelectValue /></SelectTrigger>
            <SelectContent>
              {TAG_CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>{TAG_CATEGORY_LABELS[c]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          type="submit"
          disabled={!name.trim() || createMutation.isPending}
          data-testid="button-create-tag"
          className="text-[11px]"
        >
          {createMutation.isPending ? "Saving…" : "Add Tag"}
        </Button>
      </form>

      {tagsQ.isLoading ? (
        <div className="text-[12px] text-slate-gray">Loading tags…</div>
      ) : tagsQ.error ? (
        <div className="text-[12px] text-signal-red" data-testid="text-tags-error">Could not load tags.</div>
      ) : tags.length === 0 ? (
        <div className="text-[12px] text-slate-gray" data-testid="text-empty-tags">No tags yet. Create one above.</div>
      ) : (
        <div className="space-y-2" data-testid="list-tags-by-category">
          {TAG_CATEGORIES.map((c) =>
            grouped[c].length === 0 ? null : (
              <div key={c}>
                <div className="text-[10px] uppercase tracking-wider text-slate-gray mb-1">
                  {TAG_CATEGORY_LABELS[c]}
                </div>
                <div className="flex flex-wrap gap-1.5" data-testid={`group-tags-${c}`}>
                  {grouped[c].map((t) => (
                    <span
                      key={t.id}
                      className="inline-flex items-center gap-1"
                      data-testid={`tag-row-${t.id}`}
                    >
                      <Chip tone={TAG_CATEGORY_TONE[c]}>{t.name}</Chip>
                      <button
                        type="button"
                        onClick={() => {
                          if (window.confirm(`Delete tag "${t.name}"? It will be removed from all reviews.`)) {
                            deleteMutation.mutate(t.id);
                          }
                        }}
                        disabled={deleteMutation.isPending}
                        className="text-slate-gray hover:text-signal-red transition-colors"
                        data-testid={`button-delete-tag-${t.id}`}
                        aria-label={`Delete ${t.name}`}
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}

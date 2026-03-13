import type { ContentTag } from "./tags.js";

export type PresetId = "minimal" | "standard" | "full" | "custom";

export interface ContentPreset {
  id: PresetId;
  name: string;
  description: string;
  includeTags: ContentTag[];
  excludeTags: ContentTag[];
}

export const PRESETS: ContentPreset[] = [
  {
    id: "minimal",
    name: "Minimal",
    description: "Core agents and workflows only",
    includeTags: ["core"],
    excludeTags: [],
  },
  {
    id: "standard",
    name: "Standard (recommended)",
    description: "Full development lifecycle without niche audits",
    includeTags: ["core", "planning", "implementation", "review", "devops", "maintenance"],
    excludeTags: ["board", "a11y", "performance", "customize"],
  },
  {
    id: "full",
    name: "Full",
    description: "Everything including board management and all audits",
    includeTags: [], // empty = include all
    excludeTags: [],
  },
  {
    id: "custom",
    name: "Custom",
    description: "Choose exactly what you need",
    includeTags: [],
    excludeTags: [],
  },
];

export function getPreset(id: PresetId): ContentPreset {
  const preset = PRESETS.find((p) => p.id === id);
  if (!preset) throw new Error(`Unknown preset: ${id}`);
  return preset;
}

import type { ClipVisualEffect } from "../types";

export function toggleVisualEffect(
  effects: ClipVisualEffect[] | null | undefined,
  kind: string,
): ClipVisualEffect[] | null {
  const current = effects ?? [];
  const active = current.some((effect) => effect.kind === kind);
  const next = active
    ? current.filter((effect) => effect.kind !== kind)
    : [...current, { kind, intensity: 50 }];
  return next.length > 0 ? next : null;
}

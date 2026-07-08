import type { TransitionConfig } from "../types";

export function transitionName(transition: string | TransitionConfig | null | undefined): string | null {
  if (!transition) return null;
  return typeof transition === "string" ? transition : transition.name;
}

export function transitionDuration(
  transition: string | TransitionConfig | null | undefined,
  fallback: number,
): number {
  if (!transition || typeof transition === "string") return fallback;
  return transition.duration || fallback;
}

export function makeTransition(name: string, duration: number): TransitionConfig | null {
  return name === "none" ? null : { name, duration };
}

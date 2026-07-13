# AI-first subtitle segmentation

## Goal

When DeepSeek is available, semantic structure should determine subtitle boundaries. Deterministic layout remains responsible for text fidelity, timestamps, safe width, maximum duration, protected phrases, and offline fallback.

## Chosen approach

Use a two-tier boundary model:

1. AI receives indexed words together with word timing, pauses, project context, aspect ratio, subtitle mode, and layout/readability limits.
2. Responses with confidence >= 0.82 produce strong semantic boundaries. Responses >= 0.55 remain soft preferences.
3. Strong boundaries partition the transcript before dynamic programming. A semantic group is preserved intact when it satisfies hard display constraints; an oversized group is subdivided locally rather than allowing global layout scoring to discard its meaning.
4. Tiny AI groups are rejected so an unreliable boundary cannot create flashing one-word subtitles.
5. Requests use overlapping context windows with non-overlapping ownership ranges, preventing batch edges from losing nearby semantics while avoiding duplicate output boundaries.
6. Missing keys, failed chunks, low-confidence results, or impossible AI groups fall back to the existing deterministic optimizer.

This is preferred over merely increasing the AI score because a larger score is still globally overridable and difficult to reason about. It is preferred over letting AI emit final timestamps/text because that would weaken text and timing guarantees.

## Verification

Regression tests must prove that a strong but non-rule-optimal AI boundary is preserved, impossible semantic groups are repaired, low-confidence advice remains soft/ignored, overlap windows map local indices correctly, and total AI failure remains deterministic. Existing TypeScript, Rust, and production build checks remain required.

#![allow(dead_code)]

use std::cmp::Ordering;
use std::collections::HashMap;

use crate::models::TrackKind;
use crate::render_graph::RenderGraph;

#[derive(Debug, Clone, PartialEq)]
pub struct RenderPlan {
    pub duration: f64,
    pub visual_layer_indices: Vec<usize>,
    pub units: Vec<RenderUnit>,
    pub single_pass: Option<SinglePassPlan>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum RenderUnit {
    Normal {
        start: f64,
        end: f64,
        layer_indices: Vec<usize>,
    },
    Transition {
        start: f64,
        boundary: f64,
        end: f64,
        previous_layer_indices: Vec<usize>,
        next_layer_indices: Vec<usize>,
        transition: PlannedTransition,
    },
}

#[derive(Debug, Clone, PartialEq)]
pub struct PlannedTransition {
    pub name: String,
    pub source_layer_index: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SinglePassPlan {
    pub base_layer_indices: Vec<usize>,
    pub overlay_layer_indices: Vec<usize>,
}

pub fn clips_for_indices<'a>(
    graph: &'a RenderGraph,
    layer_indices: &[usize],
) -> Vec<&'a crate::models::Clip> {
    layer_indices
        .iter()
        .filter_map(|index| graph.layers.get(*index))
        .map(|layer| &layer.clip)
        .collect()
}

pub fn compile_render_plan(graph: &RenderGraph, fallback_transition_duration: f64) -> RenderPlan {
    let visual_layer_indices = graph
        .layers
        .iter()
        .enumerate()
        .filter(|(_, layer)| {
            matches!(layer.track_kind, TrackKind::Video | TrackKind::Image) && layer.media.is_some()
        })
        .map(|(index, _)| index)
        .collect::<Vec<_>>();
    let mut boundaries = vec![0.0, graph.duration];
    for index in &visual_layer_indices {
        let clip = &graph.layers[*index].clip;
        boundaries.push(clip.start_on_track.clamp(0.0, graph.duration));
        boundaries.push((clip.start_on_track + clip.duration.max(0.0)).clamp(0.0, graph.duration));
    }
    boundaries.sort_by(|left, right| partial_cmp(*left, *right));
    boundaries.dedup_by(|left, right| (*left - *right).abs() < 0.05);
    let transitions =
        transition_candidates(graph, &visual_layer_indices, fallback_transition_duration);
    let mut units = Vec::new();
    let mut cursor = 0.0;
    for candidate in transitions {
        let start = (candidate.boundary - candidate.duration).max(cursor);
        units.extend(normal_units_between(
            graph,
            &visual_layer_indices,
            &boundaries,
            cursor,
            start,
        ));
        if candidate.boundary - start > 0.05 {
            let effective_duration = candidate.boundary - start;
            units.push(RenderUnit::Transition {
                start,
                boundary: candidate.boundary,
                end: candidate.boundary,
                previous_layer_indices: active_layer_indices(
                    graph,
                    &visual_layer_indices,
                    start,
                    candidate.boundary,
                ),
                next_layer_indices: active_layer_indices(
                    graph,
                    &visual_layer_indices,
                    candidate.boundary,
                    (candidate.boundary + effective_duration).min(graph.duration),
                ),
                transition: PlannedTransition {
                    name: candidate.name,
                    source_layer_index: candidate.source_layer_index,
                },
            });
        }
        cursor = candidate.boundary;
    }
    units.extend(normal_units_between(
        graph,
        &visual_layer_indices,
        &boundaries,
        cursor,
        graph.duration,
    ));
    RenderPlan {
        duration: graph.duration,
        single_pass: compile_single_pass_plan(graph, &visual_layer_indices),
        visual_layer_indices,
        units,
    }
}

fn compile_single_pass_plan(
    graph: &RenderGraph,
    visual_layer_indices: &[usize],
) -> Option<SinglePassPlan> {
    let first_index = *visual_layer_indices.first()?;
    let base_track_id = graph.layers[first_index].clip.track_id.as_str();
    let mut base_layer_indices = visual_layer_indices
        .iter()
        .copied()
        .filter(|index| graph.layers[*index].clip.track_id == base_track_id)
        .collect::<Vec<_>>();
    base_layer_indices.sort_by(|left, right| {
        let left_layer = &graph.layers[*left];
        let right_layer = &graph.layers[*right];
        partial_cmp(
            left_layer.clip.start_on_track,
            right_layer.clip.start_on_track,
        )
        .then_with(|| left_layer.id.cmp(&right_layer.id))
    });
    let mut cursor = 0.0;
    for index in &base_layer_indices {
        let layer = &graph.layers[*index];
        if !single_pass_common_supported(layer)
            || layer.clip.mask.is_some()
            || layer.clip.keyframes.is_some()
            || !clip_transform_is_identity(layer.clip.transform.as_ref())
            || (layer.clip.start_on_track - cursor).abs() > 0.03
        {
            return None;
        }
        cursor = layer.clip.start_on_track + layer.clip.duration;
    }
    if cursor + 0.03 < graph.duration {
        return None;
    }
    let overlay_layer_indices = visual_layer_indices
        .iter()
        .copied()
        .filter(|index| graph.layers[*index].clip.track_id != base_track_id)
        .collect::<Vec<_>>();
    for index in &overlay_layer_indices {
        let layer = &graph.layers[*index];
        if !single_pass_common_supported(layer)
            || layer.clip.keyframes.is_some()
            || layer.clip.mask.is_some()
            || !overlay_transform_supported(layer.clip.transform.as_ref())
        {
            return None;
        }
    }
    Some(SinglePassPlan {
        base_layer_indices,
        overlay_layer_indices,
    })
}

fn single_pass_common_supported(layer: &crate::render_graph::RenderLayer) -> bool {
    let clip = &layer.clip;
    if has_transition(clip.transition_in.as_ref())
        || has_transition(clip.transition_out.as_ref())
        || clip.speed <= 0.0
        || clip.reverse
        || clip
            .speed_curve
            .as_ref()
            .is_some_and(|curve| !curve.is_empty())
    {
        return false;
    }
    layer
        .media
        .as_ref()
        .is_some_and(|source| source.kind == "video" || source.kind == "image")
}

fn has_transition(transition: Option<&crate::models::ClipTransition>) -> bool {
    transition.is_some_and(|value| value.name() != "none")
}

fn clip_transform_is_identity(transform: Option<&crate::models::ClipTransform>) -> bool {
    let Some(transform) = transform else {
        return true;
    };
    (transform.x - 50.0).abs() < 0.01
        && (transform.y - 50.0).abs() < 0.01
        && (transform.scale - 100.0).abs() < 0.01
        && (transform.opacity - 100.0).abs() < 0.01
        && transform.corner_radius == 0
        && transform.mix == "normal"
        && transform.rotation.abs() < 0.01
}

fn overlay_transform_supported(transform: Option<&crate::models::ClipTransform>) -> bool {
    let Some(transform) = transform else {
        return true;
    };
    transform.corner_radius == 0 && transform.mix == "normal" && transform.rotation.abs() < 0.01
}

struct TransitionCandidate {
    boundary: f64,
    duration: f64,
    name: String,
    source_layer_index: usize,
    track_order: u32,
}

fn transition_candidates(
    graph: &RenderGraph,
    visual_layer_indices: &[usize],
    fallback_transition_duration: f64,
) -> Vec<TransitionCandidate> {
    let mut tracks: HashMap<&str, Vec<usize>> = HashMap::new();
    for index in visual_layer_indices {
        tracks
            .entry(graph.layers[*index].clip.track_id.as_str())
            .or_default()
            .push(*index);
    }
    let mut candidates = Vec::new();
    for indices in tracks.values_mut() {
        indices.sort_by(|left, right| {
            let left_layer = &graph.layers[*left];
            let right_layer = &graph.layers[*right];
            partial_cmp(
                left_layer.clip.start_on_track,
                right_layer.clip.start_on_track,
            )
            .then_with(|| left_layer.id.cmp(&right_layer.id))
        });
        for pair in indices.windows(2) {
            let previous_index = pair[0];
            let next_index = pair[1];
            let previous = &graph.layers[previous_index];
            let next = &graph.layers[next_index];
            let boundary = next.clip.start_on_track;
            if (previous.clip.start_on_track + previous.clip.duration - boundary).abs() >= 0.05
                || boundary <= 0.05
            {
                continue;
            }
            let transition = next
                .clip
                .transition_in
                .as_ref()
                .filter(|value| value.name() != "none")
                .map(|value| (value, next_index))
                .or_else(|| {
                    previous
                        .clip
                        .transition_out
                        .as_ref()
                        .filter(|value| value.name() != "none")
                        .map(|value| (value, previous_index))
                });
            let Some((transition, source_layer_index)) = transition else {
                continue;
            };
            let duration = transition
                .duration(fallback_transition_duration)
                .max(0.1)
                .min(previous.clip.duration)
                .min(next.clip.duration)
                .min(boundary)
                .max(0.0);
            if duration <= 0.05 {
                continue;
            }
            candidates.push(TransitionCandidate {
                boundary,
                duration,
                name: transition.name().to_string(),
                source_layer_index,
                track_order: next.track_order,
            });
        }
    }
    candidates.sort_by(|left, right| {
        partial_cmp(left.boundary, right.boundary)
            .then_with(|| left.track_order.cmp(&right.track_order))
            .then_with(|| {
                graph.layers[left.source_layer_index]
                    .id
                    .cmp(&graph.layers[right.source_layer_index].id)
            })
    });
    candidates.dedup_by(|left, right| (left.boundary - right.boundary).abs() < 0.05);
    candidates
}

fn normal_units_between(
    graph: &RenderGraph,
    visual_layer_indices: &[usize],
    boundaries: &[f64],
    start: f64,
    end: f64,
) -> Vec<RenderUnit> {
    if end - start <= 0.05 {
        return Vec::new();
    }
    let mut local_boundaries = vec![start];
    local_boundaries.extend(
        boundaries
            .iter()
            .copied()
            .filter(|boundary| *boundary > start + 0.05 && *boundary < end - 0.05),
    );
    local_boundaries.push(end);
    local_boundaries
        .windows(2)
        .filter_map(|window| {
            let unit_start = window[0];
            let unit_end = window[1];
            (unit_end - unit_start > 0.05).then(|| RenderUnit::Normal {
                start: unit_start,
                end: unit_end,
                layer_indices: active_layer_indices(
                    graph,
                    visual_layer_indices,
                    unit_start,
                    unit_end,
                ),
            })
        })
        .collect()
}

fn active_layer_indices(
    graph: &RenderGraph,
    visual_layer_indices: &[usize],
    start: f64,
    end: f64,
) -> Vec<usize> {
    visual_layer_indices
        .iter()
        .copied()
        .filter(|index| {
            let clip = &graph.layers[*index].clip;
            clip.start_on_track < end - 0.01 && clip.start_on_track + clip.duration > start + 0.01
        })
        .collect()
}

fn partial_cmp(left: f64, right: f64) -> Ordering {
    left.partial_cmp(&right).unwrap_or(Ordering::Equal)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{Clip, Project};
    use crate::render_graph::compile_render_graph;
    use serde::Deserialize;
    use serde_json::{json, Value};

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct GoldenFixture {
        project: Project,
        plan_expected: Value,
    }

    fn normalize_unit(graph: &RenderGraph, unit: &RenderUnit) -> Value {
        match unit {
            RenderUnit::Normal {
                start,
                end,
                layer_indices,
            } => json!({
                "kind": "normal",
                "start": start,
                "end": end,
                "layerIds": layer_indices
                    .iter()
                    .map(|index| graph.layers[*index].id.as_str())
                    .collect::<Vec<_>>(),
            }),
            RenderUnit::Transition { .. } => json!({ "kind": "transition" }),
        }
    }

    fn project_with_visual_tracks(track_orders: &[(&str, u32)], clips: Vec<Value>) -> Project {
        let mut fixture: GoldenFixture = serde_json::from_str(include_str!(
            "../../tests/fixtures/render-graph-golden.json"
        ))
        .expect("golden fixture must deserialize");
        fixture.project.tracks = track_orders
            .iter()
            .map(|(id, order)| {
                serde_json::from_value(json!({
                    "id": id,
                    "kind": "video",
                    "name": id,
                    "order": order,
                    "muted": false,
                    "locked": false,
                    "hidden": false
                }))
                .expect("track must deserialize")
            })
            .collect();
        fixture.project.clips = clips
            .into_iter()
            .map(|value| serde_json::from_value::<Clip>(value).expect("clip must deserialize"))
            .collect();
        fixture.project.media.truncate(1);
        fixture.project
    }

    fn visual_clip(id: &str, track_id: &str, start: f64, duration: f64) -> Value {
        json!({
            "id": id,
            "trackId": track_id,
            "sourceId": "video",
            "startOnTrack": start,
            "duration": duration,
            "sourceIn": 0.0,
            "sourceOut": duration,
            "speed": 1.0,
            "volume": 1.0,
            "brightness": 0.0,
            "contrast": 0.0,
            "saturation": 0.0
        })
    }

    fn total_unit_duration(units: &[RenderUnit]) -> f64 {
        units
            .iter()
            .map(|unit| match unit {
                RenderUnit::Normal { start, end, .. }
                | RenderUnit::Transition { start, end, .. } => end - start,
            })
            .sum()
    }

    #[test]
    fn render_plan_matches_shared_golden_fixture() {
        let fixture: GoldenFixture = serde_json::from_str(include_str!(
            "../../tests/fixtures/render-graph-golden.json"
        ))
        .expect("golden fixture must deserialize");
        let graph = compile_render_graph(&fixture.project);
        let plan = compile_render_plan(&graph, 0.5);
        let normalized = json!({
            "duration": plan.duration,
            "visualIds": plan
                .visual_layer_indices
                .iter()
                .map(|index| graph.layers[*index].id.as_str())
                .collect::<Vec<_>>(),
            "units": plan
                .units
                .iter()
                .map(|unit| normalize_unit(&graph, unit))
                .collect::<Vec<_>>(),
        });

        assert_eq!(normalized, fixture.plan_expected);
    }

    #[test]
    fn transition_in_config_compiles_a_transition_unit() {
        let a = visual_clip("a", "base", 0.0, 2.0);
        let mut b = visual_clip("b", "base", 2.0, 2.0);
        b["transitionIn"] = json!({ "name": "fade", "duration": 0.5 });
        let project = project_with_visual_tracks(&[("base", 10)], vec![a, b]);
        let graph = compile_render_graph(&project);

        let plan = compile_render_plan(&graph, 0.75);

        assert_eq!(plan.units.len(), 3);
        assert!(matches!(
            &plan.units[1],
            RenderUnit::Transition {
                start,
                boundary,
                end,
                transition,
                ..
            } if (*start - 1.5).abs() < 0.001
                && (*boundary - 2.0).abs() < 0.001
                && (*end - 2.0).abs() < 0.001
                && transition.name == "fade"
        ));
    }

    #[test]
    fn transition_in_legacy_uses_fallback_duration() {
        let a = visual_clip("a", "base", 0.0, 2.0);
        let mut b = visual_clip("b", "base", 2.0, 2.0);
        b["transitionIn"] = json!("wipeleft");
        let project = project_with_visual_tracks(&[("base", 10)], vec![a, b]);
        let graph = compile_render_graph(&project);

        let plan = compile_render_plan(&graph, 0.75);

        assert!(matches!(
            &plan.units[1],
            RenderUnit::Transition { start, transition, .. }
                if (*start - 1.25).abs() < 0.001 && transition.name == "wipeleft"
        ));
    }

    #[test]
    fn transition_out_compiles_when_incoming_has_none() {
        let mut a = visual_clip("a", "base", 0.0, 2.0);
        a["transitionOut"] = json!({ "name": "dissolve", "duration": 0.4 });
        let b = visual_clip("b", "base", 2.0, 2.0);
        let project = project_with_visual_tracks(&[("base", 10)], vec![a, b]);
        let graph = compile_render_graph(&project);

        let plan = compile_render_plan(&graph, 0.75);

        assert!(matches!(
            &plan.units[1],
            RenderUnit::Transition { start, transition, .. }
                if (*start - 1.6).abs() < 0.001 && transition.name == "dissolve"
        ));
    }

    #[test]
    fn transition_multiple_boundaries_preserve_total_duration() {
        let a = visual_clip("a", "base", 0.0, 2.0);
        let mut b = visual_clip("b", "base", 2.0, 2.0);
        let mut c = visual_clip("c", "base", 4.0, 2.0);
        b["transitionIn"] = json!({ "name": "fade", "duration": 0.5 });
        c["transitionIn"] = json!({ "name": "wipeleft", "duration": 0.5 });
        let project = project_with_visual_tracks(&[("base", 10)], vec![a, b, c]);
        let graph = compile_render_graph(&project);

        let plan = compile_render_plan(&graph, 0.5);

        assert_eq!(plan.units.len(), 5);
        assert!((total_unit_duration(&plan.units) - 6.0).abs() < 0.001);
    }

    #[test]
    fn transition_same_boundary_prefers_topmost_track() {
        let base_a = visual_clip("base-a", "base", 0.0, 2.0);
        let mut base_b = visual_clip("base-b", "base", 2.0, 2.0);
        base_b["transitionIn"] = json!({ "name": "fade", "duration": 0.5 });
        let overlay_a = visual_clip("overlay-a", "overlay", 0.0, 2.0);
        let mut overlay_b = visual_clip("overlay-b", "overlay", 2.0, 2.0);
        overlay_b["transitionIn"] = json!({ "name": "wipeleft", "duration": 0.5 });
        let project = project_with_visual_tracks(
            &[("base", 10), ("overlay", 5)],
            vec![base_a, base_b, overlay_a, overlay_b],
        );
        let graph = compile_render_graph(&project);

        let plan = compile_render_plan(&graph, 0.5);

        assert!(matches!(
            &plan.units[1],
            RenderUnit::Transition { transition, .. }
                if graph.layers[transition.source_layer_index].id == "overlay-b"
                    && transition.name == "wipeleft"
        ));
    }

    #[test]
    fn transition_overlap_uses_effective_duration_for_next_layers() {
        let base_a = visual_clip("base-a", "base", 0.0, 2.0);
        let mut base_b = visual_clip("base-b", "base", 2.0, 2.0);
        base_b["transitionIn"] = json!({ "name": "fade", "duration": 1.5 });
        let overlay_a = visual_clip("overlay-a", "overlay", 0.0, 2.5);
        let mut overlay_b = visual_clip("overlay-b", "overlay", 2.5, 2.0);
        overlay_b["transitionIn"] = json!({ "name": "wipeleft", "duration": 1.5 });
        let late = visual_clip("late", "late", 3.5, 0.5);
        let project = project_with_visual_tracks(
            &[("base", 10), ("overlay", 5), ("late", 3)],
            vec![base_a, base_b, overlay_a, overlay_b, late],
        );
        let graph = compile_render_graph(&project);
        let plan = compile_render_plan(&graph, 0.5);
        let second_transition = plan
            .units
            .iter()
            .find(|unit| {
                matches!(
                    unit,
                    RenderUnit::Transition { boundary, .. }
                        if (*boundary - 2.5).abs() < 0.001
                )
            })
            .expect("second transition must exist");

        assert!(matches!(
            second_transition,
            RenderUnit::Transition {
                start,
                end,
                next_layer_indices,
                ..
            } if (*start - 2.0).abs() < 0.001
                && (*end - 2.5).abs() < 0.001
                && !next_layer_indices
                    .iter()
                    .any(|index| graph.layers[*index].id == "late")
        ));
    }

    #[test]
    fn single_pass_accepts_contiguous_base_with_simple_overlay() {
        let base_a = visual_clip("base-a", "base", 0.0, 2.0);
        let base_b = visual_clip("base-b", "base", 2.0, 2.0);
        let mut overlay = visual_clip("overlay", "overlay", 1.0, 1.0);
        overlay["transform"] = json!({
            "x": 25.0,
            "y": 25.0,
            "scale": 40.0,
            "opacity": 80.0,
            "cornerRadius": 0,
            "mix": "normal",
            "rotation": 0.0
        });
        let project = project_with_visual_tracks(
            &[("base", 10), ("overlay", 5)],
            vec![base_a, base_b, overlay],
        );
        let graph = compile_render_graph(&project);

        let plan = compile_render_plan(&graph, 0.5);
        let single_pass = plan
            .single_pass
            .expect("simple overlay timeline should use single-pass rendering");

        assert_eq!(
            single_pass
                .base_layer_indices
                .iter()
                .map(|index| graph.layers[*index].id.as_str())
                .collect::<Vec<_>>(),
            vec!["base-a", "base-b"]
        );
        assert_eq!(
            single_pass
                .overlay_layer_indices
                .iter()
                .map(|index| graph.layers[*index].id.as_str())
                .collect::<Vec<_>>(),
            vec!["overlay"]
        );
    }

    #[test]
    fn single_pass_rejects_complex_overlay_transform() {
        let base = visual_clip("base", "base", 0.0, 4.0);
        let mut overlay = visual_clip("overlay", "overlay", 1.0, 1.0);
        overlay["transform"] = json!({
            "x": 50.0,
            "y": 50.0,
            "scale": 50.0,
            "opacity": 100.0,
            "cornerRadius": 12,
            "mix": "normal",
            "rotation": 0.0
        });
        let project =
            project_with_visual_tracks(&[("base", 10), ("overlay", 5)], vec![base, overlay]);
        let graph = compile_render_graph(&project);

        assert!(compile_render_plan(&graph, 0.5).single_pass.is_none());
    }

    #[test]
    fn single_pass_rejects_missing_media() {
        let mut base = visual_clip("base", "base", 0.0, 4.0);
        base["sourceId"] = json!("missing");
        let project = project_with_visual_tracks(&[("base", 10)], vec![base]);
        let graph = compile_render_graph(&project);

        assert!(compile_render_plan(&graph, 0.5).single_pass.is_none());
    }

    #[test]
    fn single_pass_rejects_reverse_and_curve_speed() {
        let mut reverse = visual_clip("reverse", "base", 0.0, 2.0);
        reverse["reverse"] = json!(true);
        let reverse_project = project_with_visual_tracks(&[("base", 10)], vec![reverse]);
        let reverse_graph = compile_render_graph(&reverse_project);
        assert!(compile_render_plan(&reverse_graph, 0.5)
            .single_pass
            .is_none());

        let mut curve = visual_clip("curve", "base", 0.0, 2.0);
        curve["speedCurve"] = json!([
            { "time": 0.0, "speed": 1.0 },
            { "time": 1.0, "speed": 2.0 }
        ]);
        let curve_project = project_with_visual_tracks(&[("base", 10)], vec![curve]);
        let curve_graph = compile_render_graph(&curve_project);
        assert!(compile_render_plan(&curve_graph, 0.5).single_pass.is_none());
    }

    #[test]
    fn single_pass_rejects_non_visual_output_tail() {
        let base = visual_clip("base", "base", 0.0, 4.0);
        let mut project = project_with_visual_tracks(&[("base", 10)], vec![base]);
        project.tracks.push(
            serde_json::from_value(json!({
                "id": "audio",
                "kind": "audio",
                "name": "audio",
                "order": 5,
                "muted": false,
                "locked": false,
                "hidden": false
            }))
            .expect("audio track must deserialize"),
        );
        let mut tail = visual_clip("tail", "audio", 0.0, 6.0);
        tail["sourceOut"] = json!(6.0);
        project
            .clips
            .push(serde_json::from_value(tail).expect("tail clip must deserialize"));
        let graph = compile_render_graph(&project);

        assert!((graph.duration - 6.0).abs() < 0.001);
        assert!(compile_render_plan(&graph, 0.5).single_pass.is_none());
    }

    #[test]
    fn ffmpeg_plan_supplies_execution_layers() {
        let a = visual_clip("a", "base", 0.0, 2.0);
        let mut b = visual_clip("b", "base", 2.0, 3.0);
        b["transitionIn"] = json!({ "name": "fade", "duration": 0.5 });
        let mut project = project_with_visual_tracks(&[("base", 10)], vec![a, b]);
        project.tracks.push(
            serde_json::from_value(json!({
                "id": "audio",
                "kind": "audio",
                "name": "audio",
                "order": 5,
                "muted": false,
                "locked": false,
                "hidden": false
            }))
            .expect("audio track must deserialize"),
        );
        let mut tail = visual_clip("tail", "audio", 0.0, 8.0);
        tail["sourceOut"] = json!(8.0);
        project
            .clips
            .push(serde_json::from_value(tail).expect("tail clip must deserialize"));
        let graph = compile_render_graph(&project);
        let plan = compile_render_plan(&graph, 0.5);

        let ids = |indices: &[usize]| {
            clips_for_indices(&graph, indices)
                .into_iter()
                .map(|clip| clip.id.as_str())
                .collect::<Vec<_>>()
        };

        assert!(matches!(
            &plan.units[0],
            RenderUnit::Normal { layer_indices, .. } if ids(layer_indices) == vec!["a"]
        ));
        assert!(matches!(
            &plan.units[1],
            RenderUnit::Transition {
                previous_layer_indices,
                next_layer_indices,
                ..
            } if ids(previous_layer_indices) == vec!["a"]
                && ids(next_layer_indices) == vec!["b"]
        ));
        assert!(matches!(
            &plan.units[3],
            RenderUnit::Normal { layer_indices, start, end }
                if layer_indices.is_empty()
                    && (*start - 5.0).abs() < 0.001
                    && (*end - 8.0).abs() < 0.001
        ));
        assert!(clips_for_indices(&graph, &[usize::MAX]).is_empty());
    }
}

#![allow(dead_code)]

use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};

use serde_json::{json, Value};

use crate::models::{Clip, ClipTransition, Keyframe, MediaSource, Project, SpeedPoint, TrackKind};

#[derive(Clone)]
pub struct RenderLayer {
    pub id: String,
    pub track_kind: TrackKind,
    pub track_order: u32,
    pub track_muted: bool,
    pub clip: Clip,
    pub media: Option<MediaSource>,
}

pub struct RenderGraph {
    pub duration: f64,
    pub layers: Vec<RenderLayer>,
}

pub struct EvaluatedVisualLayer {
    pub layer: RenderLayer,
    pub source_time: f64,
    pub speed: f64,
    pub x: f64,
    pub y: f64,
    pub scale: f64,
    pub opacity: f64,
    pub rotation: f64,
    pub transition_in_progress: f64,
    pub transition_out_progress: f64,
    pub effective_opacity: f64,
}

pub struct EvaluatedAudioLayer {
    pub layer: RenderLayer,
    pub source_time: f64,
    pub speed: f64,
    pub volume: f64,
    pub fade_in_gain: f64,
    pub fade_out_gain: f64,
    pub gain: f64,
}

pub struct EvaluatedSubtitleLayer {
    pub layer: RenderLayer,
    pub active_word_index: Option<usize>,
}

pub struct EvaluatedFrame {
    pub time: f64,
    pub visual_layers: Vec<EvaluatedVisualLayer>,
    pub audio_layers: Vec<EvaluatedAudioLayer>,
    pub subtitle_layers: Vec<EvaluatedSubtitleLayer>,
}

pub fn compile_render_graph(project: &Project) -> RenderGraph {
    let tracks: HashMap<&str, _> = project
        .tracks
        .iter()
        .filter(|track| !track.hidden)
        .map(|track| (track.id.as_str(), track))
        .collect();
    let media: HashMap<&str, _> = project
        .media
        .iter()
        .map(|source| (source.id.as_str(), source))
        .collect();
    let mut layers: Vec<RenderLayer> = project
        .clips
        .iter()
        .filter_map(|clip| {
            let track = tracks.get(clip.track_id.as_str())?;
            Some(RenderLayer {
                id: clip.id.clone(),
                track_kind: track.kind.clone(),
                track_order: track.order,
                track_muted: track.muted,
                clip: clip.clone(),
                media: clip
                    .source_id
                    .as_deref()
                    .and_then(|source_id| media.get(source_id).copied())
                    .cloned(),
            })
        })
        .collect();
    layers.sort_by(|left, right| {
        right
            .track_order
            .cmp(&left.track_order)
            .then_with(|| partial_cmp(left.clip.start_on_track, right.clip.start_on_track))
            .then_with(|| left.id.cmp(&right.id))
    });
    let visible_track_ids: HashSet<&str> = tracks.keys().copied().collect();
    let duration = project
        .clips
        .iter()
        .filter(|clip| visible_track_ids.contains(clip.track_id.as_str()))
        .map(|clip| clip.start_on_track + clip.duration.max(0.0))
        .fold(0.0_f64, f64::max);
    RenderGraph { duration, layers }
}

pub fn evaluate_frame(graph: &RenderGraph, time: f64) -> EvaluatedFrame {
    let evaluated_time = if time.is_finite() {
        time.clamp(0.0, graph.duration)
    } else {
        0.0
    };
    let active: Vec<&RenderLayer> = graph
        .layers
        .iter()
        .filter(|layer| {
            evaluated_time >= layer.clip.start_on_track
                && evaluated_time < layer.clip.start_on_track + layer.clip.duration
        })
        .collect();
    let visual_layers = active
        .iter()
        .copied()
        .filter(|layer| {
            matches!(layer.track_kind, TrackKind::Video | TrackKind::Image) && layer.media.is_some()
        })
        .map(|layer| evaluate_visual(layer, evaluated_time))
        .collect();
    let audio_layers = active
        .iter()
        .copied()
        .filter(|layer| {
            !layer.track_muted
                && matches!(
                    layer.track_kind,
                    TrackKind::Video | TrackKind::Audio | TrackKind::Voiceover
                )
                && layer
                    .media
                    .as_ref()
                    .is_some_and(|source| source.kind != "image")
        })
        .map(|layer| evaluate_audio(layer, evaluated_time))
        .collect();
    let subtitle_layers = active
        .iter()
        .copied()
        .filter(|layer| layer.track_kind == TrackKind::Subtitle)
        .map(|layer| evaluate_subtitle(layer, evaluated_time))
        .collect();
    EvaluatedFrame {
        time: evaluated_time,
        visual_layers,
        audio_layers,
        subtitle_layers,
    }
}

fn evaluate_visual(layer: &RenderLayer, time: f64) -> EvaluatedVisualLayer {
    let clip = &layer.clip;
    let relative = time - clip.start_on_track;
    let remaining = (clip.duration - relative).max(0.0);
    let transform = clip.transform.as_ref();
    let x = sample_keyframes(
        clip.keyframes.as_ref().and_then(|keys| keys.x.as_deref()),
        relative,
    )
    .unwrap_or_else(|| transform.map(|value| value.x).unwrap_or(50.0));
    let y = sample_keyframes(
        clip.keyframes.as_ref().and_then(|keys| keys.y.as_deref()),
        relative,
    )
    .unwrap_or_else(|| transform.map(|value| value.y).unwrap_or(50.0));
    let scale = sample_keyframes(
        clip.keyframes
            .as_ref()
            .and_then(|keys| keys.scale.as_deref()),
        relative,
    )
    .unwrap_or_else(|| transform.map(|value| value.scale).unwrap_or(100.0));
    let opacity = sample_keyframes(
        clip.keyframes
            .as_ref()
            .and_then(|keys| keys.opacity.as_deref()),
        relative,
    )
    .unwrap_or_else(|| transform.map(|value| value.opacity).unwrap_or(100.0))
    .clamp(0.0, 100.0);
    let rotation = sample_keyframes(
        clip.keyframes
            .as_ref()
            .and_then(|keys| keys.rotation.as_deref()),
        relative,
    )
    .unwrap_or_else(|| transform.map(|value| value.rotation).unwrap_or(0.0));
    let transition_in_progress = transition_progress(clip.transition_in.as_ref(), relative);
    let transition_out_progress = transition_progress(clip.transition_out.as_ref(), remaining);
    EvaluatedVisualLayer {
        layer: layer.clone(),
        source_time: timeline_to_source_time(clip, relative),
        speed: effective_speed(clip, relative),
        x,
        y,
        scale,
        opacity,
        rotation,
        transition_in_progress,
        transition_out_progress,
        effective_opacity: opacity / 100.0 * transition_in_progress * transition_out_progress,
    }
}

fn evaluate_audio(layer: &RenderLayer, time: f64) -> EvaluatedAudioLayer {
    let clip = &layer.clip;
    let relative = time - clip.start_on_track;
    let remaining = (clip.duration - relative).max(0.0);
    let volume = sample_keyframes(
        clip.keyframes
            .as_ref()
            .and_then(|keys| keys.volume.as_deref()),
        relative,
    )
    .unwrap_or(clip.volume)
    .clamp(0.0, 2.0);
    let fade_in_gain = if clip.fade_in > 0.0 {
        (relative / clip.fade_in).clamp(0.0, 1.0)
    } else {
        1.0
    };
    let fade_out_gain = if clip.fade_out > 0.0 {
        (remaining / clip.fade_out).clamp(0.0, 1.0)
    } else {
        1.0
    };
    EvaluatedAudioLayer {
        layer: layer.clone(),
        source_time: timeline_to_source_time(clip, relative),
        speed: effective_speed(clip, relative),
        volume,
        fade_in_gain,
        fade_out_gain,
        gain: volume * fade_in_gain * fade_out_gain,
    }
}

fn evaluate_subtitle(layer: &RenderLayer, time: f64) -> EvaluatedSubtitleLayer {
    let clip = &layer.clip;
    let relative = time - clip.start_on_track;
    let words = clip.words.as_deref().unwrap_or(&[]);
    let words_are_relative = !words.is_empty()
        && words
            .iter()
            .all(|word| word.start >= 0.0 && word.end <= clip.duration + 0.000001);
    let word_time = if words_are_relative { relative } else { time };
    let active_word_index = words
        .iter()
        .position(|word| word_time >= word.start && word_time < word.end);
    EvaluatedSubtitleLayer {
        layer: layer.clone(),
        active_word_index,
    }
}

pub(crate) fn timeline_to_source_time(clip: &Clip, relative: f64) -> f64 {
    let source_duration = (clip.source_out - clip.source_in).max(0.0);
    let offset = if let Some(curve) = clip.speed_curve.as_ref().filter(|curve| !curve.is_empty()) {
        curve_timeline_to_source(curve, source_duration, relative)
    } else {
        relative.max(0.0) * clip.speed.abs().max(0.000000001)
    }
    .clamp(0.0, source_duration);
    if clip.reverse || clip.speed < 0.0 {
        clip.source_out - offset
    } else {
        clip.source_in + offset
    }
}

pub(crate) fn effective_speed(clip: &Clip, relative: f64) -> f64 {
    if let Some(curve) = clip.speed_curve.as_ref().filter(|curve| !curve.is_empty()) {
        curve_speed_at_time(curve, (clip.source_out - clip.source_in).max(0.0), relative)
            .clamp(0.0625, 16.0)
    } else {
        clip.speed.abs().max(0.0001)
    }
}

pub(crate) fn curve_segments(curve: &[SpeedPoint], source_duration: f64) -> Vec<(f64, f64, f64)> {
    if curve.is_empty() || source_duration <= 0.0 {
        return Vec::new();
    }
    let mut sorted = curve.to_vec();
    sorted.sort_by(|left, right| partial_cmp(left.time, right.time));
    if sorted[0].time > 0.0 {
        sorted.insert(
            0,
            SpeedPoint {
                time: 0.0,
                speed: sorted[0].speed,
            },
        );
    }
    let last = sorted.len() - 1;
    if sorted[last].time < 1.0 {
        sorted.push(SpeedPoint {
            time: 1.0,
            speed: sorted[last].speed,
        });
    }
    let mut result = Vec::new();
    for pair in sorted.windows(2) {
        let start = pair[0].time * source_duration;
        let end = pair[1].time * source_duration;
        let span = end - start;
        if span <= 0.0 {
            continue;
        }
        let count = (span / 0.5).ceil().max(1.0) as usize;
        for index in 0..count {
            let sub_start = start + span * index as f64 / count as f64;
            let sub_end = start + span * (index + 1) as f64 / count as f64;
            let ratio = (index as f64 + 0.5) / count as f64;
            let speed = pair[0].speed + (pair[1].speed - pair[0].speed) * ratio;
            result.push((sub_start, sub_end, speed.clamp(0.0625, 16.0)));
        }
    }
    result
}

fn curve_timeline_to_source(curve: &[SpeedPoint], source_duration: f64, relative: f64) -> f64 {
    let segments = curve_segments(curve, source_duration);
    if segments.is_empty() {
        return relative.max(0.0);
    }
    let mut remaining = relative.max(0.0);
    for (start, end, speed) in &segments {
        let timeline_span = (end - start) / speed;
        if remaining <= timeline_span {
            return start + remaining * speed;
        }
        remaining -= timeline_span;
    }
    segments.last().map(|segment| segment.1).unwrap_or(0.0)
}

fn curve_speed_at_time(curve: &[SpeedPoint], source_duration: f64, relative: f64) -> f64 {
    let segments = curve_segments(curve, source_duration);
    let mut remaining = relative.max(0.0);
    for (start, end, speed) in &segments {
        let timeline_span = (end - start) / speed;
        if remaining <= timeline_span {
            return *speed;
        }
        remaining -= timeline_span;
    }
    segments.last().map(|segment| segment.2).unwrap_or(1.0)
}

fn sample_keyframes(frames: Option<&[Keyframe]>, time: f64) -> Option<f64> {
    let frames = frames?;
    if frames.is_empty() {
        return None;
    }
    if time <= frames[0].time {
        return Some(frames[0].value);
    }
    if time >= frames[frames.len() - 1].time {
        return Some(frames[frames.len() - 1].value);
    }
    for pair in frames.windows(2) {
        if time <= pair[1].time {
            let span = pair[1].time - pair[0].time;
            if span <= 0.0 {
                return Some(pair[1].value);
            }
            let progress = apply_easing((time - pair[0].time) / span, &pair[1].easing);
            return Some(pair[0].value + (pair[1].value - pair[0].value) * progress);
        }
    }
    Some(frames[frames.len() - 1].value)
}

fn apply_easing(progress: f64, easing: &str) -> f64 {
    match easing {
        "easeIn" => progress * progress,
        "easeOut" => 1.0 - (1.0 - progress) * (1.0 - progress),
        "easeInOut" if progress < 0.5 => 2.0 * progress * progress,
        "easeInOut" => 1.0 - (-2.0 * progress + 2.0).powi(2) / 2.0,
        _ => progress,
    }
}

fn transition_progress(transition: Option<&ClipTransition>, elapsed: f64) -> f64 {
    let Some(transition) = transition else {
        return 1.0;
    };
    if transition.name() == "none" {
        return 1.0;
    }
    let duration = transition.duration(0.5);
    if duration > 0.0 {
        (elapsed / duration).clamp(0.0, 1.0)
    } else {
        1.0
    }
}

pub fn normalize_evaluated_frame(frame: &EvaluatedFrame) -> Value {
    json!({
        "time": number(frame.time),
        "visual": frame.visual_layers.iter().map(|layer| json!({
            "id": layer.layer.id,
            "sourceTime": number(layer.source_time),
            "speed": number(layer.speed),
            "x": number(layer.x),
            "y": number(layer.y),
            "scale": number(layer.scale),
            "opacity": number(layer.opacity),
            "rotation": number(layer.rotation),
            "transitionInProgress": number(layer.transition_in_progress),
            "transitionOutProgress": number(layer.transition_out_progress),
            "effectiveOpacity": number(layer.effective_opacity),
        })).collect::<Vec<_>>(),
        "audio": frame.audio_layers.iter().map(|layer| json!({
            "id": layer.layer.id,
            "sourceTime": number(layer.source_time),
            "speed": number(layer.speed),
            "volume": number(layer.volume),
            "fadeInGain": number(layer.fade_in_gain),
            "fadeOutGain": number(layer.fade_out_gain),
            "gain": number(layer.gain),
        })).collect::<Vec<_>>(),
        "subtitle": frame.subtitle_layers.iter().map(|layer| json!({
            "id": layer.layer.id,
            "activeWordIndex": layer.active_word_index,
        })).collect::<Vec<_>>(),
    })
}

fn number(value: f64) -> Value {
    let rounded = (value * 1_000_000.0).round() / 1_000_000.0;
    if rounded.fract() == 0.0 {
        json!(rounded as i64)
    } else {
        json!(rounded)
    }
}

fn partial_cmp(left: f64, right: f64) -> Ordering {
    left.partial_cmp(&right).unwrap_or(Ordering::Equal)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Deserialize)]
    struct GoldenFixture {
        project: Project,
        samples: Vec<GoldenSample>,
    }

    #[derive(Deserialize)]
    struct GoldenSample {
        time: f64,
        expected: Value,
    }

    #[test]
    fn render_graph_matches_shared_golden_fixture() {
        let fixture: GoldenFixture = serde_json::from_str(include_str!(
            "../../tests/fixtures/render-graph-golden.json"
        ))
        .expect("golden fixture must deserialize");
        let graph = compile_render_graph(&fixture.project);
        for sample in fixture.samples {
            assert_eq!(
                normalize_evaluated_frame(&evaluate_frame(&graph, sample.time)),
                sample.expected,
                "frame at {}s differs from TypeScript golden result",
                sample.time
            );
        }
    }
}

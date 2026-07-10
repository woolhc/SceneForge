use crate::models::Clip;
use crate::render_graph::{curve_segments, effective_speed, timeline_to_source_time};

#[derive(Debug, Clone, PartialEq)]
pub struct SourceWindowPlan {
    pub parts: Vec<SourceWindowPart>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SourceWindowPart {
    pub source_start: f64,
    pub source_end: f64,
    pub timeline_duration: f64,
    pub speed: f64,
    pub reverse: bool,
}

pub fn compile_source_window(
    clip: &Clip,
    timeline_start: f64,
    timeline_duration: f64,
) -> SourceWindowPlan {
    if !timeline_start.is_finite()
        || !timeline_duration.is_finite()
        || timeline_duration <= 0.0
        || clip.duration <= 0.0
        || clip.source_out <= clip.source_in
    {
        return SourceWindowPlan { parts: Vec::new() };
    }
    let relative_start = (timeline_start - clip.start_on_track).clamp(0.0, clip.duration);
    let relative_end = (relative_start + timeline_duration).clamp(0.0, clip.duration);
    if relative_end - relative_start <= 0.000001 {
        return SourceWindowPlan { parts: Vec::new() };
    }
    let reverse = clip.reverse || clip.speed < 0.0;
    let Some(curve) = clip.speed_curve.as_ref().filter(|curve| !curve.is_empty()) else {
        let mapped_start = timeline_to_source_time(clip, relative_start);
        let mapped_end = timeline_to_source_time(clip, relative_end);
        return SourceWindowPlan {
            parts: vec![source_part(
                mapped_start,
                mapped_end,
                relative_end - relative_start,
                effective_speed(clip, relative_start),
                reverse,
            )],
        };
    };

    let source_duration = (clip.source_out - clip.source_in).max(0.0);
    let mut timeline_cursor = 0.0;
    let mut parts = Vec::new();
    for (source_start, source_end, speed) in curve_segments(curve, source_duration) {
        let segment_duration = (source_end - source_start) / speed;
        let segment_start = timeline_cursor;
        let segment_end = timeline_cursor + segment_duration;
        timeline_cursor = segment_end;
        let part_start = relative_start.max(segment_start);
        let part_end = relative_end.min(segment_end);
        if part_end - part_start <= 0.000001 {
            continue;
        }
        let source_offset_start = source_start + (part_start - segment_start) * speed;
        let source_offset_end = source_start + (part_end - segment_start) * speed;
        let mapped_start = if reverse {
            clip.source_out - source_offset_start
        } else {
            clip.source_in + source_offset_start
        };
        let mapped_end = if reverse {
            clip.source_out - source_offset_end
        } else {
            clip.source_in + source_offset_end
        };
        parts.push(source_part(
            mapped_start,
            mapped_end,
            part_end - part_start,
            speed,
            reverse,
        ));
    }
    SourceWindowPlan { parts }
}

fn source_part(
    mapped_start: f64,
    mapped_end: f64,
    timeline_duration: f64,
    speed: f64,
    reverse: bool,
) -> SourceWindowPart {
    SourceWindowPart {
        source_start: mapped_start.min(mapped_end),
        source_end: mapped_start.max(mapped_end),
        timeline_duration,
        speed: speed.abs().clamp(0.0625, 16.0),
        reverse,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::Clip;
    use serde_json::json;

    fn clip(source_in: f64, source_out: f64, duration: f64, speed: f64) -> Clip {
        serde_json::from_value(json!({
            "id": "clip",
            "trackId": "track",
            "sourceId": "source",
            "startOnTrack": 100.0,
            "duration": duration,
            "sourceIn": source_in,
            "sourceOut": source_out,
            "speed": speed,
            "volume": 1.0,
            "brightness": 0.0,
            "contrast": 0.0,
            "saturation": 0.0
        }))
        .expect("clip must deserialize")
    }

    #[test]
    fn source_window_maps_constant_speed() {
        let clip = clip(10.0, 20.0, 5.0, 2.0);

        let plan = compile_source_window(&clip, 101.0, 2.0);

        assert_eq!(plan.parts.len(), 1);
        let part = &plan.parts[0];
        assert!((part.source_start - 12.0).abs() < 0.000001);
        assert!((part.source_end - 16.0).abs() < 0.000001);
        assert!((part.timeline_duration - 2.0).abs() < 0.000001);
        assert!((part.speed - 2.0).abs() < 0.000001);
        assert!(!part.reverse);
    }

    #[test]
    fn source_window_maps_reverse_subrange_from_source_out() {
        let mut clip = clip(10.0, 20.0, 10.0, 1.0);
        clip.reverse = true;

        let plan = compile_source_window(&clip, 102.0, 3.0);

        let part = &plan.parts[0];
        assert!((part.source_start - 15.0).abs() < 0.000001);
        assert!((part.source_end - 18.0).abs() < 0.000001);
        assert!(part.reverse);
    }

    #[test]
    fn source_window_treats_negative_speed_as_reverse() {
        let clip = clip(10.0, 20.0, 10.0, -1.0);

        let plan = compile_source_window(&clip, 102.0, 3.0);

        let part = &plan.parts[0];
        assert!((part.source_start - 15.0).abs() < 0.000001);
        assert!((part.source_end - 18.0).abs() < 0.000001);
        assert!(part.reverse);
    }

    #[test]
    fn source_window_maps_constant_curve() {
        let mut clip = clip(0.0, 4.0, 2.0, 1.0);
        clip.speed_curve = serde_json::from_value(json!([
            { "time": 0.0, "speed": 2.0 },
            { "time": 1.0, "speed": 2.0 }
        ]))
        .expect("curve must deserialize");

        let plan = compile_source_window(&clip, 100.5, 1.0);

        assert!(!plan.parts.is_empty());
        assert!((plan.parts.first().unwrap().source_start - 1.0).abs() < 0.000001);
        assert!((plan.parts.last().unwrap().source_end - 3.0).abs() < 0.000001);
        assert!(
            (plan
                .parts
                .iter()
                .map(|part| part.timeline_duration)
                .sum::<f64>()
                - 1.0)
                .abs()
                < 0.000001
        );
        assert!(plan
            .parts
            .iter()
            .all(|part| (part.speed - 2.0).abs() < 0.000001));
    }

    #[test]
    fn source_window_maps_reverse_curve() {
        let mut clip = clip(0.0, 4.0, 2.0, 1.0);
        clip.reverse = true;
        clip.speed_curve = serde_json::from_value(json!([
            { "time": 0.0, "speed": 2.0 },
            { "time": 1.0, "speed": 2.0 }
        ]))
        .expect("curve must deserialize");

        let plan = compile_source_window(&clip, 100.5, 1.0);

        assert!((plan.parts.first().unwrap().source_end - 3.0).abs() < 0.000001);
        assert!((plan.parts.last().unwrap().source_start - 1.0).abs() < 0.000001);
        assert!(plan.parts.iter().all(|part| part.reverse));
    }

    #[test]
    fn source_window_splits_variable_curve_into_contiguous_parts() {
        let mut clip = clip(0.0, 4.0, 3.0, 1.0);
        clip.speed_curve = serde_json::from_value(json!([
            { "time": 0.0, "speed": 1.0 },
            { "time": 1.0, "speed": 2.0 }
        ]))
        .expect("curve must deserialize");

        let plan = compile_source_window(&clip, 100.25, 1.5);

        assert!(plan.parts.len() > 1);
        assert!(
            (plan
                .parts
                .iter()
                .map(|part| part.timeline_duration)
                .sum::<f64>()
                - 1.5)
                .abs()
                < 0.000001
        );
        for pair in plan.parts.windows(2) {
            assert!((pair[0].source_end - pair[1].source_start).abs() < 0.000001);
        }
    }
}

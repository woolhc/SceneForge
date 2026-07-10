use std::cmp::Ordering;

use crate::models::Keyframe;

pub fn compile_keyframe_expression(
    keyframes: &[Keyframe],
    fallback: f64,
    offset: f64,
    time_variable: &str,
) -> String {
    if keyframes.is_empty() {
        return format!("{fallback:.6}");
    }
    let mut sorted = keyframes.iter().collect::<Vec<_>>();
    sorted.sort_by(|left, right| {
        left.time
            .partial_cmp(&right.time)
            .unwrap_or(Ordering::Equal)
    });
    if sorted.len() == 1 {
        return format!("{:.6}", sorted[0].value);
    }
    let mut expression = format!("{:.6}", sorted[sorted.len() - 1].value);
    for pair in sorted.windows(2).rev() {
        let start = pair[0];
        let end = pair[1];
        let start_time = start.time + offset;
        let end_time = end.time + offset;
        let span = (end_time - start_time).max(0.000001);
        let progress = format!("(({time_variable}-{start_time:.6})/{span:.6})");
        let eased = easing_expression(&progress, &end.easing);
        let interpolated = format!("{:.6}+{:.6}*{eased}", start.value, end.value - start.value);
        expression = format!(
            "if(lt({time_variable},{start_time:.6}),{:.6},if(lt({time_variable},{end_time:.6}),{interpolated},{expression}))",
            start.value
        );
    }
    expression
}

pub fn compile_opacity_alpha_filter(keyframes: &[Keyframe], offset: f64) -> Option<String> {
    if keyframes.is_empty() {
        return None;
    }
    let expression = compile_keyframe_expression(keyframes, 100.0, offset, "T");
    Some(format!(
        ",format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*clip(({expression})/100,0,1)'"
    ))
}

pub fn compile_static_opacity_filter(opacity: f64, overridden_by_keyframes: bool) -> String {
    if overridden_by_keyframes {
        return String::new();
    }
    let alpha = opacity.clamp(0.0, 100.0) / 100.0;
    if alpha >= 1.0 {
        String::new()
    } else {
        format!(",colorchannelmixer=aa={alpha:.3}")
    }
}

fn easing_expression(progress: &str, easing: &str) -> String {
    match easing {
        "easeIn" => format!("{progress}*{progress}"),
        "easeOut" => format!("1-(1-{progress})*(1-{progress})"),
        "easeInOut" => format!(
            "if(lt({progress},0.5),2*{progress}*{progress},1-(-2*{progress}+2)*(-2*{progress}+2)/2)"
        ),
        _ => progress.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::Keyframe;
    use serde_json::json;

    fn keyframe(time: f64, value: f64, easing: &str) -> Keyframe {
        serde_json::from_value(json!({
            "time": time,
            "value": value,
            "easing": easing
        }))
        .expect("keyframe must deserialize")
    }

    #[test]
    fn expression_clamps_before_first_and_after_last_keyframe() {
        let frames = vec![keyframe(1.0, 10.0, "linear"), keyframe(3.0, 30.0, "linear")];

        let expression = compile_keyframe_expression(&frames, 50.0, 0.0, "t");

        assert!(expression.starts_with("if(lt(t,1.000000),10.000000,"));
        assert!(expression.ends_with(",30.000000))"));
    }

    #[test]
    fn expression_compiles_ease_in() {
        let frames = vec![keyframe(0.0, 0.0, "linear"), keyframe(2.0, 100.0, "easeIn")];

        let expression = compile_keyframe_expression(&frames, 0.0, 0.0, "t");

        assert!(expression.contains("*((t-0.000000)/2.000000)*((t-0.000000)/2.000000)"));
    }

    #[test]
    fn expression_compiles_ease_out() {
        let frames = vec![
            keyframe(0.0, 0.0, "linear"),
            keyframe(2.0, 100.0, "easeOut"),
        ];

        let expression = compile_keyframe_expression(&frames, 0.0, 0.0, "t");

        assert!(expression.contains("1-(1-((t-0.000000)/2.000000))*(1-((t-0.000000)/2.000000))"));
    }

    #[test]
    fn expression_compiles_ease_in_out() {
        let frames = vec![
            keyframe(0.0, 0.0, "linear"),
            keyframe(2.0, 100.0, "easeInOut"),
        ];

        let expression = compile_keyframe_expression(&frames, 0.0, 0.0, "t");

        assert!(expression.contains("if(lt(((t-0.000000)/2.000000),0.5)"));
    }

    #[test]
    fn opacity_filter_uses_geq_time_variable() {
        let frames = vec![keyframe(0.0, 0.0, "linear"), keyframe(2.0, 100.0, "easeIn")];

        let filter = compile_opacity_alpha_filter(&frames, 0.0).expect("filter must compile");

        assert!(filter.contains("lt(T,"));
        assert!(!filter.contains("lt(t,"));
    }

    #[test]
    fn static_opacity_is_skipped_when_keyframes_override_it() {
        assert_eq!(compile_static_opacity_filter(80.0, true), "");
        assert_eq!(
            compile_static_opacity_filter(80.0, false),
            ",colorchannelmixer=aa=0.800"
        );
    }
}

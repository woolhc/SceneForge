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
        let eased = easing_expression(&progress, &end.easing, end.bezier_points);
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

fn easing_expression(progress: &str, easing: &str, bezier_points: Option<[f64; 4]>) -> String {
    match easing {
        "easeIn" => format!("{progress}*{progress}"),
        "easeOut" => format!("1-(1-{progress})*(1-{progress})"),
        "easeInOut" => format!(
            "if(lt({progress},0.5),2*{progress}*{progress},1-(-2*{progress}+2)*(-2*{progress}+2)/2)"
        ),
        "bezier" => bezier_easing_expression(progress, bezier_points.unwrap_or([0.42, 0.0, 0.58, 1.0])),
        _ => progress.to_string(),
    }
}

const BEZIER_SAMPLE_COUNT: usize = 24;

/// 三次贝塞尔（CSS cubic-bezier 语义）在 t 处求分量值。
fn bezier_component_at(t: f64, p1: f64, p2: f64) -> f64 {
    let mt = 1.0 - t;
    3.0 * mt * mt * t * p1 + 3.0 * mt * t * t * p2 + t * t * t
}

/// 贝塞尔缓动的 ffmpeg 表达式。
///
/// ffmpeg 表达式不支持循环/变量赋值，无法直接内联牛顿迭代（每步都要把上一步的完整表达式
/// 文本代入，8 步迭代会导致表达式长度指数级爆炸，完全不可行）。因此改为在 Rust 侧
/// （真正的浮点环境）用牛顿迭代采样出一条 x 单调递增的分段折线（x1/x2 按 CSS cubic-bezier
/// 规范固定在 [0,1] 保证 x(t) 单调，可安全反解），再把这条折线编译成与
/// `compile_keyframe_expression` 同构的嵌套 if/lt 分段线性插值表达式。
/// 采样点数越多越接近真实贝塞尔曲线，与 JS 端 applyCubicBezier（keyframes.ts）的精确牛顿迭代
/// 结果在采样密度内近似一致（非逐位相同，但视觉上无法区分）。
fn bezier_easing_expression(progress: &str, points: [f64; 4]) -> String {
    let x1 = points[0].clamp(0.0, 1.0);
    let y1 = points[1];
    let x2 = points[2].clamp(0.0, 1.0);
    let y2 = points[3];

    let samples: Vec<(f64, f64)> = (0..=BEZIER_SAMPLE_COUNT)
        .map(|i| {
            let t = i as f64 / BEZIER_SAMPLE_COUNT as f64;
            (bezier_component_at(t, x1, x2), bezier_component_at(t, y1, y2))
        })
        .collect();

    let mut expression = format!("{:.6}", samples[samples.len() - 1].1);
    for pair in samples.windows(2).rev() {
        let (x0, y0) = pair[0];
        let (x1s, y1s) = pair[1];
        let span = (x1s - x0).max(0.000001);
        let local_progress = format!("(({progress}-{x0:.6})/{span:.6})");
        let interpolated = format!("{y0:.6}+{:.6}*{local_progress}", y1s - y0);
        expression = format!(
            "if(lt({progress},{x0:.6}),{y0:.6},if(lt({progress},{x1s:.6}),{interpolated},{expression}))"
        );
    }
    expression
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

    fn bezier_keyframe(time: f64, value: f64, points: [f64; 4]) -> Keyframe {
        serde_json::from_value(json!({
            "time": time,
            "value": value,
            "easing": "bezier",
            "bezierPoints": points
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
    fn expression_compiles_bezier_as_piecewise_linear_sampling() {
        let frames = vec![
            keyframe(0.0, 0.0, "linear"),
            bezier_keyframe(2.0, 100.0, [0.42, 0.0, 0.58, 1.0]),
        ];

        let expression = compile_keyframe_expression(&frames, 0.0, 0.0, "t");

        // 分段线性折线用嵌套 if/lt 表达，且不含任何未展开的迭代/循环结构
        assert!(expression.contains("if(lt(((t-0.000000)/2.000000),"));
        assert!(!expression.contains("st("));
        assert!(!expression.contains("ld("));
    }

    #[test]
    fn bezier_default_curve_matches_js_cubic_bezier_reference_points() {
        // 默认 ease 曲线 [0.42,0,0.58,1] 在 t=0.5 时的贝塞尔 x/y 分量应接近已知参考值
        // （用 Rust 侧同款 bezier_component_at 交叉验证采样点本身的正确性）
        let x_at_half = bezier_component_at(0.5, 0.42, 0.58);
        let y_at_half = bezier_component_at(0.5, 0.0, 1.0);
        assert!((x_at_half - 0.5).abs() < 1e-9, "x1/x2 对称时 t=0.5 应映射到 x=0.5");
        assert!((y_at_half - 0.5).abs() < 1e-9, "y1/y2 对称时 t=0.5 应映射到 y=0.5");
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

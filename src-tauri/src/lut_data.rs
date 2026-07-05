/**
 * 编译时嵌入 LUT .cube 文件。
 * 使用 include_str! 把 luts/ 目录的文件打包进二进制。
 */

pub fn get_lut(name: &str) -> Option<&'static str> {
    match name {
        "none" => Some(include_str!("../../luts/none.cube")),
        "cinematic" => Some(include_str!("../../luts/cinematic.cube")),
        "vintage" => Some(include_str!("../../luts/vintage.cube")),
        "bw" => Some(include_str!("../../luts/bw.cube")),
        "sepia" => Some(include_str!("../../luts/sepia.cube")),
        "warm" => Some(include_str!("../../luts/warm.cube")),
        "cool" => Some(include_str!("../../luts/cool.cube")),
        "fresh" => Some(include_str!("../../luts/fresh.cube")),
        "moody" => Some(include_str!("../../luts/moody.cube")),
        "soft" => Some(include_str!("../../luts/soft.cube")),
        _ => None,
    }
}

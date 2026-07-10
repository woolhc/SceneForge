use std::path::PathBuf;

/// RAII 临时目录守卫：创建时建立目录，Drop 时自动清理（无论成败）。
/// 用于渲染流程的临时文件管理（T2.5），避免 segments/*.mp4 等残留。
pub struct TempDirGuard {
    path: PathBuf,
}

impl TempDirGuard {
    /// 创建临时目录（在 base 下，含 uuid 子目录），返回守卫。
    pub fn new(base: &std::path::Path, prefix: &str) -> std::io::Result<Self> {
        let dir = base.join(format!("{}-{}", prefix, uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir)?;
        Ok(Self { path: dir })
    }

    pub fn path(&self) -> &std::path::Path {
        &self.path
    }
}

impl Drop for TempDirGuard {
    fn drop(&mut self) {
        // 清理整个临时目录（含所有子文件）
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

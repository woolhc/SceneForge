use std::path::PathBuf;

/// RAII 临时目录守卫：创建时建立目录，Drop 时自动清理（无论成败）。
/// 用于渲染流程的临时文件管理（T2.5），避免 segments/*.mp4 等残留。
pub struct TempDirGuard {
    path: PathBuf,
    /// 是否在 Drop 时清理（false = 调用方手动保留，如调试时）
    cleanup: bool,
}

impl TempDirGuard {
    /// 创建临时目录（在 base 下，含 uuid 子目录），返回守卫。
    pub fn new(base: &std::path::Path, prefix: &str) -> std::io::Result<Self> {
        let dir = base.join(format!("{}-{}", prefix, uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir)?;
        Ok(Self {
            path: dir,
            cleanup: true,
        })
    }

    pub fn path(&self) -> &std::path::Path {
        &self.path
    }

    /// 禁用自动清理（调试时保留临时文件）
    pub fn keep(&mut self) {
        self.cleanup = false;
    }
}

impl Drop for TempDirGuard {
    fn drop(&mut self) {
        if self.cleanup {
            // 清理整个临时目录（含所有子文件）
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }
}

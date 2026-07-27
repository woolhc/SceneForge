/// API Key 安全存储：优先写入系统 Keychain（macOS Keychain / Windows Credential Manager / Linux Secret Service），
/// SQLite 中只存空字符串占位。旧数据（SQLite 中有值的 key）首次加载时自动迁移到 Keychain。
use keyring::Entry;

const SERVICE_NAME: &str = "com.scenescript.desktop";

fn entry_for(key_name: &str) -> anyhow::Result<Entry> {
    Entry::new(SERVICE_NAME, key_name).map_err(|e| anyhow::anyhow!("Keychain 入口创建失败：{e}"))
}

/// 把 API key 写入系统 Keychain。空值时写空字符串（等效删除）。
pub fn save_key(key_name: &str, value: &str) -> anyhow::Result<()> {
    let entry = entry_for(key_name)?;
    entry.set_password(value).map_err(|e| anyhow::anyhow!("Keychain 写入失败（{key_name}）：{e}"))
}

/// 从系统 Keychain 读 API key。不存在时返回空字符串（不报错）。
pub fn load_key(key_name: &str) -> String {
    let entry = match entry_for(key_name) {
        Ok(e) => e,
        Err(_) => return String::new(),
    };
    match entry.get_password() {
        Ok(v) => v,
        Err(_) => String::new(),
    }
}

/// 迁移：如果 SQLite 里有明文 key 而 Keychain 里没有，写入 Keychain 并返回 true（调用方应清空 SQLite 里的值）。
pub fn migrate_if_needed(key_name: &str, sqlite_value: &str) -> bool {
    if sqlite_value.is_empty() {
        return false;
    }
    let existing = load_key(key_name);
    if existing.is_empty() {
        // Keychain 里没有，SQLite 里有 → 迁移
        let _ = save_key(key_name, sqlite_value);
        return true;
    }
    // Keychain 里已有值，不覆盖
    false
}

# Whisper first-use model download and unified settings

## Target

SceneForge packages `whisper-cli`, but Whisper models remain user data. The first action that requires transcription must detect whether a usable model exists, explain why it is needed, download the recommended model with visible progress, and resume the interrupted action automatically. Application startup must not download large files without user intent.

## First-use experience

Whisper readiness is checked before one-click generation, narration transcription, and subtitle recognition. If no model is available, the requested operation is paused and a blocking model setup dialog offers:

1. Download the recommended `Medium Q5` model and continue.
2. Select an existing local `.bin` model.
3. Cancel without changing the project.

The download view shows progress, transferred bytes, total bytes, and a cancel action. Successful installation selects the model, closes the dialog, and resumes the exact pending operation once. Failed or cancelled downloads leave the user in control and never start the pending operation.

## Download architecture

Rust owns model discovery, download lifecycle, filesystem writes, validation, cancellation, and deletion. Downloads are written to `$APPDATA/models/<filename>.part`, then atomically renamed after validation. The backend emits Tauri events for progress and completion. One download may run at a time.

The initial catalog exposes one recommended model while preserving an extensible model descriptor shape. The official source is primary. A backup source may be attempted after transport failure, but repository behavior must not depend exclusively on a regional mirror.

Required commands:

- `get_whisper_model_status`
- `download_whisper_model`
- `cancel_whisper_model_download`
- `select_whisper_model`
- `delete_whisper_model`
- `open_models_directory`

## Unified settings and home readiness

The existing settings modal becomes a reusable component opened from both the home screen and editor. It groups AI services, speech recognition, project defaults, and diagnostics. The speech section reports bundled `whisper-cli` readiness, installed model state, the active path, and actions to download, choose, reveal, or delete a model.

The home header gains a settings entry. When configuration is incomplete, the home screen shows a compact readiness card with direct remediation. It does not duplicate the full settings form.

## Failure handling

- Interrupted downloads retain the `.part` file for a later retry.
- Cancellation stops active network work and keeps resumable data.
- Insufficient disk space, HTTP errors, and validation errors are shown in product language.
- A failed model setup never mutates project state or loses the pending operation.
- Existing manually configured models remain supported.

## Verification

Rust tests cover model catalog/status resolution, destination safety, completed-file detection, and cancellation state. TypeScript tests cover readiness decisions and the pending-action resume contract. Full Rust tests, TypeScript tests, frontend build, formatting, and configuration checks remain required before delivery.

import { Merge, Scissors, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Project } from "../../types";
import {
  subtitleDocumentFromProject,
  type SubtitleCueDocument,
  type SubtitleCuePatch,
} from "./document";
import {
  inspectProjectSubtitleQuality,
  type SubtitleCueQualityIssue,
} from "./quality";

function formatTime(seconds: number) {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const remainder = safe - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${remainder.toFixed(2).padStart(5, "0")}`;
}

function SubtitleCueRow({
  cue,
  selected,
  onSelect,
  canSplit,
  canMerge,
  onSplit,
  onMerge,
  issues,
  onFixIssue,
  onPatch,
}: {
  cue: SubtitleCueDocument;
  selected: boolean;
  onSelect: () => void;
  canSplit: boolean;
  canMerge: boolean;
  onSplit: () => void;
  onMerge: () => void;
  issues: SubtitleCueQualityIssue[];
  onFixIssue: (issue: SubtitleCueQualityIssue) => void;
  onPatch: (patch: SubtitleCuePatch) => void;
}) {
  const [text, setText] = useState(cue.text);
  const [start, setStart] = useState(cue.start.toFixed(2));
  const [end, setEnd] = useState(cue.end.toFixed(2));

  useEffect(() => {
    setText(cue.text);
    setStart(cue.start.toFixed(2));
    setEnd(cue.end.toFixed(2));
  }, [cue.end, cue.start, cue.text]);

  const commitText = () => {
    if (text !== cue.text) onPatch({ text });
  };
  const commitTiming = () => {
    const nextStart = Number(start);
    const nextEnd = Number(end);
    if (!Number.isFinite(nextStart) || !Number.isFinite(nextEnd)) {
      setStart(cue.start.toFixed(2));
      setEnd(cue.end.toFixed(2));
      return;
    }
    if (nextStart !== cue.start || nextEnd !== cue.end)
      onPatch({ start: nextStart, end: nextEnd });
  };

  return (
    <div
      className={`subtitle-workbench-row ${selected ? "selected" : ""} ${cue.locked ? "locked" : ""}`}
    >
      <button
        className="subtitle-workbench-jump"
        onClick={onSelect}
        title="定位到时间线"
      >
        <span>{formatTime(cue.start)}</span>
        <small>
          {cue.trackName}
          {cue.role === "target"
            ? " · 译"
            : cue.role === "source"
              ? " · 原"
              : ""}
        </small>
      </button>
      <div className="subtitle-workbench-timing">
        <input
          aria-label="字幕开始时间"
          disabled={cue.locked}
          inputMode="decimal"
          value={start}
          onFocus={onSelect}
          onChange={(event) => setStart(event.target.value)}
          onBlur={commitTiming}
        />
        <span>–</span>
        <input
          aria-label="字幕结束时间"
          disabled={cue.locked}
          inputMode="decimal"
          value={end}
          onFocus={onSelect}
          onChange={(event) => setEnd(event.target.value)}
          onBlur={commitTiming}
        />
      </div>
      <textarea
        aria-label="字幕文本"
        disabled={cue.locked}
        value={text}
        rows={2}
        onFocus={onSelect}
        onChange={(event) => setText(event.target.value)}
        onBlur={commitText}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
      />
      <div className="subtitle-workbench-meta">
        <span>
          {cue.words.length ? `${cue.words.length} 词` : "无词级时间"}
          {cue.groupId ? " · 双语组" : ""}
          {issues.length ? ` · ${issues.length} 个问题` : ""}
        </span>
        <div className="subtitle-workbench-actions">
          <button
            disabled={!canSplit}
            onClick={onSplit}
            title={
              cue.groupId
                ? "双语组拆分将在后续支持"
                : "按播放头附近的词边界拆分"
            }
          >
            <Scissors size={12} />
            拆分
          </button>
          <button
            disabled={!canMerge}
            onClick={onMerge}
            title={cue.groupId ? "双语组合并将在后续支持" : "与下一条字幕合并"}
          >
            <Merge size={12} />
            合并
          </button>
        </div>
      </div>
      {issues.length ? (
        <div className="subtitle-workbench-issues">
          {issues.map((issue) => (
            <span
              key={`${issue.type}:${issue.message}`}
              className={issue.severity}
            >
              {issue.message}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Phase 2 workbench MVP. The document is still derived from Project clips, so
 * every edit remains compatible with the existing timeline and persistence path.
 */
export function SubtitleWorkbench({
  project,
  selectedCueId,
  onSelectCue,
  onPatchCue,
  canSplitCue,
  canMergeCue,
  onSplitCue,
  onMergeCue,
  onFixIssue,
}: {
  project: Project | null;
  selectedCueId: string | null;
  onSelectCue: (cueId: string) => void;
  onPatchCue: (cueId: string, patch: SubtitleCuePatch) => void;
  canSplitCue: (cueId: string) => boolean;
  canMergeCue: (cueId: string) => boolean;
  onSplitCue: (cueId: string) => void;
  onMergeCue: (cueId: string) => void;
  onFixIssue: (cueId: string, issue: SubtitleCueQualityIssue) => void;
}) {
  const [query, setQuery] = useState("");
  const [onlyIssues, setOnlyIssues] = useState(false);
  const document = useMemo(
    () => (project ? subtitleDocumentFromProject(project) : null),
    [project],
  );
  const issues = useMemo(
    () => (project ? inspectProjectSubtitleQuality(project) : []),
    [project],
  );
  const issuesByCue = useMemo(() => {
    const map = new Map<string, SubtitleCueQualityIssue[]>();
    for (const issue of issues)
      map.set(issue.cueId, [...(map.get(issue.cueId) ?? []), issue]);
    return map;
  }, [issues]);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleCues =
    document?.cues.filter((cue) => {
      if (onlyIssues && !issuesByCue.get(cue.id)?.length) return false;
      if (!normalizedQuery) return true;
      return `${cue.text} ${cue.trackName} ${cue.language ?? ""}`
        .toLocaleLowerCase()
        .includes(normalizedQuery);
    }) ?? [];

  return (
    <div className="text-section subtitle-workbench">
      <div className="text-section-title">
        <Search size={15} />
        <span>字幕工作台</span>
        <em>{document?.cues.length ?? 0} 条</em>
      </div>
      <p className="style-hint">
        点击时间码定位时间线；文本和时间在失焦或按 Cmd/Ctrl + Enter
        后保存。锁定轨道只读。
      </p>
      <div className="subtitle-workbench-filterbar">
        <label className="subtitle-workbench-search">
          <Search size={14} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索字幕、轨道或语言"
          />
        </label>
        <button
          className={onlyIssues ? "active" : ""}
          onClick={() => setOnlyIssues((value) => !value)}
        >
          {issues.length ? `${issues.length} 个问题` : "无问题"}
        </button>
      </div>
      {!document?.cues.length ? (
        <p className="style-hint">
          识别、导入或手动添加字幕后，会在这里集中校对。
        </p>
      ) : (
        <div
          className="subtitle-workbench-list"
          role="list"
          aria-label="字幕列表"
        >
          {visibleCues.map((cue) => (
            <SubtitleCueRow
              key={cue.id}
              cue={cue}
              selected={cue.id === selectedCueId}
              onSelect={() => onSelectCue(cue.id)}
              canSplit={canSplitCue(cue.id)}
              canMerge={canMergeCue(cue.id)}
              onSplit={() => onSplitCue(cue.id)}
              onMerge={() => onMergeCue(cue.id)}
              issues={issuesByCue.get(cue.id) ?? []}
              onFixIssue={(issue) => onFixIssue(cue.id, issue)}
              onPatch={(patch) => onPatchCue(cue.id, patch)}
            />
          ))}
          {visibleCues.length === 0 ? (
            <p className="style-hint">没有匹配的字幕。</p>
          ) : null}
        </div>
      )}
    </div>
  );
}

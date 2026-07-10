import type { ReactNode } from "react";

export function ToolPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="tool-panel" aria-label={`${title}工具`}>
      <header className="tool-panel-header">
        <strong>{title}</strong>
      </header>
      <div className="tool-panel-body">{children}</div>
    </section>
  );
}

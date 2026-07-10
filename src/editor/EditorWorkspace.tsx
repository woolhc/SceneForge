import { useEffect, useMemo, type ReactNode } from "react";
import { Group, Panel, Separator, useGroupRef } from "react-resizable-panels";
import { editorLayoutsForMode, type EditorMode } from "./editorLayout";

export function EditorWorkspace({
  mode,
  tools,
  preview,
  inspector,
  timeline,
}: {
  mode: EditorMode;
  tools: ReactNode;
  preview: ReactNode;
  inspector: ReactNode;
  timeline: ReactNode;
}) {
  const layouts = useMemo(() => editorLayoutsForMode(mode), [mode]);
  const verticalGroupRef = useGroupRef();
  const horizontalGroupRef = useGroupRef();

  useEffect(() => {
    verticalGroupRef.current?.setLayout(layouts.vertical);
    horizontalGroupRef.current?.setLayout(layouts.horizontal);
  }, [layouts.horizontal, layouts.vertical, horizontalGroupRef, verticalGroupRef]);

  return (
    <Group orientation="vertical" className="editor-main-group" groupRef={verticalGroupRef} defaultLayout={layouts.vertical}>
      <Panel id="workspace" minSize="20%">
        <main className="workspace">
          <Group orientation="horizontal" groupRef={horizontalGroupRef} defaultLayout={layouts.horizontal}>
            <Panel id="tools" minSize="6%" maxSize="40%">{tools}</Panel>
            <Separator />
            <Panel id="preview" minSize="20%">{preview}</Panel>
            <Separator />
            <Panel id="inspector" minSize="12%" maxSize="45%">{inspector}</Panel>
          </Group>
        </main>
      </Panel>
      <Separator />
      <Panel id="timeline" minSize="12%">{timeline}</Panel>
    </Group>
  );
}

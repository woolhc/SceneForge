import type { ReactNode } from "react";

export function PreviewWorkspace({
  toolbar,
  viewport,
  transport,
}: {
  toolbar: ReactNode;
  viewport: ReactNode;
  transport: ReactNode;
}) {
  return (
    <section className="preview-column">
      {toolbar}
      {viewport}
      {transport}
    </section>
  );
}

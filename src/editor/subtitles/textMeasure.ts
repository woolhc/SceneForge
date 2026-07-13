let measurementCanvas: HTMLCanvasElement | null = null;

function approximateGlyphWidth(character: string, fontSize: number) {
  if (/\s/.test(character)) return fontSize * 0.32;
  if (/^[\u0000-\u00ff]$/.test(character)) {
    if (/[ilI1.,'`]/.test(character)) return fontSize * 0.3;
    if (/[MW@#%]/.test(character)) return fontSize * 0.9;
    return fontSize * 0.56;
  }
  return fontSize;
}

export function measureTextWidth(
  text: string,
  fontFamily: string,
  fontSize: number,
  fontWeight = 700,
  letterSpacing = 0,
): number {
  if (typeof document !== "undefined") {
    measurementCanvas ??= document.createElement("canvas");
    const context = measurementCanvas.getContext("2d");
    if (context) {
      context.font = `${fontWeight} ${fontSize}px "${fontFamily}"`;
      return context.measureText(text).width + Math.max(0, text.length - 1) * letterSpacing;
    }
  }
  return [...text].reduce((width, character) => width + approximateGlyphWidth(character, fontSize), 0)
    + Math.max(0, text.length - 1) * letterSpacing;
}

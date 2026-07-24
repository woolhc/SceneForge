/** 判断两个连续词/字之间是否需要插入空格（英文单词间、标点后接字母数字、句号后接新句等场景）。 */
export function needsWordSpace(previousText: string, currentText: string): boolean {
  if (!previousText || !currentText) return false;
  const previous = previousText[previousText.length - 1];
  const current = currentText[0];
  const alphanumericBoundary = /[a-z0-9]/i.test(previous) && /[a-z0-9]/i.test(current);
  const punctuationBoundary = /[,;:!?]/.test(previous) && /[a-z0-9]/i.test(current);
  const sentenceBoundary = previous === "."
    && /[a-z0-9]/i.test(current)
    && !(/^\d+\.$/.test(previousText) && /\d/.test(current));
  return alphanumericBoundary || punctuationBoundary || sentenceBoundary;
}

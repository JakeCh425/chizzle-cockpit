let globalPracticeMode = false;

export function getGlobalPracticeMode(): boolean {
  return globalPracticeMode;
}

export function setGlobalPracticeMode(val: boolean): void {
  globalPracticeMode = Boolean(val);
}

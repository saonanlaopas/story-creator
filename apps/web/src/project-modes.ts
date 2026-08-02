import type { ProjectEntryMode } from "@story-creator/domain";

export const projectModes: Array<{ value: ProjectEntryMode; label: string; description: string }> = [
  { value: "premise", label: "Start from a premise", description: "Begin with a new idea and build the story foundation." },
  { value: "import-mend", label: "Import and mend", description: "Bring in existing work and plan focused repairs later." },
  { value: "import-continue", label: "Import and continue", description: "Bring in existing work and continue from a clear boundary later." }
];

export function projectModeLabel(entryMode: ProjectEntryMode): string {
  return projectModes.find((mode) => mode.value === entryMode)?.label ?? entryMode;
}

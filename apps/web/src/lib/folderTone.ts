export const FOLDER_TONES = ["indigo", "olive", "stone", "berry", "orchid", "moss"] as const;
export type FolderTone = (typeof FOLDER_TONES)[number];

/** Stable decorative colour name for a folder id (folders store no colour). */
export function folderTone(id: string): FolderTone {
  let sum = 0;
  for (let i = 0; i < id.length; i += 1) sum += id.charCodeAt(i);
  return FOLDER_TONES[sum % FOLDER_TONES.length];
}

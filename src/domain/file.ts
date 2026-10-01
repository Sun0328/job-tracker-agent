/** What a stored object is for. Keys in the bucket are grouped by kind so a listing stays readable. */
export type FileKind = "cv" | "cover-letter" | "job-ad" | "attachment";

export const FILE_KINDS: FileKind[] = ["cv", "cover-letter", "job-ad", "attachment"];

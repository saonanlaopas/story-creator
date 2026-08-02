import type { SourceMediaType } from "@story-creator/domain";

export interface SourceFileLike {
  readonly name: string;
  readonly type: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface DecodedSourceFile {
  filename: string;
  mediaType: SourceMediaType;
  text: string;
}

export class InvalidSourceFileError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidSourceFileError";
  }
}

function mediaTypeForFilename(filename: string): SourceMediaType | null {
  const lowerFilename = filename.toLowerCase();
  if (lowerFilename.endsWith(".txt")) return "text/plain";
  if (lowerFilename.endsWith(".md") || lowerFilename.endsWith(".markdown")) return "text/markdown";
  return null;
}

export async function readSourceFile(file: SourceFileLike): Promise<DecodedSourceFile> {
  const mediaType = mediaTypeForFilename(file.name);
  if (!mediaType) {
    throw new InvalidSourceFileError("Unsupported source file. Choose a .txt, .md, or .markdown file.");
  }

  const declaredMediaType = file.type.trim().toLowerCase();
  if (declaredMediaType && declaredMediaType !== mediaType) {
    throw new InvalidSourceFileError(
      `The selected file has incompatible MIME type "${file.type}" for ${file.name}. Choose a ${mediaType} file or clear the file type.`
    );
  }

  let bytes: ArrayBuffer;
  try {
    bytes = await file.arrayBuffer();
  } catch {
    throw new InvalidSourceFileError("Could not read the selected file. Choose it again or save a new copy.");
  }

  try {
    // Keep BOM bytes in the decoded string so domain normalization removes
    // exactly one leading BOM and preserves any additional valid Unicode.
    const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
    return {
      filename: file.name,
      mediaType,
      text: decoder.decode(bytes)
    };
  } catch {
    throw new InvalidSourceFileError("Invalid UTF-8 file. Save the file as UTF-8 and try again.");
  }
}

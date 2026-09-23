// Upload rules shared by the web portal and the field app. STUB: the constants and the
// implementations below are placeholders — they are deliberately unusable until filled in.

export type FileRejectionReason = "empty" | "size" | "type" | "extension";

export interface FileConstraints {
  /** Lower-case MIME types accepted for this slot. */
  readonly allowedMimeTypes: readonly string[];
  /** Lower-case extensions, without the leading dot, accepted for this slot. */
  readonly allowedExtensions: readonly string[];
  readonly maxBytes: number;
}

export interface FileCandidate {
  readonly name: string;
  readonly size: number;
  readonly type: string;
}

export type FileValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: FileRejectionReason; readonly message: string };

// TODO(shared): real ICMS evidence-upload limits; both clients must read them from here, never inline them.
export const EVIDENCE_PHOTO_CONSTRAINTS: FileConstraints = {
  allowedMimeTypes: [],
  allowedExtensions: [],
  maxBytes: 0,
};

// TODO(shared): real ICMS document-upload limits.
export const EVIDENCE_DOCUMENT_CONSTRAINTS: FileConstraints = {
  allowedMimeTypes: [],
  allowedExtensions: [],
  maxBytes: 0,
};

// Throws rather than returning ok, so a caller that ships before this lands fails loudly instead of accepting anything.
export function validateFile(_file: FileCandidate, _constraints: FileConstraints): FileValidation {
  throw new Error("@ada/shared: validateFile is not implemented yet");
}

// Byte counts come back from the API and from the native picker; both clients must render them identically.
export function formatFileSize(_bytes: number): string {
  throw new Error("@ada/shared: formatFileSize is not implemented yet");
}

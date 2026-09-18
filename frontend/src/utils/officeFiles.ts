import {
  MAX_FILE_SIZE,
  MAX_OFFICE_FILE_SIZE,
  MAX_REVIEW_IMAGE_FILE_SIZE,
  MAX_REVIEW_PDF_FILE_SIZE,
} from "../constants/index";

/**
 * Word・Excel・PowerPoint のファイル。
 *
 * 審査処理が XML から Markdown に変換して読むので、PDF と同じ「文書」として
 * アップロードできる。
 */
export const OFFICE_FILE_TYPES: Record<string, string[]> = {
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [
    ".docx",
  ],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [
    ".xlsx",
  ],
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": [
    ".pptx",
  ],
};

const OFFICE_EXTENSIONS = Object.values(OFFICE_FILE_TYPES).flat();

// パスワードや暗号化ラベルで保護された Office ファイルは ZIP ではなく、この形式になる
const CFB_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

export const isOfficeFileName = (name: string): boolean =>
  OFFICE_EXTENSIONS.some((extension) => name.toLowerCase().endsWith(extension));

export const isPdfFileName = (name: string): boolean =>
  name.toLowerCase().endsWith(".pdf");

export const IMAGE_EXTENSIONS = [
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".bmp",
  ".tif",
  ".tiff",
  ".webp",
];

/** 画像ファイルか。アップロード先と documents[].fileType の振り分けに使う */
export const isImageFileName = (name: string): boolean =>
  IMAGE_EXTENSIONS.some((extension) => name.toLowerCase().endsWith(extension));

/** 審査するファイルの種類ごとの、1ファイルの上限（バックエンドの maxFileSizeFor と揃える） */
export const maxFileSizeFor = (name: string): number => {
  if (isOfficeFileName(name)) {
    return MAX_OFFICE_FILE_SIZE;
  }
  if (isPdfFileName(name)) {
    return MAX_REVIEW_PDF_FILE_SIZE;
  }
  if (
    IMAGE_EXTENSIONS.some((extension) => name.toLowerCase().endsWith(extension))
  ) {
    return MAX_REVIEW_IMAGE_FILE_SIZE;
  }
  return MAX_FILE_SIZE;
};

/**
 * 保護されていて中身を読めない Office ファイルか。
 * 審査を始めてから失敗しないよう、ファイルを選んだときに確かめる。
 */
export const isProtectedOfficeFile = async (file: File): Promise<boolean> => {
  if (!isOfficeFileName(file.name)) {
    return false;
  }
  const header = new Uint8Array(
    await file.slice(0, CFB_SIGNATURE.length).arrayBuffer()
  );
  return CFB_SIGNATURE.every((byte, index) => header[index] === byte);
};

/** What a handler gets from `@UploadedFile()` with multer's in-memory storage. */
export interface UploadedFileData {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

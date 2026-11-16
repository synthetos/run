/** The slice of the R2 binding this Worker uses; the fake in the tests implements the same. */
export interface StoredObject {
  readonly size: number;
  readonly body: ReadableStream<Uint8Array>;
}

export interface PutOptions {
  /** R2 checks the uploaded bytes against this hex digest and refuses the object when they differ. */
  readonly sha256: string;
}

export interface Bucket {
  put(key: string, body: ReadableStream<Uint8Array>, options: PutOptions): Promise<{ readonly size: number } | null>;
  get(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
}

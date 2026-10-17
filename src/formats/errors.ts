/** A user-facing (Turkish) problem with the file's format or content. */
export class FormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FormatError";
  }
}

/** Equivalente del parser en el navegador: no hay HTTP, pero se conserva el código de error. */
export class ParserError extends Error {
  readonly statusCode = 400;

  constructor(
    message: string,
    public readonly code: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ParserError';
  }
}

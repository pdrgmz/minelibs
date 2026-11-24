/** Mínimo reemplazo de `node:assert` para dependencias que lo importan en el navegador. */
function ok(value: unknown, message?: string): asserts value {
  if (!value) throw new Error(message ?? 'Assertion failed');
}

const assert = { ok };
export default assert;
export { ok };

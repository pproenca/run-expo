declare module "node:test" {
  export function describe(name: string, fn: () => void): void;
  export function it(name: string, fn: () => void | Promise<void>): void;
}

declare module "node:assert/strict" {
  const assert: {
    deepEqual(actual: unknown, expected: unknown, message?: string): void;
    equal(actual: unknown, expected: unknown, message?: string): void;
    match(actual: string, regexp: RegExp, message?: string): void;
    throws(fn: () => unknown, expected?: RegExp | ((error: unknown) => boolean), message?: string): void;
    doesNotMatch(actual: string, regexp: RegExp, message?: string): void;
  };
  export default assert;
}

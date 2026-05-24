declare module "node:test" {
  export function describe(name: string, fn: () => void | Promise<void>): void;
  export function it(name: string, fn: () => void | Promise<void>): void;
}

declare module "node:assert/strict" {
  const assert: {
    equal(actual: unknown, expected: unknown, message?: string): void;
    deepEqual(actual: unknown, expected: unknown, message?: string): void;
    match(actual: string, expected: RegExp, message?: string): void;
    doesNotMatch(actual: string, expected: RegExp, message?: string): void;
    ok(value: unknown, message?: string): void;
    rejects(fn: () => unknown | Promise<unknown>, expected?: RegExp | object, message?: string): Promise<void>;
    throws(fn: () => unknown, expected?: RegExp | object | ((error: unknown) => boolean), message?: string): void;
  };
  export default assert;
}

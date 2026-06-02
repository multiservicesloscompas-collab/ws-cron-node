import assert from 'node:assert/strict'

export { assert }

export const assertEquals = <T>(actual: T, expected: T, message?: string): void => {
  assert.deepStrictEqual(actual, expected, message)
}

export const assertStringIncludes = (
  actual: string,
  expected: string,
  message?: string,
): void => {
  assert.ok(
    actual.includes(expected),
    message ?? `Expected string to include ${JSON.stringify(expected)}`,
  )
}

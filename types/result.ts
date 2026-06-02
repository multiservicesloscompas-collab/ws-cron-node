/**
 * Result Pattern — Functional error handling without exceptions.
 *
 * Un solo check: isFailure(result). Si no es failure, es success.
 *
 * @example
 * const divide = (a: number, b: number): Result<number, string> =>
 *   b === 0 ? failure('No se puede dividir entre cero') : success(a / b)
 *
 * const r = divide(10, 2)
 * if (isFailure(r)) return console.error(r.getError())
 * console.log(r.getValue()) // 5
 */

// --- Tipo principal ---

export type Result<T, E = string> = {
  /** Retorna el valor si es exitoso. Lanza si es error. */
  getValue(): T
  /** Retorna el error si es fallido. Lanza si es exitoso. */
  getError(): E
  /** true si la operación falló. */
  isFailure: boolean
}

// --- Constructores ---

/**
 * Crea un Result exitoso con el valor dado.
 */
export const success = <T>(value: T): Result<T, never> => ({
  getValue: () => value,
  getError: () => { throw new Error('Cannot getError on a success result') },
  isFailure: false,
})

/**
 * Crea un Result fallido con el error dado.
 */
export const failure = <E>(error: E): Result<never, E> => ({
  getValue: () => { throw new Error('Cannot getValue on a failure result') },
  getError: () => error,
  isFailure: true,
})

// --- Guard ---

/**
 * Verifica si un Result es fallido.
 * Uso: `if (isFailure(result)) return console.error(r.getError())`
 */
export const isFailure = <T, E>(r: Result<T, E>): boolean => r.isFailure

// --- Combinadores ---

/**
 * Transforma el error si el Result es fallido.
 */
export const mapErr = <T, E, F>(
  r: Result<T, E>,
  fn: (error: E) => F,
): Result<T, F> =>
  r.isFailure ? failure(fn(r.getError())) : (r as unknown as Result<T, F>)

/**
 * Encadena operaciones que retornan Result.
 */
export const chain = <T, E, U>(
  r: Result<T, E>,
  fn: (value: T) => Result<U, E>,
): Result<U, E> =>
  r.isFailure ? (r as unknown as Result<U, E>) : fn(r.getValue())

/**
 * Ejecuta un efecto si el Result es exitoso.
 */
export const tap = <T, E>(
  r: Result<T, E>,
  fn: (value: T) => void,
): Result<T, E> => {
  if (!r.isFailure) fn(r.getValue())
  return r
}

/**
 * Ejecuta un efecto si el Result es fallido.
 */
export const tapErr = <T, E>(
  r: Result<T, E>,
  fn: (error: E) => void,
): Result<T, E> => {
  if (r.isFailure) fn(r.getError())
  return r
}

// --- Helpers async ---

/**
 * Versión async de chain.
 */
export const asyncChain = async <T, E, U>(
  r: Result<T, E>,
  fn: (value: T) => Promise<Result<U, E>>,
): Promise<Result<U, E>> =>
  r.isFailure ? (r as unknown as Result<U, E>) : fn(r.getValue())

import { failure, success, type Result } from "../../types/result.ts";

export interface LlmGenerateInput {
  prompt: string;
  model: string;
}

export interface LlmAdapter {
  generateText: (input: LlmGenerateInput) => Promise<Result<string, string>>;
}

export const makeUnavailableLlmAdapter = (reason: string): LlmAdapter => ({
  generateText: async () => failure(reason),
});

export const normalizeLlmText = (value: unknown): Result<string, string> => {
  if (typeof value !== "string") {
    return failure("La respuesta del modelo no contiene texto");
  }

  const trimmed = value.trim();
  if (!trimmed) return failure("La respuesta del modelo llegó vacía");

  return success(trimmed);
};

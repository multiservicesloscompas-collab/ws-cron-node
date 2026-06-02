import { GoogleGenAI } from "@google/genai";
import { failure, success, type Result } from "../../types/result.ts";
import {
  makeUnavailableLlmAdapter,
  normalizeLlmText,
  type LlmAdapter,
} from "./llm-adapter.ts";

export interface GeminiApiKeyAdapterDeps {
  apiKey: string;
}

export const makeGeminiApiKeyAdapter = (
  deps: GeminiApiKeyAdapterDeps,
): LlmAdapter => {
  if (!deps.apiKey.trim()) {
    return makeUnavailableLlmAdapter(
      "Falta configurar GEMINI_API_KEY en el archivo .env",
    );
  }

  const ai = new GoogleGenAI({ apiKey: deps.apiKey.trim() });

  return {
    generateText: async ({ prompt, model }) => {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: prompt,
        });

        const textResult = normalizeLlmText(response.text);
        if (textResult.isFailure) return failure(textResult.getError());

        return success(textResult.getValue());
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return failure(`No se pudo generar el mensaje con Gemini: ${reason}`);
      }
    },
  };
};

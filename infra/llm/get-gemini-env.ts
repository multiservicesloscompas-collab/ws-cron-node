export interface GeminiEnv {
  apiKey: string;
}

export const getGeminiEnv = (): GeminiEnv => ({
  apiKey: process.env.GEMINI_API_KEY || "",
});

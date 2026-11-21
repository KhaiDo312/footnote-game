/**
 * The only file that calls the AI model. Server-side only (actions and jobs).
 *
 * createDeepSpaceAI(env, 'anthropic') routes through DeepSpace's proxy. With
 * no `authToken`, the app owner pays, and no API key ever appears in our
 * code. The model id comes from AI_MODEL in config.ts.
 */

import { generateText, Output } from 'ai'
import { createDeepSpaceAI } from 'deepspace/worker'
import type { Env } from '../../worker'
import { AI_MAX_OUTPUT_TOKENS, AI_MODEL, MAX_SOURCE_CHARS } from './config'
import { GENERATION_SYSTEM, generatedSetSchema, generationPrompt, type GeneratedSet } from './prompts'

/** Asks the AI for questions about the document. Throws if the call fails. */
export async function generateQuestions(env: Env, sourceText: string): Promise<GeneratedSet> {
  const ai = createDeepSpaceAI(env, 'anthropic')
  const { output } = await generateText({
    model: ai(AI_MODEL),
    system: GENERATION_SYSTEM,
    prompt: generationPrompt(sourceText.slice(0, MAX_SOURCE_CHARS)),
    output: Output.object({ schema: generatedSetSchema }),
    maxOutputTokens: AI_MAX_OUTPUT_TOKENS,
  })
  return output
}

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
import { AI_MAX_OUTPUT_TOKENS, AI_MODEL, JUDGE_MAX_OUTPUT_TOKENS, MAX_SOURCE_CHARS } from './config'
import {
  GENERATION_SYSTEM,
  generatedSetSchema,
  generationPrompt,
  JUDGE_SYSTEM,
  judgementSchema,
  type GeneratedSet,
  type Judgement,
} from './prompts'

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

/**
 * Asks the AI whether the passages support one answer. `prompt` comes from
 * judgePrompt(). `signal` cancels the call when the judge's time is up.
 * Throws if the call fails; the caller turns that into "Couldn't check".
 */
export async function askJudge(env: Env, prompt: string, signal: AbortSignal): Promise<Judgement> {
  const ai = createDeepSpaceAI(env, 'anthropic')
  const { output } = await generateText({
    model: ai(AI_MODEL),
    system: JUDGE_SYSTEM,
    prompt,
    output: Output.object({ schema: judgementSchema }),
    maxOutputTokens: JUDGE_MAX_OUTPUT_TOKENS,
    abortSignal: signal,
  })
  return output
}

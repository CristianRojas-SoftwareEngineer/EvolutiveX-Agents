// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Proveedor único de texto: Gemini API (free tier) vía fetch nativo, sin SDK.
// thinking desactivado (thinkingBudget: 0) y salida acotada para optimizar
// latencia y cuota.
import {
  buildUserContent,
  MAX_OUTPUT_TOKENS,
  REQUEST_TIMEOUT_MS,
  type GenerationInput,
} from "./provider.js";
import { SUMMARY_SYSTEM_PROMPT } from "./prompts.js";

// Modelo del Orchestrator (§5.4): gemini-3.1-flash-lite, probado en
// producción. Verificar vigencia si Gemini cambia su catálogo.
const MODEL = "gemini-3.1-flash-lite";
const buildEndpointUrl = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
}

export class GeminiProvider {
  readonly name = "gemini";
  constructor(private readonly apiKey: string) {}

  async generate(input: GenerationInput): Promise<string> {
    if (!this.apiKey) throw new Error("Gemini: sin API key");

    const content = buildUserContent(input);

    const body = {
      systemInstruction: {
        parts: [{ text: SUMMARY_SYSTEM_PROMPT }],
      },
      contents: [{ role: "user", parts: [{ text: content }] }],
      generationConfig: {
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        temperature: 0.7,
        thinkingConfig: { thinkingBudget: 0 },
      },
    };

    const res = await fetch(buildEndpointUrl(MODEL), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": this.apiKey,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);

    const data = (await res.json()) as GeminiResponse;
    const text = (data.candidates?.[0]?.content?.parts ?? [])
      .map((p) => p.text ?? "")
      .join("")
      .trim();

    if (!text) throw new Error("Gemini devolvió respuesta vacía");
    return text;
  }
}

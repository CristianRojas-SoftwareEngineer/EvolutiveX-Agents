// Configuración de ESLint (flat config). Cubre el código fuente TypeScript de
// src/ y tests/; el chequeo de tipos lo hace tsc (npm run typecheck), así que
// aquí se usa la config recomendada sin type-checking. eslint-config-prettier va
// al final para desactivar reglas de formato (Prettier es la autoridad de estilo).
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: [
      "dist/",
      "node_modules/",
      "tests/.build/",
      "*.mjs",
      ".claude-plugin/types/",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // El transcript enriquecido corre en el sandbox de function hooks: no puede
  // importar módulos de Node ni código de fuera de su carpeta.
  {
    files: ["src/transcript/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["node:*", "../*"],
              message:
                "src/transcript/ corre en el sandbox de Claude Code: solo puede importar módulos de su propia carpeta.",
            },
          ],
        },
      ],
    },
  },
  prettier,
);

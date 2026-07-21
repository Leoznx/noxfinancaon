import js from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", ".output", ".vinxi", ".vercel", "src/routeTree.gen.ts"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "server-only",
              message:
                "TanStack Start does not use the Next.js `server-only` package. Rename the module to `*.server.ts` or mark it with `@tanstack/react-start/server-only`.",
            },
          ],
        },
      ],
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
      // O projeto integra respostas dinâmicas do Supabase e APIs externas em muitos
      // pontos; o TypeScript estrito continua responsável pelos erros estruturais.
      "@typescript-eslint/no-explicit-any": "off",
      // Blocos catch vazios são usados deliberadamente nas limpezas best-effort de
      // storage/localStorage, onde a falha não pode interromper logout e hidratação.
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  eslintPluginPrettier,
  {
    rules: {
      // Formatação é verificada separadamente; não deve esconder erros funcionais
      // do ESLint nem falhar só por CRLF/LF entre Windows e o ambiente de build.
      "prettier/prettier": "off",
    },
  },
);

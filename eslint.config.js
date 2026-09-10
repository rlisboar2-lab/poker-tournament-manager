// eslint.config.js
// Configuração base (flat config). Objetivo desta etapa: diagnosticar, não corrigir em massa.
//
// `rules-of-hooks` e `exhaustive-deps` ficam no nível padrão — são os que valem
// como porta de qualidade e os que os `eslint-disable-line` do código já citam.
//
// As regras novas do React Compiler (`purity`, `refs`, `set-state-in-effect`)
// entram como warning: apontam justamente o estado espelhado e as refs lidas
// durante o render do motor do relógio, que são trabalho da S8 da auditoria.
// Deixá-las como error travaria `npm run lint` em vermelho permanente.

import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'supabase'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-hooks/purity': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // `(window as any).webkitAudioContext`: escape de prefixo de fornecedor em Clock.tsx.
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
);

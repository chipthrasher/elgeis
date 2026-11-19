import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import globals from 'globals'
import { defineConfig } from 'eslint/config'

export default defineConfig(
    { ignores: ['assets/', 'dist/', 'node_modules/'] },
    js.configs.recommended,
    tseslint.configs.recommended,
    {
        languageOptions: { globals: { ...globals.browser, ...globals.node } },
        rules: {
            eqeqeq: ['error', 'smart'],
            'guard-for-in': 'error',
            'no-throw-literal': 'error',
            'no-await-in-loop': 'error',
            'default-param-last': 'error',
            'no-self-compare': 'error',
            camelcase: 'error',
        },
    },
)

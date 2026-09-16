import nx from '@nx/eslint-plugin';

// Configuración base del workspace (flat config).
// Sin reglas con información de tipos (D4 de bootstrap-monorepo): el test de reglas usa
// ESLint.lintText sobre rutas virtuales, que no pertenecen a ningún tsconfig.
// Límites entre proyectos, capas de dominio, SDKs de IA, `any` y `console` llegan en el grupo 9.
export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    ignores: [
      '**/dist',
      '**/out-tsc',
      '**/coverage',
      '**/tmp',
      '**/.nx',
      '**/node_modules',
      '**/vitest.config.*.timestamp*',
    ],
  },
];

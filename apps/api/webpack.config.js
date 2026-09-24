const { NxAppWebpackPlugin } = require('@nx/webpack/app-plugin');
const { join } = require('path');

module.exports = {
  output: {
    path: join(__dirname, '../../dist/apps/api'),
    clean: true,
    ...(process.env.NODE_ENV !== 'production' && {
      devtoolModuleFilenameTemplate: '[absolute-resource-path]',
    }),
  },
  plugins: [
    new NxAppWebpackPlugin({
      target: 'node',
      compiler: 'tsc',
      main: './src/main.ts',
      // Ruta **absoluta** a propósito (ADR-048): `GeneratePackageJsonPlugin` de Nx 23.2.1 llama a
      // `readTsConfig(options.tsConfig)` con el valor **tal cual** —a diferencia del resto de consumidores, que
      // hacen `path.isAbsolute(tsConfig) ? tsConfig : path.join(options.root, tsConfig)`
      // (`@nx/webpack/dist/src/plugins/nx-webpack-plugin/lib/apply-base-config.js:267-269`)—. Con la ruta
      // relativa, y como el ejecutor corre con el cwd en el directorio del proyecto, el fichero no se encuentra,
      // `importHelpers` se lee como `false` y Nx NO añade `tslib` al manifiesto que genera, aunque el bundle la
      // requiera ~1.500 veces. El contenedor construía bien y moría al arrancar con
      // `Error: Cannot find module 'tslib'`. Con la ruta absoluta, `importHelpers` se lee `true` y Nx la añade
      // sola. Quien devuelva aquí `'./tsconfig.app.json'` reintroduce exactamente ese fallo de arranque.
      // No basta con esto: `tslib` tiene que estar además en `dependencies` del package.json raíz, porque
      // `createPackageJson` descarta con `isProduction` todo lo que figure en `devDependencies` raíz.
      tsConfig: join(__dirname, 'tsconfig.app.json'),
      assets: [
        './src/assets',
        // Prompts de libs/ai, igual que el worker: `api` ejecuta `extract-pasted-job` dentro de la petición (D1 de
        // paste-job-description). Solo los `.md`; los fixtures del mock viven en un directorio hermano y no se copian.
        // `input` sin `./` se resuelve contra la raíz del workspace. copy-webpack-plugin no falla si no hay
        // coincidencias (noErrorOnMissing), por eso CI comprueba el archivo tras `build`.
        {
          input: 'libs/ai/src/infrastructure/prompts',
          glob: '**/*.md',
          output: 'assets/ai/prompts',
        },
      ],
      optimization: false,
      outputHashing: 'none',
      generatePackageJson: true,
      sourceMap: true,
    }),
  ],
};

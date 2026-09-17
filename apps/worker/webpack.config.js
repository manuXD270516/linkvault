const { NxAppWebpackPlugin } = require('@nx/webpack/app-plugin');
const { join } = require('path');

module.exports = {
  output: {
    path: join(__dirname, '../../dist/apps/worker'),
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
      tsConfig: './tsconfig.app.json',
      assets: [
        './src/assets',
        // Prompts de libs/ai (D7 de ai-gateway-core): solo los `.md`; los fixtures del mock viven en un directorio
        // hermano y no se copian. `input` sin `./` se resuelve contra la raíz del workspace. copy-webpack-plugin
        // no falla si no hay coincidencias (noErrorOnMissing), por eso CI comprueba el archivo tras `build`.
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

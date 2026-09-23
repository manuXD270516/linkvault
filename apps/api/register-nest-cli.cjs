'use strict';

/**
 * Nest CLI bootstrap for `node -r` (seed-demo, backfill-*).
 * `tsx` / Node type-stripping do not emit `design:paramtypes`; SWC does
 * (same as Vitest's unplugin-swc). Forces CommonJS so extensionless
 * relative imports resolve via the hook below.
 */
require('reflect-metadata');

const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { transformSync } = require('@swc/core');

const workspaceRoot = path.resolve(__dirname, '../..');

const aliases = {
  '@linkvault/shared': path.join(workspaceRoot, 'libs/shared/src/index.ts'),
  '@linkvault/ai': path.join(workspaceRoot, 'libs/ai/src/index.ts'),
  '@linkvault/testing': path.join(workspaceRoot, 'tools/testing/src/index.ts'),
  '@linkvault/test-env': path.join(workspaceRoot, 'tools/test-env/src/index.ts'),
  '@linkvault/testing/preset': path.join(
    workspaceRoot,
    'tools/testing/src/testing.preset.ts',
  ),
  '@linkvault/test-env/preset': path.join(
    workspaceRoot,
    'tools/test-env/src/test-env.preset.ts',
  ),
};

function resolveAlias(request) {
  if (Object.prototype.hasOwnProperty.call(aliases, request)) {
    return aliases[request];
  }
  for (const [alias, target] of Object.entries(aliases)) {
    if (request.startsWith(`${alias}/`)) {
      const rest = request.slice(alias.length + 1);
      return path.join(path.dirname(target), rest);
    }
  }
  return null;
}

const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
  const aliased = resolveAlias(request);
  if (aliased !== null) {
    return originalResolveFilename.call(this, aliased, parent, isMain, options);
  }

  try {
    return originalResolveFilename.call(this, request, parent, isMain, options);
  } catch (error) {
    if (
      error.code !== 'MODULE_NOT_FOUND' ||
      !(request.startsWith('.') || path.isAbsolute(request))
    ) {
      throw error;
    }
    const candidates = [
      `${request}.ts`,
      `${request}.tsx`,
      path.join(request, 'index.ts'),
      path.join(request, 'index.tsx'),
    ];
    for (const candidate of candidates) {
      try {
        return originalResolveFilename.call(
          this,
          candidate,
          parent,
          isMain,
          options,
        );
      } catch {
        // try next
      }
    }
    throw error;
  }
};

function compile(source, filename) {
  const { code } = transformSync(source, {
    filename,
    sourceMaps: 'inline',
    module: { type: 'commonjs', ignoreDynamic: true },
    jsc: {
      target: 'es2022',
      parser: {
        syntax: 'typescript',
        decorators: true,
        dynamicImport: true,
      },
      transform: {
        legacyDecorator: true,
        decoratorMetadata: true,
      },
      keepClassNames: true,
      externalHelpers: false,
    },
  });
  return code;
}

const jsExtension = Module._extensions['.js'];
Module._extensions['.ts'] = function loadTs(module, filename) {
  const source = fs.readFileSync(filename, 'utf8');
  module._compile(compile(source, filename), filename);
};
Module._extensions['.tsx'] = Module._extensions['.ts'];
// Keep .js for completeness when a TS file re-exports compiled neighbors.
Module._extensions['.js'] = jsExtension;

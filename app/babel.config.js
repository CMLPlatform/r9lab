// Jest runs CommonJS without --experimental-vm-modules, so a source `import()` throws.
// NOTE: tests only; Metro handles `import()` natively and splits the chunk.
const dynamicImportToRequire = ({ types: t }) => ({
  visitor: {
    CallExpression(path) {
      if (path.node.callee.type !== 'Import') return;
      path.replaceWith(
        t.callExpression(
          t.memberExpression(
            t.callExpression(
              t.memberExpression(t.identifier('Promise'), t.identifier('resolve')),
              [],
            ),
            t.identifier('then'),
          ),
          [
            t.arrowFunctionExpression(
              [],
              t.callExpression(t.identifier('require'), path.node.arguments),
            ),
          ],
        ),
      );
    },
  },
});

// msw's interceptors load their WASM HTTP parser relative to `import.meta.url`, which
// CommonJS Jest leaves without a file URL. NOTE: tests only.
const importMetaUrlToFileUrl = ({ types: t }) => ({
  visitor: {
    MemberExpression(path) {
      const { object, property } = path.node;
      if (object.type !== 'MetaProperty' || object.meta.name !== 'import') return;
      if (property.type !== 'Identifier' || property.name !== 'url') return;
      path.replaceWith(
        t.memberExpression(
          t.callExpression(
            t.memberExpression(
              t.callExpression(t.identifier('require'), [t.stringLiteral('node:url')]),
              t.identifier('pathToFileURL'),
            ),
            [t.identifier('__filename')],
          ),
          t.identifier('href'),
        ),
      );
    },
  },
});

module.exports = (api) => {
  // Respect explicit Babel/NODE envs, then ENVIRONMENT (used by Docker builds),
  // otherwise default to development.
  const env =
    process.env.BABEL_ENV ?? process.env.NODE_ENV ?? process.env.ENVIRONMENT ?? 'development';
  api.cache.using(() => env);

  // Treat staging as production-like for build optimizations.
  const isProduction = env === 'production' || env === 'prod' || env === 'staging';

  return {
    presets: ['babel-preset-expo'],
    // React Compiler is useful, but running it during every dev transform slows
    // Metro feedback noticeably on this app. Keep it for production bundles.
    plugins: [
      ...(env === 'test' ? [dynamicImportToRequire, importMetaUrlToFileUrl] : []),
      ...(isProduction ? [['babel-plugin-react-compiler', { target: '19' }]] : []),
    ],
  };
};

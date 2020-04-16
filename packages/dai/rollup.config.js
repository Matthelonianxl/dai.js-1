import resolve from '@rollup/plugin-node-resolve';
import babel from 'rollup-plugin-babel';
import json from '@rollup/plugin-json';

import pkg from './package.json';

const makeExternalPredicate = externalArr => {
  if (externalArr.length === 0) {
    return () => false;
  }
  const pattern = new RegExp(`^(${externalArr.join('|')})($|/)`);
  return id => pattern.test(id);
};

export default [
  // CommonJS
  {
    input: 'src/index.js',
    output: [
      { file: pkg.main, format: 'cjs', indent: false },
      { file: pkg.module, format: 'es', indent: false }
    ],
    external: makeExternalPredicate([
      ...Object.keys(pkg.dependencies || {}),
      ...Object.keys(pkg.peerDependencies || {})
    ]),
    plugins: [
      babel({
        plugins: ['@babel/plugin-proposal-class-properties'],
        runtimeHelpers: true
      }),
      resolve(),
      json()
    ]
  },

  // UMD
  {
    input: 'src/index.js',
    output: {
      file: pkg.unpkg,
      format: 'umd',
      name: '@makerdao/dai',
      indent: false
    },
    external: makeExternalPredicate([
      ...Object.keys(pkg.dependencies || {}),
      ...Object.keys(pkg.peerDependencies || {})
    ]),
    plugins: [
      babel({
        plugins: ['@babel/plugin-proposal-class-properties'],
        runtimeHelpers: true,
        exclude: 'node_modules/**'
      }),
      resolve(),
      json()
    ]
  }
];

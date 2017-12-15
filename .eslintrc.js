module.exports = {
  parser: 'babel-eslint',
  extends: ['airbnb'],
  env: {
    browser: true,
    node: true
  },
  rules: {
    'react/no-danger': 'off',
    'import/no-extraneous-dependencies': 'off',
    'arrow-parens': 'off',
    'global-require': 'off',
    'spaced-comment': 'off',
    'linebreak-style': 'off',
    'class-methods-use-this': 'off',
    'no-plusplus': ["error", { "allowForLoopAfterthoughts": true }],
    'no-param-reassign': ["error", { "props": false }],
    'comma-dangle': ['error', {
      arrays: 'always-multiline',
      objects: 'always-multiline',
      imports: 'always-multiline',
      exports: 'always-multiline',
      functions: 'ignore',
    }]
  },

  settings: {
    'import/resolver': {
      'webpack': {}
    }
  }
};

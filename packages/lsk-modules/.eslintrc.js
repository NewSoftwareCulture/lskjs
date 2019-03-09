var path = require('path');
// const user = process.env.USER;
// const warn = user === 'isuvorov' ? 'off' : 'warn';

const res =  {
  parser: 'babel-eslint',
  env: {
    browser: true,
    es6: true
  },
  extends: ['eslint:recommended', 'airbnb'],
  plugins: ['import'],
  parserOptions: {
    ecmaVersion: 8,
    sourceType: 'module',
    ecmaFeatures: {
      jsx: true,
      modules: true
    }
  },
  globals: {
    __SERVER__: true,
    __CLIENT__: true,
    __DEV__: true,
  },
  rules: {
    'class-methods-use-this': 'off',    
    'global-require': 'off',    
  },
  settings: {
    'import/resolver': {
      alias: {
        map: [
          ['~', path.resolve('./src/')],
        ],
        extensions: ['.ts', '.js', '.jsx', '.json']
      },
    }
  }
}

module.exports = res;

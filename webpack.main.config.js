const path = require('path');

module.exports = {
  mode: 'development',
  entry: './src/main/main.ts',
  target: 'electron-main',
  module: {
    rules: [
      {
        test: /\.ts$/,
        include: /src/,
        use: 'ts-loader',
      },
    ],
  },
  output: {
    path: path.resolve(__dirname, '.webpack/main'),
    filename: 'main.js',
  },
  resolve: {
    extensions: ['.ts', '.js'],
  },
  node: {
    __dirname: false,
    __filename: false,
  },
};

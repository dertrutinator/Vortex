const webpack = require('webpack');
const nodeExternals = require('webpack-node-externals');
const TerserPlugin = require('terser-webpack-plugin');

const mode = 'production';

module.exports = {
  entry: './src/main.ts',
  target: 'electron-main',
  node: { __filename: false, __dirname: false },
  mode,
  output: {
    libraryTarget: 'commonjs2',
    filename: '../app/main.js'
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        loader: 'ts-loader',
        exclude: /node_modules/,
      },
    ],
  },
  resolve: { extensions: ['.js', '.jsx', '.ts', '.tsx', '.json'] },
  plugins: [
    new webpack.DefinePlugin({
      'process.env.NODE_ENV': JSON.stringify('production'),
    }),
  ],
  devtool: 'source-map',
  optimization: {
    minimizer: [
      new TerserPlugin({
        cache: true,
        parallel: true,
        sourceMap: true,
        terserOptions: {
          compress: {},
          output: {
            max_line_len: 256,
          },
          mangle: false,
          keep_fnames: true, // required atm, name mangling breaks extensions
        }
      })
    ]
  },
  // we can't pack any node_modules, otherwise extensions can't load those modules
  externals: nodeExternals(),
};

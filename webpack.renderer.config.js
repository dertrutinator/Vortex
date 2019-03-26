var webpack = require('webpack');
var nodeExternals = require('webpack-node-externals');
const TerserPlugin = require('terser-webpack-plugin')

const mode = 'production';

module.exports = {
  entry: './src/renderer.tsx',
  target: 'electron-renderer',
  node: { __filename: false, __dirname: false },
  mode,
  output: {
    libraryTarget: 'commonjs2',
    filename: '../app/renderer.js'
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        loader: 'ts-loader',
        exclude: /node_modules/,
        options: {
          compilerOptions: {
            sourceMap: true,
            inlineSourceMap: false,
            inlineSources: false,
          }
        }
      },
    ]
  },
  resolve: { extensions: ['.js', '.jsx', '.ts', '.tsx', '.json'] },
  plugins: [
    new webpack.DefinePlugin({
      'process.env.NODE_ENV': JSON.stringify('production'),
    }),
  ],
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
  devtool: 'source-map',
  externals: nodeExternals(),
};

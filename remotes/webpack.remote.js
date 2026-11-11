const ReactRefreshPlugin = require('@pmmmwh/react-refresh-webpack-plugin');
const { appshellRemote } = require('@appshell/webpack-plugin');
const ReactRefreshSingleton = require('single-react-refresh-plugin');
const { merge } = require('webpack-merge');
const { devDependencies } = require('./package.json');

/*
 * Every remote here builds the same way, so each webpack.config.js is one call to this.
 *
 * appshellRemote() is what every appshell micro-frontend needs: the federation setup the
 * application's shell expects, a dev server an overlay can load from, and the plugin that writes
 * the manifest a publish sends. @appshell/webpack-plugin's README has each setting and why.
 * What's merged over it is this repository's own: Babel for TypeScript and React, React Fast
 * Refresh while developing, and plain CSS.
 */
module.exports =
  ({ name, exposes, port, uniqueName, dependencies }) =>
  (_env, { mode }) => {
    const isDevelopment = mode === 'development';

    return merge(
      appshellRemote({
        name,
        exposes,
        port: Number(process.env.PORT) || port,
        mode,
        react: true,
        dependencies,
        uniqueName,
        // One Fast Refresh runtime for the page, as there's one React.
        shared: isDevelopment
          ? { 'react-refresh': { singleton: true, requiredVersion: devDependencies['react-refresh'] } }
          : {},
      }),
      {
        devServer: { hot: true },
        resolve: { extensions: ['.js', '.ts', '.tsx'] },
        module: {
          rules: [
            {
              test: /\.tsx?$/,
              exclude: /node_modules/,
              use: {
                loader: 'babel-loader',
                options: {
                  presets: [
                    ['@babel/preset-react', { runtime: 'automatic' }],
                    '@babel/preset-typescript',
                  ],
                  plugins: isDevelopment ? ['react-refresh/babel'] : [],
                },
              },
            },
            { test: /\.css$/i, use: ['style-loader', 'css-loader'] },
          ],
        },
        plugins: isDevelopment
          ? [new ReactRefreshPlugin({ overlay: false }), new ReactRefreshSingleton()]
          : [],
      },
    );
  };

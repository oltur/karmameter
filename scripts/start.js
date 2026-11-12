/* eslint-disable no-console */
const webpack = require('webpack');
const WebpackDevServer = require('webpack-dev-server');
const chalk = require('chalk');
const webpackConfig = require('../webpack.config');
const SETTINGS = require('../settings');

const serverConfig = {
  contentBase: SETTINGS.PUBLIC_PATH,
  publicPath: '/',
  stats: { colors: true },
  hot: true,
  historyApiFallback: true,
  // The bundled fsevents/chokidar version predates Node's current native
  // module ABI and crashes the dev server outright on modern macOS/Node -
  // poll instead of relying on native OS file-watching.
  watchOptions: { poll: 1000 },
  // Forward /api/* to the local karmameter-api server (see api/, run with
  // `npm start` on its default port 3000) the same way nginx does in
  // production (strips the /api prefix before proxying).
  proxy: {
    '/api': {
      target: 'http://localhost:3000',
      pathRewrite: { '^/api': '' },
    },
  },
};

new WebpackDevServer(webpack(webpackConfig), serverConfig)
  .listen(SETTINGS.PORT, 'localhost', (error) => {
    if (error) {
      console.error(error);
    } else {
      console.log(`
        Listening at ${chalk.bold.cyan(`http://localhost:${SETTINGS.PORT}/`)}.
        Serving files from ${chalk.bold.cyan(SETTINGS.PUBLIC_PATH)}.
        Browser will be opened automaticly when webpack finish building.
      `);
    }
  });

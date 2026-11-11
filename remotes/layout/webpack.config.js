const remote = require('../webpack.remote');
const { dependencies } = require('./package.json');

module.exports = remote({
  name: 'LayoutModule',
  exposes: { './Layout': './src/Layout' },
  port: 7401,
  uniqueName: 'acme-layout',
  dependencies,
});

const remote = require('../webpack.remote');
const { dependencies } = require('./package.json');

module.exports = remote({
  name: 'LayoutModule',
  exposes: { './Layout': './src/Layout' },
  port: 7411,
  uniqueName: 'acme-layout',
  dependencies,
});

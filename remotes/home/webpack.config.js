const remote = require('../webpack.remote');
const { dependencies } = require('./package.json');

module.exports = remote({
  name: 'HomeModule',
  exposes: { './Home': './src/Home' },
  port: 7412,
  uniqueName: 'acme-home',
  dependencies,
});

const remote = require('../webpack.remote');
const { dependencies } = require('./package.json');

module.exports = remote({
  name: 'HelloModule',
  exposes: { './Hello': './src/Hello' },
  port: 7400,
  uniqueName: 'hello',
  dependencies,
});

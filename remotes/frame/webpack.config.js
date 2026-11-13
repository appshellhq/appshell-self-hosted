const remote = require('../webpack.remote');
const { dependencies } = require('./package.json');

module.exports = remote({
  name: 'FrameModule',
  exposes: {
    './OwnOrigin': './src/OwnOrigin',
    './SameOrigin': './src/SameOrigin',
    './CrossSite': './src/CrossSite',
  },
  port: 7414,
  uniqueName: 'acme-frame',
  dependencies,
});

const
  sinon = require('sinon');

require('sinon-as-promised');

module.exports = function () {
  return sinon.stub().returns({
    indices: {
      exists: sinon.stub().resolves(false),
      create: sinon.stub(),
      getMapping: sinon.stub().resolves([]),
      putMapping: sinon.stub().resolves({})
    },
    create: function () {},
    bulk: function () {}
  });
};

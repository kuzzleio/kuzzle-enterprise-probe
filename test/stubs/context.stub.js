const
  sandbox = require('sinon').sandbox.create(),
  Bluebird = require('bluebird');

module.exports = function () {
  return {
    accessors: {
      execute: sandbox.stub().returns(Bluebird.resolve({result: 'someResult'}))

    },
    constructors: {
      Dsl: function () {
        return {
          register: () => Bluebird.resolve({id: 'filterId'}),
          test: () => {}
        };
      }
    },
    reset: () => sandbox.reset()
  };
};

const
  sandbox = require('sinon').sandbox.create(),
  Bluebird = require('bluebird'),
  Request = require('kuzzle-common-objects').Request;

module.exports = function () {
  return {
    accessors: {
      execute: sandbox.stub().returns(Bluebird.resolve({result: 'someResult'})),
      trigger: sandbox.stub()
    },
    constructors: {
      Request: function (data) {
        return new Request(data);
      },
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

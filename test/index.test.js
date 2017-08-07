const
  should = require('should'),
  sinon = require('sinon'),
  proxyquire = require('proxyquire'),
  StubContext = require('./stubs/context.stub'),
  Request = require('kuzzle-common-objects').Request,
  Bluebird = require('bluebird'),
  longTimeout = require('long-timeout');

describe('#Testing index file', () => {
  let
    Plugin,
    plugin,
    sandbox,
    fakeContext,
    setIntervalSpy;

  before(() => {
    sandbox = sinon.sandbox.create();
  });

  beforeEach(() => {
    sandbox.reset();

    setIntervalSpy = sandbox.spy(longTimeout, 'setInterval');
    Plugin = proxyquire('../lib/index', {
      'long-timeout': longTimeout
    });

    plugin = new Plugin();
    fakeContext = new StubContext();
  });

  afterEach(() => {
    setIntervalSpy.returnValues.forEach(value => {
      longTimeout.clearInterval(value);
    });
    setIntervalSpy.restore();
  });

  it('should default index to measures if storage index is not configured', () => {
    return plugin.init({
      probes: {
        foo: {
          type: 'monitor',
          hooks: ['foo:bar']
        }
      }
    }, fakeContext).then(() => {
      should(plugin.index).be.eql('measures');
    });
  });

  it('should do nothing if no probe is set', () => {
    return plugin.init({
      storageIndex: 'bar'
    }, fakeContext)
      .then(() => {
        should(plugin.probes).be.empty();

        return plugin.init({
          storageIndex: 'bar',
          probes: {}
        }, fakeContext);
      })
      .then(() => {
        should(plugin.probes).be.empty();
      });
  });

  it('should prepare the DSL at startup', () => {
    const
      stubRegister = sinon.stub().returns(Bluebird.resolve({id: 'foobar'}));

    fakeContext = {
      constructors: {
        Dsl: function () {
          return {
            register: stubRegister
          };
        }
      }
    };

    return plugin.init({
      storageIndex: 'bar',
      probes: {
        foo: {
          type: 'watcher',
          index: 'foo',
          collection: 'bar',
          filter: {}
        }
      }
    }, fakeContext).then(() => {
      should(stubRegister.calledOnce).be.true();
      should(stubRegister.calledWith('foo', 'bar', {})).be.true();
    });
  });

  it('should ignore probes without any type defined', () => {
    return plugin.init({
      storageIndex: 'bar',
      probes: {
        badProbe: {
          index: 'foo',
          collection: 'bar',
          hooks: ['foo:bar', 'data:beforePublish']
        }
      }
    }, fakeContext).then(() => {
      should(plugin.probes.badProbe).be.undefined();
    });
  });

  it('should not reset the measure if an error during saving occurs', (done) => {
    fakeContext.accessors.execute = sinon.stub();
    fakeContext.accessors.execute
      .onFirstCall().returns(Bluebird.resolve({result: true}))
      .onSecondCall().returns(Bluebird.resolve({result: {collections: ['foo']}}))
      .onThirdCall().returns(Bluebird.resolve({result: 'someResult'}));

    const
      pluginConfig = {
        storageIndex: 'bar',
        probes: {
          foo: {
            type: 'monitor',
            hooks: ['foo:bar'],
            interval: 25
          }
        }
      };

    plugin.init(pluginConfig, fakeContext)
      .then(() => plugin.startProbes())
      .then(() => {
        fakeContext.accessors.execute = sinon.spy(() => Bluebird.reject(new Error('some Error')));

        plugin.monitor(new Request({
          body: {
            event: 'foo:bar'
          }
        }));

        should(fakeContext.accessors.execute.called).be.false();

        setTimeout(() => {
          should(fakeContext.accessors.execute.calledOnce).be.true();

          setTimeout(() => {
            try {
              should(plugin.measures.foo['foo:bar']).be.eql(1);
            } catch (e) {
              return done(e);
            }

            done();
          }, 0);
        }, 50);
      })
      .catch(err => done(err));
  });

  it('should call setInterval when an interval is set on a valid probe', (done) => {
    fakeContext.accessors.execute = sinon.stub();
    fakeContext.accessors.execute
      .onFirstCall().returns(Bluebird.resolve({result: true}))
      .onSecondCall().returns(Bluebird.resolve({result: {collections: ['foo']}}))
      .onThirdCall().returns(Bluebird.resolve({result: 'someResult'}))
      .onCall(4).returns(Bluebird.resolve({result: 'someResult'}));

    plugin.init({
      storageIndex: 'storageIndex',
      probes: {
        fooprobe: {
          type: 'watcher',
          index: 'foo',
          collection: 'bar',
          collects: ['foo'],
          interval: 250
        }
      }
    }, fakeContext)
      .then(() => plugin.startProbes())
      .then(() => {
        setTimeout(() => {
          should(setIntervalSpy.calledOnce).be.true();

          done();
        }, 20);
      });
  });

  it('should not call setInterval when an error occures during collection creation', (done) => {
    fakeContext.accessors.execute = sinon.stub();
    fakeContext.accessors.execute
      .onFirstCall().returns(Bluebird.resolve({result: true}))
      .onSecondCall().returns(Bluebird.resolve({result: {collections: ['foo']}}))
      .onThirdCall().returns(Bluebird.reject(new Error('some Error')));

    plugin.init({
      storageIndex: 'storageIndex',
      probes: {
        fooprobe: {
          type: 'watcher',
          index: 'foo',
          collection: 'bar',
          collects: ['foo'],
          interval: '1ms'
        }
      }
    }, fakeContext)
      .then(() => plugin.startProbes())
      .then(() => {
        setTimeout(() => {
          should(setIntervalSpy.callCount).be.eql(0);
          done();
        }, 20);
      });
  });
});

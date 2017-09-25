const
  should = require('should'),
  sinon = require('sinon'),
  proxyquire = require('proxyquire'),
  StubContext = require('./stubs/context.stub'),
  longTimeout = require('long-timeout'),
  Request = require('kuzzle-common-objects').Request,
  Bluebird = require('bluebird');

describe('#counter probes', () => {
  let
    Plugin,
    plugin,
    fakeContext,
    setIntervalSpy;

  beforeEach(() => {
    setIntervalSpy = sinon.spy(longTimeout, 'setInterval');
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

  it('should initialize probes according to their configuration', () => {
    return plugin.init({
      storageIndex: 'bar',
      probes: {
        bar: {
          type: 'counter',
          increasers: ['bar:baz', 'foo:bar', 'foo:bar'],
          decreasers: ['baz:qux'],
          interval: '1 hour'
        },
        badProbe: {
          type: 'counter',
          increasers: ['baz:qux'],
          decreasers: ['baz:qux'],
          interval: '1m'
        }
      }
    }, fakeContext, false).then(() => {
      should(plugin.probes.bar).not.be.empty().and.have.property('interval').eql(60 * 60 * 1000);
      should(plugin.probes.badProbe).be.undefined();
    });
  });

  it('should initialize the events mapping properly', () => {
    return plugin.init({
      storageIndex: 'bar',
      probes: {
        bar: {
          type: 'counter',
          increasers: ['bar:baz', 'foo:bar', 'foo:bar'],
          decreasers: ['baz:qux']
        },
        baz: {
          type: 'counter',
          increasers: ['baz:qux', 'bar:baz'],
          decreasers: ['foo:bar']
        }
      }
    }, fakeContext, false).then(() => {
      should(plugin.eventMapping.counter.increasers['bar:baz']).match(['bar', 'baz']);
      should(plugin.eventMapping.counter.increasers['foo:bar']).match(['bar']);
      should(plugin.eventMapping.counter.increasers['baz:qux']).match(['baz']);
      should(plugin.eventMapping.counter.decreasers['baz:qux']).match(['bar']);
      should(plugin.eventMapping.counter.decreasers['foo:bar']).match(['baz']);
    });
  });

  it('should initialize the measures object properly', () => {
    return plugin.init({
      storageIndex: 'bar',
      probes: {
        bar: {
          type: 'counter',
          increasers: ['bar:baz', 'foo:bar', 'foo:bar'],
          decreasers: ['baz:qux']
        },
        baz: {
          type: 'counter',
          increasers: ['baz:qux', 'bar:baz'],
          decreasers: ['foo:bar']
        }
      }
    }, fakeContext, false).then(() => {
      should(plugin.measures.bar).match({count: 0});
      should(plugin.measures.baz).match({count: 0});
    });
  });

  it('should save immediately an increasing counter if no interval is set', (done) => {
    plugin.init({
      storageIndex: 'bar',
      probes: {
        foo: {
          type: 'counter',
          increasers: ['foo:bar', 'bar:baz'],
          decreasers: ['baz:qux', 'qux:foo']
        }
      }
    }, fakeContext).then(() => {
      plugin.counter(new Request({
        body: {
          event: 'foo:bar'
        }
      }));

      should(fakeContext.accessors.execute.calledOnce).be.true();
      should(fakeContext.accessors.execute.args[0][0]).be.instanceof(Request);
      should(fakeContext.accessors.execute.args[0][0].input.resource.index).be.eql('bar');
      should(fakeContext.accessors.execute.args[0][0].input.resource.collection).be.eql('foo');
      should(fakeContext.accessors.execute.args[0][0].input.controller).be.eql('document');
      should(fakeContext.accessors.execute.args[0][0].input.action).be.eql('create');
      should(fakeContext.accessors.execute.args[0][0].input.body.count).be.eql(1);
      should(fakeContext.accessors.execute.args[0][0].input.body.hasOwnProperty('timestamp')).be.true();

      // measure should never be reset
      setTimeout(() => {
        should(plugin.measures.foo.count).be.eql(1);
        done();
      }, 0);
    });
  });

  it('should not save the measure (but trigger the event) if the probe is set volatile', (done) => {
    plugin.init({
      storageIndex: 'bar',
      probes: {
        foo: {
          type: 'counter',
          increasers: ['foo:bar', 'bar:baz'],
          decreasers: ['baz:qux', 'qux:foo'],
          volatile: true
        }
      }
    }, fakeContext)
      .then(() => {
        plugin.counter(new Request({
          body: {
            event: 'foo:bar'
          }
        }));

        should(fakeContext.accessors.execute.calledOnce).be.false();

        setTimeout(() => {
          should(fakeContext.accessors.trigger.calledOnce).be.true();
          should(plugin.measures.foo.count).be.eql(1);
          done();
        }, 0);
      });
  });

  it('should save immediately a decreasing counter if no interval is set', (done) => {
    plugin.init({
      storageIndex: 'bar',
      probes: {
        foo: {
          type: 'counter',
          increasers: ['foo:bar', 'bar:baz'],
          decreasers: ['baz:qux', 'qux:foo']
        }
      }
    }, fakeContext).then(() => {
      plugin.counter(new Request({
        body: {
          event: 'qux:foo'
        }
      }));

      should(fakeContext.accessors.execute.calledOnce).be.true();
      should(fakeContext.accessors.execute.args[0][0]).be.instanceof(Request);
      should(fakeContext.accessors.execute.args[0][0].input.resource.index).be.eql('bar');
      should(fakeContext.accessors.execute.args[0][0].input.resource.collection).be.eql('foo');
      should(fakeContext.accessors.execute.args[0][0].input.controller).be.eql('document');
      should(fakeContext.accessors.execute.args[0][0].input.action).be.eql('create');
      should(fakeContext.accessors.execute.args[0][0].input.body.count).be.eql(-1);
      should(fakeContext.accessors.execute.args[0][0].input.body.hasOwnProperty('timestamp')).be.true();

      plugin.counter(new Request({
        body: {
          event: 'baz:qux'
        }
      }));

      should(fakeContext.accessors.execute.calledTwice).be.true();
      should(fakeContext.accessors.execute.args[1][0]).be.instanceof(Request);
      should(fakeContext.accessors.execute.args[1][0].input.resource.index).be.eql('bar');
      should(fakeContext.accessors.execute.args[1][0].input.resource.collection).be.eql('foo');
      should(fakeContext.accessors.execute.args[1][0].input.controller).be.eql('document');
      should(fakeContext.accessors.execute.args[1][0].input.action).be.eql('create');
      should(fakeContext.accessors.execute.args[1][0].input.body.count).be.eql(-2);
      should(fakeContext.accessors.execute.args[1][0].input.body.hasOwnProperty('timestamp')).be.true();


      // measure should never be reset
      setTimeout(() => {
        should(plugin.measures.foo.count).be.eql(-2);
        done();
      }, 0);
    });
  });

  it('should only save the counter after the given interval', (done) => {
    this.timeout = 500;

    const
      pluginConfig = {
        storageIndex: 'bar',
        probes: {
          foo: {
            type: 'counter',
            increasers: ['foo:bar', 'bar:baz'],
            decreasers: ['baz:qux', 'qux:foo'],
            interval: 250
          }
        }
      };

    fakeContext.accessors.execute = sinon.stub();
    fakeContext.accessors.execute
      .onFirstCall().returns(Bluebird.resolve({result: true}))
      .onSecondCall().returns(Bluebird.resolve({result: {collections: ['foo']}}))
      .onThirdCall().returns(Bluebird.resolve({result: 'someResult'}));

    plugin.init(pluginConfig, fakeContext)
      .then(() => plugin.startProbes())
      .then(() => {
        fakeContext.accessors.execute = sinon.stub().returns(Bluebird.resolve());

        // 2 increasers + 1 decreaser => count must be equal to 1
        plugin.counter(new Request({
          body: {
            event: 'foo:bar'
          }
        }));
        plugin.counter(new Request({
          body: {
            event: 'bar:baz'
          }
        }));
        plugin.counter(new Request({
          body: {
            event: 'qux:foo'
          }
        }));

        should(fakeContext.accessors.execute.called).be.false();

        setTimeout(() => {
          should(fakeContext.accessors.execute.calledOnce).be.true();
          should(fakeContext.accessors.execute.args[0][0]).be.instanceof(Request);
          should(fakeContext.accessors.execute.args[0][0].input.resource.index).be.eql('bar');
          should(fakeContext.accessors.execute.args[0][0].input.resource.collection).be.eql('foo');
          should(fakeContext.accessors.execute.args[0][0].input.controller).be.eql('document');
          should(fakeContext.accessors.execute.args[0][0].input.action).be.eql('create');
          should(fakeContext.accessors.execute.args[0][0].input.body.count).be.eql(1);
          should(fakeContext.accessors.execute.args[0][0].input.body.hasOwnProperty('timestamp')).be.true();

          setTimeout(() => {
            should(plugin.measures.foo.count).be.eql(1);
            done();
          }, 0);
        }, 300);
      })
      .catch(err => done(err));
  });

  it('should create a collection with timestamp and count mapping', (done) => {
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
          type: 'counter',
          increasers: ['foo:bar', 'bar:baz'],
          decreasers: ['baz:qux', 'qux:foo'],
          interval: 1000
        }
      }
    }, fakeContext)
      .then(() => plugin.startProbes());

    setTimeout(() => {
      should(fakeContext.accessors.execute.callCount).be.eql(4);
      should(fakeContext.accessors.execute.args[3][0].input.body).match({
        properties: {
          timestamp: {
            type: 'date',
            format: 'epoch_millis'
          },
          count: {
            type: 'integer'
          }
        }
      });

      done();
    }, 20);
  });
});

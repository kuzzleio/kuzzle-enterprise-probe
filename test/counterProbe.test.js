const
  should = require('should'),
  sinon = require('sinon'),
  proxyquire = require('proxyquire'),
  lolex = require('lolex'),
  StubContext = require('./stubs/context.stub'),
  StubElasticsearch = require('./stubs/elasticsearch.stub'),
  longTimeout = require('long-timeout');

require('sinon-as-promised');

describe('#counter probes', () => {
  let
    Plugin,
    plugin,
    esStub,
    fakeContext,
    setIntervalSpy;

  beforeEach(() => {
    setIntervalSpy = sinon.spy(longTimeout, 'setInterval');
    esStub = new StubElasticsearch();
    Plugin = proxyquire('../lib/index', {
      'elasticsearch': {
        Client: esStub
      },
      'long-timeout': longTimeout
    });

    plugin = new Plugin();
    esStub.reset();
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
      databases: ['foo'],
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
      databases: ['foo'],
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
      should(plugin.dummy).be.false();
      should(plugin.eventMapping.counter.increasers['bar:baz']).match(['bar', 'baz']);
      should(plugin.eventMapping.counter.increasers['foo:bar']).match(['bar']);
      should(plugin.eventMapping.counter.increasers['baz:qux']).match(['baz']);
      should(plugin.eventMapping.counter.decreasers['baz:qux']).match(['bar']);
      should(plugin.eventMapping.counter.decreasers['foo:bar']).match(['baz']);
    });
  });

  it('should initialize the measures object properly', () => {
    return plugin.init({
      databases: ['foo'],
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
      should(plugin.dummy).be.false();
      should(plugin.measures.bar).match({count: 0});
      should(plugin.measures.baz).match({count: 0});
    });
  });

  it('should save immediately an increasing counter if no interval is set', (done) => {
    plugin.init({
      databases: ['foo'],
      storageIndex: 'bar',
      probes: {
        foo: {
          type: 'counter',
          increasers: ['foo:bar', 'bar:baz'],
          decreasers: ['baz:qux', 'qux:foo']
        }
      }
    }, fakeContext).then(() => {
      sinon.stub(plugin.client, 'create').resolves();
      plugin.counter('foo:bar');
      should(plugin.client.create.calledOnce).be.true();
      should(plugin.client.create.calledWithMatch({
        index: 'bar',
        type: 'foo',
        body: {
          'count': 1
        }
      })).be.true();

      plugin.client.create.restore();

      // measure should never be reset
      setTimeout(() => {
        should(plugin.measures.foo.count).be.eql(1);
        done();
      }, 0);
    });
  });

  it('should save immediately an decreasing counter if no interval is set', (done) => {
    plugin.init({
      databases: ['foo'],
      storageIndex: 'bar',
      probes: {
        foo: {
          type: 'counter',
          increasers: ['foo:bar', 'bar:baz'],
          decreasers: ['baz:qux', 'qux:foo']
        }
      }
    }, fakeContext).then(() => {
      sinon.stub(plugin.client, 'create').resolves();
      plugin.counter('qux:foo');
      should(plugin.client.create.calledOnce).be.true();
      should(plugin.client.create.calledWithMatch({
        index: 'bar',
        type: 'foo',
        body: {
          'count': -1
        }
      })).be.true();

      plugin.counter('baz:qux');
      should(plugin.client.create.calledTwice).be.true();
      should(plugin.client.create.calledWithMatch({
        index: 'bar',
        type: 'foo',
        body: {
          'count': -2
        }
      })).be.true();

      plugin.client.create.restore();

      // measure should never be reset
      setTimeout(() => {
        should(plugin.measures.foo.count).be.eql(-2);
        done();
      }, 0);
    });
  });

  it('should only save the counter after the given interval', (done) => {
    const
      clock = lolex.install(),
      pluginConfig = {
        databases: ['foo'],
        storageIndex: 'bar',
        probes: {
          foo: {
            type: 'counter',
            increasers: ['foo:bar', 'bar:baz'],
            decreasers: ['baz:qux', 'qux:foo'],
            interval: 1000
          }
        }
      };

    plugin.init(pluginConfig, fakeContext)
      .then(() => {
        sinon.stub(plugin.client, 'create').resolves();

        // 2 increasers + 1 decreaser => count must be equal to 1
        plugin.counter('foo:bar');
        plugin.counter('bar:baz');
        plugin.counter('qux:foo');
        should(plugin.client.create.called).be.false();

        clock.next();
        should(plugin.client.create.calledOnce).be.true();
        should(plugin.client.create.calledWithMatch({
          index: 'bar',
          type: 'foo',
          body: {
            count: 1
          }
        })).be.true();

        clock.uninstall();
        plugin.client.create.restore();
        setTimeout(() => {
          should(plugin.measures.foo.count).be.eql(1);
          done();
        }, 0);
      })
      .catch(err => done(err));
  });

  it('should create a collection with timestamp and count mapping', (done) => {
    plugin.init({
      databases: ['foo'],
      storageIndex: 'storageIndex',
      probes: {
        fooprobe: {
          type: 'counter',
          increasers: ['foo:bar', 'bar:baz'],
          decreasers: ['baz:qux', 'qux:foo'],
          interval: 1000
        }
      }
    }, fakeContext);

    setTimeout(() => {
      should(plugin.client.indices.putMapping.calledOnce).be.true();
      should(plugin.client.indices.putMapping.firstCall.args[0]).match({
        index: 'storageIndex',
        type: 'fooprobe',
        updateAllTypes: false,
        body: {
          properties: {
            timestamp: {
              type: 'date',
              format: 'epoch_millis'
            },
            count: {
              type: 'integer'
            }
          }
        }
      });

      done();
    }, 20);
  });
});

var
  should = require('should'),
  sinon = require('sinon'),
  proxyquire = require('proxyquire'),
  lolex = require('lolex'),
  StubContext = require('./stubs/context.stub'),
  StubElasticsearch = require('./stubs/elasticsearch.stub');

require('sinon-as-promised');

describe('#counter probes', () => {
  var
    Plugin,
    plugin,
    esStub,
    fakeContext;

  before(() => {
    esStub = new StubElasticsearch();

    Plugin = proxyquire('../lib/index', {
      'elasticsearch': {
        Client: esStub
      }
    });
  });

  beforeEach(() => {
    plugin = new Plugin();
    esStub.reset();
    fakeContext = new StubContext();
  });

  it('should initialize probes according to their configuration', () => {
    plugin.init({
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
    }, fakeContext, false);

    should(plugin.probes.bar).not.be.empty().and.have.property('interval').eql(60 * 60 * 1000);
    should(plugin.probes.badProbe).be.undefined();
  });

  it('should initialize the events mapping properly', () => {
    plugin.init({
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
    }, fakeContext, false);

    should(plugin.dummy).be.false();
    should(plugin.eventMapping.counter.increasers['bar:baz']).match(['bar', 'baz']);
    should(plugin.eventMapping.counter.increasers['foo:bar']).match(['bar']);
    should(plugin.eventMapping.counter.increasers['baz:qux']).match(['baz']);
    should(plugin.eventMapping.counter.decreasers['baz:qux']).match(['bar']);
    should(plugin.eventMapping.counter.decreasers['foo:bar']).match(['baz']);
  });

  it('should initialize the measures object properly', () => {
    plugin.init({
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
    }, fakeContext, false);

    should(plugin.dummy).be.false();
    should(plugin.measures.bar).match({count: 0});
    should(plugin.measures.baz).match({count: 0});
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
    }, fakeContext);

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
    }, fakeContext);

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

  it('should only save the counter after the given interval', (done) => {
    var
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
});
var
  should = require('should'),
  sinon = require('sinon'),
  proxyquire = require('proxyquire'),
  lolex = require('lolex'),
  StubContext = require('./stubs/context.stub'),
  StubElasticsearch = require('./stubs/elasticsearch.stub');

require('sinon-as-promised');

describe('#monitor probes', () => {
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
        foo: {
          type: 'monitor',
          hooks: ['foo:bar'],
          interval: 'none'
        },
        badProbe: {
          type: 'monitor',
          hooks: ['foo:bar', 'bar:baz'],
          interval: 'Never gonna give you up'
        }
      }
    }, fakeContext, false);

    should(plugin.probes.foo).not.be.empty().and.have.property('interval').undefined();
    should(plugin.probes.badProbe).be.undefined();
  });

  it('should initialize the events mapping properly', () => {
    plugin.init({
      databases: ['foo'],
      storageIndex: 'bar',
      probes: {
        foo: {
          type: 'monitor',
          hooks: ['foo:bar']
        },
        qux: {
          type: 'monitor',
          hooks: ['foo:bar', 'bar:baz', 'foo:bar']
        }
      }
    }, fakeContext, false);

    should(plugin.dummy).be.false();
    should(plugin.eventMapping.monitor['foo:bar']).match(['foo', 'qux']);
    should(plugin.eventMapping.monitor['bar:baz']).match(['qux']);
  });

  it('should initialize the measures object properly', () => {
    plugin.init({
      databases: ['foo'],
      storageIndex: 'bar',
      probes: {
        foo: {
          type: 'monitor',
          hooks: ['foo:bar']
        },
        qux: {
          type: 'monitor',
          hooks: ['foo:bar', 'bar:baz', 'foo:bar']
        }
      }
    }, fakeContext, false);

    should(plugin.dummy).be.false();
    should(plugin.measures.foo).match({'foo:bar': 0});
    should(plugin.measures.qux).match({'foo:bar': 0, 'bar:baz': 0});
  });

  it('should save immediately a measure if no interval is set in the probe', (done) => {
    plugin.init({
      databases: ['foo'],
      storageIndex: 'bar',
      probes: {
        foo: {
          type: 'monitor',
          hooks: ['foo:bar']
        }
      }
    }, fakeContext);

    sinon.stub(plugin.client, 'create').resolves();
    plugin.monitor('foo:bar');
    should(plugin.client.create.calledOnce).be.true();
    should(plugin.client.create.calledWithMatch({
      index: 'bar',
      type: 'foo',
      body: {
        'foo:bar': 1
      }
    })).be.true();

    plugin.client.create.restore();

    // measure should have been reset
    setTimeout(() => {
      should(plugin.measures.foo['foo:bar']).be.eql(0);
      done();
    }, 0);
  });

  it('should only save the measure after the given interval', (done) => {
    var
      clock = lolex.install(),
      pluginConfig = {
        databases: ['foo'],
        storageIndex: 'bar',
        probes: {
          foo: {
            type: 'monitor',
            hooks: ['foo:bar'],
            interval: '1s'
          }
        }
      };

    plugin.init(pluginConfig, fakeContext)
      .then(() => {
        sinon.stub(plugin.client, 'create').resolves();

        plugin.monitor('foo:bar');
        should(plugin.client.create.called).be.false();

        clock.next();
        should(plugin.client.create.calledOnce).be.true();
        should(plugin.client.create.calledWithMatch({
          index: 'bar',
          type: 'foo',
          body: {
            'foo:bar': 1
          }
        })).be.true();

        clock.uninstall();
        plugin.client.create.restore();
        setTimeout(() => {
          should(plugin.measures.foo['foo:bar']).be.eql(0);
          done();
        }, 0);
      })
      .catch(err => done(err));
  });
});

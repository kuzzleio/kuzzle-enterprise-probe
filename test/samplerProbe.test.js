var
  should = require('should'),
  sinon = require('sinon'),
  proxyquire = require('proxyquire').noPreserveCache(),
  StubContext = require('./stubs/context.stub'),
  StubElasticsearch = require('./stubs/elasticsearch.stub');

require('sinon-as-promised');

describe('#sampler probes', () => {
  var
    Plugin,
    plugin,
    esStub,
    fakeContext;

  beforeEach(() => {
    esStub = new StubElasticsearch();

    Plugin = proxyquire('../lib/index', {
      'elasticsearch': {
        Client: esStub
      }
    });

    plugin = new Plugin();
    fakeContext = new StubContext();
  });

  it('should initialize probes according to their configuration', () => {
    plugin.init({
      databases: ['foo'],
      storageIndex: 'bar',
      probes: {
        foo: {
          type: 'sampler',
          index: 'foo',
          collection: 'bar',
          sampleSize: 100,
          filter: {term: { 'foo': 'bar'}},
          collects: '*',
          interval: '1h'
        },
        bar: {
          type: 'sampler',
          index: 'foo',
          collection: 'bar',
          sampleSize: 100,
          filter: {term: { 'foo': 'bar'}},
          collects: [
            'foo.bar',
            'bar.baz',
            'baz.qux'
          ],
          interval: '1m'
        },
        baz: {
          type: 'sampler',
          index: 'foo',
          sampleSize: 100,
          collection: 'bar',
          collects: [
            'foo.bar',
            'bar.baz',
            'baz.qux'
          ],
          interval: '1m'
        },
        badProbe1: {
          type: 'sampler',
          index: undefined,
          collection: 'bar',
          sampleSize: 100,
          filter: {term: { 'foo': 'bar'}},
          collects: '*',
          interval: '1m'
        },
        badProbe2: {
          type: 'sampler',
          index: 'foo',
          collection: undefined,
          sampleSize: 100,
          filter: {term: { 'foo': 'bar'}},
          collects: '*',
          interval: '1m'
        },
        badProbe3: {
          type: 'sampler',
          index: 'foo',
          collection: 'bar',
          sampleSize: 100,
          filter: {term: { 'foo': 'bar'}},
          collects: 'foobar',
          interval: '1m'
        },
        badProbe4: {
          type: 'sampler',
          index: 'foo',
          collection: 'bar',
          sampleSize: 100,
          filter: {term: { 'foo': 'bar'}},
          collects: 123,
          interval: '1m'
        },
        badProbe5: {
          type: 'sampler',
          index: 'foo',
          collection: 'bar',
          sampleSize: 100,
          filter: {term: { 'foo': 'bar'}},
          collects: { 'foo': 'bar' },
          interval: '1m'
        },
        badProbe6: {
          type: 'sampler',
          index: 'foo',
          collection: 'bar',
          filter: {term: { 'foo': 'bar'}},
          collects: '*',
          interval: '1m'
        },
        badProbe7: {
          type: 'sampler',
          index: 'foo',
          collection: 'bar',
          sampleSize: 'foobar',
          filter: {term: { 'foo': 'bar'}},
          collects: '*',
          interval: '1m'
        },
        badProbe8: {
          type: 'sampler',
          index: 'foo',
          collection: 'bar',
          sampleSize: 100,
          filter: {term: { 'foo': 'bar'}},
          interval: '1m'
        },
        badProbe9: {
          type: 'sampler',
          index: 'foo',
          collection: 'bar',
          sampleSize: 100,
          filter: {term: { 'foo': 'bar'}},
          collects: [],
          interval: '1m'
        },
        badProbe10: {
          type: 'sampler',
          index: 'foo',
          collection: 'bar',
          sampleSize: 100,
          filter: {term: { 'foo': 'bar'}},
          collects: '*',
          interval: 'none'
        },
        badProbe11: {
          type: 'sampler',
          index: 'foo',
          collection: 'bar',
          sampleSize: 100,
          filter: {term: { 'foo': 'bar'}},
          collects: '*'
        }
      }
    }, fakeContext, false);

    should(plugin.probes.foo).not.be.empty().and.have.property('interval').eql(60 * 60 * 1000);
    should(plugin.probes.bar).not.be.empty().and.have.property('interval').eql(60 * 1000);
    should(plugin.probes.baz).not.be.empty().and.have.property('filter').match({});
    should(plugin.probes.badProbe1).be.undefined();
    should(plugin.probes.badProbe2).be.undefined();
    should(plugin.probes.badProbe3).be.undefined();
    should(plugin.probes.badProbe4).be.undefined();
    should(plugin.probes.badProbe5).be.undefined();
    should(plugin.probes.badProbe6).be.undefined();
    should(plugin.probes.badProbe7).be.undefined();
    should(plugin.probes.badProbe8).be.undefined();
    should(plugin.probes.badProbe9).be.undefined();
    should(plugin.probes.badProbe10).be.undefined();
    should(plugin.probes.badProbe11).be.undefined();
  });

  it('should initialize the measures object properly', () => {
    plugin.init({
      databases: ['foo'],
      storageIndex: 'bar',
      probes: {
        foo: {
          type: 'sampler',
          index: 'foo',
          collection: 'bar',
          sampleSize: 100,
          collects: ['foo', 'bar'],
          interval: '1m'
        }
      }
    }, fakeContext, false);

    should(plugin.measures.foo).match({content: [], count: 0});
  });

  it('should collect a sample of the provided documents', (done) => {
    var
      i,
      document = {
        _id: 'someId',
        body: {
          foobar: 'foobar',
          foo: {
            bar: 'bar',
            baz: 'baz',
            qux: 'qux'
          },
          barfoo: 'barfoo',
          quxbaz: 'quxbaz'
        }
      };

    plugin.init({
      databases: ['foo'],
      storageIndex: 'storageIndex',
      probes: {
        fooprobe: {
          type: 'sampler',
          index: 'foo',
          collection: 'bar',
          sampleSize: 3,
          collects: ['foobar', 'foo.baz', 'foo.qux', 'barfoo'],
          interval: '1ms'
        }
      }
    }, fakeContext);

    sinon.stub(plugin.dsl, 'test').resolves(['filterId']);
    sinon.stub(plugin.client, 'bulk').resolves();

    for (i = 0; i < 100; i++) {
      plugin.sampler({index: 'foo', collection: 'bar', data: document});
    }

    setTimeout(() => {
      should(plugin.dsl.test.callCount).be.eql(100);
      should(plugin.dsl.test.alwaysCalledWithMatch('foo', 'bar', {foo: 'bar'}, undefined));
      should(plugin.client.bulk.calledOnce).be.true();
      should(plugin.client.bulk.firstCall.args[0].body.length).be.eql(6); // 3 documents + 3 bulk headers
      should(plugin.client.bulk.firstCall.args[0].body[1]).match({
        content: {
          _id: document._id,
          foobar: 'foobar',
          foo: {
            baz: 'baz',
            qux: 'qux'
          },
          barfoo: 'barfoo'}
      });

      should(plugin.client.bulk.firstCall.args[0].body[1].content.quxbar).be.undefined();
      should(plugin.client.bulk.firstCall.args[0].body[1].content.foo.bar).be.undefined();

      plugin.client.bulk.restore();
      plugin.dsl.test.restore();

      // measure should be reset
      setTimeout(() => {
        should(plugin.measures.fooprobe.content).be.empty();
        done();
      }, 20);
    }, 20);
  });

  it('should create a collection with timestamp mapping if no mapping is provided and collects is not empty', (done) => {
    plugin.init({
      databases: ['foo'],
      storageIndex: 'storageIndex',
      probes: {
        fooprobe: {
          type: 'sampler',
          index: 'foo',
          collection: 'bar',
          sampleSize: 3,
          collects: ['foobar', 'foo.baz', 'foo.qux', 'barfoo'],
          interval: '1ms'
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
            }
          }
        }
      });

      done();
    }, 20);
  });

  it('should create a collection with timestamp and provided mapping if a mapping is provided', (done) => {
    plugin.init({
      databases: ['foo'],
      storageIndex: 'storageIndex',
      probes: {
        fooprobe: {
          type: 'sampler',
          index: 'foo',
          collection: 'bar',
          sampleSize: 3,
          collects: ['foobar', 'foo.baz', 'foo.qux', 'barfoo'],
          mapping: {foo: 'bar'},
          interval: '1ms'
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
            content: {
              properties: {
                foo: 'bar'
              }
            }
          }
        }
      });
      done();
    }, 20);
  });
});

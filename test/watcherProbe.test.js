const
  should = require('should'),
  sinon = require('sinon'),
  proxyquire = require('proxyquire'),
  StubContext = require('./stubs/context.stub'),
  StubElasticsearch = require('./stubs/elasticsearch.stub'),
  longTimeout = require('long-timeout');

require('sinon-as-promised');

describe('#watcher probes', () => {
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
    plugin.init({
      databases: ['foo'],
      storageIndex: 'bar',
      probes: {
        foo: {
          type: 'watcher',
          index: 'foo',
          collection: 'bar',
          filter: {term: { 'foo': 'bar'}},
          collects: '*',
          interval: 'none'
        },
        bar: {
          type: 'watcher',
          index: 'foo',
          collection: 'bar',
          filter: {term: { 'foo': 'bar'}},
          interval: '1m'
        },
        baz: {
          type: 'watcher',
          index: 'foo',
          collection: 'bar',
          collects: [
            'foo.bar',
            'bar.baz',
            'baz.qux'
          ]
        },
        qux: {
          type: 'watcher',
          index: 'foo',
          collection: 'bar',
          collects: []
        },
        badProbe1: {
          type: 'watcher',
          index: undefined,
          collection: 'bar',
          filter: {term: { 'foo': 'bar'}},
          collects: '*'
        },
        badProbe2: {
          type: 'watcher',
          index: 'foo',
          collection: undefined,
          filter: {term: { 'foo': 'bar'}},
          collects: '*'
        },
        badProbe3: {
          type: 'watcher',
          index: 'foo',
          collection: 'bar',
          filter: {term: { 'foo': 'bar'}},
          collects: 'foobar'
        },
        badProbe4: {
          type: 'watcher',
          index: 'foo',
          collection: 'bar',
          filter: {term: { 'foo': 'bar'}},
          collects: 123
        },
        badProbe5: {
          type: 'watcher',
          index: 'foo',
          collection: 'bar',
          filter: {term: { 'foo': 'bar'}},
          collects: { 'foo': 'bar' }
        }
      }
    }, fakeContext, false);

    should(plugin.probes.foo).not.be.empty().and.have.property('interval').undefined();
    should(plugin.probes.bar).not.be.empty().and.have.property('interval').eql(60 * 1000);
    should(plugin.probes.baz).not.be.empty().and.have.property('filter').match({});
    should(plugin.probes.qux).not.be.empty().and.have.property('collects').null();
    should(plugin.probes.badProbe1).be.undefined();
    should(plugin.probes.badProbe2).be.undefined();
    should(plugin.probes.badProbe3).be.undefined();
    should(plugin.probes.badProbe4).be.undefined();
    should(plugin.probes.badProbe5).be.undefined();
  });

  it('should initialize the measures object properly', () => {
    return plugin.init({
      databases: ['foo'],
      storageIndex: 'bar',
      probes: {
        foo: {
          type: 'watcher',
          index: 'foo',
          collection: 'bar',
          collects: ['foo', 'bar']
        },
        bar: {
          type: 'watcher',
          index: 'foo',
          collection: 'bar',
          collects: '*'
        },
        baz: {
          type: 'watcher',
          index: 'foo',
          collection: 'bar'
        }
      }
    }, fakeContext, false).then(() => {
      should(plugin.measures.foo).match({content: []});
      should(plugin.measures.bar).match({content: []});
      should(plugin.measures.baz).match({count: 0});
    });
  });

  it('should save immediately if no interval is set (watcher with collected content)', (done) => {
    plugin.init({
      databases: ['foo'],
      storageIndex: 'storageIndex',
      probes: {
        fooprobe: {
          type: 'watcher',
          index: 'foo',
          collection: 'bar',
          collects: '*'
        }
      }
    }, fakeContext).then(() => {
      sinon.stub(plugin.dsl, 'test').resolves(['filterId']);
      sinon.stub(plugin.client, 'bulk').resolves();
      plugin.watcher({index: 'foo', collection: 'bar', data: {body: {foo: 'bar'}}});
    });

    setTimeout(() => {
      should(plugin.dsl.test.calledOnce).be.true();
      should(plugin.dsl.test.calledWithMatch('foo', 'bar', {foo: 'bar'}, undefined));
      should(plugin.client.bulk.calledOnce).be.true();
      should(plugin.client.bulk.firstCall.args[0]).match({
        body: [
          {index: {_index: 'storageIndex', _type: 'fooprobe'}},
          {content: {foo: 'bar'}}
        ]
      });

      plugin.client.bulk.restore();
      plugin.dsl.test.restore();

      // measure should be reset
      setTimeout(() => {
        should(plugin.measures.fooprobe.content).be.empty();
        done();
      }, 20);
    }, 20);
  });

  it('should save immediately if no interval is set (watcher counting documents)', (done) => {
    plugin.init({
      databases: ['foo'],
      storageIndex: 'storageIndex',
      probes: {
        fooprobe: {
          type: 'watcher',
          index: 'foo',
          collection: 'bar'
        }
      }
    }, fakeContext).then(() => {
      sinon.stub(plugin.dsl, 'test').resolves(['filterId']);
      sinon.stub(plugin.client, 'create').resolves();
      plugin.watcher({index: 'foo', collection: 'bar', data: {body: {foo: 'bar'}}});

      setTimeout(() => {
        should(plugin.dsl.test.calledOnce).be.true();
        should(plugin.dsl.test.calledWithMatch('foo', 'bar', {foo: 'bar'}, undefined));
        should(plugin.client.create.calledOnce).be.true();
        should(plugin.client.create.firstCall.args[0]).match({
          index: 'storageIndex',
          type: 'fooprobe',
          body: {
            'count': plugin.measures.fooprobe.count
          }
        });

        plugin.client.create.restore();
        plugin.dsl.test.restore();

        // measure should be reset
        setTimeout(() => {
          should(plugin.measures.fooprobe.count).be.eql(0);
          done();
        }, 20);
      }, 0);
    });
  });

  it('should collect the configured collectable fields', (done) => {
    const
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
          type: 'watcher',
          index: 'foo',
          collection: 'bar',
          collects: ['foobar', 'foo.baz', 'foo.qux', 'barfoo']
        }
      }
    }, fakeContext).then(() => {
      sinon.stub(plugin.dsl, 'test').resolves(['filterId']);
      sinon.stub(plugin.client, 'bulk').resolves();
      plugin.watcher({index: 'foo', collection: 'bar', data: document});
    });

    setTimeout(() => {
      should(plugin.dsl.test.calledOnce).be.true();
      should(plugin.dsl.test.calledWithMatch('foo', 'bar', {foo: 'bar'}, undefined));
      should(plugin.client.bulk.calledOnce).be.true();
      should(plugin.client.bulk.firstCall.args[0]).match({
        body: [
          {index: {_index: 'storageIndex', _type: 'fooprobe'}},
          {content: {
            _id: document._id,
            foobar: 'foobar',
            foo: {
              baz: 'baz',
              qux: 'qux'
            },
            barfoo: 'barfoo'}}
        ]
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

  it('should create a collection with timestamp and count mapping if no mapping is provided and collects is empty', (done) => {
    plugin.init({
      databases: ['foo'],
      storageIndex: 'storageIndex',
      probes: {
        fooprobe: {
          type: 'watcher',
          index: 'foo',
          collection: 'bar'
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

  it('should create a collection with timestamp mapping if no mapping is provided and collects is not empty', (done) => {
    plugin.init({
      databases: ['foo'],
      storageIndex: 'storageIndex',
      probes: {
        fooprobe: {
          type: 'watcher',
          index: 'foo',
          collection: 'bar',
          collects: ['foo']
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

  it('should create a collection with timestamp and provided mapping mapping if a mapping is provided', (done) => {
    plugin.init({
      databases: ['foo'],
      storageIndex: 'storageIndex',
      probes: {
        fooprobe: {
          type: 'watcher',
          index: 'foo',
          collection: 'bar',
          collects: ['foo'],
          mapping: {foo: 'bar'}
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

  it('should not create a collection if it already exists', (done) => {
    plugin.init({
      databases: ['foo'],
      storageIndex: 'storageIndex',
      probes: {
        fooprobe: {
          type: 'watcher',
          index: 'foo',
          collection: 'bar',
          collects: ['foo'],
          mapping: {foo: 'bar'}
        }
      }
    }, fakeContext);

    sinon.stub(plugin.client, 'bulk').resolves();
    sinon.stub(plugin.client, 'create').resolves();

    plugin.client.indices.getMapping.resolves({
      storageIndex: {
        mappings: {
          fooprobe: 'exists'
        }
      }
    });

    setTimeout(() => {
      should(plugin.client.indices.putMapping.callCount).be.eql(0);

      plugin.client.bulk.restore();
      plugin.client.create.restore();

      done();
    }, 20);
  });
});

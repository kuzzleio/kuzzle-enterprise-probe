const
  should = require('should'),
  sinon = require('sinon'),
  proxyquire = require('proxyquire'),
  StubContext = require('./stubs/context.stub'),
  longTimeout = require('long-timeout'),
  Request = require('kuzzle-common-objects').Request,
  Bluebird = require('bluebird');

describe('#sampler probes', () => {
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
    }, fakeContext, false).then(() => {
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
  });

  it('should initialize the measures object properly', () => {
    return plugin.init({
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
    }, fakeContext, false).then(() => {
      should(plugin.measures.foo).match({content: [], count: 0});
    });
  });

  it('should collect a sample of the provided documents', (done) => {
    let
      i;

    fakeContext.accessors.execute = sinon.stub();
    fakeContext.accessors.execute
      .onFirstCall().returns(Bluebird.resolve({result: true}))
      .onSecondCall().returns(Bluebird.resolve({result: {collections: ['foo']}}))
      .onThirdCall().returns(Bluebird.resolve({result: 'someResult'}));

    const
      documentId = 'someId',
      documentBody = {
        foobar: 'foobar',
        foo: {
          bar: 'bar',
          baz: 'baz',
          qux: 'qux'
        },
        barfoo: 'barfoo',
        quxbaz: 'quxbaz'
      };

    plugin.init({
      storageIndex: 'storageIndex',
      probes: {
        fooprobe: {
          type: 'sampler',
          index: 'foo',
          collection: 'bar',
          sampleSize: 3,
          collects: ['foobar', 'foo.baz', 'foo.qux', 'barfoo'],
          interval: 250
        }
      }
    }, fakeContext)
      .then(() => plugin.startProbes())
      .then(() => {
        fakeContext.accessors.execute = sinon.stub().returns(Bluebird.resolve());
        sinon.stub(plugin.dsl, 'test').returns(['filterId']);

        for (i = 0; i < 100; i++) {
          plugin.sampler(new Request({
            body: {
              payload: {
                data: {
                  index: 'foo',
                  collection: 'bar',
                  _id: documentId,
                  body: documentBody
                }
              }
            }
          }));
        }

        setTimeout(() => {
          should(plugin.dsl.test.callCount).be.eql(100);
          should(plugin.dsl.test.alwaysCalledWithMatch('foo', 'bar', {foo: 'bar'}, undefined));

          should(fakeContext.accessors.execute.calledOnce).be.true();

          plugin.dsl.test.restore();

          // measure should be reset
          setTimeout(() => {
            should(plugin.measures.fooprobe.content).be.empty();
            done();
          }, 20);
        }, 300);
      });
  });

  it('should create a collection with timestamp mapping if no mapping is provided and collects is not empty', (done) => {
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
          type: 'sampler',
          index: 'foo',
          collection: 'bar',
          sampleSize: 3,
          collects: ['foobar', 'foo.baz', 'foo.qux', 'barfoo'],
          interval: '1ms'
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
          }
        }
      });

      done();
    }, 20);
  });

  it('should create a collection with timestamp and provided mapping if a mapping is provided', (done) => {
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
          type: 'sampler',
          index: 'foo',
          collection: 'bar',
          sampleSize: 3,
          collects: ['foobar', 'foo.baz', 'foo.qux', 'barfoo'],
          mapping: {foo: 'bar'},
          interval: '1ms'
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
          content: {
            properties: {
              foo: 'bar'
            }
          }
        }
      });
      done();
    }, 20);
  });
});

/*
 * Kuzzle, a backend software, self-hostable and ready to use
 * to power modern apps
 *
 * Copyright 2015-2018 Kuzzle
 * mailto: support AT kuzzle.io
 * website: http://kuzzle.io
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */


const
  should = require('should'),
  sinon = require('sinon'),
  proxyquire = require('proxyquire'),
  StubContext = require('./stubs/context.stub'),
  longTimeout = require('long-timeout'),
  Request = require('kuzzle-common-objects').Request;

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
        }
      }
    }, fakeContext, false).then(() => {
      should(plugin.probes.foo).not.be.empty().and.have.property('interval').eql(60 * 60 * 1000);
      should(plugin.probes.bar).not.be.empty().and.have.property('interval').eql(60 * 1000);
      should(plugin.probes.baz).not.be.empty().and.have.property('filter').match({});
    });
  });

  it('should throw an error if the "index" parameter is missing', () => {
    return should(() => {
      plugin.init({
        storageIndex: 'bar',
        probes: {
          badProbe: {
            type: 'sampler',
            index: undefined,
            collection: 'bar',
            sampleSize: 100,
            filter: {term: { 'foo': 'bar'}},
            collects: '*',
            interval: '1m'
          }
        }
      }, fakeContext, false);
    }).throw('plugin-probe: [probe: badProbe] Configuration error: missing index or collection');
  });

  it('should throw an error if the "collection" parameter is missing', () => {
    return should(() => {
      plugin.init({
        storageIndex: 'bar',
        probes: {
          badProbe: {
            type: 'sampler',
            index: 'foo',
            collection: undefined,
            sampleSize: 100,
            filter: {term: { 'foo': 'bar'}},
            collects: '*',
            interval: '1m'
          }
        }
      }, fakeContext, false);
    }).throw('plugin-probe: [probe: badProbe] Configuration error: missing index or collection');
  });

  it('should throw an error if the "collect" parameter is missing', () => {
    return should(() => {
      plugin.init({
        storageIndex: 'bar',
        probes: {
          badProbe: {
            type: 'sampler',
            index: 'foo',
            collection: 'bar',
            sampleSize: 100,
            filter: {term: { 'foo': 'bar'}},
            interval: '1m'
          }
        }
      }, fakeContext, false);
    }).throw('plugin-probe: [probe: badProbe] A "collects" parameter is required for sampler probes');
  });

  it('should throw an error if the "collect" parameter is a malformed string', () => {
    return should(() => {
      plugin.init({
        storageIndex: 'bar',
        probes: {
          badProbe: {
            type: 'sampler',
            index: 'foo',
            collection: 'bar',
            sampleSize: 100,
            filter: {term: { 'foo': 'bar'}},
            collects: 'foobar',
            interval: '1m'
          }
        }
      }, fakeContext, false);
    }).throw('plugin-probe: [probe: badProbe] Invalid "collects" value');
  });

  it('should throw an error if the "collect" parameter is a numeric value', () => {
    return should(() => {
      plugin.init({
        storageIndex: 'bar',
        probes: {
          badProbe: {
            type: 'sampler',
            index: 'foo',
            collection: 'bar',
            sampleSize: 100,
            filter: {term: { 'foo': 'bar'}},
            collects: 123,
            interval: '1m'
          }
        }
      }, fakeContext, false);
    }).throw('plugin-probe: [probe: badProbe] Invalid "collects" format: expected array or string, got number');
  });

  it('should throw an error if the "collect" parameter is an object', () => {
    return should(() => {
      plugin.init({
        storageIndex: 'bar',
        probes: {
          badProbe: {
            type: 'sampler',
            index: 'foo',
            collection: 'bar',
            sampleSize: 100,
            filter: {term: { 'foo': 'bar'}},
            collects: { 'foo': 'bar' },
            interval: '1m'
          }
        }
      }, fakeContext, false);
    }).throw('plugin-probe: [probe: badProbe] Invalid "collects" format: expected array or string, got object');
  });

  it('should throw an error if the "collect" parameter is an empty array', () => {
    return should(() => {
      plugin.init({
        storageIndex: 'bar',
        probes: {
          badProbe: {
            type: 'sampler',
            index: 'foo',
            collection: 'bar',
            sampleSize: 100,
            filter: {term: { 'foo': 'bar'}},
            collects: [],
            interval: '1m'
          }
        }
      }, fakeContext, false);
    }).throw('plugin-probe: [probe: badProbe] A "collects" parameter is required for sampler probes');
  });

  it('should throw an error if the "sampleSize" parameter is missing', () => {
    return should(() => {
      plugin.init({
        storageIndex: 'bar',
        probes: {
          badProbe: {
            type: 'sampler',
            index: 'foo',
            collection: 'bar',
            filter: {term: { 'foo': 'bar'}},
            collects: '*',
            interval: '1m'
          }
        }
      }, fakeContext, false);
    }).throw('plugin-probe: [probe: badProbe] "sampleSize" parameter missing');
  });

  it('should throw an error if the "sampleSize" parameter is invalid', () => {
    return should(() => {
      plugin.init({
        storageIndex: 'bar',
        probes: {
          badProbe: {
            type: 'sampler',
            index: 'foo',
            collection: 'bar',
            sampleSize: 'foobar',
            filter: {term: { 'foo': 'bar'}},
            collects: '*',
            interval: '1m'
          }
        }
      }, fakeContext, false);
    }).throw('plugin-probe: [probe: badProbe] invalid "sampleSize" parameter. Expected a number, got a string');
  });

  it('should throw an error if the "interval" parameter is missing', () => {
    return should(() => {
      plugin.init({
        storageIndex: 'bar',
        probes: {
          badProbe: {
            type: 'sampler',
            index: 'foo',
            collection: 'bar',
            sampleSize: 100,
            filter: {term: { 'foo': 'bar'}},
            collects: '*'
          }
        }
      }, fakeContext, false);
    }).throw('plugin-probe: [probe: badProbe] An "interval" parameter is required for sampler probes');
  });

  it('should throw an error if the "interval" parameter is malformed', () => {
    return should(() => {
      plugin.init({
        storageIndex: 'bar',
        probes: {
          badProbe: {
            type: 'sampler',
            index: 'foo',
            collection: 'bar',
            sampleSize: 100,
            filter: {term: { 'foo': 'bar'}},
            collects: '*',
            interval: 'none'
          }
        }
      }, fakeContext, false);
    }).throw('plugin-probe: [probe: badProbe] An "interval" parameter is required for sampler probes');
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
      .onFirstCall().resolves({result: true})
      .onSecondCall().resolves({result: {collections: ['foo']}})
      .onThirdCall().resolves({result: 'someResult'});

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
        fakeContext.accessors.execute = sinon.stub().resolves();
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
      .onFirstCall().resolves({result: true})
      .onSecondCall().resolves({result: {collections: ['foo']}})
      .onThirdCall().resolves({result: 'someResult'})
      .onCall(4).resolves({result: 'someResult'});

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
      .onFirstCall().resolves({result: true})
      .onSecondCall().resolves({result: {collections: ['foo']}})
      .onThirdCall().resolves({result: 'someResult'})
      .onCall(4).resolves({result: 'someResult'});

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

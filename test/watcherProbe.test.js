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

describe('#watcher probes', () => {
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
    plugin.init({
      storageIndex: 'bar',
      probes: {
        foo: {
          type: 'watcher',
          index: 'foo',
          collection: 'bar',
          filter: {term: {'foo': 'bar'}},
          collects: '*',
          interval: 'none'
        },
        bar: {
          type: 'watcher',
          index: 'foo',
          collection: 'bar',
          filter: {term: {'foo': 'bar'}},
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
        }
      }
    }, fakeContext, false);

    should(plugin.probes.foo).not.be.empty().and.have.property('interval').undefined();
    should(plugin.probes.bar).not.be.empty().and.have.property('interval').eql(60 * 1000);
    should(plugin.probes.baz).not.be.empty().and.have.property('filter').match({});
    should(plugin.probes.qux).not.be.empty().and.have.property('collects').null();
  });

  it('should throw an error if the "index" parameter is missing', () => {
    return should(() => {
      plugin.init({
        storageIndex: 'bar',
        probes: {
          badProbe: {
            type: 'watcher',
            index: undefined,
            collection: 'bar',
            filter: {term: {'foo': 'bar'}},
            collects: '*'
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
            type: 'watcher',
            index: 'foo',
            collection: undefined,
            filter: {term: {'foo': 'bar'}},
            collects: '*'
          }
        }
      }, fakeContext, false);
    }).throw('plugin-probe: [probe: badProbe] Configuration error: missing index or collection');
  });

  it('should throw an error if the "collect" parameter is a malformed string', () => {
    return should(() => {
      plugin.init({
        storageIndex: 'bar',
        probes: {
          badProbe: {
            type: 'watcher',
            index: 'foo',
            collection: 'bar',
            filter: {term: {'foo': 'bar'}},
            collects: 'foobar'
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
            type: 'watcher',
            index: 'foo',
            collection: 'bar',
            filter: {term: {'foo': 'bar'}},
            collects: 123
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
            type: 'watcher',
            index: 'foo',
            collection: 'bar',
            filter: {term: {'foo': 'bar'}},
            collects: {'foo': 'bar'}
          }
        }
      }, fakeContext, false);
    }).throw('plugin-probe: [probe: badProbe] Invalid "collects" format: expected array or string, got object');
  });

  it('should initialize the measures object properly', () => {
    return plugin.init({
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
      storageIndex: 'storageIndex',
      probes: {
        fooprobe: {
          type: 'watcher',
          index: 'foo',
          collection: 'bar',
          collects: '*'
        }
      }
    }, fakeContext)
      .then(() => {
        sinon.stub(plugin.dsl, 'test').returns(['filterId']);
        fakeContext.accessors.execute = sinon.stub().resolves();

        plugin.watcher(new Request({
          body: {
            payload: {
              data: {
                index: 'foo',
                collection: 'bar',
                body: {
                  foo: 'bar'
                }
              }
            }
          }
        }));
      });

    setTimeout(() => {
      should(plugin.dsl.test.calledOnce).be.true();
      should(plugin.dsl.test.calledWithMatch('foo', 'bar', {foo: 'bar'}, undefined));

      should(fakeContext.accessors.execute.calledOnce).be.true();

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
      storageIndex: 'storageIndex',
      probes: {
        fooprobe: {
          type: 'watcher',
          index: 'foo',
          collection: 'bar'
        }
      }
    }, fakeContext).then(() => {
      sinon.stub(plugin.dsl, 'test').returns(['filterId']);
      fakeContext.accessors.execute = sinon.stub().resolves();

      plugin.watcher(new Request({
        body: {
          payload: {
            data: {
              index: 'foo',
              collection: 'bar',
              body: {
                foo: 'bar'
              }
            }
          }
        }
      }));

      setTimeout(() => {
        should(plugin.dsl.test.calledOnce).be.true();
        should(plugin.dsl.test.calledWithMatch('foo', 'bar', {foo: 'bar'}, undefined));

        should(fakeContext.accessors.execute.calledOnce).be.true();

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
          type: 'watcher',
          index: 'foo',
          collection: 'bar',
          collects: ['foobar', 'foo.baz', 'foo.qux', 'barfoo']
        }
      }
    }, fakeContext).then(() => {
      sinon.stub(plugin.dsl, 'test').returns(['filterId']);
      plugin.watcher(new Request({
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
    });

    setTimeout(() => {
      should(plugin.dsl.test.calledOnce).be.true();
      should(plugin.dsl.test.calledWithMatch('foo', 'bar', {foo: 'bar'}, undefined));

      should(fakeContext.accessors.execute.calledOnce).be.true();

      plugin.dsl.test.restore();

      // measure should be reset
      setTimeout(() => {
        should(plugin.measures.fooprobe.content).be.empty();
        done();
      }, 20);
    }, 20);
  });

  it('should create a collection with timestamp and count mapping if no mapping is provided and collects is empty', (done) => {
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
          type: 'watcher',
          index: 'foo',
          collection: 'bar'
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
          type: 'watcher',
          index: 'foo',
          collection: 'bar',
          collects: ['foo']
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

  it('should create a collection with timestamp and provided mapping mapping if a mapping is provided', (done) => {
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
          type: 'watcher',
          index: 'foo',
          collection: 'bar',
          collects: ['foo'],
          mapping: {foo: 'bar'}
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
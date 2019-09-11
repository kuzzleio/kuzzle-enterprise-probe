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
        }
      }
    }, fakeContext, false).then(() => {
      should(plugin.probes.bar).not.be.empty().and.have.property('interval').eql(60 * 60 * 1000);
    });
  });

  it('should throw an error if there is no increaser configured', () => {
    should(plugin.init({
      storageIndex: 'bar',
      probes: {
        badProbe: {
          type: 'counter',
          decreasers: ['baz:qux'],
          interval: '1m'
        }
      }
    }, fakeContext, false)).be.rejectedWith('plugin-probe: [probe: badProbe] "increasers" parameter missing"');
  });

  it('should reject the promise if there is no decreaser configured', () => {
    should(plugin.init({
      storageIndex: 'bar',
      probes: {
        badProbe: {
          type: 'counter',
          increasers: ['baz:qux'],
          interval: '1m'
        }
      }
    }, fakeContext, false)).be.rejectedWith('plugin-probe: [probe: badProbe] "decreasers" parameter missing"');
  });

  it('should reject the promise if the same event is set for increaser and decreaser', () => {
    return should(() => {
      plugin.init({
        storageIndex: 'bar',
        probes: {
          badProbe: {
            type: 'counter',
            increasers: ['baz:qux'],
            decreasers: ['baz:qux'],
            interval: '1m'
          }
        }
      }, fakeContext, false);
    }).throw('plugin-probe: [probe: badProbe] Configuration error: an event cannot be set both to increase and to decrease a counter');
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
      should(fakeContext.accessors.execute.args[0][0].input.body).ownProperty('timestamp');

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
      should(fakeContext.accessors.execute.args[0][0].input.body).ownProperty('timestamp');

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
      should(fakeContext.accessors.execute.args[1][0].input.body).ownProperty('timestamp');


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
      .onFirstCall().resolves({result: true})
      .onSecondCall().resolves({result: {collections: ['foo']}})
      .onThirdCall().resolves({result: 'someResult'});

    plugin.init(pluginConfig, fakeContext)
      .then(() => plugin.startProbes())
      .then(() => {
        fakeContext.accessors.execute = sinon.stub().resolves();

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
          should(fakeContext.accessors.execute.args[0][0].input.body).ownProperty('timestamp');

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
      .onFirstCall().resolves({result: true})
      .onSecondCall().resolves({result: {collections: ['foo']}})
      .onThirdCall().resolves({result: 'someResult'})
      .onCall(4).resolves({result: 'someResult'});

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

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
  Bluebird = require('bluebird'),
  StubContext = require('./stubs/context.stub'),
  Request = require('kuzzle-common-objects').Request,
  longTimeout = require('long-timeout');

describe('#Testing index file', () => {
  let
    Plugin,
    plugin,
    fakeContext,
    setIntervalSpy;

  beforeEach(() => {
    sinon.reset();

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

  it('should default index to measures if storage index is not configured', () => {
    return plugin.init({
      probes: {
        foo: {
          type: 'monitor',
          hooks: ['foo:bar']
        }
      }
    }, fakeContext).then(() => {
      should(plugin.index).be.eql('measures');
    });
  });

  it('should do nothing if no probe is set', () => {
    return Bluebird.resolve(plugin.init({
      storageIndex: 'bar'
    }, fakeContext))
      .then(() => {
        should(plugin.probes).be.empty();

        return plugin.init({
          storageIndex: 'bar',
          probes: {}
        }, fakeContext);
      })
      .then(() => {
        should(plugin.probes).be.empty();
      });
  });

  it('should prepare the DSL at startup', () => {
    const
      stubRegister = sinon.stub().resolves({id: 'foobar'});

    fakeContext = {
      constructors: {
        Dsl: function () {
          return {
            register: stubRegister
          };
        }
      }
    };

    return plugin.init({
      storageIndex: 'bar',
      probes: {
        foo: {
          type: 'watcher',
          index: 'foo',
          collection: 'bar',
          filter: {}
        }
      }
    }, fakeContext).then(() => {
      should(stubRegister.calledOnce).be.true();
      should(stubRegister.calledWith('foo', 'bar', {})).be.true();
    });
  });

  it('should throw an error if a probe if configured without any type defined', () => {
    return should(() => {
      plugin.init({
        storageIndex: 'bar',
        probes: {
          foo: {
            type: 'monitor',
            hooks: ['foo:bar']
          },
          badProbe: {
            index: 'foo',
            collection: 'bar',
            hooks: ['foo:bar', 'data:beforePublish']
          }
        }
      }, fakeContext);
    }).throw('plugin-probe: [probe: badProbe] "type" parameter missing"');
  });

  it('should not reset the measure if an error during saving occurs', (done) => {
    fakeContext.accessors.execute = sinon.stub();
    fakeContext.accessors.execute
      .onFirstCall().resolves({result: true})
      .onSecondCall().resolves({result: {collections: ['foo']}})
      .onThirdCall().resolves({result: 'someResult'});

    const
      pluginConfig = {
        storageIndex: 'bar',
        probes: {
          foo: {
            type: 'monitor',
            hooks: ['foo:bar'],
            interval: 30
          }
        }
      };

    plugin.init(pluginConfig, fakeContext)
      .then(() => plugin.startProbes())
      .then(() => {
        fakeContext.accessors.execute.reset();
        fakeContext.accessors.execute.rejects(new Error('some Error'));

        plugin.monitor(new Request({
          body: {
            event: 'foo:bar'
          }
        }));

        should(fakeContext.accessors.execute).not.be.called();

        setTimeout(() => {
          should(fakeContext.accessors.execute).be.calledOnce();

          setTimeout(() => {
            try {
              should(plugin.measures.foo['foo:bar']).be.eql(1);
            } catch (e) {
              return done(e);
            }

            done();
          }, 0);
        }, 50);
      })
      .catch(err => done(err));
  });

  it('should call setInterval when an interval is set on a valid probe', (done) => {
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
          interval: 250
        }
      }
    }, fakeContext)
      .then(() => plugin.startProbes())
      .then(() => {
        setTimeout(() => {
          should(setIntervalSpy.calledOnce).be.true();

          done();
        }, 20);
      });
  });

  it('should not call setInterval when an error occures during collection creation', (done) => {
    fakeContext.accessors.execute = sinon.stub();
    fakeContext.accessors.execute
      .onFirstCall().resolves({result: true})
      .onSecondCall().resolves({result: {collections: ['foo']}})
      .onThirdCall().rejects(new Error('some Error'));

    plugin.init({
      storageIndex: 'storageIndex',
      probes: {
        fooprobe: {
          type: 'watcher',
          index: 'foo',
          collection: 'bar',
          collects: ['foo'],
          interval: '1ms'
        }
      }
    }, fakeContext)
      .then(() => plugin.startProbes())
      .then(() => {
        setTimeout(() => {
          should(setIntervalSpy.callCount).be.eql(0);
          done();
        }, 20);
      });
  });
});

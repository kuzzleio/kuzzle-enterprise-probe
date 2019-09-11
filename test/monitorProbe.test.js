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
  Request = require('kuzzle-common-objects').Request,
  longTimeout = require('long-timeout');

describe('#monitor probes', () => {
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
        foo: {
          type: 'monitor',
          hooks: ['foo:bar'],
          interval: 'none'
        }
      }
    }, fakeContext, false).then(() => {
      should(plugin.probes.foo).not.be.empty().and.have.property('interval').undefined();
    });
  });

  it('should throw an error if interval parameter is misconfigured', () => {
    return should(() => {
      plugin.init({
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
    }).throw('plugin-probe: [probe: badProbe] Invalid interval "undefined".');
  });

  it('should initialize the events mapping properly', () => {
    return plugin.init({
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
    }, fakeContext, false).then(() => {
      should(plugin.eventMapping.monitor['foo:bar']).match(['foo', 'qux']);
      should(plugin.eventMapping.monitor['bar:baz']).match(['qux']);
    });
  });

  it('should initialize the measures object properly', () => {
    return plugin.init({
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
    }, fakeContext, false).then(() => {
      should(plugin.measures.foo).match({'foo:bar': 0});
      should(plugin.measures.qux).match({'foo:bar': 0, 'bar:baz': 0});
    });
  });

  it('should save immediately a measure if no interval is set in the probe', (done) => {
    plugin.init({
      storageIndex: 'bar',
      probes: {
        foo: {
          type: 'monitor',
          hooks: ['foo:bar']
        }
      }
    }, fakeContext).then(() => {
      plugin.monitor(new Request({
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
      should(fakeContext.accessors.execute.args[0][0].input.body['foo:bar']).be.eql(1);
      should(fakeContext.accessors.execute.args[0][0].input.body).ownProperty('timestamp');

      // measure should have been reset
      setTimeout(() => {
        try {
          should(plugin.measures.foo['foo:bar']).be.eql(0);
          done();
        }
        catch (e) {
          done(e);
        }
      }, 0);
    });
  });

  it('should only save the measure after the given interval', (done) => {
    this.timeout = 500;

    fakeContext.accessors.execute = sinon.stub();
    fakeContext.accessors.execute
      .onFirstCall().resolves({result: true})
      .onSecondCall().resolves({result: {collections: ['foo']}})
      .onThirdCall().resolves({result: 'someResult'});

    plugin.init({
      storageIndex: 'bar',
      probes: {
        foo: {
          type: 'monitor',
          hooks: ['foo:bar'],
          interval: 250
        }
      }
    }, fakeContext)
      .then(() => plugin.startProbes())
      .then(() => {
        fakeContext.accessors.execute = sinon.stub().resolves();

        plugin.monitor(new Request({
          body: {
            event: 'foo:bar'
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
          should(fakeContext.accessors.execute.args[0][0].input.body['foo:bar']).be.eql(1);
          should(fakeContext.accessors.execute.args[0][0].input.body).ownProperty('timestamp');

          setTimeout(() => {
            try {
              should(plugin.measures.foo['foo:bar']).be.eql(0);
            } catch (e) {
              return done(e);
            }

            done();
          }, 0);
        }, 300);
      })
      .catch(err => done(err));
  });

  it('should create a collection with timestamp and event fields mapping', (done) => {
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
          type: 'monitor',
          hooks: ['foo:bar', 'bar:foo'],
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
          'foo:bar': {
            type: 'integer'
          },
          'bar:foo': {
            type: 'integer'
          }
        }
      });

      done();
    }, 20);
  });
});

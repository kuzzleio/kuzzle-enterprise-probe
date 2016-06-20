var
  should = require('should'),
  sinon = require('sinon'),
  proxyquire = require('proxyquire'),
  lolex = require('lolex');

require('sinon-as-promised');

describe('#Testing index file', () => {
  var
    Plugin,
    plugin,
    esStub,
    fakeContext = {
      constructors: {
        Dsl: function () {
          return {
            register: () => {},
            createFilterId: () => {}
          };
        }
      }
    };

  before(() => {
    esStub = sinon.stub().returns({
      indices: {
        exists: sinon.stub().resolves(false),
        create: sinon.stub()
      },
      create: function () {}
    });

    Plugin = proxyquire('../lib/index', {
      'elasticsearch': {
        Client: esStub
      }
    });
  });

  beforeEach(() => {
    plugin = new Plugin();
    esStub.reset();
  });


  it('should throw an error if no config is provided', () => {
    should(() => plugin.init({}, {}, false)).throw(/no configuration provided/);
    should(() => plugin.init(undefined, {}, false)).throw(/no configuration provided/);
    should(() => plugin.init(null, {}, false)).throw(/no configuration provided/);
  });

  it('should throw an error if no target database is configured', () => {
    should(() => plugin.init({foo: 'bar'}, {}, false)).throw(/no target database set/);
    should(() => plugin.init({databases: 'foo:bar'}, {}, false)).throw(/no target database set/);
    should(() => plugin.init({databases: []}, {}, false)).throw(/no target database set/);
  });

  it('should throw an error if no storage index is configured', () => {
    should(() => plugin.init({databases: ['foo:bar']}, {}, false)).throw(/no storage index/);
    should(() => plugin.init({databases: ['foo:bar'], storageIndex: 1}, {}, false)).throw(/no storage index/);
    should(() => plugin.init({databases: ['foo:bar'], storageIndex: ''}, {}, false)).throw(/no storage index/);
  });
  
  it('should enter dummy mode if no probe is set', () => {
    plugin.init({
      databases: ['foo'],
      storageIndex: 'bar'
    }, {}, false);

    should(plugin.dummy).be.true();
    should(plugin.probes).be.empty();
    should(plugin.client).be.null();

    plugin.init({
      databases: ['foo'],
      storageIndex: 'bar',
      probes: {}
    }, {}, false);

    should(plugin.dummy).be.true();
    should(plugin.probes).be.empty();
    should(plugin.client).be.null();
  });

  it('should enter dummy mode when asked to', () => {
    plugin.init({
      databases: ['foo'],
      storageIndex: 'bar',
      probes: {
        foo: {
          type: 'monitor',
          hooks: ['foo:bar']
        }
      }
    }, fakeContext, true);

    should(plugin.dummy).be.true();
    should(plugin.probes).not.be.empty();
    should(plugin.client).be.null();
  });

  it('should initialize the probes list according to their configuration', () => {
    plugin.init({
      databases: ['foo'],
      storageIndex: 'bar',
      probes: {
        foo: {
          type: 'monitor',
          hooks: ['foo:bar'],
          interval: 'none'
        },
        bar: {
          type: 'counter',
          increasers: ['bar:baz', 'foo:bar', 'foo:bar'],
          decreasers: ['baz:qux'],
          interval: '1 hour'
        },
        badProbe1: {
          type: 'counter',
          increasers: ['baz:qux'],
          decreasers: ['baz:qux'],
          interval: '1m'
        },
        badProbe2: {
          type: 'monitor',
          hooks: ['foo:bar', 'bar:baz'],
          interval: 'Never gonna give you up'
        }
      }
    }, fakeContext, false);

    should(plugin.probes.foo).not.be.empty().and.have.property('interval').undefined();
    should(plugin.probes.bar).not.be.empty().and.have.property('interval').eql(60 * 60 * 1000);
    should(plugin.probes.badProbe1).be.undefined();
    should(plugin.probes.badProbe2).be.undefined();
  });

  it('should initialize the hooks list properly', () => {
    plugin.init({
      databases: ['foo'],
      storageIndex: 'bar',
      probes: {
        foo: {
          type: 'monitor',
          hooks: ['foo:bar']
        },
        bar: {
          type: 'counter',
          increasers: ['bar:baz', 'foo:bar', 'foo:bar'],
          decreasers: ['baz:qux']
        },
        baz: {
          type: 'counter',
          increasers: ['baz:qux'],
          decreasers: ['foo:bar']
        }
      }
    }, fakeContext, false);

    should(plugin.dummy).be.false();
    should(plugin.hooks['foo:bar']).match(['monitor', 'counter']);
    should(plugin.hooks['bar:baz']).be.eql('counter');
    should(plugin.hooks['baz:qux']).be.eql('counter');
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
        bar: {
          type: 'counter',
          increasers: ['bar:baz', 'foo:bar', 'foo:bar'],
          decreasers: ['baz:qux']
        },
        baz: {
          type: 'counter',
          increasers: ['baz:qux', 'bar:baz'],
          decreasers: ['foo:bar']
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
        foo: {
          type: 'monitor',
          hooks: ['foo:bar']
        },
        bar: {
          type: 'counter',
          increasers: ['bar:baz', 'foo:bar', 'foo:bar'],
          decreasers: ['baz:qux']
        },
        baz: {
          type: 'counter',
          increasers: ['baz:qux', 'bar:baz'],
          decreasers: ['foo:bar']
        },
        qux: {
          type: 'monitor',
          hooks: ['foo:bar', 'bar:baz', 'foo:bar']
        }
      }
    }, fakeContext, false);

    should(plugin.dummy).be.false();
    should(plugin.measures.foo).match({'foo:bar': 0});
    should(plugin.measures.bar).match({count: 0});
    should(plugin.measures.baz).match({count: 0});
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

  it('should not reset the measure if an error during saving occurs', (done) => {
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
        sinon.stub(plugin.client, 'create').rejects(new Error('foobar'));

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
          should(plugin.measures.foo['foo:bar']).be.eql(1);
          done();
        }, 0);
      })
      .catch(err => done(err));
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

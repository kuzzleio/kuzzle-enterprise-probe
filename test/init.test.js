var
  should = require('should'),
  sinon = require('sinon'),
  proxyquire = require('proxyquire');

require('sinon-as-promised');

describe('#init', () => {
  var
    Plugin,
    plugin,
    clock,
    esStub;

  before(() => {
    clock = sinon.useFakeTimers();
    esStub = sinon.stub().returns({
      exists: sinon.stub().resolves(false)
    });

    Plugin = proxyquire('../lib/index', {
      'elasticsearch': {
        Client: esStub
      }
    });
  });

  after(() => {
    clock.restore();
  });

  beforeEach(() => {
    esStub.reset();
    plugin = new Plugin();
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
    }, {}, true);

    should(plugin.dummy).be.true();
    should(plugin.probes).not.be.empty();
    should(plugin.client).be.null();
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
          increasers: ['bar:baz', 'foo:bar'],
          decreasers: ['baz: qux']
        }
      }
    }, {}, false);

    should(plugin.dummy).be.false();
    should(plugin.hooks).match({
      'foo:bar': 'monitor',
      'bar:baz': 'counter',
      'baz:qux': 'counter'
    });
  });
});
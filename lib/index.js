var
  Elasticsearch = require('elasticsearch'),
  Q = require('q'),
  _ = require('lodash'),
  ms = require('ms');

module.exports = function EnterpriseProbePlugin () {
  this.dummy = true;
  this.hooks = {};
  this.probes = {};
  this.eventMapping = {};
  this.client = null;
  this.index = "";

  /*
   * Stores the ongoing measurements.
   * Structure:
   *  {
   *    probeName_1: {
   *      // measurement
   *    },
   *    probeName_2: {
   *      // measurement
   *    },
   *    // ...
   *    probeName_n: {
   *      measurement
   *    }
   *  }
   */
  this.measures = {};

  /**
   * Initializes the plugin, connects it to ElasticSearch, and loads probes
   *
   * @param {object} config - plugin configuration
   * @param {object} context - kuzzle context
   * @param {boolean} isDummy - dummy-mode flag
   * @returns {Promise}
   */
  this.init = function (config, context, isDummy) {
    if (!config) {
      throw new Error('plugin-probe: no configuration provided.');
    }

    if (!config.databases || !Array.isArray(config.databases) || !config.databases.length) {
      throw new Error('plugin-probe: no target database set')
    }

    if (!config.storageIndex || typeof config.storageIndex !== 'string' || !config.storageIndex.length) {
      throw new Error('plugin-probe: no storage index defined');
    }

    this.probes = configureProbes(config.probes);

    // Enters dummy-mode if there is no probe set.
    this.dummy = isDummy || Object.keys(this.probes).length === 0;

    if (this.dummy) {
      return Q();
    }

    this.client = new Elasticsearch.Client({
      hosts: config.databases,
      apiVersion: '2.2',
      defer: () => Q.defer()
    });

    this.index = config.storageIndex;
    this.hooks = buildHooksList(this.probes);
    this.eventMapping = buildEventsToProbesMapping(this.probes);
    this.measures = initializeMeasures(this.probes);

    return createMeasuresIndex(this.client, this.index)
      .then(() => startProbes(this.client, this.index, this.probes, this.measures));
  };

  /**
   * Monitor probe
   * Basic event counter, used to monitor Kuzzle activity.
   *
   * Each measure is independent from each other, meaning each counter
   * is reset at the start of a new measurement.
   *
   * Can be set on any Kuzzle event. Each monitored event must be
   * explicitly listed in the probe configuration.
   *
   * The "aggregator" configuration accepts the following formats:
   * - "none": no aggregator, each event will create a new measure
   * - "duration": a string in human readable format, using the "ms"
   *               conversion library
   *               (see https://www.npmjs.com/package/ms)
   *
   * Probe configuration sample:
   *  {
   *    probes: {
   *      probe_monitor_1: {
   *        type: 'monitor',
   *        hooks: ['some:event', 'some:otherevent', 'andyet:another'],
   *        aggregator: "10s"
   *      }
   *    }
   *  }
   *
   * Resulting measures: every 10 seconds, a new measure will be written
   * with the aggregated number of fired events.
   * The measure document will look like this:
   *  {
   *    'some:event': 142,
   *    'some:otherevent': 0,
   *    'andyet:another': 3,
   *    timestamp: 123456789
   *  }
   */
  this.monitor = function () {
    var
      event = arguments[arguments.length-1];

    this.eventMapping.monitor[event].forEach(probe => {
      this.measures[probe][event]++;

      if (!this.probes[probe].aggregator) {
        saveMeasure(this.client, this.index, this.probes[probe], this.measures[probe]);
      }
    });
  };
};

/**
 * Creates the measures index if it does not already exists
 * @param {object} esClient - elasticsearch client
 * @param {string} index name where the measures will be stored
 * @returns {Promise}
 */
function createMeasuresIndex(esClient, index) {
  return esClient.indices.exists({index})
    .then(exists => {
      if (!exists) {
        return esClient.indices.create({index});
      }
      return Q();
    });
}

/**
 * Creates a hooks list from the probes configuration, binding listed probes hooks
 * to their corresponding plugin functions.
 * Rules of binding: probe type === plugin function name
 *
 * @param {object} probes configuration
 * @returns {object} resulting hooks object, used by Kuzzle
 */
function buildHooksList(probes) {
  var
    hooks = {};
  
  Object.keys(probes).forEach(name => {
    if (['monitor', 'counter'].indexOf(probes[name].type) !== -1) {
      []
        .concat(probes[name].hooks, probes[name].increasers, probes[name].decreasers)
        .filter(value => value)
        .forEach(hook => {
          hooks[hook] = probes[name].type;
        });
    }
  });

  return hooks;
}

/**
 * Creates a mapping between an event name and its associated probes.
 * This is especially useful for methods called by Kuzzle, because
 * they only have the event name, and no information about the
 * corresponding probes.
 *
 * The returned mapping is in the following format:
 *  {
 *    monitor: {
 *      eventName: [associated, probes, list],
 *      ...
 *    },
 *    counter: {
 *      increasers: {
 *        eventName: [associated, probes, list],
 *        ...
 *      },
 *      decreasers: {
 *        eventName: [associated, probes, list],
 *        ...
 *      }
 *    }
 *  }
 *
 * @param probes configuration list
 */
function buildEventsToProbesMapping(probes) {
  var mapping = {
    monitor: {},
    counter: {
      increasers: {},
      decreasers: {}
    }
  };

  Object.keys(probes).forEach(name => {
    switch (probes[name].type) {
      case 'monitor':
        probes[name].hooks
          .forEach(hook => {
            if (!mapping.monitor[hook]) {
              mapping.monitor[hook] = [];
            }

            mapping.monitor[hook].push(name);
          });
        break;

      case 'counter':
        ['increasers', 'decreasers'].forEach(type => {
          probes[name][type]
            .filter(value => value)
            .forEach(hook => {
              if (!mapping.counter[type][hook]) {
                mapping.counter[type][hook] = [];
              }

              mapping.counter[type][hook].push(name);
            });
        });
        break;
    }
  });

  return mapping;
}

/**
 * Takes the probes configuration and returns a ready-to-use object
 *
 * @param probes - raw probes configuration
 * @returns {object} converted probes
 */
function configureProbes(probes) {
  var
    output = _.cloneDeep(probes);

  Object.keys(output).forEach(name => {
    output[name].name = name;

    // TODO: throw an error if no aggregator is set for "sampler" probes
    if (output[name].aggregator === 'none') {
      output[name].aggregator = undefined;
    }
    else if (typeof output[name].aggregator === 'string') {
      output[name].aggregator = ms(output[name].aggregator);

      if (isNaN(output[name].aggregator)) {
        console.error('plugin-probe: Invalid aggregator "' + probes[name].aggregator + '". Aborting probes');
        return {};
      }
    }
  });

  return output;
}

/**
 * Returns an initialized "measures" object from the current probes
 * configuration
 *
 * @param probes configuration
 * @returns {Object} new measures object
 */
function initializeMeasures(probes) {
  var measures = {};

  Object.keys(probes).forEach(name => {
    measures[name] = {};

    switch (probes[name].type) {
      case 'monitor':
        probes[name].hooks.forEach(hook => {
          measures[name][hook] = 0;
        });
        break;

      case 'counter':
        measures[name].count = 0;
        break;
    }
  });

  return measures;
}

/**
 * Starts the probes, making save their measures according to their
 * aggregator interval
 *
 * @param client - elasticsearch client
 * @param index where to stores measures documents
 * @param probes
 * @param measures
 */
function startProbes(client, index, probes, measures) {
  console.log('██████████ KUZZLE PROBES ██████████');
  Object.keys(probes)
    .filter(name => {
      console.log('██ Starting probe: ', name);
      return probes[name].aggregator;
    })
    .forEach(name => {
      setInterval(() => saveMeasure(client, index, probes[name], measures[name]), probes[name].aggregator);
    });
  console.log('███████████████████████████████████');
}

/**
 * Saves the current measure to the database
 *
 * @param client - elasticsearch client
 * @param index where to stores measures documents
 * @param probe
 * @param measure
 */
function saveMeasure(client, index, probe, measure) {
  var
    document = {
      index,
      type: probe.name,
      body: measure
    };

  document.body.timestamp = Date.now();

  client.create(document);

  resetMeasure(probe, measure);
}

/**
 * Reset the provided measure, if the probe confiuration allows it
 *
 * @param probe
 * @param measure
 */
function resetMeasure(probe, measure) {
  // TODO: handle the "watcher" probe

  if (probe.type === 'monitor') {
    Object.keys(measure).forEach(event => {
      measure[event] = 0;
    });
  }
}

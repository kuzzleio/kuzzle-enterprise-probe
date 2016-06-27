var
  Elasticsearch = require('elasticsearch'),
  longTimeout = require('long-timeout'),
  q = require('q'),
  _ = require('lodash'),
  ms = require('ms'),
/*
 This library is used over Math.random() to ensure seeded, unbiased,
 evenly distributed random numbers.
 It also provides with an easy way to generate random integers with
 inclusive ranges.
*/
  Random = require('random-js');

/**
 * @constructor
 */
module.exports = function EnterpriseProbePlugin () {
  this.dummy = true;
  this.hooks = {};
  this.probes = {};
  this.eventMapping = {};
  this.client = null;
  this.index = '';
  this.dsl = null;

  // Used for sampler probes
  this.randomEngine = Random.engines.mt19937().autoSeed();

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
   * @param {Object} config - plugin configuration
   * @param {Object} context - kuzzle context
   * @param {Boolean} isDummy - dummy-mode flag
   * @returns {Promise}
   */
  this.init = function (config, context, isDummy) {
    if (!config || _.isEmpty(config)) {
      throw new Error('plugin-probe: no configuration provided.');
    }

    if (!config.databases || !Array.isArray(config.databases) || !config.databases.length) {
      throw new Error('plugin-probe: no target database set');
    }

    if (!config.storageIndex || typeof config.storageIndex !== 'string') {
      throw new Error('plugin-probe: no storage index defined');
    }


    this.probes = configureProbes(config.probes);

    // Enters dummy-mode if there is no probe set.
    this.dummy = isDummy || Object.keys(this.probes).length === 0;

    if (this.dummy) {
      return q();
    }

    this.client = new Elasticsearch.Client({
      hosts: config.databases,
      apiVersion: '2.2'
    });

    this.index = config.storageIndex;
    this.dsl = prepareDsl(context, this.probes);
    this.hooks = buildHooksList(this.probes);
    this.eventMapping = buildEventsToProbesMapping(this.probes);
    this.measures = initializeMeasures(this.probes);

    return createMeasuresIndex(this.client, this.index)
      .then(() => createMeasuresCollections(this.client, this.index, this.probes))
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
   * The "interval" configuration accepts the following formats:
   * - "none": no interval, each event will create a new measure
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
   *        interval: "10s"
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

      if (!this.probes[probe].interval) {
        saveMeasure(this.client, this.index, this.probes[probe], this.measures[probe]);
      }
    });
  };

  /**
   * Counter probe
   * Aggregates multiple fired events into a single measurement counter.
   * Useful to track activity at low-level.
   *
   * Each measure is cumulative: counters are kept for the entire Kuzzle
   * uptime, without ever being reset.
   *
   * The counter can be increased by some events, and decreased by others.
   *
   * Can be set on any Kuzzle event. Each monitored event must be explicitly
   * listed in the probe configuration.
   *
   * The "interval" configuration accepts the following formats:
   * - "none": no interval, each event will create a new measure
   * - "duration": a string in human readable format, using the "ms"
   *               conversion library
   *               (see https://www.npmjs.com/package/ms)
   *
   * Probe configuration sample:
   *  {
   *    probes: {
   *      probe_counter_1: {
   *        type: 'counter',
   *        increasers: ['list:of', 'counterIncreasing:events'],
   *        decreasers: ['anotherlist:of', 'counterDecreasing:events'],
   *        interval: '10m'
   *      }
   *    }
   *  }
   *
   * Resulting measures: every 10 minutes, a new measure will be written
   * with the calculated counter.
   * The measure document will look like this:
   *  {
   *    count: 1234,
   *    timestamp: 123456789
   *  }
   */
  this.counter = function () {
    var
      event = arguments[arguments.length-1];

    // increasing counters
    if (this.eventMapping.counter.increasers[event]) {
      this.eventMapping.counter.increasers[event].forEach(probe => {
        this.measures[probe].count++;

        if (!this.probes[probe].interval) {
          saveMeasure(this.client, this.index, this.probes[probe], this.measures[probe]);
        }
      });
    }

    // decreasing counters
    if (this.eventMapping.counter.decreasers[event]) {
      this.eventMapping.counter.decreasers[event].forEach(probe => {
        this.measures[probe].count--;

        if (!this.probes[probe].interval) {
          saveMeasure(this.client, this.index, this.probes[probe], this.measures[probe]);
        }
      });
    }
  };

  /**
   * Watcher probe
   * Watch documents and messages activity, counting them or retrieving part of their content.
   * Filters can be added to focus on particular documents and/or messages, and a probe
   * can only monitor one index-collection pair at a time
   *
   * Current limitation: due to the way Kuzzle handle documents,
   * only newly created documents can be watched. This will be fixed in the future.
   *
   * Each measure is independent from each other, meaning each watcher probe
   * is reset at the start of a new measurement.
   *
   * The "interval" configuration accepts the following formats:
   * - "none": no interval, each watched document/message will create a new measure
   * - "duration": a string in human readable format, using the "ms"
   *               conversion library
   *               (see https://www.npmjs.com/package/ms)
   *
   * The "collects" parameter configures how the probe collects data.
   * This parameter can be:
   * - empty, null or undefined: no data will be collected, only the number of
   *   matched documents/messages will be reported
   * - a '*' string value: the entire document/message will be collected
   * - an array listing the document/message attributes to collect
   *
   * The "filter" parameter configures what documents/messages will be watched.
   * It can be empty, undefined or null, meaning all documents/messages sent to an index-collection pair
   * will be watched.
   * Otherwise, a filter can be set, using the Kuzzle DSL: http://kuzzle.io/guide/#filtering-syntax
   *
   * Probe configuration sample:
   *  {
   *    probes: {
   *      probe_watcher_1: {
   *      type: 'watcher',
   *      index: 'index',
   *      collection: 'collection',
   *      filter: {
   *        'some': 'filters'
   *      },
   *      collects: [
   *        'can.be.empty.or.undefined',
   *        'any',
   *        'number',
   *        'of.fields',
   *        'nesting.supported.using.dot.separated.field.names'
   *      ],
   *      aggregator: '1h'
   *    },
   *    probe_watcher_2: {
   *      type: 'watcher',
   *      index: 'index',
   *      collection: 'collection',
   *      filter: {},
   *      collects: '*',
   *      aggregator: 'none'
   *    }
   *  }
   *
   *  @param {Object} requestObject - Standardized request made to Kuzzle
   */
  this.watcher = function (requestObject) {
    this.dsl.test(requestObject.index, requestObject.collection, requestObject.data.body, requestObject.data._id)
      .then(matchedIds => {
        matchedIds.forEach(filterId => {
          this.eventMapping.watcher[filterId].forEach(name => {
            var probe = this.probes[name];

            if (probe.collects) {
              this.measures[name].content.push(collectData(requestObject.data._id, requestObject.data.body, probe.collects));
            }
            else {
              this.measures[name].count++;
            }

            if (!probe.interval) {
              saveMeasure(this.client, this.index, probe, this.measures[name]);
            }
          });
        });
      });
  };

  /**
   * Sampler probe
   *
   * Identical to "watcher" probes, but instead of collecting every document/message matching
   * the configured probe, this probe retrieves only a statistical sample of documents/messages.
   * The sampler probe guarantees a statistically evenly distributed sample, meaning
   * all documents and messages have the same probability to enter the sample.
   *
   * The "sampleSize", "collects" and "interval" parameters are required.
   * The sample size should be large enough and the duration long enough for the sample to
   * have meaning statistically speaking.
   *
   * Current limitation: due to the way Kuzzle handle documents,
   * only newly created documents can be watched. This will be fixed in the future.
   *
   * Each measure is independent from each other, meaning each sampler probe
   * is reset at the start of a new measurement.
   *
   * The "interval" configuration must be set with a "duration": a string in human
   * readable format, using the "ms" conversion library (see https://www.npmjs.com/package/ms)
   *
   * The "collects" parameter configures how the probe collects data.
   * This parameter can be:
   * - a '*' string value: the entire document/message will be collected
   * - an array listing the document/message attributes to collect
   *
   * The "filter" parameter configures what documents/messages will be watched.
   * It can be empty, undefined or null, meaning all documents/messages sent to an index-collection pair
   * will be watched.
   * Otherwise, a filter can be set, using the Kuzzle DSL: http://kuzzle.io/guide/#filtering-syntax
   *
   * Probe configuration sample:
   *  {
   *    probes: {
   *      probe_sampler_1: {
   *      type: 'sampler',
   *      index: 'index',
   *      collection: 'collection',
   *      sampleSize: 500,
   *      filter: {
   *        'some': 'filters'
   *      },
   *      collects: [
   *        'can.be.empty.or.undefined',
   *        'any',
   *        'number',
   *        'of.fields',
   *        'nesting.supported.using.dot.separated.field.names'
   *      ],
   *      aggregator: '1d'
   *    },
   *    probe_sampler_2: {
   *      type: 'sampler',
   *      index: 'index',
   *      collection: 'collection',
   *      sampleSize: 2000,
   *      filter: {},
   *      collects: '*',
   *      aggregator: '1h'
   *    }
   *  }
   *
   * @param {Object} requestObject - Standardized request made to Kuzzle
   */
  this.sampler = function (requestObject) {
    this.dsl.test(requestObject.index, requestObject.collection, requestObject.data.body, requestObject.data._id)
      .then(matchedIds => {
        matchedIds.forEach(filterId => {
          this.eventMapping.sampler[filterId].forEach(probe => {
            var
              collected = collectData(requestObject.data._id, requestObject.data.body, probe.collects),
              positionCandidate;

            /*
             Reservoir sampling implementation

             First, we add documents to the sample until it's filled.
             */
            this.measures[probe.name].count++;

            if (this.measures[probe.name].content.length < probe.sampleSize) {
              return this.measures[probe.name].content.push(collected);
            }

            // Then, we replace elements with gradually decreasing probability
            positionCandidate = Random.integer(0, this.measures[probe.name].count - 1)(this.randomEngine);

            if (positionCandidate < probe.sampleSize) {
              this.measures[probe.name].content[positionCandidate] = collected;
            }
          });
        });
      });
  };
};

/**
 * Creates the measures index if it does not already exists
 *
 * @param {Object} esClient - elasticsearch client
 * @param {string} index name where the measures will be stored
 * @returns {Promise}
 */
function createMeasuresIndex(esClient, index) {
  return esClient.indices.exists({index})
    .then(exists => {
      if (!exists) {
        return esClient.indices.create({index});
      }
      return q();
    });
}

/**
 * Creates the measures collections if they do not already exist
 *
 * @param {Object} esClient - elasticsearch client
 * @param {string} index name where the measures will be stored
 * @param {Object} probes configuration
 * @returns {Promise}
 */
function createMeasuresCollections(esClient, index, probes) {
  var
    collections = Object.keys(probes),
    inexistantCollections,
    createCollectionPromises;

  return esClient.indices.getMapping({index, type: collections})
    .then(function (response) {
      if (
        response &&
        response[index] &&
        response[index].mappings) {
        inexistantCollections = _.difference(collections, Object.keys(response[index].mappings));
      }
      else {
        inexistantCollections = collections;
      }

      if (inexistantCollections.length === 0) {
        return q();
      }

      createCollectionPromises = inexistantCollections.map(name => {
        return createCollection(esClient, index, probes[name]);
      });

      return q.all(createCollectionPromises);
    });
}

/**
 * Creates the probe measurement collection
 * Creates default fields mapping and uses the mapping provided with the probe configuration for the `content` field
 *
 * @param {Object} esClient
 * @param {string} measureIndex
 * @param {Object} probe
 * @returns {Promise}
 */
function createCollection(esClient, measureIndex, probe) {
  var
    probeMapping = {timestamp: {type: 'date', format: 'epoch_millis'}},
    countType = {type: 'integer'};

  switch (probe.type) {
    case 'watcher':
    case 'sampler':
      if (probe.collects) {
        if (probe.mapping) {
          _.merge(probeMapping, {content: {properties: _.cloneDeep(probe.mapping)}});
        }
      }
      else {
        probeMapping.count = countType;
      }
      break;
    case 'counter':
      probeMapping.count = countType;
      break;
    case 'monitor':
      probe.hooks.forEach(hook => {
        probeMapping[hook] = {type: 'integer'};
      });
      break;
  }

  return esClient.indices.putMapping({
    index: measureIndex,
    type: probe.name,
    updateAllTypes: false,
    body: probeMapping
  });
}

/**
 * Creates a hooks list from the probes configuration, binding listed probes hooks
 * to their corresponding plugin functions.
 * Rules of binding: probe type === plugin function name
 *
 * @param {Object} probes configuration
 * @returns {Object} resulting hooks object, used by Kuzzle
 */
function buildHooksList(probes) {
  var
    hooks = {};
  
  Object.keys(probes).forEach(name => {
    if (['monitor', 'counter'].indexOf(probes[name].type) > -1) {
      []
        .concat(probes[name].hooks, probes[name].increasers, probes[name].decreasers)
        .filter(value => value)
        .forEach(event => {
          hooks = addEventToHooks(hooks, event, probes[name].type);
        });
    }

    // Adds a generic event listener on new messages/documents for watcher and sampler probes
    if (['watcher', 'sampler'].indexOf(probes[name].type) > -1) {
      hooks = addEventToHooks(hooks, 'data:beforePublish', probes[name].type);
      hooks = addEventToHooks(hooks, 'data:beforeCreate', probes[name].type);
      hooks = addEventToHooks(hooks, 'data:beforeCreateOrReplace', probes[name].type);
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
 *    },
 *    watcher: {
 *      filterUniqueId: [associated, probes, names],
 *      ...
 *    },
 *    sampler: {
 *      filterUniqueId: [associated, probes, objects],
 *      ...
 *    }
 *  }
 *
 * @param {Object} probes configuration list
 * @returns {Object} mapping object
 */
function buildEventsToProbesMapping(probes) {
  var mapping = {
    monitor: {},
    counter: {
      increasers: {},
      decreasers: {}
    },
    watcher: {},
    sampler: {}
  };

  Object.keys(probes).forEach(name => {
    switch (probes[name].type) {
      case 'monitor':
        probes[name].hooks
          .forEach(hook => {
            if (!mapping.monitor[hook]) {
              mapping.monitor[hook] = [];
            }

            if (mapping.monitor[hook].indexOf(name) === -1) {
              mapping.monitor[hook].push(name);
            }
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

              if (mapping.counter[type][hook].indexOf(name) === -1) {
                mapping.counter[type][hook].push(name);
              }
            });
        });
        break;

      case 'watcher':
        if (!mapping.watcher[probes[name].filterId]) {
          mapping.watcher[probes[name].filterId] = [name];
        }
        else {
          mapping.watcher[probes[name].filterId].push(name);
        }
        break;

      case 'sampler':
        if (!mapping.sampler[probes[name].filterId]) {
          mapping.sampler[probes[name].filterId] = [probes[name]];
        }
        else {
          mapping.sampler[probes[name].filterId].push(probes[name]);
        }
        break;
    }
  });

  return mapping;
}

/**
 * Takes the probes configuration and returns a ready-to-use object
 *
 * @param {Object} probes - raw probes configuration
 * @returns {Object} converted probes
 */
function configureProbes(probes) {
  var output = {};

  if (!probes || _.isEmpty(probes)) {
    return output;
  }

  Object.keys(probes).forEach(name => {
    var probe = _.cloneDeep(probes[name]);
    probe.name = name;

    if (!probe.type) {
      return console.error(`plugin-probe: [probe: ${name}] "type" parameter missing"`);
    }

    if (probe.type === 'sampler' && (probe.interval === 'none' || !probe.interval)) {
      return console.error(`plugin-probe: [probe: ${name}] An "interval" parameter is required for sampler probes`);
    }

    if (probe.interval === 'none') {
      probe.interval = undefined;
    }
    else if (typeof probe.interval === 'string') {
      probe.interval = ms(probe.interval);

      if (isNaN(probe.interval)) {
        return console.error(`plugin-probe: [probe: ${name}] Invalid interval "${probe.interval}".`);
      }
    }

    /*
     In the case of a counter probe, the same event cannot be in
     the "increasers" and in the "decreasers" lists at the same
     time
     */
    if (probe.type === 'counter' && _.intersection(probe.increasers, probe.decreasers).length > 0) {
      return console.error(`plugin-probe: [probe: ${name}] Configuration error: an event cannot be set both to increase and to decrease a counter`);
    }

    /*
     watcher and sampler configuration check
     */
    if (['watcher', 'sampler'].indexOf(probe.type) > -1) {
      if (!probe.index || !probe.collection) {
        return console.error(`plugin-probe: [probe: ${name}] Configuration error: missing index or collection`);
      }

      // checking if the "collects" parameter is correct
      if (probe.collects) {
        if (typeof probe.collects !== 'string' && !Array.isArray(probe.collects)) {
          return console.error(`plugin-probe: [probe: ${name}] Invalid "collects" format: expected array or string, got ${typeof probe.collects}`);
        }

        if (typeof probe.collects === 'string' && probe.collects !== '*') {
          return console.error(`plugin-probe: [probe: ${name}] Invalid "collects" value`);
        }

        if (Array.isArray(probe.collects) && probe.collects.length === 0) {
          probe.collects = null;
        }
      }

      // the "collects" parameter is required for sampler probes
      if (probe.type === 'sampler' && !probe.collects) {
        return console.error(`plugin-probe: [probe: ${name}] A "collects" parameter is required for sampler probes`);
      }

      // forcing an empty filter if not defined
      if (probe.filter === undefined || probe.filter === null) {
        probe.filter = {};
      }
    }

    // sampler probe specific check
    if (probe.type === 'sampler') {
      if (!probe.sampleSize) {
        return console.error(`plugin-probe: [probe: ${name}] "sampleSize" parameter missing`);
      }

      if (typeof probe.sampleSize !== 'number') {
        return console.error(`plugin-probe: [probe: ${name}] invalid "sampleSize" parameter. Expected a number, got a ${typeof probe.sampleSize}`);
      }
    }
    
    output[name] = probe;
  });

  return output;
}

/**
 * Returns an initialized "measures" object from the current probes
 * configuration
 *
 * @param {Object} probes configuration
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

      case 'watcher':
        if (probes[name].collects) {
          measures[name].content = [];
        }
        else {
          measures[name].count = 0;
        }
        break;

      case 'sampler':
        measures[name].content = [];
        measures[name].count = 0;
        break;
    }
  });

  return measures;
}

/**
 * Starts the probes, making save their measures according to their
 * "interval" interval
 *
 * @param {Object} client - elasticsearch client
 * @param {string} index where to stores measures documents
 * @param {Object} probes
 * @param {Object} measures object used to store measurements
 */
function startProbes(client, index, probes, measures) {
  console.log('██████████ KUZZLE PROBES ██████████');
  Object.keys(probes)
    .filter(name => {
      console.log(`██ Starting probe: ${name}`);
      return probes[name].interval;
    })
    .forEach(name => {
      longTimeout.setInterval(() => saveMeasure(client, index, probes[name], measures[name]), probes[name].interval);
    });
  console.log('███████████████████████████████████');
}

/**
 * Saves the current measure to the database
 *
 * There are two kinds of measures:
 *  - single document measure, for instance a measure coming from a counter probe
 *  - measures containing a set of content. These measures generate
 *      1 document per content. For instance sampler probes generate a statistical
 *      sample set of documents/messages.
 *      These measures generates as many measure documents than collected contents.
 *
 * @param {Object} client - elasticsearch client
 * @param {string} index where to stores measures documents
 * @param {Object} probe
 * @param {Object} measure
 */
function saveMeasure(client, index, probe, measure) {
  var
    promise,
    timestamp = Date.now(),
    request;

  if (measure.content) {
    if (measure.content.length === 0) {
      return false;
    }

    request = [];

    measure.content.forEach(content => {
      request.push({
        index: {
          _index: index,
          _type: probe.name
        }
      });

      request.push({
        timestamp,
        content
      });
    });

    promise = client.bulk({body: request});
  }
  else {
    request = measure;
    request.timestamp = timestamp;

    promise = client.create({
      index,
      type: probe.name,
      body: request
    });
  }

  promise
    .then(() => resetMeasure(probe, measure))
    .catch(err => {
      console.error(`plugin-probe: [${probe.name}] Failed to save the following measure:`);
      console.dir(measure, {depth: null});
      console.error('Reason: ');
      console.dir(err, {depth: null});
      console.error('======');
    });
}

/**
 * Reset the provided measure, if the probe configuration allows it
 *
 * @param {Object} probe
 * @param {Object} measure
 */
function resetMeasure(probe, measure) {
  if (probe.type === 'monitor') {
    Object.keys(measure).forEach(event => {
      measure[event] = 0;
    });
  }

  if (['watcher', 'sampler'].indexOf(probe.type) > -1) {
    if (measure.count !== undefined) {
      measure.count = 0;
    }

    if (measure.content) {
      measure.content = [];
    }
  }
}

/**
 * Simple function avoiding repetition of code
 * Returns a new hooks object with an added "event: probe" attribute in it
 *
 * @param {Object} hooks
 * @param {string} event
 * @param {string} probeType
 * @returns {Object} new hooks object
 */
function addEventToHooks(hooks, event, probeType) {
  var newHooks = _.clone(hooks);

  if (!newHooks[event]) {
    newHooks[event] = probeType;
  }
  else if (typeof newHooks[event] === 'string' && newHooks[event] !== probeType) {
    newHooks[event] = [newHooks[event], probeType];
  }
  else if (Array.isArray(newHooks[event]) && newHooks[event].indexOf(probeType) === -1) {
    newHooks[event].push(probeType);
  }

  return newHooks;
}

/**
 * Register watcher and sampler probes in the DSL
 *
 * @param {Object} context - plugin context
 * @param {Object} probes
 * @returns {Object} Instantiated DSL
 */
function prepareDsl(context, probes) {
  var dsl = new context.constructors.Dsl();

  Object.keys(probes).forEach(name => {
    var probe = probes[name];

    probe.filterId = dsl.createFilterId(probe.index, probe.collection, probe.filter);

    if (['watcher', 'sampler'].indexOf(probe.type) > -1) {
      dsl.register(probe.filterId, probe.index, probe.collection, probe.filter);
    }
  });

  return dsl;
}

/**
 * Returns an object containing only the necessary collected data
 *
 * @param {string} id - document id (may be undefined)
 * @param {Object|string} content - data source
 * @param {Array|string} collect - information about what to collect
 * @returns {Object}
 */
function collectData(id, content, collect) {
  var collected = {};

  if (collect === '*') {
    collected = content;
  }
  else {
    collect.forEach(field => _.set(collected, field, _.get(content, field)));
  }

  if (id) {
    collected._id = id;
  }

  return collected;
}

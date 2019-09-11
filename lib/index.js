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

'use strict';

const
  longTimeout = require('long-timeout'),
  Bluebird = require('bluebird'),
  _ = require('lodash'),
  debug = require('debug')('kuzzle:kdc:probes'),
  ms = require('ms'),
  /*
   This library is used over Math.random() to ensure seeded, unbiased,
   evenly distributed random numbers.
   It also provides with an easy way to generate random integers with
   inclusive ranges.
  */
  { MersenneTwister19937, integer } = require('random-js');

/**
 * @constructor
 */
class ProbePlugin {
  constructor () {
    this.hooks = {};
    this.probes = {};
    this.eventMapping = {};
    this.context = null;
    this.index = '';
    this.dsl = null;

    // Used for sampler probes
    this.randomEngine = MersenneTwister19937.autoSeed();

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

    this.controllers = {
      measure: {
        monitor: 'monitor',
        counter: 'counter',
        watcher: 'watcher',
        sampler: 'sampler'
      }
    };

    this.routes = [
      {verb: 'post', url: 'measure/monitor', controller: 'measure', action: 'monitor'},
      {verb: 'post', url: 'measure/counter', controller: 'measure', action: 'counter'},
      {verb: 'post', url: 'measure/watcher', controller: 'measure', action: 'watcher'},
      {verb: 'post', url: 'measure/sampler', controller: 'measure', action: 'sampler'}
    ];
  }

  /**
   * Initializes the plugin, connects it to ElasticSearch, and loads probes
   *
   * @param {Object} customConfig - plugin configuration
   * @param {Object} context - kuzzle context
   * @returns {Promise}
   */
  init (customConfig, context) {
    const
      defaultConfig = {
        storageIndex: 'measures',
        probes: {}
      },
      config = Object.assign(defaultConfig, customConfig);

    if (!config.storageIndex || typeof config.storageIndex !== 'string') {
      throw new Error('plugin-probe: no storage index defined');
    }

    this.context = context;
    this.index = config.storageIndex;
    this.hooks = {
      'core:kuzzleStart': 'startProbes'
    };

    this.probes = this._configureProbes(config.probes);

    if (Object.keys(this.probes).length === 0) {
      return this;
    }

    debug('===> Probes Initialized!');
    return this._prepareDsl(this.probes)
      .then(dsl => {
        this.dsl = dsl;
        this.eventMapping = this._buildEventsToProbesMapping(this.probes);
        this.measures = this._initializeMeasures(this.probes);
        return this;
      });
  }

  /**
   * Monitor probe
   *
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
   *
   *  @param {KuzzleRequest} request
   */
  monitor (request) {
    const
      event = request.input.body.event;
    debug(`Received measure for monitor ${event}`);

    for (const probe of this.eventMapping.monitor[event]) {
      this.measures[probe][event]++;

      if (!this.probes[probe].interval) {
        this._afterMeasure(this.probes[probe], this.measures[probe]);
      }
    }

    return Promise.resolve({
      acknowledged: true
    });
  }

  /**
   * Counter probe
   *
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
   *
   *  @param {KuzzleRequest} request
   */
  counter (request) {
    const
      event = request.input.body.event;
    debug(`Received measure for counter ${event}`);

    // increasing counters
    if (this.eventMapping.counter.increasers[event]) {
      for (const probe of this.eventMapping.counter.increasers[event]) {
        this.measures[probe].count++;

        if (!this.probes[probe].interval) {
          this._afterMeasure(this.probes[probe], this.measures[probe]);
        }
      }
    }

    // decreasing counters
    if (this.eventMapping.counter.decreasers[event]) {
      for (const probe of this.eventMapping.counter.decreasers[event]) {
        this.measures[probe].count--;

        if (!this.probes[probe].interval) {
          this._afterMeasure(this.probes[probe], this.measures[probe]);
        }
      }
    }

    return Promise.resolve({
      acknowledged: true
    });
  }

  /**
   * Watcher probe
   *
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
   * @param {KuzzleRequest} request - Standardized request made to Kuzzle
   */
  watcher (request) {
    const
      payload = request.input.body.payload,
      matchedIds = this.dsl.test(payload.data.index, payload.data.collection, payload.data.body, payload.data._id);

    for (const filterId of matchedIds) {
      for (const name of this.eventMapping.watcher[filterId]) {
        const probe = this.probes[name];
        debug(`Received measure for watcher ${name}`);

        if (probe.collects) {
          this.measures[name].content.push(this._collectData(payload.data._id, payload.data.body, probe.collects));
        }
        else {
          this.measures[name].count++;
        }

        if (!probe.interval) {
          this._afterMeasure(probe, this.measures[name]);
        }
      }
    }

    return Promise.resolve({
      acknowledged: true
    });
  }

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
   * @param {KuzzleRequest} request - Standardized request made to Kuzzle
   */
  sampler (request) {
    const
      payload = request.input.body.payload,
      matchedIds = this.dsl.test(payload.data.index, payload.data.collection, payload.data.body, payload.data._id);

    for (const filterId of matchedIds) {
      for (const probe of this.eventMapping.sampler[filterId]) {
        const
          collected = this._collectData(payload.data._id, payload.data.body, probe.collects);
        let
          positionCandidate;
        debug(`Received measure for sampler ${probe.name}`);

        /*
         Reservoir sampling implementation

         First, we add documents to the sample until it's filled.
         */
        this.measures[probe.name].count++;

        if (this.measures[probe.name].content.length < probe.sampleSize) {
          return Promise.resolve(this.measures[probe.name].content.push(collected));
        }

        // Then, we replace elements with gradually decreasing probability
        positionCandidate = integer(0, this.measures[probe.name].count - 1)(this.randomEngine);

        if (positionCandidate < probe.sampleSize) {
          this.measures[probe.name].content[positionCandidate] = collected;
        }
      }
    }

    return Promise.resolve({
      acknowledged: true
    });
  }

  /**
   * Starts the probes, making save their measures according to their "interval" interval
   */
  startProbes() {
    return this._createMeasuresIndex()
      .then(() => this._getMissingCollections(this.probes))
      .then(missingCollections => {
        this.context.log.info('██████████ KUZZLE PROBES ██████████');
        for (const name of Object.keys(this.probes)) {
          this.context.log.info(`██ Starting probe: ${name}`);

          this._createCollection(this.probes[name], missingCollections)
            .then(() => {
              if (this.probes[name].interval) {
                longTimeout.setInterval(
                  () => this._afterMeasure(this.probes[name], this.measures[name]),
                  this.probes[name].interval
                );
              }
            })
            .catch(error => {
              this.context.log.error(`An error occured during creation of collection "${name}":`);
              this.context.log.error(error);
            });
        }
        this.context.log.info('███████████████████████████████████');
        return;
      });
  }

  /**
   * Creates the measures index if it does not already exists
   *
   * @returns {Promise}
   */
  _createMeasuresIndex() {
    return this.context.accessors.execute(
      new this.context.constructors.Request({
        index: this.index,
        controller: 'index',
        action: 'exists'
      }))
      .then(response => {
        if (!response.result) {
          return this.context.accessors.execute(
            new this.context.constructors.Request({
              index: this.index,
              controller: 'index',
              action: 'create'
            }));
        }
        return;
      });
  }

  /**
   * Returns the measures missing collections
   *
   * @param {Object} probes configuration
   * @returns {Promise}
   */
  _getMissingCollections(probes) {
    const
      collections = Object.keys(probes);

    return this.context.accessors.execute(this.context.constructors.Request({
      index: this.index,
      controller: 'collection',
      action: 'list',
      type: 'stored'
    }))
      .then(response => {
        const existingCollections = response.result.collections.map(item => item.name);

        return _.difference(collections, existingCollections);
      });
  }

  /**
   * Creates the probe measurement collection
   * Creates default fields mapping depending on the probe type attached
   * Uses the mapping provided with the probe configuration for the `content` field
   *
   * @param {Object} probe
   * @param {string[]} missingCollections
   * @returns {Promise}
   */
  _createCollection(probe, missingCollections) {
    if (missingCollections.indexOf(probe.name) === -1) {
      return Bluebird.resolve({});
    }

    const
      probeMapping = {timestamp: {type: 'date', format: 'epoch_millis'}},
      countType = {type: 'integer'},
      creationRequest = this.context.constructors.Request({
        index: this.index,
        collection: probe.name,
        controller: 'collection',
        action: 'create'
      });
    let mappingRequest;

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
        for (const hook of probe.hooks) {
          probeMapping[hook] = {type: 'integer'};
        }
        break;
      default:
        throw new Error(`The probe type ${probe.type} is unknown`);
    }

    mappingRequest = this.context.constructors.Request({
      index: this.index,
      collection: probe.name,
      controller: 'collection',
      action: 'updateMapping',
      body: {
        properties: probeMapping
      }
    });

    return this.context.accessors.execute(creationRequest)
      .then(() => this.context.accessors.execute(mappingRequest));

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
  _buildEventsToProbesMapping(probes) {
    const mapping = {
      monitor: {},
      counter: {
        increasers: {},
        decreasers: {}
      },
      watcher: {},
      sampler: {}
    };

    for (const name of Object.keys(probes)) {
      switch (probes[name].type) {
        case 'monitor':
          for (const hook of probes[name].hooks) {
            if (!mapping.monitor[hook]) {
              mapping.monitor[hook] = [];
            }

            if (mapping.monitor[hook].indexOf(name) === -1) {
              mapping.monitor[hook].push(name);
            }
          }
          break;

        case 'counter':
          for (const type of ['increasers', 'decreasers']) {
            if (!probes[name][type]) {
              throw new Error(`plugin-probe: [probe: ${name}] "${type}" parameter missing"`);
            }

            for (const hook of probes[name][type].filter(value => value)) {
              if (!mapping.counter[type][hook]) {
                mapping.counter[type][hook] = [];
              }

              if (mapping.counter[type][hook].indexOf(name) === -1) {
                mapping.counter[type][hook].push(name);
              }
            }
          }
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

        default:
          throw new Error(`The probe type ${probes[name].type} is unknown`);
      }
    }

    return mapping;
  }

  /**
   * Takes the probes configuration and returns a ready-to-use object
   *
   * @param {Object} probes - raw probes configuration
   * @returns {Object} converted probes
   */
  _configureProbes(probes) {
    const output = {};

    if (!probes || _.isEmpty(probes)) {
      return output;
    }

    for (const name of Object.keys(probes)) {
      const probe = _.cloneDeep(probes[name]);
      probe.name = name;

      if (!probe.type) {
        throw new Error(`plugin-probe: [probe: ${name}] "type" parameter missing"`);
      }

      if (probe.type === 'sampler' && (probe.interval === 'none' || !probe.interval)) {
        throw new Error(`plugin-probe: [probe: ${name}] An "interval" parameter is required for sampler probes`);
      }

      if (probe.interval === 'none') {
        probe.interval = undefined;
      }
      else if (typeof probe.interval === 'string') {
        probe.interval = ms(probe.interval);

        if (isNaN(probe.interval)) {
          throw new Error(`plugin-probe: [probe: ${name}] Invalid interval "${probe.interval}".`);
        }
      }

      /*
       In the case of a counter probe, the same event cannot be in
       the "increasers" and in the "decreasers" lists at the same
       time
       */
      if (probe.type === 'counter' && _.intersection(probe.increasers, probe.decreasers).length > 0) {
        throw new Error(`plugin-probe: [probe: ${name}] Configuration error: an event cannot be set both to increase and to decrease a counter`);
      }

      /*
       watcher and sampler configuration check
       */
      if (['watcher', 'sampler'].indexOf(probe.type) > -1) {
        if (!probe.index || !probe.collection) {
          throw new Error(`plugin-probe: [probe: ${name}] Configuration error: missing index or collection`);
        }

        // checking if the "collects" parameter is correct
        if (probe.collects) {
          if (typeof probe.collects !== 'string' && !Array.isArray(probe.collects)) {
            throw new Error(`plugin-probe: [probe: ${name}] Invalid "collects" format: expected array or string, got ${typeof probe.collects}`);
          }

          if (typeof probe.collects === 'string' && probe.collects !== '*') {
            throw new Error(`plugin-probe: [probe: ${name}] Invalid "collects" value`);
          }

          if (Array.isArray(probe.collects) && probe.collects.length === 0) {
            probe.collects = null;
          }
        }

        // the "collects" parameter is required for sampler probes
        if (probe.type === 'sampler' && !probe.collects) {
          throw new Error(`plugin-probe: [probe: ${name}] A "collects" parameter is required for sampler probes`);
        }

        // forcing an empty filter if not defined
        if (probe.filter === undefined || probe.filter === null) {
          probe.filter = {};
        }
      }

      // sampler probe specific check
      if (probe.type === 'sampler') {
        if (!probe.sampleSize) {
          throw new Error(`plugin-probe: [probe: ${name}] "sampleSize" parameter missing`);
        }

        if (typeof probe.sampleSize !== 'number') {
          throw new Error(`plugin-probe: [probe: ${name}] invalid "sampleSize" parameter. Expected a number, got a ${typeof probe.sampleSize}`);
        }
      }

      output[name] = probe;
    }

    return output;
  }

  /**
   * Returns an initializ "measures" object from the current probes
   * configuration
   *
   * @param {Object} probes configuration
   * @returns {Object} new measures object
   */
  _initializeMeasures(probes) {
    const measures = {};

    for (const name of Object.keys(probes)) {
      measures[name] = {};

      switch (probes[name].type) {
        case 'monitor':
          for (const hook of probes[name].hooks) {
            measures[name][hook] = 0;
          }
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

        default:
          throw new Error(`The probe type ${probes[name].type} is unknown`);
      }
    }

    return measures;
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
   * @param {Object} probe
   * @param {Object} measure
   */
  _saveMeasure(probe, measure) {
    const
      timestamp = Date.now();
    let
      promise,
      request;

    if (measure.content) {
      if (measure.content.length === 0) {
        return Bluebird.resolve(false);
      }

      request = [];

      for (const content of measure.content) {
        request.push({
          index: {
            _index: this.index,
            _type: probe.name
          }
        });

        request.push({
          timestamp,
          content
        });
      }

      promise = this.context.accessors.execute(this.context.constructors.Request({
        index: this.index,
        collection: probe.name,
        controller: 'bulk',
        action: 'import',
        body: {
          bulkData: request
        }
      }));
    }
    else {
      request = measure;
      request.timestamp = timestamp;

      try {
        promise = this.context.accessors.execute(this.context.constructors.Request({
          index: this.index,
          collection: probe.name,
          controller: 'document',
          action: 'create',
          body: JSON.parse(JSON.stringify(request))
        }, {
          user: {
            _id: null
          }
        }));
      }
      catch (error) {
        promise = Bluebird.reject(error);
      }
    }

    return promise;
  }

  /**
   * Performs a set of operations after receiving a probe.
   *
   * @param {Object} probe
   * @param {Object} measure
   */
  _afterMeasure(probe, measure) {
    return new Bluebird((resolve, reject) => {
      if (!probe.volatile) {
        this._saveMeasure(probe, measure)
          .then(() => resolve())
          .catch(err => reject(err));
      } else {
        resolve();
      }
    }).then(() => {
      this._notifyMeasure(probe, measure);
      this._resetMeasure(probe, measure);
      return;
    }).catch(err => this._showError(probe, measure, err));
  }

  /**
   * Triggers a custom event to notify that KDC received a measure.
   *
   * @param {Object} probe
   * @param {Object} measure
   */
  _notifyMeasure(probe, measure) {
    this.context.accessors.trigger('receivedMeasure', {
      data: JSON.parse(JSON.stringify(measure)),
      probeName: probe.name
    });
  }

  /**
   * Reset the provided measure, if the probe configuration allows it
   *
   * @param {Object} probe
   * @param {Object} measure
   */
  _resetMeasure(probe, measure) {
    if (probe.type === 'monitor') {
      for (const event of Object.keys(measure)) {
        measure[event] = 0;
      }
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
   * Register watcher and sampler probes in the DSL
   *
   * @param {Object} probes
   * @returns {Object} Instantiated DSL
   */
  _prepareDsl(probes) {
    const
      dsl = new this.context.constructors.Dsl(),
      promises = [];

    for (const name of Object.keys(probes)) {
      const probe = probes[name];

      if (['watcher', 'sampler'].indexOf(probe.type) > -1) {
        promises.push(
          dsl
            .register(probe.index, probe.collection, probe.filter)
            .then(result => {
              probe.filterId = result.id;
            })
        );
      }
    }

    return Bluebird.all(promises).then(() => dsl);
  }

  /**
   * Returns an object containing only the necessary collected data
   *
   * @param {string} id - document id (may be undefined)
   * @param {Object|string} content - data source
   * @param {Array|string} collect - information about what to collect
   * @returns {Object}
   */
  _collectData(id, content, collect) {
    let collected = {};

    if (collect === '*') {
      collected = content;
    }
    else {
      for (const field of collect) {
        _.set(collected, field, _.get(content, field));
      }
    }

    if (id) {
      collected._id = id;
    }

    return collected;
  }

  /**
   * Prints an error to logger.
   *
   * @param  {Object} probe
   * @param  {Object} measure
   * @param  {String} err
   */
  _showError(probe, measure, err) {
    this.context.log.error(`plugin-probe: [${probe.name}] Failed to save the following measure:`);
    this.context.log.error(measure);
    this.context.log.error('Reason: ');
    this.context.log.error(err);
    this.context.log.error('======');
  }
}

module.exports = ProbePlugin;

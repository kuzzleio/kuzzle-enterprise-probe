<p align=center> ![logo](http://kuzzle.io/guide/images/kuzzle.svg)

# Table of content

* [Table of content](#table-of-content" aria-hidden="true"><span aria-hidden="true)
* [About](#about" aria-hidden="true"><span aria-hidden="true)
* [Plugin configuration](#plugin-configuration" aria-hidden="true"><span aria-hidden="true)
  * [Installation](#installation" aria-hidden="true"><span aria-hidden="true)
  * [General configuration](#general-configuration" aria-hidden="true"><span aria-hidden="true)
  * [Retrieving probe measures](#retrieving-probe-measures" aria-hidden="true"><span aria-hidden="true)
* [Probes description](#probes-description" aria-hidden="true"><span aria-hidden="true)
  * [monitor probes](#monitor-probes" aria-hidden="true"><span aria-hidden="true)
    * [Description](#description" aria-hidden="true"><span aria-hidden="true)
    * [Configuration](#configuration" aria-hidden="true"><span aria-hidden="true)
    * [Measure document](#measure-document" aria-hidden="true"><span aria-hidden="true)
    * [Adding a monitor probe](#adding-a-monitor-probe" aria-hidden="true"><span aria-hidden="true)
  * [counter probes](#counter-probes" aria-hidden="true"><span aria-hidden="true)
    * [Description](#description-1" aria-hidden="true"><span aria-hidden="true)
    * [Configuration](#configuration-1" aria-hidden="true"><span aria-hidden="true)
    * [Measure document](#measure-document-1" aria-hidden="true"><span aria-hidden="true)
    * [Adding a counter probe](#adding-a-counter-probe" aria-hidden="true"><span aria-hidden="true)



# About

Plugin allowing to add probes, collecting data and events to calculate data metrics.


# Plugin configuration

## Installation

Using the command-line interface:

```shell
kuzzle plugins --install --path /absolute/path/to/this/plugin kuzzle-enterprise-probe
```

:warning: If Kuzzle is running inside a Docker container, you need to first make the plugin directory accessible from inside the container.

## General configuration

After a fresh installation, the plugin configuration looks like this:

```json
{
  "path": "/absolute/path/kuzzle-enterprise-probe",
  "activated": true,
  "config":
   {
     "threads": 1,
     "loadedBy": "server",
     "databases": [ "localhost:9200" ],
     "storageIndex": "measures",
     "probes": {}
   }
}
```

You may need to configure the following parameters:

* `databases`: the list of Elasticsearch `host:port` where the probe measures will be stored
* `storageIndex`: the index name under which the measures will be stored

You can change these values by using the CLI:

```shell
kuzzle plugins --set '{ "databases": ["host1:port", "host2:port", "host...:port"]}' kuzzle-enterprise-probe
```
:warning: The number of threads must be strictly equal to 1, and this plugin can only be loaded by a Kuzzle server.


## Retrieving probe measures

Measures are stored in the Elasticsearch instances listed in the `databases` parameter in the probe general configuration.

The index used is the one configured under the `storageIndex` configuration parameter.

Each probe creates a new collection, using the probe name as the collection name, and stores its measurements in it.


# Probes description

## `monitor` probes

### Description

`monitor` probes are basic event counter, used to monitor Kuzzle activity.

Each measure is independent from each other, meaning each counter is reset at the start of a new measurement.

Can be set on any [Kuzzle event](http://kuzzle.io/guide/#how-to-create-a-plugin). Each monitored event must be explicitly listed in the probe configuration.

### Configuration

Probe configuration example:

```json
{
  "probes": {
    "probe_monitor_1": {
      "type": "monitor",
      "hooks": ["some:event", "some:otherevent", "andyet:anotherone"],
      "interval": "10 minutes"
    }
  }
}
```

Parameters rundown:

- `probe_monitor_1` is the probe unique name, and also the data collection in which the measurements are stored
- `type: monitor` tells the plugin that this probe is a monitor one
- `hooks` lists the events to listen
- `interval` configures the measurement save interval. The following formats are accepted:
  - `"none"`: no interval, each listened event will create a new measure document
  - `"duration"`: a string in human readable format, using the [ms conversion library](https://www.npmjs.com/package/ms)

### Measure document

Following the previously given example: every 10 minutes, a new measure will be written with the counted fired events.

The measure document will look like this:

```json
{
  "some:event": 142,
  "some:otherevent": 0,
  "andyet:anotherone": 3,
  "timestamp": 123456789
}
```

The `timestamp` field is automatically added, and mark the end of a measurement. It's encoded as the number of milliseconds since Epoch.

### Adding a `monitor` probe

Command-line interface example:

```shell
kuzzle plugins --set '{
  "probes": {
    "probe_monitor_1": {
      "type": "monitor",
      "interval": "10 minutes",
      "hooks": ["some:event", "some:otherevent", "andyet:anotherone"]
    }
  }
}' kuzzle-enterprise-probe
```

## `counter` probes

### Description

`counter` probes aggregates multiple fired events into a single measurement counter.  

Each measure is cumulative, meaning counters are kept for the entire Kuzzle uptime, without ever being reset.

The counter can be increased by some events, and decreased by others.

Can be set on any Kuzzle event. Each monitored event must be explicitly listed in the probe configuration.

### Configuration

Probe configuration example:

```json
{
  "probes": {
    "probe_counter_1": {
      "type": "counter",
      "increasers": ["list:of", "counterIncreasing:events"],
      "decreasers": ["anotherlist:of", "counterDecreasing:events"],
      "interval": "1h"
    }
  }
}
```

Parameters rundown:

- `probe_counter_1` is the probe unique name, and also the data collection in which the measurements are stored
- `type: counter` tells the plugin that this probe is a counter one
- `increasers` lists the events increasing the counter
- `decreasers` lists the events decreasing the counter
- `interval` configures the measurement save interval. The following formats are accepted:
  - `"none"`: no interval, each listened event will create a new measure document
  - `"duration"`: a string in human readable format, using the [ms conversion library](https://www.npmjs.com/package/ms)

### Measure document

Following the previously given example: every 1 hour, a new measure will be written with the counted fired events.

The measure document will look like this:

```json
{
  "count": 1234,
  "timestamp": 123456789
}
```

The `timestamp` field is automatically added, and mark the end of a measurement. It's encoded as the number of milliseconds since Epoch.

### Adding a `counter` probe

Command-line interface example:

```shell
kuzzle plugins --set '{
  "probes": {
    "probe_counter_1": {
      "type": "counter",
      "interval": "1h",
      "increasers": ["list:of", "counterIncreasing:events"],
      "decreasers": ["anotherlist:of", "counterDecreasing:events"]
    }
  }
}' kuzzle-enterprise-probe
```

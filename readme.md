# node-message-bus

[![npm](https://img.shields.io/npm/v/node-message-bus.svg)](https://www.npmjs.com/package/node-message-bus)
[![Dependencies](https://img.shields.io/badge/dependencies-none-brightgreen.svg)](http://npm.anvaka.com/#/view/2d/node-message-bus)
[![npm](https://img.shields.io/npm/dm/node-message-bus.svg)](https://www.npmjs.com/package/node-message-bus)
[![License](https://img.shields.io/github/license/zitros/node-message-bus.svg)](LICENSE)
[![GitHub](https://img.shields.io/github/stars/zitros/node-message-bus.svg?style=social&label=Star)](https://github.com/ZitRos/node-message-bus)

Ready-to-go RabbitMQ support for your NodeJS microservices. A convenient wrapper around [ampqlib](https://www.npmjs.com/package/amqplib)
for RabbitMQ, bringing the most critical features to build with message bus pattern.

## Features

- Built-in, no-external-dependencies support of exponential backoff.
- Built-in tools for testing with dynamic instances provided by [CloudAMQP](https://www.cloudamqp.com/).
- Simple yet flexible interfaces.
- Pluggable logging library.

## Table of Contents

1. [Installation](#installation)
2. [Configuration](#configuration)
3. [Usage](#usage)
   1. [Initialize](#initialize)
   2. [Disconnect](#disconnect)
   3. [Publish messages](#publish-messages)
   4. [Consume messages](#consume-messages)
4. [Features](#features)
   1. [Built-in exponential backoff](built-in-exponential-backoff)
   2. [Spot RabbitMQ instances for testing](#spot-rabbitmq-instances-for-testing)
5. [License](#license)

## Installation

Install this NPM module:

```sh
npm install --save node-message-bus
```

## Configuration

This module can be configured with the following environment variables.

```sh
# REQUIRED. Connection URL. Note that this variable is ignored
# when {NODE_MESSAGE_BUS_TESTING_CLOUDAMQP_API_KEY} is set and {NODE_ENV=test}.
NODE_MESSAGE_BUS_CONNECTION_URL=http://admin:admin@rabbitmq

# Optional. Supply the default exchange name and its type. Name is empty by default.
# The library will ensure the default exchange is present when calling {initMessageBus}.
# When publishing messages, if the exchange name is not specified, it is published to
# the default exchange.
# If you're starting a new infrastructure, prefer specifying the "default" exchange name
# with the "topic" type.
NODE_MESSAGE_BUS_DEFAULT_EXCHANGE_NAME=
NODE_MESSAGE_BUS_DEFAULT_EXCHANGE_TYPE=direct

# Optional. When set to "test", the library switches to a "testing mode" and will try to
# connect to your CloudAMQP account, if {NODE_MESSAGE_BUS_TESTING_CLOUDAMQP_API_KEY} is present.
NODE_ENV=test

# Optional. An API key from https://customer.cloudamqp.com/ for testing, used to spin up dynamic
# RabbitMQ instances. Read below to understand how dynamic instances are created.
NODE_MESSAGE_BUS_TESTING_CLOUDAMQP_API_KEY=faf83b09-352f-add3-c2e3-c83212a32344
NODE_MESSAGE_BUS_TESTING_CLOUDAMQP_INSTANCE_LIFETIME=86400000
```

## Usage

### Initialize

In JavaScript, you have to call `initMessageBus` function to initialize the library with
what this service will listen or push to, before doing anything else. You won't get errors
if you, for instance, publish messages before calling this functions, but publishing will
hang and wait until initMessageBus is called.

```typescript
import { initMessageBus } from 'node-message-bus';

// All configuration items are OPTIONAL. For just publishing messages to the default exchange, use
// await initMessageBus({}).
// If any of these collide with already defined queues, and properties mismatch, {initMessageBus}
// will throw an error. Prefer defining new queues when migrating.
await initMessageBus({
  // Logging function. {logType} is one of these: 'log', 'info', 'warn', 'error'
  logger: (logType, message) => console[logType](message),

  // Exchanges to configure before start.
  exchanges: [
    {
      name: 'default',
      type: 'topic',
    },
  ],

  // Queues to configure before start.
  queues: [
    {
      name: 'test-queue-1',
    },
    {
      name: 'test-queue-with-dead-letter-and-ttl',
      options: {
        deadLetterExchange: '',
        deadLetterRoutingKey: 'something',
        messageTtl: 2000,
      },
    },
    {
      name: 'test-queue-dead-letter-handler',
    },
  ],

  // Bindings to configure before start.
  bindings: [
    {
      toQueue: 'test-queue-1',
      routingKey: 'routing-key',
    },
    {
      toQueue: 'test-queue-dead-letter-handler',
      routingKey: 'something',
    },
  ],
});
```

If you need to define any queues in runtime (which should only be used for testing), use `configureMessageBus`,
which has the same API as `initMessageBus`. Note that there's no way to delete/reset created queues, which is by design.

```typescript
import { configureMessageBus } from 'node-message-bus';

await configureMessageBus({
  /* Same arguments as in {initMessageBus}. */
});
```

### Disconnect

To properly disconnect from a message bus ensuring all messages are ack'ed, use this function.
We demonstrate the usage of this function along with [node-graceful-shutdown](https://www.npmjs.com/package/node-graceful-shutdown)
NPM module.

```javascript
import { onShutdown } from 'node-graceful-shutdown';
import { closeMessageBus } from 'node-message-bus';

// {closeMessageBus} is an async function that will be invoked by node-graceful-shutdown.
onShutdown(closeMessageBus);
```

### Publish messages

Don't forget to call `initMessageBus` for microservices which publishing only.

```typescript
import { publishMessage } from 'node-message-bus';

await publishMessage({
  key: 'key-1',
  data: {
    info: 'This will be serialized to JSON,',
    or: "you can pass a primitive value to 'data'.",
  },
});
```

### Consume messages

Consumers are defined once, globally, per-microservice. There's no such thing as a "temporary" consumer.

```typescript
import { consumeMessages } from 'node-message-bus';

await consumeMessages({
  queueName: 'test-queue-1',
  handler: async (data) => {
    // From the previous example, data is an object { info: "...", or: "..." }.
    // Any errors thrown in this code will be logged
  },
});
```

## Features

### Built-in exponential backoff

`node-message-bus` features exponential backoff when consuming messages out of the box, with no dependencies.

When consuming a message errors (or you `nack` it yourself), the message which caused an error will be `ack`nowledged
but sent back to the **automatic exponential backoff queue**. This queue will be created automatically on failures.
If creating a backoff queue or sending a message to it fails too, the message will be `nack`'ed and hence consuming
this message will be retried.

Assuming there's a queue `queue-name`, with incoming message `routing-key`, automatic exponential backoff queues use
the following naming pattern:

- `queue-name` (original queue)
- `queue-name.backoff-1s+routing-key` (delayed by 1 seconds)
- `queue-name.backoff-4s+routing-key` (delayed by 4 seconds)
- `queue-name.backoff-16s+routing-key` (delayed by 16 seconds)
- `queue-name.backoff-64s+routing-key` (delayed by 64 seconds)
- `queue-name.backoff-256s+routing-key` (delayed by 256 seconds)
- `queue-name.backoff-1024s+routing-key` (delayed by 1024 seconds)

These queues have TTL and push the message back to the exchange with the same routing key and properties they had
before. These queues are not auto-deleted.

### Spot RabbitMQ instances for testing

If you set the following environment variables,

```shell
NODE_ENV=test
NODE_MESSAGE_BUS_TESTING_CLOUDAMQP_API_KEY=<your_api_key>
```

`node-message-bus` will switch to a testing mode and will be using [cloudamqp.com](https://cloudamqp.com) to
create hot RabbitMQ instances on `initMessageBus`, under the hood. Thus, tests you run will be connected to
a clean RabbitMQ instance.

`node-message-bus` create a [free plan](https://www.cloudamqp.com/plans.html) instances, which should be enough for various testing purposes:

<img width="806" alt="image" src="https://user-images.githubusercontent.com/4989256/161066219-def235f4-2434-4400-abcf-91bbe9a48493.png">

Specifically, when in testing mode, `initMessageBus` will perform the following sequence of actions:

1. Connect to [cloudamqp.com](https://cloudamqp.com) using the provided API key.
2. Delete all instances with names `node-message-bus-delete-after-*`, where `*` is past the current date (as deleting instances in step `5.` can fail).
3. Create a new instance named `node-message-bus-delete-after-*`, where `*` is the current date plus 1 hour (controlled by `NODE_MESSAGE_BUS_TESTING_CLOUDAMQP_INSTANCE_LIFETIME`).
4. Run a test connecting to this instance.
5. Delete the created instance during this run `node-message-bus-delete-after-*`.

In case [cloudamqp.com](https://cloudamqp.com) is down, tests will fail. But you see yourself that this is
a highly available service [here](https://status.cloudamqp.com/).

## License

[MIT](license) © [Nikita Savchenko](https://nikita.tk)
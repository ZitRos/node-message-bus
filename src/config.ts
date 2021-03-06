import { ChannelWrapper } from 'amqp-connection-manager';
import { ConfirmChannel } from 'amqplib';
import { MessageBusConfig } from 'Types';
import { error, log, setLoggerFunction } from 'Utils';
import { DEFAULT_CONFIG, DEFAULT_EXCHANGE_NAME } from './Const';

// Config that was applied through the lifetime of the message bus.
const appliedConfig: Required<Omit<MessageBusConfig, 'logger'>> = {
  exchanges: [],
  queues: [],
  bindings: [],
};

/**
 * Returns all applied message bus data through the lifetime of this application.
 */
export const getMessageBusConfig = () => appliedConfig;

export const configureMessageBusStatic = async (config: MessageBusConfig) => {
  if (typeof config.logger === 'function') {
    setLoggerFunction(config.logger);
  }
};

export const configureMessageBus = async (
  config: MessageBusConfig,
  channel?: ChannelWrapper | ConfirmChannel
) => {
  configureMessageBusStatic(config);

  if (!channel) {
    // To avoid creating circular dependency.
    channel = await (await import('./channel')).getChannel();
  }

  for (const exchange of (config.exchanges || []).concat(
    DEFAULT_CONFIG.exchanges || []
  )) {
    try {
      log(`Asserting exchange "${exchange.name}" of type "${exchange.type}".`);
      await channel.assertExchange(
        exchange.name,
        exchange.type,
        exchange.options
      );
      appliedConfig.exchanges.push(exchange);
    } catch (e) {
      const message = `Failed to assert exchange "${exchange.name}" of type "${
        exchange.type
      }" with options ${JSON.stringify(exchange.options)}: ${e}`;
      error(message);
      throw new Error(message);
    }
  }
  for (const queue of (config.queues || []).concat(
    DEFAULT_CONFIG.queues || []
  )) {
    try {
      log(`Asserting queue "${queue.name}".`);
      await channel.assertQueue(queue.name, queue.options);
      appliedConfig.queues.push(queue);
    } catch (e) {
      const message = `Failed to assert queue "${
        queue.name
      }" with options ${JSON.stringify(queue.options)}: ${e}`;
      error(message);
      throw new Error(message);
    }
  }
  for (const binding of (config.bindings || []).concat(
    DEFAULT_CONFIG.bindings || []
  )) {
    const fromExchange = binding.fromExchange || DEFAULT_EXCHANGE_NAME;
    try {
      log(
        `Asserting the queue binding "${fromExchange}" -> "${binding.toQueue}" by key "${binding.routingKey}".`
      );
      await channel.bindQueue(
        binding.toQueue,
        fromExchange,
        binding.routingKey
      );
      appliedConfig.bindings.push(binding);
    } catch (e) {
      const message = `Failed to bind queue "${binding.toQueue}" to exchange "${fromExchange}" via the routing key "${binding.routingKey}": ${e}`;
      error(message);
      throw new Error(message);
    }
  }
};

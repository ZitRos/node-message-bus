import { Options } from 'amqplib';
import { IMessage } from 'Types';
import { error, log } from 'Utils';
import { getChannel } from './channel';
import { DEFAULT_CONFIG, DEFAULT_EXCHANGE_NAME } from './Const';

interface Message extends IMessage {
  exchangeName?: string;
  options?: Options.Publish;
}

interface DirectMessage extends Omit<IMessage, 'routingKey'> {
  queueName: string;
  data: any;
  options?: Options.Publish;
}

const LAST_PUBLISHED_MESSAGES_BUFFER_SIZE = 50;

let lastPublishedMessages: any[] = [];
const pushToLastMessages = (m: any) => {
  if (process.env.NODE_ENV !== 'test') {
    return;
  }
  lastPublishedMessages.push(m);
  if (lastPublishedMessages.length > LAST_PUBLISHED_MESSAGES_BUFFER_SIZE) {
    lastPublishedMessages.splice(0, 1);
  }
};

export const publishMessage = async <
  DataType extends { data: any; routingKey: string } = Message
>(
  message: Message & DataType
) => {
  const channel = await getChannel();
  const exchangeName =
    message.exchangeName ||
    DEFAULT_CONFIG.exchanges?.[0].name ||
    DEFAULT_EXCHANGE_NAME;

  try {
    log(`Publishing message with routingKey=${message.routingKey}`);
    await channel.publish(
      exchangeName,
      message.routingKey,
      message.data, // channel.publish stringifies JSON by default.
      message.options
    );
    pushToLastMessages(message);
  } catch (e) {
    error(
      `Unable to publish data ${message.data} to exchange "${exchangeName}" with routing routingKey "${message.routingKey}": ${e}`
    );
    throw new Error(
      `Message bus encountered an error when publishing to exchange "${exchangeName}" with routingKey "${message.routingKey}".`
    );
  }
};

/** Use for tests only */
export const getLastPublishedMessages = () => lastPublishedMessages.slice();
/** Use for tests only */
export const resetLastPublishedMessages = () => (lastPublishedMessages = []);

export const publishMessageToQueue = async ({
  data,
  queueName,
  options,
}: DirectMessage) => {
  const channel = await getChannel();

  try {
    log(`Publishing message to queue=${queueName}`);
    await channel.sendToQueue(queueName, data, options);
  } catch (e) {
    error(
      `Unable to publish data ${data} to queue "${queueName}" with options "${JSON.stringify(
        options || {}
      )}": ${e}`
    );
    throw new Error(
      `Message bus encountered an error when publishing a message to queue "${queueName}".`
    );
  }
};

import Bluebird from 'bluebird';
import map from 'lodash/map';
import Module from '@lskjs/module';
import get from 'lodash/get';
import pick from 'lodash/pick';
import prettyStringify from '@lskjs/utils/prettyStringify';
import Err from '@lskjs/utils/Err';
import { Stats } from '@lskjs/utils/Stats';

const toQs = (params = {}) => map(params, (val, key) => [key, val].join('=')).join('&');

export class RabbitWorker extends Module {
  async init() {
    await super.init();
    this.stats = new Stats();
    if (!this.app.getErrorInfo) throw '!this.app.getErrorInfo';
    // this.queues = get(this, 'app.config.rabbit.queues');
    // this.exchanges = get(this, 'app.config.rabbit.exchanges');
    this.rabbit = await this.app.module('rabbit');
  }
  async parse() {
    throw 'not implemented worker.parse()';
  }
  async onTelegramError({ err, job }) {
    const { params } = job || {};
    const str = [
      Err.getCode(err),
      Err.getMessage(err),
      '\n',
      prettyStringify(params),
      '\n',
      `/api/${this.worker || this.name}?${toQs(params)}`,
    ]
      .filter(Boolean)
      .join('\n');
    // console.log(66666);
    // const str = `\n${err.code}\n${err.message || ''}\n\n${JSON.stringify(params)}\n\n/api/${this.name}?${toQs(params)}`;
    this.app.rlog.error(str, {
      prefix: `worker/${process.env.SERVICE || this.name}`,
    });
  }
  async onConsumeError({ err, job }) {
    const errInfo = this.app.getErrorInfo(Err.getCode(err));
    const nack = get(errInfo, 'nack', true);
    const telegram = get(errInfo, 'telegram', true) && !__DEV__;
    const log = get(errInfo, 'log', 'error');

    if (err && err.code === 'RABBIT_TIMEOUT') {
      await job.nackSuccess(); // TODO: я не правильно юзаю эту хрень
      const { rabbitTimeout = 10000 } = this.config.rabbitTimeout;
      this.log.trace('RABBIT_TIMEOUT [delay]', rabbitTimeout);
      await Bluebird.delay(rabbitTimeout);
      return;
    }
    if (log && this.log[log]) {
      this.log[log](Err.getCode(err), Err.getText(err));
    }
    if (telegram) {
      this.onTelegramError({ err, job });
    }
    const apm = await this.app.module('apm');
    try {
      apm.captureError(err);
    } catch (apmErr) {
      this.log.error('apm.captureError', apmErr);
    }

    if (!nack) {
      if (this.debug) console.error('err4', err); // eslint-disable-line no-console
      await job.ackError(err);
      return;
    }
    if (job.isTooMuchRedelivered({ err })) {
      const routingKey = get(job, 'msg.fields.routingKey');
      const queue = `${routingKey}_redelivered`;
      try {
        await this.rabbit.assertQueueOnce(queue);
        // this.rabbit.consume(this.queue, this.onConsume.bind(this), { noAck: false });
        this.log.error('manual redeliver', `${routingKey} => ${queue}`);
        const { meta = {} } = job.params;
        await this.rabbit.sendToQueue(queue, {
          ...job.params,
          meta: {
            ...meta,
            __err: {
              code: Err.getCode(err),
              message: Err.getMessage(err),
            },
          },
        });
        if (this.debug) console.error('err1', err); // eslint-disable-line no-console
        await job.ackError(err);
      } catch (err2) {
        this.log.error('cant re-redeliver', err2, __DEV__ ? err2.stack : '');
        await job.nackError(err);
      }
      return;
    }
    if (this.debug) console.error('err3', err); // eslint-disable-line no-console
    await job.nackError(err);
  }
  async process(params) {
    const { Job } = this;
    const job = new Job({ params, worker: this, app: this.app, rabbit: this.rabbit, config: this.config });
    return job.run();
  }
  async onConsume(msg) {
    this.stats.print({
      log: this.log.info.bind(this.log),
      successKey: 'event.success',
      unsuccessKey: 'event.error',
    });
    if (msg === null) return;
    let params;
    try {
      params = JSON.parse(msg.content.toString());
    } catch (err) {
      const str = msg.content.toString();
      if (__DEV__) {
        this.log.error('[ignore] cant parse json', str);
      } else {
        this.log.error('[ignore] cant parse json ');
        this.onTelegramError({ err: 'cant parse json', job: { params: str } });
      }
      await this.rabbit.nack(msg, { requeue: false });
      return;
    }
    const { Job } = this;
    const job = new Job({ msg, params, worker: this, app: this.app, rabbit: this.rabbit, config: this.config });
    try {
      await job.run();
      if (!job.status) {
        await job.ackSuccess();
      }
    } catch (error) {
      if (this.debug) this.log.error('-----------\n', error, '\n-----------'); // eslint-disable-line no-console
      if (this.debug) this.log.error('-----------\n', error.stack, '\n-----------'); // eslint-disable-line no-console
      try {
        const errorParams = pick(error, 'nack', 'es', 'telegram', 'log');
        const err = new Err(error, errorParams);
        const { delay = __DEV__ ? 10000 : 0 } = this.rabbit.config.options;
        if (delay) {
          this.log.warn('[delay] 10000');
          await Bluebird.delay(10000);
        }
        await this.onConsumeError({ err, job });
      } catch (err2) {
        this.log.error('error while onError', err2);
      }
    }
  }
  async run() {
    await super.run();
    if (!this.rabbit) throw '!rabbit';
    const queue = process.env.AMQP_QUEUE || this.queue;
    if (!queue) {
      this.log.warn('!queue');
      return;
    }
    if (!this.Job) {
      this.log.warn('!Job', this.Job);
      return;
    }
    const { queue: queueName } = await this.rabbit.queue(queue);
    const options = { noAck: false };
    this.log.info(`[${queueName}]`, { ...options, prefetch: get(this, 'rabbit.config.options.prefetch') });
    this.rabbit.consume(queueName, this.onConsume.bind(this), options);
  }
  async stop() {
    return this.rabbit.stop();
  }
}

export default RabbitWorker;
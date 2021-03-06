import Module from '@lskjs/module/2';
import importFn from '@lskjs/utils/importFn';
import asyncMapValues from '@lskjs/utils/asyncMapValues';
import assignProps from '@lskjs/utils/assignProps';
import Err from '@lskjs/utils/Err';
import availableProviders from './providers';

export default class BillingServerModule extends Module {
  name = 'BillingServerModule';
  availableProviders = availableProviders;
  providers = {};
  constructor(...props) {
    super(...props);
    assignProps(this, ...props);
  }
  async getProviders() {
    return {
      ...availableProviders,
      ...(this.availableProviders || {}),
    };
  }
  getModels() {
    return require('./models').default;
  }
  provider(name) {
    if (!this.providers[name]) throw new Err('!provider', { data: { name } });
    return this.providers[name];
  }
  async init() {
    await super.init();
    if (!this.config) {
      if (this.app.config.billing) {
        this.config = this.app.config.billing;
      } else {
        this.log.warn('!config');
        return;
      }
    }
    this.log.debug('availableProviders', Object.keys(this.availableProviders));
    const { providers: providersConfigs } = this.config;
    const availableProviders = await this.getProviders(); // eslint-disable-line no-shadow

    this.providers = await asyncMapValues(providersConfigs, async (config, name) => {
      const { provider: providerName } = config;
      if (!providerName) {
        this.log.warn(`Empty provider for '${name}'`);
        return null;
      }
      if (!availableProviders[providerName]) {
        this.log.warn(`Can't find provider '${providerName}' for '${name}'`);
        return null;
      }
      const Provider = await importFn(availableProviders[providerName]);
      const provider = new Provider({ app: this.app, module: this, config, name });
      await provider.init();
      return provider;
    });
    this.log.debug('providers', Object.keys(this.providers));
  }

  async run() {
    await super.run();
    if (!this.config) return;
    await asyncMapValues(this.providers, (provider) => provider && provider.run());
  }
}

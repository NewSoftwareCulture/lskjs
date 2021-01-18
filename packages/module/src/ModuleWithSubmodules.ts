/* eslint-disable @typescript-eslint/interface-name-prefix */
import arrayToObject from '@lskjs/utils/arrayToObject';
import get from 'lodash/get';
import omit from 'lodash/omit';
import mapValues from 'lodash/mapValues';
import asyncMapValues from '@lskjs/utils/asyncMapValues';
import Err from '@lskjs/utils/Err';
// import { setProps } from './utils/setProps';
import { ModuleWithEE } from './ModuleWithEE';
import { createAsyncModule } from './utils/createAsyncModule';
import { IModule, IModuleWithSubmodules, IModuleKeyValue, IAsyncModuleKeyValue } from './types';

const filterWildcard = (array: string[], pattern: string): string[] =>
  array.filter((name) => name.startsWith(pattern.substr(0, pattern.length - 1)));

export abstract class ModuleWithSubmodules extends ModuleWithEE implements IModuleWithSubmodules {
  __availableModules: IAsyncModuleKeyValue = {};
  __initedModules: IModuleKeyValue = {};
  async __getModules(): Promise<IAsyncModuleKeyValue> {
    const modules = await this.getModules();
    return {
      ...modules,
      ...(this.modules || {}),
    };
  }

  __parent?: IModule;
  modules?: IAsyncModuleKeyValue;

  getModules(): IAsyncModuleKeyValue {
    return {};
  }

  // app.webserver.i18
  // app.webserver.i18:I18Module

  async getModuleConfig(name: string): Promise<object> {
    const config = get(this.config, name, {});
    // const name = this.debug
    const ns = [this.log.ns, name].filter(Boolean).join('.');
    // const ns = [this.log.ns, name].filter(Boolean).join('.');
    return {
      debug: this.config.debug,
      ...config,
      log: {
        ...omit(this.config.log || {}, ['name']),
        ns,
        ...(config.log || {}),
      },
    };
  }

  async getModuleProps(name: string): Promise<object> {
    return {
      // app: this.app || this,
      __parent: this,
      config: await this.getModuleConfig(name),
    };
  }

  hasModule(nameOrNames: string | string[]): boolean | { [name: string]: boolean } {
    console.log('@@@ hasModule', this.name, nameOrNames, JSON.stringify(this.__lifecycle))
    if (typeof nameOrNames === 'string' && nameOrNames.endsWith('*')) {
      // eslint-disable-next-line no-param-reassign
      nameOrNames = filterWildcard(Object.keys(this.__availableModules), nameOrNames);
    }
    if (Array.isArray(nameOrNames)) {
      return mapValues(arrayToObject(nameOrNames), (n: string) => this.hasModule(n) as boolean);
    }
    const name = nameOrNames;
    console.log({ name }, this.__availableModules[name], Boolean(this.__availableModules[name]), Object.keys(this.__availableModules).includes(name));
    return Boolean(this.__availableModules[name]);
  }

  __availableModules: IAsyncModuleKeyValue = {};

  async module(nameOrNames: string | string[], { run: isRun = true } = {}): Promise<IModule | IModuleKeyValue> {
    if (!this.__lifecycle.initStart)
      throw new Err('MODULE_INVALID_WORKFLOW_INIT', 'please init module first before .module()');
    if (typeof nameOrNames === 'string' && nameOrNames.endsWith('*')) {
      const names = filterWildcard(Object.keys(this.__availableModules), nameOrNames);
      this.log.trace(`module(${nameOrNames})`, names);
      // eslint-disable-next-line no-param-reassign
      nameOrNames = names;
    }
    if (Array.isArray(nameOrNames)) {
      return asyncMapValues(arrayToObject(nameOrNames), (n: string) => this.module(n) as Promise<IModule>);
    }
    const name = nameOrNames;
    if (this.debug) this.log.trace(`module(${name})`, isRun ? 'run' : undefined);
    if (this.__initedModules[name]) return this.__initedModules[name];
    const availableModule = this.__availableModules && this.__availableModules[name];
    if (!availableModule)
      throw new Err('MODULE_INJECTING_NOT_FOUND', `Module "${name}" not found in module ${this.name}`, {
        data: { name },
      });
    try {
      const moduleProps = await this.getModuleProps(name);
      const instance = await createAsyncModule(availableModule, moduleProps);
      this.__initedModules[name] = instance;
      if (isRun) await instance.__run();
      return instance;
    } catch (err) {
      this.log.fatal(`module(${name})`, err);
      throw new Err('MODULE_INJECTING_ERROR', { data: { name } }, err);
    }
  }

  async init(): Promise<void> {
    await super.init();
    await this.__initModules();
  }

  private async __initModules(): Promise<void> {
    this.__availableModules = await this.__getModules();
    if (this.debug && this.log && Object.keys(this.__availableModules).length) {
      this.log.debug('modules', Object.keys(this.__availableModules));
    }
  }

  private async __runModules(): Promise<void> {
    await asyncMapValues(this.__initedModules, (m: IModule) => {
      const isNeedRun =
        this.__lifecycle.initFinish &&
        (!this.__lifecycle.runStart || (this.__lifecycle.runStart && this.__lifecycle.stopFinish));
      if (!isNeedRun) return;
      return m.__run();
    });
  }

  async run(): Promise<void> {
    await super.run();
    await this.__runModules();
  }
}

export default ModuleWithSubmodules;

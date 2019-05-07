/* eslint-disable global-require */
import express from 'express';
import path from 'path';
import mapValues from 'lodash/mapValues';
import forEach from 'lodash/forEach';
import flattenDeep from 'lodash/flattenDeep';
import map from 'lodash/map';
import staticFileMiddleware from 'connect-static-file';
import Api from '@lskjs/apiquery';
import autobind from '@lskjs/autobind';
import I18 from '@lskjs/i18';
import db from '@lskjs/db/server';
import Module from '@lskjs/module';
import { Server as httpServer } from 'http';

import AsyncRouter from './AsyncRouter';
import createWs from './ws';


export default class ServerApp extends Module {
  name = 'App';
  asyncRouter = AsyncRouter;
  Api = Api;
  i18 = new I18({ ctx: this });
  async init() {
    super.init();
    this.log.trace('ServerApp init');
    this.express = this.createExpress();
    this.app = this.express; // Fallback
    this.httpServer = httpServer(this.express);
    if (this.config.express) {
      this.log.trace('express config:', this.config.express);
      forEach((this.config.express || {}), (value, key) => {
        this.express.set(key, value);
      });
    }
    this.db = await this.getDatabase();
    this.requests = this.getRequests();
    this.log.debug('requests', Object.keys(this.requests));
    this.responses = this.getResponses();
    this.log.debug('responses', Object.keys(this.responses));
    this.errors = this.getErrors();
    this.log.debug('errors', Object.keys(this.errors));
    this.middlewares = this.getMiddlewares();
    this.log.debug('middlewares', Object.keys(this.middlewares));

    this.helpers = this.getHelpers();
    this.log.debug('helpers', Object.keys(this.helpers));
    this.statics = this._getStatics();
    this.log.debug('statics', this.statics);
    this.api = new this.Api({
      url: `http://127.0.0.1:${this.config.port}`,
      log: this.log,
    });
    if (this.config.ws) this.initWs();
    if (this.i18) {
      await this.i18.setState({
        log: this.log,
        config: this.config.i18,
        getLocale: this.getLocale,
      }).init();
    }
  }
  async afterInit() {
    // super.afterInit(...arguments);
    this.models = this.getMongooseModels();
    this.log.debug('models', Object.keys(this.models));
    this.resourses = this.getResourses();
    this.log.debug('resourses', Object.keys(this.resourses));
    await this.runModels();
  }


  @autobind
  url(str, params = null) {
    let query = '';
    if (params && Object.keys(params.length)) {
      query = `?${map(params, (val, key) => `${key}=${val}`).join('&')}`;
    }
    return `${this.config.url}${str}${query}`;
  }

  e(code, params) {
    const t = this.i18 ? this.i18.t : (a => a);
    return {
      code,
      message: t(`errors.${code}`, params),
      status: 500,
      ...params,
    };
  }

  // emit(...args) {
  //   this.modules && this.modules.events && this.modules.events.emit(...args); // eslint-disable-line
  // }
  // on(...args) {
  //   this.modules && this.modules.events && this.modules.events.on(...args); // eslint-disable-line
  // }
  // once(...args) {
  //   this.modules && this.modules.events && this.modules.events.once(...args); // eslint-disable-line
  // }

  getMiddlewares() {
    return require('./middlewares').default(this); // eslint-disable-line
  }
  getMongooseModels() {
    const models = this.getModels();


    forEach(this.modules, (mdl, moduleName) => {
      let models2 = {};
      if (mdl.getModels) {
        models2 = mdl.getModels();
      } else if (mdl.models) {
        models2 = mdl.models;
      }
      // console.log('models2', Object.keys(models2));
      forEach(models2, (model, modelName) => {
        if (models[modelName]) {
          this.log.error(`ServerApp.getMongooseModels: CONFLICT modules/${moduleName}/${modelName}`); // eslint-disable-line no-console
          return;
        }
        models[modelName] = models2[modelName];
      });
    });
    return mapValues(models, (model) => {
      if (model._universal) {
        return model.getMongooseModel(this.db);
      }
      return model;
    });
  }
  getModels() {
    return require('./models').default(this);
  }
  getDatabase() {
    return this.config.db ? db(this, this.config.db) : null;
  }
  getErrors() {
    return require('./getErrors').default(this);
  }
  getResourses() {
    return require('./resourses').default(this);
  }
  getRequests() {
    return require('./requests').default(this);
  }
  getResponses() {
    return require('./responses').default(this);
  }
  getHelpers() {
    return require('./helpers').default(this);
  }
  getStatics() {
    const buildRoot = `${__dirname}/public`;
    const root = __DEV__ ? `${__dirname}/../public` : buildRoot;
    return {
      '/': root,
      // '/favicon.ico': buildRoot + require('file-loader!../public/favicon.ico'),
    };
  }
  _getStatics() {
    return mapValues(this.getStatics() || {}, p => path.resolve(p));
  }

  runStatics() {
    forEach(this.statics, (_path, url) => {
      this.app.use(url, express.static(_path));
      this.app.use(url, staticFileMiddleware(_path));
    });
  }

  useStaticPublic(publicPath, urlPath = null) {
    this.log.trace('DEPRECATED');
  }

  getUsingMiddlewares() {
    return [
      this.middlewares.extendReqRes,
      this.middlewares.reqLog,
      this.middlewares.accessLogger,
      this.middlewares.reqParser,
      this.middlewares.reqData,
      this.middlewares.parseToken,
      this.middlewares.parseUser,
      this.middlewares.i18,
    ];
  }

  acl() {
    return (req, res, next) => {
      next();
    };
  }

  initWs() {
    this.ws = createWs(this);
    this.ws.wrapExpress(this.app);
  }
  async runWs() {
    if (!this.config.ws) return;
    this.log.trace('ServerApp.runWs');
    this.ws.serveClient(false);
    this.ws.attach(this.httpServer);
    const transports = this.config.ws.transports || ['websocket'];
    this.ws.set('transports', transports);
  }

  runMiddlewares() {
    this.log.trace('ServerApp.runMiddlewares');
    const middlewares = flattenDeep(this.getUsingMiddlewares());
    middlewares.forEach((middleware) => {
      if (middleware && typeof middleware === 'function') this.app.use(middleware);
    });
  }
  runDefaultRoute() {
    this.log.trace('ServerApp.runDefaultRoute');
    this.app.use((req, res, next) => {
      const err = this.errors.e404('Route not found');
      next(err);
    });
  }

  runCatchErrors() {
    if (this.middlewares.catchError) this.app.use(this.middlewares.catchError);
  }

  runModels() {
    const promises = map(this.models, async (model, name) => {
      if (model.run) {
        this.models[name] = await model.run(this);
      }
    });
    return Promise.all(promises);
  }


  getDocsRouter = require('./methods/getDocsRouter').default;
  getDocsTemplate = require('./methods/getDocsTemplate').default;

  resolve = require('./methods/resolve').default;
  runRedis = require('./methods/runRedis').default;

  _getRoutes(...args) {
    return require('./methods/_getRoutes').default(...args);
  }
  runRoutes(...args) {
    return require('./methods/runRoutes').default(...args);
  }
  // getI18 = require('../Uapp/i18/getI18').default;
  // getI18Params = require('../Uapp/i18/getI18Params').default;
  // getLocale = require('../Uapp/i18/getLocale').default;
  // initI18 = require('../Uapp/i18/initI18').default;


  async run(...args) {
    await super.run(...args);
    this.log.trace('ServerApp.run');
    if (this.db) await this.db.run();
    if (this.config.ws) await this.runWs();
    if (this.config.redis) await this.runRedis();
    this.runStatics();
    this.runMiddlewares();
  }

  createExpress() {
    return express();
  }

  async afterRun() {
    this.log.trace('ServerApp afterRun');
    this.runRoutes();
    this.runDefaultRoute();
    this.runCatchErrors();
    return new Promise((resolve) => {
      this.httpInstance = this.httpServer.listen(this.config.port, () => {
        this.log.trace(`App running on port ${this.config.port}!`);
        resolve(this);
      });
    });
  }
  async stop() {
    await super.stop();
    if (this.db) await this.db.stop();
    await new Promise((resolved) => {
      if (this.httpInstance) {
        this.httpInstance.close(resolved);
      } else {
        resolved();
      }
    });
  }

  async started() {
    console.log(`🎃  The server is running at http://127.0.0.1:${this.config.port}/ [${global.timing()}ms]`);
  }
}
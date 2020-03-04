import Promise from 'bluebird';
import Api from '@lskjs/server-api';

export default class PermitApi extends Api {
  getRoutes() {
    return {
      '/list': ::this.find,
      '/find': ::this.find,
      '/count': ::this.count,
      '/get': ::this.findOne,
      '/findOne': ::this.findOne,
    };
  }
  isAuth(req) {
    return true;
  }
  async count(req) {
    await this.isAuth(req);
    const { PermitModel } = this.app.models;
    return this.cache(['permit/count', req.data], () => PermitModel.countByParams(req.data));
  }
  async find(req) {
    await this.isAuth(req);
    const { PermitModel } = this.app.models;
    const params = await this.getListParams(req);
    return this.cache(['permit/find', params], async () => {
      let items = await PermitModel.findByParams(params);
      items = await PermitModel.prepare(items, { req, ...params });
      return Promise.props({
        data: items,
        count: PermitModel.countDocuments(params.filter),
        __pack: 1,
      });
    });
  }
  async findOne(req) {
    await this.isAuth(req);
    const { PermitModel } = this.app.models;
    return this.cache(['permit/findOne', req.data], async () => {
      const { _id } = req.data;
      if (!_id) throw this.e(404, '!_id');
      const item = await PermitModel.findById(_id);
      if (!item) throw this.e(404, '!item');
      return PermitModel.prepare(item, { req, method: 'findOne' });
    });
  }
}
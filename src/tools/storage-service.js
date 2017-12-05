export default class StorageService {
  constructor() {}

  createId(prefix, key) {
    return `${prefix}.${key}`;
  }

  setData(prefix, key, data) {
    localStorage.setItem(this.createId(prefix, key), JSON.stringify(data));
  }

  getData(prefix, key) {
    return JSON.parse(localStorage.getItem(this.createId(prefix, key)));
  }

  hasData(prefix, key) {
    return localStorage.getItem(this.createId(prefix, key));
  }

  deleteData(prefix, key) {
    return localStorage.removeItem(this.createId(prefix, key));
  }

}

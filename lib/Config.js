class Config {
    constructor() {
        this._config = null;
    }
    static get instance() {
        if (!Config.singleton) Config.singleton = new Config();
        return Config.singleton;
    }

    getConfig() {
        if (this._config) return this._config;
        this._config = JSON.parse(require("fs").readFileSync(global.confPath))
        return this._config;
    }
    reloadConfig() {
        this._config = JSON.parse(require("fs").readFileSync(global.confPath))
        return this._config;
    }
}

module.exports = Config.instance;
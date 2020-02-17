class Debug {
    constructor() {
        this.active = process.env.DEBUG;
    }
    static get instance() {
        if (!Debug.singleton) Debug.singleton = new Debug();
        return Debug.singleton;
    }

    start(txt) {
        return {t0:Date.now(), txt:txt}
    }
    end(op) {
        this.log(op.txt + " => " + (Date.now() - op.t0 + "[ms]"));
    }
    log(txt) {
        if (!this.active) return;
        console.log(txt);
    }
}

module.exports = Debug.instance;
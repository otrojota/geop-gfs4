global.confPath = __dirname + "/config.json";

let downloader = false;
let debug = false;
let test = false;
let reindexar = false;

for (let i=2; i<process.argv.length; i++) {
    let arg = process.argv[i].toLowerCase();
    if (arg == "-d" || arg == "-download" || arg == "-downloader") downloader = true;
    if (arg == "-dbg" || arg == "-debug") debug = true;
    if (arg == "-reindexar") reindexar = true;
}
if (!downloader && process.env.DOWNLOADER) {
    downloader = true;
}
if (process.env.REINDEXAR) {
    reindexar = true;
}
if (debug) {
    process.env.DEBUG = true;
}

if (test) {
    const config = require("./lib/Config").getConfig();
    let testFile = config.dataPath + "/downloads/test.grb2";
    console.log("Iniciando importación de prueba de " + testFile);
    const DescargaPronostico = require("./lib/DescargaPronostico");
    const EjecucionModelo = require("./lib/EjecucionModelo");
    const descargador = new DescargaPronostico(new EjecucionModelo(), 0);
    descargador.importa(testFile)
        .then(_ => console.log("Importación Finalizada"))
        .catch(error => console.error(error));
    return;
}

if (reindexar) {
    const config = require("./lib/Config").getConfig();
    const DescargaPronostico = require("./lib/DescargaPronostico");
    const EjecucionModelo = require("./lib/EjecucionModelo");
    const descargador = new DescargaPronostico(new EjecucionModelo(), 0);
    console.log("Iniciando Reindexación completa");
    descargador.fullReindexar()
        .then(_ => console.log("Reindexación finalizada"))
        .catch(error => console.error(error));
    return;
}

const ProveedorCapasGFS4 = require("./lib/ProveedorCapasGFS4");

if (downloader) {
    console.log("[GFS4] Iniciando en modo Downloader");
    require("./lib/Downloader").init();
} else {
    const config = require("./lib/Config").getConfig();
    const proveedorCapas = new ProveedorCapasGFS4({
        puertoHTTP:config.webServer.http.port,
        directorioWeb:__dirname + "/www",
        directorioPublicacion:config.publishPath
    });
    proveedorCapas.start();
}


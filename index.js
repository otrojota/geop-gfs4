global.confPath = __dirname + "/config.json";
const ProveedorCapasGFS4 = require("./lib/ProveedorCapasGFS4");

let downloader = false;
for (let i=2; i<process.argv.length; i++) {
    let arg = process.argv[i].toLowerCase();
    if (arg == "-d" || arg == "-download" || arg == "-downloader") downloader = true;
}
if (!downloader && process.env.DOWNLOADER) {
    downloader = true;
}

if (downloader) {
    console.log("[GFS4] Iniciando en modo Downloader");
    require("./lib/Downloader").init();
} else {
    const config = require("./lib/Config").getConfig();
    const proveedorCapas = new ProveedorCapasGFS4({
        puertoHTTP:8081,
        directorioWeb:__dirname + "/www",
        directorioPublicacion:config.publishPath
    });
    proveedorCapas.start();
}


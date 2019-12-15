const EjecucionModelo = require("./EjecucionModelo");
const fs = require('fs');
const moment = require("moment-timezone");
const config = require("./Config").getConfig();

class Downloader {
    constructor() {
        this.pathEstado = require("./Config").getConfig().dataPath + "/estado.json";
    }
    static get instance() {
        if (!Downloader.singleton) Downloader.singleton = new Downloader();
        return Downloader.singleton;
    }

    getEstado() {
        return new Promise((resolve, reject) => {
            fs.readFile(this.pathEstado, (err, data) => {
                if (err) {
                    if (err.code == "ENOENT") resolve(null);
                    else reject(err);
                } else resolve(JSON.parse(data));
            })
        });
    }
    setEstado(estado) {
        return new Promise((resolve, reject) => {
            fs.writeFile(this.pathEstado, JSON.stringify(estado), err => {
                if (err) reject(err);
                resolve();
            })
        })
    }

    init() {
        this.callBuscador(1000);
    }
    callBuscador(ms) {
        if (!ms) ms = 60000;
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(_ => {
            this.timer = null;
            this.buscaNuevaEjecucionModelo()
        }, ms);
    }

    async buscaNuevaEjecucionModelo() {
        /*
        if (1 == 1) {
            this.test();
            return;
        }
        */
        let ejecucion = new EjecucionModelo();
        let publicado = false;
        let n = 0;
        do {
            n++;
            try {
                publicado = await ejecucion.estaPublicado();
                if (!publicado) ejecucion.dec();                
            } catch(error) {
                console.error(error);
                return;
            }
        } while(!publicado && n < 50);
        if (n >= 50) {
            console.log("No hay modelos para descargar");
            this.callBuscador();
            return;
        }
        console.log(new Date().toLocaleString() + ": Buscando nuevas publicaciones de modelo");
        console.log("Modelo Publicado:" + ejecucion.tiempo.format("DD/MMM/YYYY HH:mm"));
        try {
            let estado = await this.getEstado();
            if (!estado) estado = {};
            if (!estado.ultimaEjecucionImportada || ejecucion.tiempo.isAfter(moment.tz(estado.ultimaEjecucionImportada, "UTC"))) {
                this.iniciaImportacion(ejecucion);
            } else {
                console.log("No hay nuevas publicaciones");
                this.callBuscador();
            }
        } catch(error) {
            console.error(error);
            this.callBuscador();
        }
    }

    iniciaImportacion(ejecucion) {
        this.tInicioImportacion = new Date().getTime();
        console.log(new Date().toLocaleString() + ": Iniciando Importación");
        ejecucion.importa()
            .then(resumen => {
                console.log("Importación finalizada:", JSON.stringify(resumen, null, 4)); 
                this.finalizaImportacion(ejecucion);               
            })
            .catch(error => {
                console.error("Error importando ejecución del modelo", error);
                this.callBuscador();
            })
    }
    
    async finalizaImportacion(ejecucion) {
        try {
            let estado = await this.getEstado();
            if (!estado) estado = {};
            estado.ultimaEjecucionImportada = ejecucion.tiempo.format("YYYY-MM-DD HH:mm");
            await this.setEstado(estado);
        } catch(error) {
            console.error(error);
        } finally {
            this.callBuscador();
            console.log(new Date().toLocaleString() + ": Importación Finalizada");
            console.log("--Tiempo Total:" + (new Date().getTime() - this.tInicioImportacion) / 1000 / 60 + " [min]");
        }
    }

    async test() {
        try {
            
            let ejecucion = new EjecucionModelo("2019-12-15 06:00");
            let descarga = new (require("./DescargaPronostico"))(ejecucion, 0);
            descarga.importa("/Volumes/JSamsung/geoportal/gfs4/data/downloads/gfs4_000.grb2");
            
           /*
           let info = await require("./GDAL").info("/Volumes/JSamsung/pomeo-data/downloads-bak/gfs.06_26.t12z.pgrb2.0p25.f001");
           console.log("info", info);
           let st = info.bands.reduce((st, b) => {
                let m = b.metadata[""];
                st += b.band + ";" + b.description.replace(/\;/g, "_") + ";";
                st += m.GRIB_ELEMENT.replace(/\;/g, "_") + ";";
                st += m.GRIB_COMMENT.replace(/\;/g, "_") + ";";
                st += m.GRIB_UNIT.replace(/\;/g, "_") + ";" + m.GRIB_SHORT_NAME.replace(/\;/g, "_");
                st += ";;;\n";
                return st;
           }, "Nº Banda;Descripción Banda;Variable GFS;Comentarios;Unidad Medida;Short Name;Código POMeO;Nombre POMeO;Indice Nível POMeO (inicia en cero);Descripción Nivel POMeO\n");
           fs.writeFileSync("/Volumes/JSamsung/pomeo-data/downloads-bak/variables-gfs.csv", st);
           */
        } catch(error) {
            console.error(error);
        }
    }
}

module.exports = Downloader.instance;